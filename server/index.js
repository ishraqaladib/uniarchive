import { scheduleBackups } from "./backups.js";
import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { openDatabase, uploadsDir } from "./db.js";
import { createApp } from "./app.js";
if (process.env.NODE_ENV === "production" && !process.env.SMTP_HOST) {
  throw new Error(
    "Configure SMTP_HOST for verification and reset emails in production.",
  );
}
const db = await openDatabase();
// Remove orphan PDFs left by an interrupted deletion or upload; never expose storage statically.
const files = new Set(
  (await db.query("SELECT file_name FROM documents")).map((d) => d.file_name),
);
for (const f of fs.readdirSync(uploadsDir))
  if (/^[a-f0-9-]+\.pdf$/.test(f) && !files.has(f))
    fs.unlinkSync(path.join(uploadsDir, f));
const app = createApp(db);
const backupInterval = await scheduleBackups(db);
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const dist = path.resolve("dist");
  if (!fs.existsSync(path.join(dist, "index.html")))
    throw new Error("Run npm run build before npm start.");
  app.use(express.static(dist));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
}
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`UniArchive running at http://localhost:${port}`),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    clearInterval(backupInterval);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
