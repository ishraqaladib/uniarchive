import "dotenv/config";
import fs from "node:fs/promises";
import { connectDrive, driveFailure } from "../server/storage.js";
try {
  const { client, config } = await connectDrive();
  let folderId = config.folder_id;
  if (!folderId) {
    const { data } = await client.files.list({
      q: "trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='uniarchive_role' and value='uploads-root' }",
      fields: "files(id,name)",
      pageSize: 10,
    });
    folderId = data.files?.[0]?.id;
    if (!folderId) {
      const { data: folder } = await client.files.create({
        requestBody: {
          name: "UniArchive Uploads",
          mimeType: "application/vnd.google-apps.folder",
          appProperties: { uniarchive_role: "uploads-root" },
        },
        fields: "id",
      });
      folderId = folder.id;
    }
  }
  const { data: folder } = await client.files.get({
    fileId: folderId,
    fields: "id,name,mimeType,trashed,permissions(type,role)",
  });
  if (
    folder.mimeType !== "application/vnd.google-apps.folder" ||
    folder.trashed
  )
    throw new Error("The configured folder is not available.");
  if (
    folder.permissions?.some((p) => p.type === "anyone" || p.type === "domain")
  )
    throw new Error("Choose a restricted Drive folder before connecting it.");
  const { filename, ...saved } = config;
  await fs.writeFile(
    filename,
    JSON.stringify(
      { ...saved, folder_id: folderId, connected_at: new Date().toISOString() },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const envPath = ".env";
  let env = await fs.readFile(envPath, "utf8").catch((e) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  env = /^STORAGE_PROVIDER=/m.test(env)
    ? env.replace(/^STORAGE_PROVIDER=.*$/m, "STORAGE_PROVIDER=google-drive")
    : env + "\nSTORAGE_PROVIDER=google-drive\n";
  await fs.writeFile(envPath, env, { mode: 0o600 });
  console.log(
    JSON.stringify({
      connected: true,
      folderId,
      name: folder.name,
      private: true,
    }),
  );
} catch (e) {
  console.error(e.status ? e.message : driveFailure(e).message);
  process.exitCode = 1;
}
