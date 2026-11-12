import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { openDatabase, now } from "../server/db.js";
const prompt = createInterface({ input: stdin, output: stdout });
const name = await prompt.question("Administrator name: ");
const email = (await prompt.question("Email address: "))
  .trim()
  .toLowerCase();
prompt.close();
// Password comes from stdin on a second prompt, with terminal echo disabled on POSIX.
const { spawnSync } = await import("node:child_process");
let pass;
if (stdin.isTTY) spawnSync("stty", ["-echo"], { stdio: "inherit" });
try {
  const p = createInterface({ input: stdin, output: stdout });
  pass = await p.question("Password (8–72 bytes): ");
  p.close();
} finally {
  if (stdin.isTTY) {
    spawnSync("stty", ["echo"], { stdio: "inherit" });
    stdout.write("\n");
  }
}
if (
  name.trim().length < 1 ||
  name.length > 100 ||
  !/^\S+@\S+\.\S+$/.test(email) ||
  pass.length < 8 ||
  Buffer.byteLength(pass) > 72
)
  throw new Error("Check name, email and password.");
const db = await openDatabase();
try {
  await db.query(
    "INSERT INTO users (id,name,email,password_hash,role,status,verified,session_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      crypto.randomUUID(),
      name.trim(),
      email,
      await bcrypt.hash(pass, 12),
      "Admin",
      "Active",
      1,
      0,
      now(),
    ],
  );
  console.log("Administrator created.");
} finally {
  await db.close();
}
