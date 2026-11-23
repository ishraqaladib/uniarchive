import crypto from "node:crypto";
import multer from "multer";
import { requireUser, safeUser } from "./auth.js";

const fail = (message) => Object.assign(new Error(message), { status: 400 });
function imageType(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return "image/png";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  )
    return "image/jpeg";
  if (
    bytes.length >= 20 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16)) &&
    bytes.readUInt32LE(4) === bytes.length - 8
  )
    return "image/webp";
  throw fail("Choose a JPEG, PNG, or WebP image.");
}

export function installAvatarRoutes(app, db) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
  }).single("picture");
  app.put(
    "/api/account/avatar",
    requireUser,
    (req, res, next) => {
      upload(req, res, (err) =>
        next(
          err
            ? fail(
                err.code === "LIMIT_FILE_SIZE"
                  ? "Profile pictures must be no larger than 2 MB."
                  : "Upload one image using the picture field.",
              )
            : undefined,
        ),
      );
    },
    async (req, res) => {
      if (!req.file) throw fail("Choose a profile picture to upload.");
      const mime = imageType(req.file.buffer);
      const version = crypto.randomUUID();
      await db.transaction(async (tx) => {
        // Serialize replacements across serverless instances as well as locally.
        await tx.query(
          "SELECT id FROM users WHERE id=?" +
            (db.dialect === "mysql" ? " FOR UPDATE" : ""),
          [req.user.id],
        );
        await tx.query("DELETE FROM user_avatars WHERE user_id=?", [
          req.user.id,
        ]);
        await tx.query(
          "INSERT INTO user_avatars (user_id,data,mime_type,version) VALUES (?,?,?,?)",
          [req.user.id, req.file.buffer, mime, version],
        );
      });
      res.json({
        user: safeUser({ ...req.user, avatar_version: version }),
        message: "Profile picture saved.",
      });
    },
  );
  app.get("/api/account/avatar/:version", requireUser, async (req, res) => {
    const [avatar] = await db.query(
      "SELECT data,mime_type FROM user_avatars WHERE user_id=? AND version=?",
      [req.user.id, req.params.version],
    );
    if (!avatar)
      return res.status(404).json({ error: "Profile picture not found." });
    res.type(avatar.mime_type).send(Buffer.from(avatar.data));
  });
  app.delete("/api/account/avatar", requireUser, async (req, res) => {
    await db.query("DELETE FROM user_avatars WHERE user_id=?", [req.user.id]);
    res.json({
      user: safeUser({ ...req.user, avatar_version: null }),
      message: "Profile picture removed.",
    });
  });
}
