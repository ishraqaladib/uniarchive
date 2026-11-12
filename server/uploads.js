import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { requireUser } from "./auth.js";
import { queueFileCleanup, flushFileCleanup } from "./storage.js";
import { now } from "./db.js";
export const chunkSize = 3 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
export async function validatePdf(bytes) {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw fail(400, "The uploaded file is not a valid PDF.");
  try {
    const pdf = await PDFDocument.load(bytes);
    if (!pdf.getPageCount()) throw new Error();
  } catch {
    throw fail(
      400,
      "This PDF cannot be read. Upload a valid, unencrypted PDF.",
    );
  }
}
export async function insertDocument(
  tx,
  user,
  fields,
  stored,
  id,
  size,
  filename,
) {
  // Lock a shared user row so concurrent serverless instances enforce one upload cap.
  await tx.query(
    "SELECT id FROM users WHERE id=?" +
      (tx.dialect === "mysql" ? " FOR UPDATE" : ""),
    [user.id],
  );
  const documents = await tx.query(
    "SELECT id FROM documents WHERE uploader_id=?" +
      (tx.dialect === "mysql" ? " FOR UPDATE" : ""),
    [user.id],
  );
  if (user.role === "Student" && documents.length >= 10)
    throw fail(
      409,
      "The Free plan allows up to 10 documents. Remove an existing upload before adding another.",
    );
  await tx.query(
    "INSERT INTO documents (id,title,type,resource_kind,year,course_id,uploader_id,file_name,storage_provider,original_name,size_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      fields.title,
      fields.type,
      fields.resource_kind,
      fields.year,
      fields.course_id,
      user.id,
      stored.file_name,
      stored.storage_provider,
      filename,
      size,
      now(),
    ],
  );
  await tx.query(
    "INSERT INTO submissions (id,document_id,status) VALUES (?,?,?)",
    [crypto.randomUUID(), id, "Pending"],
  );
}
export async function expireUploads(db) {
  await db.query("DELETE FROM upload_sessions WHERE expires_at<?", [now()]);
}
export function installUploadRoutes(app, db, storage, documentSchema) {
  const locked = db.dialect === "mysql" ? " FOR UPDATE" : "";
  async function session(tx, req) {
    const [s] = await tx.query(
      "SELECT * FROM upload_sessions WHERE id=? AND user_id=?" + locked,
      [req.params.id, req.user.id],
    );
    if (!s || s.expires_at < now())
      throw fail(404, "This upload has expired. Please select the file again.");
    return s;
  }
  app.post("/api/uploads", requireUser, async (req, res) => {
    if (storage.provider !== "google-drive")
      throw fail(400, "Chunked uploads require cloud storage.");
    const fields = documentSchema.parse(req.body);
    const size = Number(req.body.size);
    const filename = path.basename(String(req.body.filename || ""));
    if (
      !Number.isSafeInteger(size) ||
      size < 5 ||
      !/\.pdf$/i.test(filename) ||
      filename.length > 255
    )
      throw fail(400, "Choose a valid PDF file.");
    await expireUploads(db);
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const [settings] = await tx.query(
        "SELECT max_upload_mb FROM settings WHERE id=?" + locked,
        ["main"],
      );
      if (size > settings.max_upload_mb * 1024 * 1024)
        throw fail(
          400,
          `The maximum upload size is ${settings.max_upload_mb} MB.`,
        );
      const [course] = await tx.query("SELECT id FROM courses WHERE id=?", [
        fields.course_id,
      ]);
      if (!course) throw fail(400, "The selected course no longer exists.");
      const [active] = await tx.query(
        "SELECT COUNT(*) AS count FROM upload_sessions WHERE user_id=?",
        [req.user.id],
      );
      const [reserved] = await tx.query(
        "SELECT COALESCE(SUM(total_bytes),0) AS bytes FROM upload_sessions",
      );
      if (
        Number(active.count) >= 2 ||
        Number(reserved.bytes) + size > 100 * 1024 * 1024
      )
        throw fail(
          429,
          "Upload capacity is busy. Finish your current upload or try again later.",
        );
      const [count] = await tx.query(
        "SELECT COUNT(*) AS count FROM documents WHERE uploader_id=?",
        [req.user.id],
      );
      if (req.user.role === "Student" && Number(count.count) >= 10)
        throw fail(
          409,
          "The Free plan allows up to 10 documents. Remove an existing upload before adding another.",
        );
      await tx.query(
        "INSERT INTO upload_sessions (id,user_id,metadata,total_bytes,expires_at) VALUES (?,?,?,?,?)",
        [
          id,
          req.user.id,
          JSON.stringify({ ...fields, filename }),
          size,
          new Date(Date.now() + 3600000).toISOString(),
        ],
      );
    });
    res.status(201).json({ id, chunkSize });
  });
  app.put(
    "/api/uploads/:id/chunks/:index",
    requireUser,
    express.raw({ type: "application/octet-stream", limit: chunkSize }),
    async (req, res) => {
      const index = Number(req.params.index);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        !Buffer.isBuffer(req.body)
      )
        throw fail(400, "Invalid upload chunk.");
      await db.transaction(async (tx) => {
        const s = await session(tx, req);
        const expected = Math.min(
          chunkSize,
          Number(s.total_bytes) - index * chunkSize,
        );
        if (expected <= 0 || req.body.length !== expected)
          throw fail(400, "The upload chunk size is incorrect.");
        if (
          index === 0 &&
          !req.body.subarray(0, 5).equals(Buffer.from("%PDF-"))
        )
          throw fail(400, "The uploaded file is not a valid PDF.");
        const [existing] = await tx.query(
          "SELECT data FROM upload_chunks WHERE upload_id=? AND chunk_index=?",
          [s.id, index],
        );
        if (existing) {
          if (!Buffer.from(existing.data).equals(req.body))
            throw fail(
              409,
              "This upload chunk does not match. Start a new upload.",
            );
        } else
          await tx.query(
            "INSERT INTO upload_chunks (upload_id,chunk_index,data) VALUES (?,?,?)",
            [s.id, index, req.body],
          );
      });
      res.json({ received: true });
    },
  );
  app.post("/api/uploads/:id/complete", requireUser, async (req, res) => {
    let stored;
    try {
      await db.transaction(async (tx) => {
        const [existing] = await tx.query(
          "SELECT id,uploader_id FROM documents WHERE id=?",
          [req.params.id],
        );
        if (existing?.uploader_id === req.user.id) return;
        const s = await session(tx, req);
        const meta = JSON.parse(s.metadata);
        const chunks = await tx.query(
          "SELECT chunk_index,data FROM upload_chunks WHERE upload_id=? ORDER BY chunk_index",
          [s.id],
        );
        if (
          chunks.length !== Math.ceil(s.total_bytes / chunkSize) ||
          chunks.some((c, i) => c.chunk_index !== i)
        )
          throw fail(409, "The upload is incomplete. Please try again.");
        const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c.data)));
        if (bytes.length !== Number(s.total_bytes))
          throw fail(400, "The uploaded size does not match.");
        const [settings] = await tx.query(
          "SELECT max_upload_mb FROM settings WHERE id=?",
          ["main"],
        );
        if (bytes.length > settings.max_upload_mb * 1024 * 1024)
          throw fail(400, "The upload exceeds the current size limit.");
        await validatePdf(bytes);
        stored = await storage.put({
          id: s.id,
          buffer: bytes,
          name: meta.filename,
        });
        await insertDocument(
          tx,
          req.user,
          meta,
          stored,
          s.id,
          bytes.length,
          meta.filename,
        );
        await tx.query("DELETE FROM upload_sessions WHERE id=?", [s.id]);
      });
    } catch (e) {
      if (stored) {
        await queueFileCleanup(db, { id: req.params.id, ...stored });
        await flushFileCleanup(db, storage);
      }
      throw e;
    }
    res.status(201).json({
      id: req.params.id,
      message: "PDF uploaded. Your submission is pending review.",
    });
  });
  app.delete("/api/uploads/:id", requireUser, async (req, res) => {
    await db.query("DELETE FROM upload_sessions WHERE id=? AND user_id=?", [
      req.params.id,
      req.user.id,
    ]);
    res.json({ message: "Incomplete upload removed." });
  });
}
