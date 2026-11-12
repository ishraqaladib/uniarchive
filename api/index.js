import "dotenv/config";
process.env.DATA_DIR ||= "/tmp/uniarchive";
process.env.APP_URL ||= process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "";
const { assertMailConfiguration } = await import("../server/mail.js");
assertMailConfiguration();
if (
  process.env.MYSQL_SSL !== "true" ||
  process.env.DB_CLIENT !== "mysql" ||
  process.env.STORAGE_PROVIDER !== "google-drive"
)
  throw new Error("Vercel requires hosted MySQL and Google Drive storage.");
const { openDatabase } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const db = await openDatabase();
const app = createApp(db);
export default app;
