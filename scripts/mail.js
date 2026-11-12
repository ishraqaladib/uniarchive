import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
if (process.env.NODE_ENV === "production")
  throw new Error("Local mail viewer is disabled in production.");
const dir = path.resolve(process.env.DATA_DIR || ".data", "mail");
const files = await fs.readdir(dir).catch(() => []);
if (!files.length)
  console.log(
    "No local messages. Register an account or request a reset first.",
  );
for (const file of files.sort().slice(-10)) {
  const m = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
  console.log(`\nTo: ${m.to}\nSubject: ${m.subject}\n${m.text}\n`);
}
