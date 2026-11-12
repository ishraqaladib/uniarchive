import "dotenv/config";
import { openDatabase } from "../server/db.js";
import { runBackup } from "../server/backups.js";
// Run with the server stopped; the live server makes its own daily snapshots.
const db = await openDatabase();
try {
  console.log("Backup created: " + (await runBackup(db)));
} finally {
  await db.close();
}
