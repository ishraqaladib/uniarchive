import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "uniarchive-test-"));
process.env.DATA_DIR = temp;
process.env.NODE_ENV = "test";
process.env.DB_CLIENT = "sqlite";
process.env.STORAGE_PROVIDER = "local";
process.env.JWT_SECRET = "test-secret-with-more-than-thirty-two-characters";
process.env.SMTP_HOST = "";
process.env.UNIVERSITY_DOMAINS = "restricted.example.edu"; // Obsolete settings must not restrict signup.
process.env.APP_URL = "http://localhost:3000";
const { openDatabase } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { seed } = await import("../scripts/seed.js");
const db = await openDatabase();
await seed(db);
const app = createApp(db);
const admin = request.agent(app),
  moderator = request.agent(app),
  student = request.agent(app),
  other = request.agent(app),
  newStudent = request.agent(app);
const mutate = (r) => r.set("X-UniArchive-Client", "web");
const pass = "UniArchive123!";
let courseId, uploadedId;
async function login(agent, email, password = pass) {
  return mutate(agent.post("/api/auth/login")).send({ email, password });
}
async function latestToken(kind, email) {
  const files = await fs.readdir(path.join(temp, "mail"));
  const mails = await Promise.all(
    files.map(async (f) =>
      JSON.parse(await fs.readFile(path.join(temp, "mail", f), "utf8")),
    ),
  );
  const match = mails
    .filter((m) => m.to === email && m.subject.toLowerCase().includes(kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  assert.ok(match);
  return new URL(match.text.match(/http:\/\/\S+/)[0]).searchParams.get("token");
}
after(async () => {
  await db.close();
  await fs.rm(temp, { recursive: true, force: true });
});
test("UniArchive user, document and administration workflows", async (t) => {
  await t.test(
    "blocks anonymous protected access and cross-origin writes",
    async () => {
      await request(app).get("/api/documents").expect(401);
      await request(app).post("/api/auth/login").send({}).expect(403);
      await mutate(request(app).post("/api/auth/login"))
        .set("Origin", "https://evil.example")
        .send({})
        .expect(403);
      await request(app).get("/api/departments").expect(200);
    },
  );
  await t.test(
    "any-email registration requires verification and rejects invalid input",
    async () => {
      await mutate(other.post("/api/auth/register"))
        .send({
          name: "Other Student",
          email: "not-an-email",
          password: pass,
          confirmPassword: pass,
        })
        .expect(400);
      await mutate(other.post("/api/auth/register"))
        .send({
          name: "Other Student",
          email: "other@gmail.com",
          password: pass,
          confirmPassword: "wrong",
        })
        .expect(400);
      await mutate(other.post("/api/auth/register"))
        .send({
          name: "Other Student",
          email: "other@gmail.com",
          password: pass,
          confirmPassword: pass,
          role: "Admin",
        })
        .expect(201);
      await login(other, "other@gmail.com").then((r) =>
        assert.equal(r.status, 403),
      );
      const token = await latestToken("verify", "other@gmail.com");
      await mutate(other.post("/api/auth/verify-email"))
        .send({ token })
        .expect(200);
      await mutate(other.post("/api/auth/verify-email"))
        .send({ token })
        .expect(400);
      const response = await login(other, "other@gmail.com");
      assert.equal(response.status, 200);
      assert.equal(response.body.user.role, "Student");
      assert.ok(response.headers["set-cookie"][0].includes("HttpOnly"));
      assert.ok(response.headers["set-cookie"][0].includes("SameSite=Lax"));
    },
  );
  await t.test(
    "logs in three roles and keeps credentials out of responses",
    async () => {
      for (const [agent, email] of [
        [admin, "admin@uniarchive.edu"],
        [moderator, "moderator@uniarchive.edu"],
        [student, "student@uniarchive.edu"],
      ]) {
        const r = await login(agent, email);
        assert.equal(r.status, 200);
        assert.equal(r.body.user.password_hash, undefined);
      }
      await login(student, "student@uniarchive.edu", "bad").then((r) =>
        assert.equal(r.status, 401),
      );
      await student.get("/api/users").expect(403);
      await moderator.get("/api/users").expect(403);
      await admin.get("/api/users").expect(200);
      await mutate(student.post("/api/departments"))
        .send({ name: "No" })
        .expect(403);
    },
  );
  await t.test(
    "profile pictures persist, replace, and remain private to their owner",
    async () => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      );
      const upload = (agent, bytes = png, name = "photo.png") =>
        mutate(agent.put("/api/account/avatar")).attach("picture", bytes, name);
      await upload(request(app)).expect(401);
      await mutate(student.put("/api/account/avatar")).expect(400);
      await upload(
        student,
        Buffer.from('<svg onload="alert(1)"></svg>'),
        "fake.png",
      ).expect(400);
      const tooLarge = await upload(
        student,
        Buffer.alloc(2 * 1024 * 1024 + 1),
      ).expect(400);
      assert.match(tooLarge.body.error, /2 MB/);
      const saved = await upload(student).expect(200);
      const url = saved.body.user.avatar_url;
      assert.match(url, /^\/api\/account\/avatar\//);
      assert.equal(saved.body.user.password_hash, undefined);
      const image = await student
        .get(url)
        .expect(200)
        .expect("Content-Type", /image\/png/);
      assert.deepEqual(image.body, png);
      assert.equal(image.headers["cache-control"], "no-store");
      await request(app).get(url).expect(401);
      await other.get(url).expect(404);
      assert.equal(
        (await student.get("/api/auth/me")).body.user.avatar_url,
        url,
      );
      assert.equal(
        (await login(student, "student@uniarchive.edu")).body.user.avatar_url,
        url,
      );
      const replaced = await upload(student).expect(200);
      assert.notEqual(replaced.body.user.avatar_url, url);
      await student.get(url).expect(404);
      const removed = await mutate(
        student.delete("/api/account/avatar"),
      ).expect(200);
      assert.equal(removed.body.user.avatar_url, null);
      await student.get(replaced.body.user.avatar_url).expect(404);
      assert.equal(
        (await student.get("/api/auth/me")).body.user.avatar_url,
        null,
      );
      // Keep photos on two accounts to check disk persistence and account cleanup.
      await upload(admin).expect(200);
      await upload(other).expect(200);
    },
  );
  await t.test(
    "lists courses by code and shows approved files only",
    async () => {
      const r = await student.get("/api/courses?q=CSE%20323").expect(200);
      assert.equal(r.body.length, 1);
      courseId = r.body[0].id;
      const docs = await student
        .get("/api/documents?course=" + courseId)
        .expect(200);
      assert.equal(docs.body.length, 3);
      assert.ok(
        docs.body.every((d) => d.status === "Approved" && !d.file_name),
      );
      await student.get("/api/documents?mode=queue").expect(403);
      const q = await moderator.get("/api/documents?mode=queue").expect(200);
      assert.equal(q.body.length, 1);
      await other.get("/api/documents/" + q.body[0].id + "/file").expect(403);
      await moderator
        .get("/api/documents/" + q.body[0].id + "/file")
        .expect(200);
    },
  );
  await t.test(
    "rejects non-PDF and forged PDFs before persisting",
    async () => {
      for (const file of [
        { name: "bad.txt", type: "text/plain", data: Buffer.from("bad") },
        {
          name: "bad.pdf",
          type: "application/pdf",
          data: Buffer.from("%PDF-broken"),
        },
      ]) {
        await mutate(student.post("/api/documents"))
          .field("title", "Invalid")
          .field("type", "Note")
          .field("year", "2026")
          .field("course_id", courseId)
          .field("resource_kind", "Notes")
          .attach("file", file.data, {
            filename: file.name,
            contentType: file.type,
          })
          .expect(400);
      }
      const r = await student.get("/api/documents?mode=mine");
      assert.equal(r.body.length, 6);
    },
  );
  await t.test(
    "uploads, moderates, filters, previews and downloads an actual PDF",
    async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const buffer = Buffer.from(await pdf.save());
      const uploaded = await mutate(student.post("/api/documents"))
        .field("title", "Test PDF")
        .field("type", "Note")
        .field("year", "2026")
        .field("course_id", courseId)
        .field("resource_kind", "Summary")
        .attach("file", buffer, {
          filename: "test.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      uploadedId = uploaded.body.id;
      await other.get("/api/documents/" + uploadedId + "/file").expect(403);
      await mutate(student.patch("/api/submissions/" + uploadedId))
        .send({ status: "Approved" })
        .expect(403);
      await mutate(moderator.patch("/api/submissions/" + uploadedId))
        .send({ status: "Approved" })
        .expect(200);
      await mutate(moderator.patch("/api/submissions/" + uploadedId))
        .send({ status: "Rejected" })
        .expect(409);
      const docs = await other
        .get(
          "/api/documents?course=" +
            courseId +
            "&kind=Summary&type=Note&year=2026&q=Test",
        )
        .expect(200);
      assert.equal(docs.body.length, 1);
      await other
        .get("/api/documents/" + uploadedId + "/file")
        .expect(200)
        .expect("Content-Type", /application\/pdf/);
      await other
        .get("/api/documents/" + uploadedId + "/file?download=true")
        .expect(200)
        .expect("Content-Disposition", /attachment/);
      const stats = await student.get("/api/overview");
      assert.equal(stats.body.downloads, 1);
      await mutate(other.post("/api/documents/" + uploadedId + "/save"))
        .send({})
        .expect(200);
      const saved = await other.get("/api/documents?mode=saved");
      assert.equal(saved.body.length, 1);
    },
  );
  await t.test(
    "enforces ownership and re-reviews edited metadata",
    async () => {
      const b = {
        title: "Edited PDF",
        type: "Past Paper",
        year: 2025,
        course_id: courseId,
        resource_kind: "Notes",
      };
      await mutate(other.put("/api/documents/" + uploadedId))
        .send(b)
        .expect(403);
      await mutate(other.delete("/api/documents/" + uploadedId)).expect(403);
      await mutate(student.put("/api/documents/" + uploadedId))
        .send(b)
        .expect(200);
      await other.get("/api/documents/" + uploadedId + "/file").expect(403);
      await mutate(moderator.patch("/api/submissions/" + uploadedId))
        .send({ status: "Rejected", reason: "Please check the title." })
        .expect(200);
      const mine = await student.get("/api/documents?mode=mine");
      assert.equal(
        mine.body.find((d) => d.id === uploadedId).reason,
        "Please check the title.",
      );
      await mutate(student.delete("/api/documents/" + uploadedId)).expect(200);
      await fs.access(path.join(temp, "uploads", uploadedId + ".pdf")).then(
        () => assert.fail("PDF should have been removed"),
        (e) => assert.equal(e.code, "ENOENT"),
      );
      assert.equal(
        (
          await db.query("SELECT * FROM submissions WHERE document_id=?", [
            uploadedId,
          ])
        ).length,
        0,
      );
    },
  );
  await t.test(
    "supports departments and courses with cascade confirmation",
    async () => {
      const dep = await mutate(admin.post("/api/departments"))
        .send({ name: "Test department" })
        .expect(201);
      const unknown = await mutate(admin.post("/api/courses"))
        .send({
          code: "UNKNOWN 101",
          name: "Course with unverified placement",
          department_id: dep.body.id,
          credits: "",
          semester: "",
        })
        .expect(201);
      const directory = await admin.get("/api/courses");
      const unspecified = directory.body.find((c) => c.id === unknown.body.id);
      assert.equal(unspecified.credits, null);
      assert.equal(unspecified.semester, null);
      await mutate(admin.put("/api/courses/" + unknown.body.id))
        .send({
          code: "UNKNOWN 101",
          name: unspecified.name,
          department_id: dep.body.id,
          credits: 0,
          semester: 0,
        })
        .expect(400);
      await mutate(admin.delete("/api/courses/" + unknown.body.id)).expect(200);
      const course = {
        code: "TEST 101",
        name: "Test course",
        credits: 3,
        semester: 1,
        department_id: dep.body.id,
      };
      const created = await mutate(admin.post("/api/courses"))
        .send(course)
        .expect(201);
      await mutate(admin.post("/api/courses")).send(course).expect(409);
      await mutate(admin.delete("/api/departments/" + dep.body.id)).expect(409);
      await mutate(admin.put("/api/courses/" + created.body.id))
        .send({ ...course, name: "Updated course" })
        .expect(200);
      await mutate(admin.delete("/api/courses/" + courseId)).expect(409);
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const file = await mutate(admin.post("/api/documents"))
        .field("title", "Cascade test")
        .field("type", "Note")
        .field("year", "2026")
        .field("course_id", created.body.id)
        .attach("file", Buffer.from(await pdf.save()), {
          filename: "cascade.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      await mutate(moderator.patch("/api/submissions/" + file.body.id))
        .send({ status: "Approved" })
        .expect(200);
      await mutate(admin.delete("/api/courses/" + created.body.id)).expect(409);
      await admin.get("/api/documents/" + file.body.id + "/file").expect(200);
      await mutate(
        admin.delete("/api/courses/" + created.body.id + "?confirm=true"),
      ).expect(200);
      assert.equal(
        (
          await db.query("SELECT * FROM submissions WHERE document_id=?", [
            file.body.id,
          ])
        ).length,
        0,
      );
      await fs.access(path.join(temp, "uploads", file.body.id + ".pdf")).then(
        () => assert.fail("Cascade must remove stored file"),
        (e) => assert.equal(e.code, "ENOENT"),
      );
      await mutate(admin.delete("/api/departments/" + dep.body.id)).expect(200);
    },
  );
  await t.test(
    "admin invites accept personal and custom-domain emails",
    async () => {
      for (const email of [
        "invited@outlook.com",
        "invited@independent.example",
      ]) {
        await mutate(admin.post("/api/users"))
          .send({ name: "Invited Member", email, role: "Student" })
          .expect(201);
        const [user] = await db.query(
          "SELECT verified FROM users WHERE email=?",
          [email],
        );
        assert.equal(user.verified, 0);
        assert.ok(await latestToken("verify", email));
        assert.ok(await latestToken("reset", email));
      }
      await mutate(admin.post("/api/users"))
        .send({ name: "Invalid Email", email: "invalid", role: "Student" })
        .expect(400);
    },
  );
  await t.test(
    "admin limits, suspends, bans and changes roles with session revocation",
    async () => {
      const users = await admin.get("/api/users");
      const o = users.body.find((u) => u.email === "other@gmail.com");
      await mutate(admin.patch("/api/users/" + o.id))
        .send({ role: "Moderator", status: "Suspended" })
        .expect(200);
      await other.get("/api/documents").expect(401);
      await login(other, "other@gmail.com").then((r) =>
        assert.equal(r.status, 403),
      );
      await mutate(admin.patch("/api/users/" + o.id))
        .send({ role: "Moderator", status: "Active" })
        .expect(200);
      await login(other, "other@gmail.com").then((r) =>
        assert.equal(r.status, 200),
      );
      await other.get("/api/documents?mode=queue").expect(200);
      await mutate(admin.patch("/api/settings"))
        .send({ maxUploadMb: 1 })
        .expect(200);
      await mutate(admin.patch("/api/settings"))
        .send({ maxUploadMb: 21 })
        .expect(400);
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const bytes = Buffer.concat([
        Buffer.from(await pdf.save()),
        Buffer.alloc(1024 * 1024),
      ]);
      await mutate(student.post("/api/documents"))
        .field("title", "Too big")
        .field("type", "Note")
        .field("year", "2026")
        .field("course_id", courseId)
        .attach("file", bytes, {
          filename: "large.pdf",
          contentType: "application/pdf",
        })
        .expect(400);
      await mutate(admin.patch("/api/settings"))
        .send({ maxUploadMb: 20 })
        .expect(200);
      const a = users.body.find((u) => u.role === "Admin");
      await mutate(admin.patch("/api/users/" + a.id))
        .send({ role: "Student", status: "Active" })
        .expect(409);
      await mutate(admin.delete("/api/users/" + a.id)).expect(409);
    },
  );
  await t.test(
    "accepts a 20 MB PDF, enforces the 10-upload Free limit, and cleans up",
    async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const small = Buffer.from(await pdf.save());
      const large = Buffer.alloc(20 * 1024 * 1024, 32);
      small.copy(large);
      const ids = [];
      for (let i = 0; i < 4; i++) {
        const r = await mutate(student.post("/api/documents"))
          .field("title", "Limit test " + i)
          .field("type", "Note")
          .field("year", "2026")
          .field("course_id", courseId)
          .attach("file", i === 0 ? large : small, {
            filename: "test.pdf",
            contentType: "application/pdf",
          })
          .expect(201);
        ids.push(r.body.id);
      }
      await mutate(student.post("/api/documents"))
        .field("title", "Over limit")
        .field("type", "Note")
        .field("year", "2026")
        .field("course_id", courseId)
        .attach("file", small, {
          filename: "test.pdf",
          contentType: "application/pdf",
        })
        .expect(409);
      for (const id of ids)
        await mutate(student.delete("/api/documents/" + id)).expect(200);
    },
  );
  await t.test("serves 100 concurrent directory requests", async () => {
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => request(app).get("/api/courses?q=CSE")),
    );
    assert.ok(results.every((r) => r.status === 200 && r.body.length === 6));
    assert.ok(
      performance.now() - started < 2000,
      "Local directory batch should complete within 2 seconds",
    );
  });
  await t.test(
    "password reset is single-use and revokes previous sessions",
    async () => {
      await mutate(student.post("/api/auth/forgot-password"))
        .send({ email: "student@uniarchive.edu" })
        .expect(200);
      const token = await latestToken("reset", "student@uniarchive.edu");
      await mutate(student.post("/api/auth/reset-password"))
        .send({
          token,
          password: "NewPassword123!",
          confirmPassword: "NewPassword123!",
        })
        .expect(200);
      await student.get("/api/documents").expect(401);
      await mutate(student.post("/api/auth/reset-password"))
        .send({ token, password: pass, confirmPassword: pass })
        .expect(400);
      await login(student, "student@uniarchive.edu", "NewPassword123!").then(
        (r) => assert.equal(r.status, 200),
      );
      const r = await mutate(student.post("/api/auth/logout"))
        .send({})
        .expect(200);
      await student.get("/api/documents").expect(401);
    },
  );
  await t.test(
    "account deletion requires password and removes owned documents",
    async () => {
      const pdf = await PDFDocument.create();
      pdf.addPage();
      const uploaded = await mutate(other.post("/api/documents"))
        .field("title", "Account deletion fixture")
        .field("type", "Note")
        .field("year", "2026")
        .field("course_id", courseId)
        .attach("file", Buffer.from(await pdf.save()), {
          filename: "owned.pdf",
          contentType: "application/pdf",
        })
        .expect(201);
      await mutate(other.delete("/api/account"))
        .send({ password: "wrong" })
        .expect(400);
      await mutate(other.delete("/api/account"))
        .send({ password: pass })
        .expect(200);
      await other.get("/api/documents").expect(401);
      assert.equal(
        (await db.query("SELECT user_id FROM user_avatars")).length,
        1,
      );
      await fs
        .access(path.join(temp, "uploads", uploaded.body.id + ".pdf"))
        .then(
          () => assert.fail("Account deletion must remove owned PDF"),
          (e) => assert.equal(e.code, "ENOENT"),
        );
      assert.equal(
        (
          await db.query("SELECT * FROM users WHERE email=?", [
            "other@gmail.com",
          ])
        ).length,
        0,
      );
    },
  );
  await t.test(
    "creates a restorable database-and-files backup and preserves foreign keys",
    async () => {
      const { runBackup } = await import("../server/backups.js");
      const snapshot = await runBackup(db);
      assert.ok(
        (await fs.stat(path.join(snapshot, "uniarchive.sqlite"))).size > 0,
      );
      const files = await fs.readdir(path.join(snapshot, "uploads"));
      assert.equal(files.length, 6);
      const init = (await import("sql.js")).default;
      const SQL = await init();
      const restored = new SQL.Database(
        await fs.readFile(path.join(snapshot, "uniarchive.sqlite")),
      );
      assert.equal(
        restored.exec("SELECT COUNT(*) FROM documents")[0].values[0][0],
        6,
      );
      restored.close();
      await assert.rejects(
        db.query(
          "INSERT INTO courses (id,code,name,credits,semester,department_id) VALUES (?,?,?,?,?,?)",
          ["invalid-course", "BAD 1", "Invalid", 3, 1, "missing-department"],
        ),
        /FOREIGN KEY/,
      );
    },
  );
  await t.test("embedded database persists across reopening", async () => {
    const second = await openDatabase();
    try {
      const docs = await second.query("SELECT * FROM documents");
      assert.equal(docs.length, 6);
      const [photo] = await second.query(
        "SELECT data,mime_type FROM user_avatars",
      );
      assert.equal(photo.mime_type, "image/png");
      assert.ok(
        Buffer.from(photo.data)
          .subarray(0, 8)
          .equals(Buffer.from("89504e470d0a1a0a", "hex")),
      );
      assert.ok((await second.query("SELECT * FROM users")).length >= 3);
    } finally {
      await second.close();
    }
  });
});

test("Google Drive storage, 20 MB chunked uploads, access controls and cleanup retries", async () => {
  const { createStorage, flushFileCleanup, driveFailure } =
    await import("../server/storage.js");
  const { Readable } = await import("node:stream");
  const objects = new Map();
  let sequence = 0,
    failDelete = false;
  const client = {
    files: {
      create: async (request) => {
        const chunks = [];
        for await (const chunk of request.media.body) chunks.push(chunk);
        const id = "cloud-" + ++sequence;
        objects.set(id, {
          bytes: Buffer.concat(chunks),
          meta: { id, ...request.requestBody, trashed: false },
        });
        assert.equal(request.media.mimeType, "application/pdf");
        assert.equal(request.requestBody.permissions, undefined);
        return { data: { id } };
      },
      get: async (request) => {
        if (request.fileId === "private-folder")
          return {
            data: {
              id: "private-folder",
              mimeType: "application/vnd.google-apps.folder",
              trashed: false,
            },
          };
        const item = objects.get(request.fileId);
        if (!item) throw { code: 404 };
        return {
          data: request.alt === "media" ? Readable.from(item.bytes) : item.meta,
        };
      },
      delete: async (request) => {
        if (failDelete) throw { code: 503 };
        objects.delete(request.fileId);
        return { data: {} };
      },
    },
  };
  const storage = createStorage({
    provider: "google-drive",
    driveClient: client,
    folderId: "private-folder",
  });
  await storage.check();
  const cloudApp = createApp(db, { storage });
  const owner = request.agent(cloudApp),
    reader = request.agent(cloudApp);
  await login(owner, "admin@uniarchive.edu").then((r) =>
    assert.equal(r.status, 200),
  );
  await login(reader, "student@uniarchive.edu", "NewPassword123!").then((r) =>
    assert.equal(r.status, 200),
  );
  const [course] = await db.query("SELECT id FROM courses WHERE code=?", [
    "CSE 323",
  ]);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const upload = await mutate(owner.post("/api/documents"))
    .field("title", "Cloud fixture")
    .field("type", "Note")
    .field("year", "2026")
    .field("course_id", course.id)
    .attach("file", bytes, {
      filename: "cloud.pdf",
      contentType: "application/pdf",
    })
    .expect(201);
  const id = upload.body.id;
  const [row] = await db.query("SELECT * FROM documents WHERE id=?", [id]);
  assert.equal(row.storage_provider, "google-drive");
  assert.ok(objects.has(row.file_name));
  await request(cloudApp)
    .get("/api/documents/" + id + "/file")
    .expect(401);
  await reader.get("/api/documents/" + id + "/file").expect(403);
  await mutate(owner.patch("/api/submissions/" + id))
    .send({ status: "Approved" })
    .expect(200);
  const response = await reader
    .get("/api/documents/" + id + "/file?download=true")
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.deepEqual(response.body, bytes);
  const docs = await reader.get("/api/documents");
  assert.equal(docs.body.find((d) => d.id === id).file_name, undefined);
  failDelete = true;
  await mutate(owner.delete("/api/documents/" + id)).expect(200);
  assert.equal(
    (await db.query("SELECT * FROM documents WHERE id=?", [id])).length,
    0,
  );
  assert.equal(
    (await db.query("SELECT * FROM file_cleanup WHERE id=?", [id])).length,
    1,
  );
  assert.ok(objects.has(row.file_name));
  failDelete = false;
  await flushFileCleanup(db, storage);
  assert.equal(objects.size, 0);
  assert.equal(
    (await db.query("SELECT * FROM file_cleanup WHERE id=?", [id])).length,
    0,
  );
  await mutate(owner.post("/api/documents"))
    .field("title", "Rollback fixture")
    .field("type", "Note")
    .field("year", "2026")
    .field("course_id", "00000000-0000-4000-8000-000000000000")
    .attach("file", bytes, {
      filename: "cloud.pdf",
      contentType: "application/pdf",
    })
    .expect(400);
  assert.equal(objects.size, 0);
  // Exercise a 20 MB file with every HTTP request below Vercel's payload cap.
  const large = Buffer.alloc(20 * 1024 * 1024, 32);
  bytes.copy(large);
  const session = await mutate(owner.post("/api/uploads"))
    .send({
      title: "Chunked cloud PDF",
      type: "Note",
      year: 2026,
      course_id: course.id,
      filename: "large.pdf",
      size: large.length,
    })
    .expect(201);
  const uploadId = session.body.id,
    size = session.body.chunkSize;
  assert.ok(size < 4.5 * 1024 * 1024);
  await request(cloudApp).post("/api/uploads").expect(403);
  await mutate(reader.put(`/api/uploads/${uploadId}/chunks/0`))
    .set("Content-Type", "application/octet-stream")
    .send(large.subarray(0, size))
    .expect(404);
  await mutate(owner.post(`/api/uploads/${uploadId}/complete`)).expect(409);
  for (
    let offset = 0, index = 0;
    offset < large.length;
    offset += size, index++
  ) {
    await mutate(owner.put(`/api/uploads/${uploadId}/chunks/${index}`))
      .set("Content-Type", "application/octet-stream")
      .send(large.subarray(offset, offset + size))
      .expect(200);
  }
  // A retried identical chunk is safe; changed bytes cannot replace it.
  await mutate(owner.put(`/api/uploads/${uploadId}/chunks/0`))
    .set("Content-Type", "application/octet-stream")
    .send(large.subarray(0, size))
    .expect(200);
  const changed = Buffer.from(large.subarray(0, size));
  changed[20] ^= 1;
  await mutate(owner.put(`/api/uploads/${uploadId}/chunks/0`))
    .set("Content-Type", "application/octet-stream")
    .send(changed)
    .expect(409);
  await mutate(owner.post(`/api/uploads/${uploadId}/complete`)).expect(201);
  await mutate(owner.post(`/api/uploads/${uploadId}/complete`)).expect(201);
  const [chunked] = await db.query("SELECT * FROM documents WHERE id=?", [
    uploadId,
  ]);
  assert.deepEqual(objects.get(chunked.file_name).bytes, large);
  assert.equal(
    (
      await db.query("SELECT * FROM upload_chunks WHERE upload_id=?", [
        uploadId,
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT * FROM submissions WHERE document_id=?", [
        uploadId,
      ])
    ).length,
    1,
  );
  await mutate(owner.delete(`/api/documents/${uploadId}`)).expect(200);
  const expiring = await mutate(owner.post("/api/uploads"))
    .send({
      title: "Expired upload",
      type: "Note",
      year: 2026,
      course_id: course.id,
      filename: "valid.pdf",
      size: bytes.length,
    })
    .expect(201);
  await mutate(owner.put(`/api/uploads/${expiring.body.id}/chunks/0`))
    .set("Content-Type", "application/octet-stream")
    .send(bytes)
    .expect(200);
  await db.query("UPDATE upload_sessions SET expires_at=? WHERE id=?", [
    "2000-01-01T00:00:00.000Z",
    expiring.body.id,
  ]);
  const { expireUploads } = await import("../server/uploads.js");
  await expireUploads(db);
  assert.equal(
    (
      await db.query("SELECT * FROM upload_chunks WHERE upload_id=?", [
        expiring.body.id,
      ])
    ).length,
    0,
  );
  await request(cloudApp).get("/api/maintenance").expect(401);
  const safeError = driveFailure({
    code: 401,
    config: { headers: { Authorization: "Bearer PRIVATE_SECRET" } },
  });
  assert.ok(!JSON.stringify(safeError).includes("PRIVATE_SECRET"));
  assert.match(safeError.message, /expired|revoked/);
});
