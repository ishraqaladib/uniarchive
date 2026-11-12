import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { now, uploadsDir } from "./db.js";
import {
  authentication,
  requireUser,
  roles,
  safeUser,
  signSession,
  cookieOptions,
  production,
  universityEmail,
  sendToken,
} from "./auth.js";
const uid = () => crypto.randomUUID();
const error = (status, message) =>
  Object.assign(new Error(message), { status });
const clean = z.string().trim().min(1).max(180);
const password = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use no more than 72 characters.")
  .refine(
    (p) => Buffer.byteLength(p, "utf8") <= 72,
    "Password must be at most 72 UTF-8 bytes.",
  );
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const courseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .transform((s) => s.toUpperCase()),
  name: clean.max(150),
  credits: z.coerce.number().min(0.5).max(10),
  semester: z.coerce.number().int().min(1).max(16),
  department_id: z.string().uuid(),
});
const documentSchema = z.object({
  title: clean,
  type: z.enum(["Note", "Slide", "Past Paper"]),
  year: z.coerce
    .number()
    .int()
    .min(1990)
    .max(new Date().getFullYear() + 1),
  course_id: z.string().uuid(),
  resource_kind: z
    .enum(["Notes", "Assignment", "Class Task", "Summary"])
    .default("Notes"),
});
const docSelect = `SELECT d.*, c.code AS course_code,c.name AS course_name,c.semester,c.department_id,u.name AS uploader_name,s.status,s.reason,s.reviewed_at FROM documents d JOIN courses c ON c.id=d.course_id JOIN users u ON u.id=d.uploader_id JOIN submissions s ON s.document_id=d.id`;
function publicDoc(d) {
  const { file_name, ...rest } = d;
  return rest;
}
async function getDoc(db, id) {
  const [d] = await db.query(docSelect + " WHERE d.id=?", [id]);
  if (!d) throw error(404, "Document not found.");
  return d;
}
function canRead(u, d) {
  return (
    d.status === "Approved" ||
    d.uploader_id === u.id ||
    ["Admin", "Moderator"].includes(u.role)
  );
}
async function removeDocs(tx, where, args) {
  const docs = await tx.query(
    "SELECT id,file_name FROM documents WHERE " + where,
    args,
  );
  for (const d of docs)
    await tx.query("DELETE FROM documents WHERE id=?", [d.id]);
  return docs;
}
async function unlinkDocs(docs) {
  for (const d of docs)
    await fs.unlink(path.join(uploadsDir, d.file_name)).catch((e) => {
      if (e.code !== "ENOENT")
        console.error("File cleanup failed for document", d.id);
    });
}
export function createApp(db) {
  const app = express();
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: production ? undefined : false }));
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const expected = new URL(process.env.APP_URL || "http://localhost:3000")
        .origin;
      if (
        req.get("X-UniArchive-Client") !== "web" ||
        (origin && origin !== expected)
      )
        return res.status(403).json({ error: "Request origin not allowed." });
    }
    next();
  });
  app.use("/api", authentication(db));
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again in 15 minutes." },
  });
  app.use("/api/auth", authLimiter);
  app.get("/api/config", async (req, res) => {
    const [settings] = await db.query("SELECT * FROM settings WHERE id=?", [
      "main",
    ]);
    res.json({
      maxUploadMb: settings.max_upload_mb,
      supportEmail: process.env.SUPPORT_EMAIL || null,
      emailVerification: true,
    });
  });
  app.get("/api/stats", async (req, res) => {
    const [docs] = await db.query(
      "SELECT COUNT(*) AS count FROM submissions WHERE status='Approved'",
    );
    const [courses] = await db.query("SELECT COUNT(*) AS count FROM courses");
    const [users] = await db.query(
      "SELECT COUNT(*) AS count FROM users WHERE status='Active'",
    );
    const [downloads] = await db.query(
      "SELECT COUNT(*) AS count FROM downloads",
    );
    res.json({
      documents: docs.count,
      courses: courses.count,
      students: users.count,
      downloads: downloads.count,
    });
  });
  app.get("/api/auth/me", (req, res) =>
    res.json({ user: req.user ? safeUser(req.user) : null }),
  );
  app.post("/api/auth/register", async (req, res) => {
    const b = z
      .object({
        name: clean.max(100),
        email: emailSchema,
        password,
        confirmPassword: z.string(),
      })
      .parse(req.body);
    if (b.password !== b.confirmPassword)
      throw error(400, "Passwords must match.");
    if (!universityEmail(b.email))
      throw error(
        400,
        "Use a university email address. Contact your administrator if your university domain is not recognised.",
      );
    const hash = await bcrypt.hash(b.password, 12);
    const u = { id: uid(), name: b.name, email: b.email };
    await db.query(
      "INSERT INTO users (id,name,email,password_hash,role,status,verified,session_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [u.id, u.name, u.email, hash, "Student", "Active", 0, 0, now()],
    );
    await sendToken(db, u, "verify");
    res.status(201).json({
      message:
        "Account created. Check your university email for a verification link. In local development, run npm run mail to read it.",
    });
  });
  app.post("/api/auth/login", async (req, res) => {
    const b = z
      .object({ email: emailSchema, password: z.string().min(1).max(72) })
      .parse(req.body);
    const [u] = await db.query("SELECT * FROM users WHERE email=?", [b.email]);
    if (!u || !(await bcrypt.compare(b.password, u.password_hash)))
      throw error(401, "Email or password is incorrect.");
    if (u.status !== "Active")
      throw error(
        403,
        "Your account is " +
          u.status.toLowerCase() +
          ". Contact your administrator.",
      );
    if (!u.verified)
      throw error(403, "Verify your university email before logging in.");
    signSession(res, u);
    res.json({ user: safeUser(u) });
  });
  app.post("/api/auth/logout", requireUser, async (req, res) => {
    await db.query(
      "UPDATE users SET session_version=session_version+1 WHERE id=?",
      [req.user.id],
    );
    res.clearCookie("uniarchive_session", {
      ...cookieOptions,
      maxAge: undefined,
    });
    res.json({ message: "Logged out." });
  });
  app.post("/api/auth/forgot-password", async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    const [u] = await db.query("SELECT * FROM users WHERE email=?", [email]);
    if (u && u.status === "Active") await sendToken(db, u, "reset");
    res.json({
      message:
        "If an active account exists for that email, a reset link has been sent. For local mail, run npm run mail.",
    });
  });
  app.post("/api/auth/resend-verification", async (req, res) => {
    const email = emailSchema.parse(req.body.email);
    const [u] = await db.query("SELECT * FROM users WHERE email=?", [email]);
    if (u && !u.verified && u.status === "Active")
      await sendToken(db, u, "verify");
    res.json({
      message: "If verification is needed, a new link has been sent.",
    });
  });
  app.post("/api/auth/verify-email", async (req, res) => {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.body.token);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await db.transaction(async (tx) => {
      const [t] = await tx.query("SELECT * FROM tokens WHERE id=? AND kind=?", [
        hash,
        "verify",
      ]);
      if (!t || t.expires_at < now())
        throw error(400, "This verification link is invalid or expired.");
      await tx.query("UPDATE users SET verified=1 WHERE id=?", [t.user_id]);
      await tx.query("DELETE FROM tokens WHERE id=?", [hash]);
    });
    res.json({ message: "Email verified. You can now log in." });
  });
  app.post("/api/auth/reset-password", async (req, res) => {
    const b = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password,
        confirmPassword: z.string(),
      })
      .parse(req.body);
    if (b.password !== b.confirmPassword)
      throw error(400, "Passwords must match.");
    const hash = crypto.createHash("sha256").update(b.token).digest("hex");
    const pass = await bcrypt.hash(b.password, 12);
    await db.transaction(async (tx) => {
      const [t] = await tx.query("SELECT * FROM tokens WHERE id=? AND kind=?", [
        hash,
        "reset",
      ]);
      if (!t || t.expires_at < now())
        throw error(400, "This reset link is invalid or expired.");
      await tx.query(
        "UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=?",
        [pass, t.user_id],
      );
      await tx.query("DELETE FROM tokens WHERE user_id=? AND kind=?", [
        t.user_id,
        "reset",
      ]);
    });
    res.json({ message: "Password updated. Log in with your new password." });
  });
  app.get("/api/departments", async (req, res) =>
    res.json(await db.query("SELECT * FROM departments ORDER BY name")),
  );
  app.post("/api/departments", roles("Admin"), async (req, res) => {
    const name = clean.max(120).parse(req.body.name);
    const id = uid();
    await db.query("INSERT INTO departments (id,name) VALUES (?,?)", [
      id,
      name,
    ]);
    res.status(201).json({ id, name });
  });
  app.put("/api/departments/:id", roles("Admin"), async (req, res) => {
    const name = clean.max(120).parse(req.body.name);
    const r = await db.query("UPDATE departments SET name=? WHERE id=?", [
      name,
      req.params.id,
    ]);
    if (!r.changes) throw error(404, "Department not found.");
    res.json({ message: "Department updated." });
  });
  app.delete("/api/departments/:id", roles("Admin"), async (req, res) => {
    await db.transaction(async (tx) => {
      const [c] = await tx.query(
        "SELECT COUNT(*) AS count FROM courses WHERE department_id=?",
        [req.params.id],
      );
      if (c.count)
        throw error(
          409,
          "Move or remove the courses in this department first.",
        );
      await tx.query("DELETE FROM departments WHERE id=?", [req.params.id]);
    });
    res.json({ message: "Department deleted." });
  });
  app.get("/api/courses", async (req, res) => {
    const q = String(req.query.q || "")
      .trim()
      .slice(0, 100);
    const args = [];
    let where = "";
    if (q) {
      where = " WHERE (LOWER(c.code) LIKE ? OR LOWER(c.name) LIKE ?)";
      args.push("%" + q.toLowerCase() + "%", "%" + q.toLowerCase() + "%");
    }
    const rows = await db.query(
      `SELECT c.*,dep.name AS department_name,(SELECT COUNT(*) FROM documents d JOIN submissions s ON d.id=s.document_id WHERE d.course_id=c.id AND s.status='Approved') AS document_count FROM courses c JOIN departments dep ON c.department_id=dep.id` +
        where +
        " ORDER BY dep.name,c.semester,c.code",
      args,
    );
    res.json(rows);
  });
  app.post("/api/courses", roles("Admin"), async (req, res) => {
    const b = courseSchema.parse(req.body);
    const id = uid();
    await db.query(
      "INSERT INTO courses (id,code,name,credits,semester,department_id) VALUES (?,?,?,?,?,?)",
      [id, b.code, b.name, b.credits, b.semester, b.department_id],
    );
    res.status(201).json({ id, ...b });
  });
  app.put("/api/courses/:id", roles("Admin"), async (req, res) => {
    const b = courseSchema.parse(req.body);
    const r = await db.query(
      "UPDATE courses SET code=?,name=?,credits=?,semester=?,department_id=? WHERE id=?",
      [b.code, b.name, b.credits, b.semester, b.department_id, req.params.id],
    );
    if (!r.changes) throw error(404, "Course not found.");
    res.json({ message: "Course updated." });
  });
  app.delete("/api/courses/:id", roles("Admin"), async (req, res) => {
    const docs = await db.transaction(async (tx) => {
      const [c] = await tx.query(
        "SELECT COUNT(*) AS count FROM documents d JOIN submissions s ON s.document_id=d.id WHERE d.course_id=? AND s.status=?",
        [req.params.id, "Approved"],
      );
      if (c.count && req.query.confirm !== "true")
        throw error(
          409,
          "This course contains approved documents. Confirm removal of the course and its documents.",
        );
      const d = await removeDocs(tx, "course_id=?", [req.params.id]);
      await tx.query("DELETE FROM courses WHERE id=?", [req.params.id]);
      return d;
    });
    await unlinkDocs(docs);
    res.json({ message: "Course and its documents deleted." });
  });
  app.get("/api/documents", requireUser, async (req, res) => {
    const where = [],
      args = [];
    const mode = req.query.mode || "library";
    if (mode === "mine") {
      where.push("d.uploader_id=?");
      args.push(req.user.id);
    } else if (mode === "queue") {
      if (!["Admin", "Moderator"].includes(req.user.role))
        throw error(403, "Moderator access required.");
      where.push("s.status=?");
      args.push(
        ["Pending", "Approved", "Rejected"].includes(req.query.status)
          ? req.query.status
          : "Pending",
      );
    } else {
      where.push("s.status='Approved'");
      if (mode === "saved") {
        where.push(
          "d.id IN (SELECT document_id FROM collections WHERE user_id=?)",
        );
        args.push(req.user.id);
      }
    }
    for (const [key, col] of [
      ["course", "d.course_id"],
      ["type", "d.type"],
      ["year", "d.year"],
      ["kind", "d.resource_kind"],
    ])
      if (req.query[key]) {
        where.push(col + "=?");
        args.push(String(req.query[key]).slice(0, 100));
      }
    if (req.query.q) {
      where.push("(LOWER(d.title) LIKE ? OR LOWER(c.code) LIKE ?)");
      const q = "%" + String(req.query.q).toLowerCase().slice(0, 100) + "%";
      args.push(q, q);
    }
    const rows = await db.query(
      docSelect +
        " WHERE " +
        where.join(" AND ") +
        " ORDER BY d.created_at DESC",
      args,
    );
    const saved = await db.query(
      "SELECT document_id FROM collections WHERE user_id=?",
      [req.user.id],
    );
    res.json(
      rows.map((d) => ({
        ...publicDoc(d),
        saved: saved.some((s) => s.document_id === d.id),
      })),
    );
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 20 * 1024 * 1024 + 1,
      files: 1,
      fields: 6,
      parts: 7,
      fieldSize: 4096,
    },
    fileFilter: (req, file, cb) =>
      cb(
        null,
        file.mimetype === "application/pdf" &&
          /\.pdf$/i.test(file.originalname),
      ),
  });
  app.post(
    "/api/documents",
    requireUser,
    upload.single("file"),
    async (req, res) => {
      const b = documentSchema.parse(req.body);
      if (!req.file)
        throw error(400, "Choose a PDF file. Only .pdf files are accepted.");
      const [settings] = await db.query(
        "SELECT max_upload_mb FROM settings WHERE id=?",
        ["main"],
      );
      if (req.file.size > settings.max_upload_mb * 1024 * 1024)
        throw error(
          400,
          `The maximum upload size is ${settings.max_upload_mb} MB.`,
        );
      if (!req.file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw error(400, "The uploaded file is not a valid PDF.");
      try {
        const p = await PDFDocument.load(req.file.buffer);
        if (!p.getPageCount()) throw new Error();
      } catch {
        throw error(
          400,
          "This PDF cannot be read. Upload a valid, unencrypted PDF.",
        );
      }
      const id = uid(),
        filename = id + ".pdf";
      await fs.writeFile(path.join(uploadsDir, filename), req.file.buffer, {
        mode: 0o600,
      });
      try {
        await db.transaction(async (tx) => {
          const [count] = await tx.query(
            "SELECT COUNT(*) AS count FROM documents WHERE uploader_id=?",
            [req.user.id],
          );
          if (req.user.role === "Student" && count.count >= 10)
            throw error(
              409,
              "The Free plan allows up to 10 documents. Remove an existing upload before adding another.",
            );
          await tx.query(
            "INSERT INTO documents (id,title,type,resource_kind,year,course_id,uploader_id,file_name,original_name,size_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [
              id,
              b.title,
              b.type,
              b.resource_kind,
              b.year,
              b.course_id,
              req.user.id,
              filename,
              path.basename(req.file.originalname),
              req.file.size,
              now(),
            ],
          );
          await tx.query(
            "INSERT INTO submissions (id,document_id,status) VALUES (?,?,?)",
            [uid(), id, "Pending"],
          );
        });
      } catch (e) {
        await fs.unlink(path.join(uploadsDir, filename));
        throw e;
      }
      res.status(201).json({
        id,
        message: "PDF uploaded. Your submission is pending review.",
      });
    },
  );
  app.put("/api/documents/:id", requireUser, async (req, res) => {
    const b = documentSchema.parse(req.body);
    await db.transaction(async (tx) => {
      const d = await getDoc(tx, req.params.id);
      if (d.uploader_id !== req.user.id && req.user.role !== "Admin")
        throw error(
          403,
          "Only the uploader or an admin can edit this document.",
        );
      await tx.query(
        "UPDATE documents SET title=?,type=?,resource_kind=?,year=?,course_id=? WHERE id=?",
        [b.title, b.type, b.resource_kind, b.year, b.course_id, d.id],
      );
      await tx.query(
        "UPDATE submissions SET status=?,reviewed_by=NULL,reviewed_at=NULL,reason=NULL WHERE document_id=?",
        ["Pending", d.id],
      );
    });
    res.json({
      message: "Metadata updated. The document has been returned for review.",
    });
  });
  app.delete("/api/documents/:id", requireUser, async (req, res) => {
    const docs = await db.transaction(async (tx) => {
      const d = await getDoc(tx, req.params.id);
      if (d.uploader_id !== req.user.id && req.user.role !== "Admin")
        throw error(
          403,
          "Only the uploader or an admin can delete this document.",
        );
      return removeDocs(tx, "id=?", [d.id]);
    });
    await unlinkDocs(docs);
    res.json({ message: "Document deleted." });
  });
  app.get("/api/documents/:id/file", requireUser, async (req, res) => {
    const d = await getDoc(db, req.params.id);
    if (!canRead(req.user, d))
      throw error(403, "This file has not been approved.");
    const file = path.join(uploadsDir, d.file_name);
    try {
      await fs.access(file);
    } catch {
      throw error(404, "The stored PDF is missing. Contact the administrator.");
    }
    if (req.query.download === "true") {
      await db.query(
        "INSERT INTO downloads (id,document_id,user_id,created_at) VALUES (?,?,?,?)",
        [uid(), d.id, req.user.id, now()],
      );
      return res.download(file, d.original_name);
    }
    res.set("Content-Security-Policy", "sandbox; default-src 'none'");
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="document.pdf"`);
    res.sendFile(file);
  });
  app.patch(
    "/api/submissions/:id",
    roles("Admin", "Moderator"),
    async (req, res) => {
      const b = z
        .object({
          status: z.enum(["Approved", "Rejected"]),
          reason: z.string().trim().max(500).default(""),
        })
        .parse(req.body);
      await db.transaction(async (tx) => {
        const d = await getDoc(tx, req.params.id);
        if (d.status !== "Pending")
          throw error(409, "This submission has already been reviewed.");
        await tx.query(
          "UPDATE submissions SET status=?,reason=?,reviewed_by=?,reviewed_at=? WHERE document_id=?",
          [b.status, b.reason, req.user.id, now(), d.id],
        );
      });
      res.json({ message: "Submission " + b.status.toLowerCase() + "." });
    },
  );
  app.post("/api/documents/:id/save", requireUser, async (req, res) => {
    await db.transaction(async (tx) => {
      const d = await getDoc(tx, req.params.id);
      if (d.status !== "Approved")
        throw error(400, "Only approved documents can be saved.");
      const [s] = await tx.query(
        "SELECT id FROM collections WHERE user_id=? AND document_id=?",
        [req.user.id, d.id],
      );
      if (s) await tx.query("DELETE FROM collections WHERE id=?", [s.id]);
      else
        await tx.query(
          "INSERT INTO collections (id,user_id,document_id) VALUES (?,?,?)",
          [uid(), req.user.id, d.id],
        );
    });
    res.json({ message: "Saved collection updated." });
  });
  app.get("/api/overview", requireUser, async (req, res) => {
    const args = [req.user.id];
    const [counts] = await db.query(
      `SELECT COUNT(*) AS uploads,SUM(CASE WHEN s.status='Approved' THEN 1 ELSE 0 END) AS approved,SUM(CASE WHEN s.status='Pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN s.status='Rejected' THEN 1 ELSE 0 END) AS rejected FROM documents d JOIN submissions s ON s.document_id=d.id WHERE d.uploader_id=?`,
      args,
    );
    const [dl] = await db.query(
      "SELECT COUNT(*) AS downloads FROM downloads dl JOIN documents d ON d.id=dl.document_id WHERE d.uploader_id=?",
      args,
    );
    const activity = await db.query(
      "SELECT SUBSTR(dl.created_at,1,10) AS day,COUNT(*) AS count FROM downloads dl JOIN documents d ON d.id=dl.document_id WHERE d.uploader_id=? GROUP BY SUBSTR(dl.created_at,1,10) ORDER BY day DESC LIMIT 14",
      args,
    );
    res.json({
      ...counts,
      downloads: dl.downloads,
      activity: activity.reverse(),
    });
  });
  app.get("/api/billing", requireUser, async (req, res) =>
    res.json({
      plan: "Free",
      sample: true,
      payments: await db.query(
        "SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC",
        [req.user.id],
      ),
    }),
  );
  app.get("/api/users", roles("Admin"), async (req, res) =>
    res.json(
      await db.query(
        "SELECT u.id,u.name,u.email,u.role,u.status,u.verified,u.created_at,(SELECT COUNT(*) FROM documents d WHERE d.uploader_id=u.id) AS upload_count FROM users u ORDER BY u.created_at",
      ),
    ),
  );
  app.post("/api/users", roles("Admin"), async (req, res) => {
    const b = z
      .object({
        name: clean.max(100),
        email: emailSchema,
        role: z.enum(["Student", "Moderator", "Admin"]),
      })
      .parse(req.body);
    if (!universityEmail(b.email))
      throw error(400, "A university email address is required.");
    const u = { id: uid(), name: b.name, email: b.email };
    await db.query(
      "INSERT INTO users (id,name,email,password_hash,role,status,verified,session_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        u.id,
        u.name,
        u.email,
        await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12),
        b.role,
        "Active",
        0,
        0,
        now(),
      ],
    );
    await sendToken(db, u, "verify");
    await sendToken(db, u, "reset");
    res.status(201).json({
      message:
        "User invited. Verification and password setup links have been sent.",
    });
  });
  async function protectLastAdmin(tx, user, newRole, newStatus) {
    if (
      user.role === "Admin" &&
      user.status === "Active" &&
      (newRole !== "Admin" || newStatus !== "Active")
    ) {
      const [r] = await tx.query(
        "SELECT COUNT(*) AS count FROM users WHERE role='Admin' AND status='Active'",
      );
      if (r.count <= 1)
        throw error(409, "Keep at least one active administrator.");
    }
  }
  app.patch("/api/users/:id", roles("Admin"), async (req, res) => {
    const b = z
      .object({
        role: z.enum(["Student", "Moderator", "Admin"]),
        status: z.enum(["Active", "Suspended", "Banned"]),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const [u] = await tx.query("SELECT * FROM users WHERE id=?", [
        req.params.id,
      ]);
      if (!u) throw error(404, "User not found.");
      await protectLastAdmin(tx, u, b.role, b.status);
      await tx.query(
        "UPDATE users SET role=?,status=?,session_version=session_version+1 WHERE id=?",
        [b.role, b.status, u.id],
      );
    });
    res.json({
      message: "User access updated. Existing sessions have been revoked.",
    });
  });
  async function deleteUser(userId) {
    const docs = await db.transaction(async (tx) => {
      const [u] = await tx.query("SELECT * FROM users WHERE id=?", [userId]);
      if (!u) throw error(404, "User not found.");
      await protectLastAdmin(tx, u, "deleted", "deleted");
      const docs = await removeDocs(tx, "uploader_id=?", [u.id]);
      await tx.query("DELETE FROM users WHERE id=?", [u.id]);
      return docs;
    });
    await unlinkDocs(docs);
  }
  app.delete("/api/users/:id", roles("Admin"), async (req, res) => {
    await deleteUser(req.params.id);
    res.json({ message: "User and their uploads deleted." });
  });
  app.delete("/api/account", requireUser, async (req, res) => {
    const b = z.object({ password: z.string() }).parse(req.body);
    if (!(await bcrypt.compare(b.password, req.user.password_hash)))
      throw error(400, "Password is incorrect.");
    await deleteUser(req.user.id);
    res.clearCookie("uniarchive_session", {
      ...cookieOptions,
      maxAge: undefined,
    });
    res.json({ message: "Account deleted." });
  });
  app.patch("/api/settings", roles("Admin"), async (req, res) => {
    const maxUploadMb = z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .parse(req.body.maxUploadMb);
    await db.query("UPDATE settings SET max_upload_mb=? WHERE id=?", [
      maxUploadMb,
      "main",
    ]);
    res.json({ message: "Upload limit updated.", maxUploadMb });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" "),
      });
    if (err instanceof multer.MulterError)
      return res.status(400).json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "PDF files must be no larger than 20 MB."
            : "The upload exceeds the allowed number or size of fields.",
      });
    if (/UNIQUE constraint|Duplicate entry/i.test(err.message))
      return res.status(409).json({
        error: "That email, course code, or department name already exists.",
      });
    if (/FOREIGN KEY constraint|foreign key constraint/i.test(err.message))
      return res.status(400).json({
        error:
          "A selected course or department no longer exists, or this record is still in use.",
      });
    console.error(err.status ? err.message : err);
    res.status(err.status || 500).json({
      error: err.status
        ? err.message
        : "Something went wrong. Please try again.",
    });
  });
  return app;
}
