import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { openDatabase, dataDir } from "../server/db.js";
import {
  createStorage,
  connectDrive,
  driveFailure,
} from "../server/storage.js";
import { createApp } from "../server/app.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Run this demonstration check only in local development.");
const storage = createStorage();
if (storage.provider !== "google-drive")
  throw new Error("Run npm run drive:setup first.");
const db = await openDatabase();
try {
  await storage.check();
  const [existing] = await db.query(
    "SELECT id FROM documents WHERE title=? AND storage_provider=?",
    ["UniArchive cloud connection check", "google-drive"],
  );
  if (existing) {
    console.log(
      JSON.stringify({
        verified: false,
        previousCheckExists: true,
        documentId: existing.id,
        message:
          "A previous connection-check document exists. Open it in the app to check access.",
      }),
    );
    process.exitCode = 0;
  } else {
    const app = createApp(db, { storage });
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .set("X-UniArchive-Client", "web")
      .send({
        email: "admin@uniarchive.edu",
        password: process.env.DEMO_PASSWORD || "UniArchive123!",
      });
    if (login.status !== 200)
      throw new Error(
        "Local demo admin login failed. Use your own application account to test the connection.",
      );
    const [course] = await db.query("SELECT id FROM courses WHERE code=?", [
      "CSE 323",
    ]);
    if (!course) throw new Error("The local demo CSE 323 course is missing.");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    [
      "UniArchive cloud connection check",
      "This PDF confirms that the application can store and retrieve",
      "a document in the connected Google Drive account.",
      "",
      "This is generated demonstration content, not university material.",
    ].forEach((line, i) =>
      page.drawText(line, { x: 45, y: 775 - i * 26, size: i ? 12 : 22, font }),
    );
    const bytes = Buffer.from(await pdf.save());
    const uploaded = await agent
      .post("/api/documents")
      .set("X-UniArchive-Client", "web")
      .field("title", "UniArchive cloud connection check")
      .field("type", "Note")
      .field("year", String(new Date().getFullYear()))
      .field("course_id", course.id)
      .attach("file", bytes, {
        filename: "UniArchive cloud connection check.pdf",
        contentType: "application/pdf",
      });
    if (uploaded.status !== 201)
      throw new Error(uploaded.body.error || "The cloud test upload failed.");
    const id = uploaded.body.id;
    const review = await agent
      .patch("/api/submissions/" + id)
      .set("X-UniArchive-Client", "web")
      .send({
        status: "Approved",
        reason: "Generated storage connection check.",
      });
    if (review.status !== 200)
      throw new Error("The test PDF uploaded but could not be approved.");
    const download = await agent
      .get("/api/documents/" + id + "/file?download=true")
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    if (
      download.status !== 200 ||
      !Buffer.isBuffer(download.body) ||
      !download.body.equals(bytes)
    )
      throw new Error(
        "The downloaded cloud PDF did not match the uploaded PDF.",
      );
    const [row] = await db.query("SELECT file_name FROM documents WHERE id=?", [
      id,
    ]);
    const { client, config } = await connectDrive();
    const { data: file } = await client.files.get({
      fileId: row.file_name,
      fields: "id,parents,permissions(type,role),size",
    });
    if (
      !file.parents?.includes(config.folder_id) ||
      file.permissions?.some((p) => p.type === "anyone" || p.type === "domain")
    )
      throw new Error("Check the privacy of the connected storage folder.");
    const result = {
      verified: true,
      documentId: id,
      folderId: config.folder_id,
      storage: "google-drive",
      private: true,
      uploadDownloadMatch: true,
      sizeBytes: Number(file.size),
    };
    await fs.writeFile(
      path.join(dataDir, "drive-check-result.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result));
  }
} catch (e) {
  console.error(
    e.response || e.config
      ? driveFailure(e).message
      : e.message || "Cloud verification failed.",
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
