import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./db.js";
// Uses the database's write queue so files cannot be deleted during a snapshot.
export async function runBackup(db) {
  const root = path.join(dataDir, "backups");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(
    root,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  try {
    await db.snapshot(target);
  } catch (e) {
    await fs.rm(target, { recursive: true, force: true });
    throw e;
  }
  const dirs = (await fs.readdir(root))
    .filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n))
    .sort()
    .reverse();
  for (const old of dirs.slice(7))
    await fs.rm(path.join(root, old), { recursive: true, force: true });
  return target;
}
export async function scheduleBackups(db) {
  const root = path.join(dataDir, "backups");
  const files = (await fs.readdir(root).catch(() => []))
    .filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n))
    .sort();
  const latest = files.length
    ? (await fs.stat(path.join(root, files.at(-1)))).mtimeMs
    : 0;
  const run = () =>
    runBackup(db).catch(() =>
      console.error(
        "Automatic backup failed. Check permissions and, for MySQL, install mysqldump.",
      ),
    );
  if (Date.now() - latest > 86400000) await run();
  const interval = setInterval(run, 86400000);
  interval.unref();
  return interval;
}
