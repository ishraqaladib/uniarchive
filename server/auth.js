import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { dataDir, now } from "./db.js";
export const production = process.env.NODE_ENV === "production";
let secret = process.env.JWT_SECRET;
if (!secret) {
  if (production) throw new Error("JWT_SECRET is required in production.");
  const file = path.join(dataDir, "session-secret");
  if (!fs.existsSync(file))
    fs.writeFileSync(file, crypto.randomBytes(48).toString("hex"), {
      mode: 0o600,
    });
  secret = fs.readFileSync(file, "utf8");
}
if (secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters.");
export const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  verified: !!u.verified,
  created_at: u.created_at,
});
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: production,
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
};
export function signSession(res, user) {
  res.cookie(
    "uniarchive_session",
    jwt.sign({ sub: user.id, v: user.session_version }, secret, {
      expiresIn: "8h",
      algorithm: "HS256",
    }),
    cookieOptions,
  );
}
export function authentication(db) {
  return async (req, res, next) => {
    const token = req.cookies.uniarchive_session;
    if (token)
      try {
        const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
        const [u] = await db.query("SELECT * FROM users WHERE id=?", [
          payload.sub,
        ]);
        if (
          u &&
          u.status === "Active" &&
          u.verified &&
          u.session_version === payload.v
        )
          req.user = u;
      } catch {}
    next();
  };
}
export function requireUser(req, res, next) {
  if (!req.user)
    return res.status(401).json({ error: "Please log in to continue." });
  next();
}
export const roles =
  (...allowed) =>
  (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ error: "Please log in to continue." });
    if (!allowed.includes(req.user.role))
      return res
        .status(403)
        .json({ error: "You do not have permission for this action." });
    next();
  };
export function universityEmail(email) {
  const domain = email.split("@")[1] || "";
  const allowed = (process.env.UNIVERSITY_DOMAINS || "")
    .toLowerCase()
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return allowed.length
    ? allowed.includes(domain)
    : /\.edu(?:\.[a-z]{2})?$|\.ac\.[a-z]{2}$/i.test(domain);
}
export async function sendToken(db, user, kind) {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM tokens WHERE user_id=? AND kind=?", [
      user.id,
      kind,
    ]);
    await tx.query(
      "INSERT INTO tokens (id,user_id,kind,expires_at) VALUES (?,?,?,?)",
      [
        hash,
        user.id,
        kind,
        new Date(
          Date.now() + (kind === "reset" ? 3600000 : 86400000),
        ).toISOString(),
      ],
    );
  });
  const url = new URL(
    kind === "reset" ? "/reset-password" : "/verify-email",
    process.env.APP_URL || "http://localhost:3000",
  );
  url.searchParams.set("token", token);
  const message = {
    from: process.env.SMTP_FROM || "UniArchive <noreply@example.edu>",
    to: user.email,
    subject:
      kind === "reset"
        ? "Reset your UniArchive password"
        : "Verify your UniArchive email",
    text: `Hello ${user.name},\n\n${kind === "reset" ? "Reset your password" : "Verify your university email"} using this link:\n${url}\n\nThis link expires ${kind === "reset" ? "in one hour" : "in 24 hours"}. If you did not request this, ignore this message.`,
  };
  if (process.env.SMTP_HOST) {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      ...(process.env.SMTP_USER
        ? {
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
            },
          }
        : {}),
    });
    await transport.sendMail(message);
  } else {
    if (production) throw new Error("SMTP must be configured in production.");
    const dir = path.join(dataDir, "mail");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${Date.now()}-${crypto.randomUUID()}.json`),
      JSON.stringify({ ...message, created_at: now() }, null, 2),
      { mode: 0o600 },
    );
  }
}
