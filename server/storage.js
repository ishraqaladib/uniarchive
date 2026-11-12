import "dotenv/config";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { dataDir, uploadsDir } from "./db.js";
const failure = (message, status = 503) =>
  Object.assign(new Error(message), { status });
export function driveFailure(err) {
  const code = Number(err?.response?.status || err?.code || 0);
  if (code === 404)
    return failure(
      "The cloud PDF is missing or is no longer accessible. Contact the administrator.",
      404,
    );
  if (code === 401 || err?.response?.data?.error === "invalid_grant")
    return failure(
      "The Google Drive connection has expired or was revoked. Ask the administrator to reconnect it.",
    );
  if (code === 403 || code === 429)
    return failure(
      "Google Drive rejected this request. Check the account permissions, storage space, and API quota.",
    );
  return failure("Cloud storage is temporarily unavailable. Please try again.");
}
export async function driveConfiguration() {
  const filename = path.resolve(
    process.env.GOOGLE_DRIVE_CREDENTIALS_FILE ||
      path.join(dataDir, "google-drive-client.json"),
  );
  let saved = {};
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.GOOGLE_DRIVE_CREDENTIALS_FILE
  ) {
    try {
      saved = JSON.parse(await fs.readFile(filename, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw failure("The private Google Drive configuration cannot be read.");
    }
  }
  return {
    filename,
    client_id: process.env.GOOGLE_CLIENT_ID || saved.client_id,
    client_secret: process.env.GOOGLE_CLIENT_SECRET || saved.client_secret,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || saved.refresh_token,
    redirect_uri:
      process.env.GOOGLE_REDIRECT_URI ||
      saved.redirect_uri ||
      "https://developers.google.com/oauthplayground",
    folder_id: process.env.GOOGLE_DRIVE_FOLDER_ID || saved.folder_id,
  };
}
export async function connectDrive(config) {
  config ||= await driveConfiguration();
  if (!config.client_id || !config.client_secret || !config.refresh_token)
    throw failure("Google Drive credentials are not configured.");
  const auth = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    config.redirect_uri,
  );
  auth.setCredentials({ refresh_token: config.refresh_token });
  return { client: google.drive({ version: "v3", auth }), config };
}
export class DriveStorage {
  constructor(client, folderId) {
    this.client = client;
    this.folderId = folderId;
    this.provider = "google-drive";
  }
  async check() {
    try {
      if (!this.folderId)
        throw failure(
          "Configure GOOGLE_DRIVE_FOLDER_ID or run npm run drive:setup.",
        );
      const { data } = await this.client.files.get({
        fileId: this.folderId,
        fields: "id,name,mimeType,trashed",
      });
      if (
        data.trashed ||
        data.mimeType !== "application/vnd.google-apps.folder"
      )
        throw failure("The configured Google Drive folder is unavailable.");
      return data;
    } catch (e) {
      if (e.status) throw e;
      throw driveFailure(e);
    }
  }
  async put({ id, buffer, name }) {
    try {
      const { data } = await this.client.files.create(
        {
          requestBody: {
            name,
            parents: [this.folderId],
            mimeType: "application/pdf",
            appProperties: { uniarchive_document_id: id },
          },
          media: { mimeType: "application/pdf", body: Readable.from(buffer) },
          fields: "id",
        },
        { timeout: 120000 },
      );
      if (!data.id)
        throw failure("Google Drive did not return a file identifier.");
      return { file_name: data.id, storage_provider: this.provider };
    } catch (e) {
      if (e.status) throw e;
      throw driveFailure(e);
    }
  }
  async metadata(doc) {
    try {
      const { data } = await this.client.files.get({
        fileId: doc.file_name,
        fields: "id,mimeType,parents,trashed,appProperties",
      });
      if (data.trashed) throw failure("The cloud PDF has been removed.", 404);
      if (
        !data.parents?.includes(this.folderId) ||
        data.appProperties?.uniarchive_document_id !== doc.id
      )
        throw failure(
          "The stored PDF does not match this repository record.",
          409,
        );
      return data;
    } catch (e) {
      if (e.status) throw e;
      throw driveFailure(e);
    }
  }
  async open(doc) {
    try {
      const meta = await this.metadata(doc);
      if (meta.mimeType !== "application/pdf")
        throw failure("The stored file is no longer a PDF.", 404);
      const { data } = await this.client.files.get(
        { fileId: doc.file_name, alt: "media" },
        { responseType: "stream", timeout: 120000 },
      );
      return data;
    } catch (e) {
      if (e.status) throw e;
      throw driveFailure(e);
    }
  }
  async remove(doc) {
    try {
      await this.metadata(doc);
      await this.client.files.delete({ fileId: doc.file_name });
    } catch (e) {
      if (e.status === 404 || Number(e.code || e.response?.status) === 404)
        return;
      if (e.status) throw e;
      throw driveFailure(e);
    }
  }
}
function localPath(key) {
  if (!/^[a-f0-9-]+\.pdf$/.test(key || ""))
    throw failure("The local PDF identifier is invalid.", 404);
  return path.join(uploadsDir, key);
}
export function createStorage({
  provider = process.env.STORAGE_PROVIDER || "local",
  driveClient,
  folderId,
} = {}) {
  if (!["local", "google-drive"].includes(provider))
    throw failure("STORAGE_PROVIDER must be local or google-drive.");
  let drive;
  async function cloud() {
    if (!drive) {
      if (driveClient) drive = new DriveStorage(driveClient, folderId);
      else {
        const { client, config } = await connectDrive();
        drive = new DriveStorage(client, config.folder_id);
      }
    }
    return drive;
  }
  return {
    provider,
    check: async () =>
      provider === "google-drive"
        ? (await cloud()).check()
        : { name: "Local PDF storage" },
    put: async (data) => {
      if (provider === "google-drive") return (await cloud()).put(data);
      const key = data.id + ".pdf";
      await fs.writeFile(localPath(key), data.buffer, { mode: 0o600 });
      return { file_name: key, storage_provider: "local" };
    },
    open: async (doc) => {
      if (doc.storage_provider === "google-drive")
        return (await cloud()).open(doc);
      const file = localPath(doc.file_name);
      try {
        await fs.access(file);
      } catch {
        throw failure(
          "The stored PDF is missing. Contact the administrator.",
          404,
        );
      }
      return createReadStream(file);
    },
    remove: async (doc) => {
      if (doc.storage_provider === "google-drive")
        return (await cloud()).remove(doc);
      try {
        await fs.unlink(localPath(doc.file_name));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    },
  };
}
// Deletion jobs survive restarts; failed provider requests never lose the file identifier.
export async function flushFileCleanup(db, storage) {
  const jobs = await db.query(
    "SELECT * FROM file_cleanup ORDER BY created_at LIMIT 50",
  );
  for (const job of jobs) {
    try {
      await storage.remove({
        id: job.id,
        file_name: job.file_name,
        storage_provider: job.storage_provider,
      });
      await db.query("DELETE FROM file_cleanup WHERE id=?", [job.id]);
    } catch {
      await db.query("UPDATE file_cleanup SET attempts=attempts+1 WHERE id=?", [
        job.id,
      ]);
      console.error("Stored PDF cleanup will retry for document", job.id);
    }
  }
}
export async function queueFileCleanup(db, doc) {
  await db.query(
    "INSERT INTO file_cleanup (id,file_name,storage_provider,created_at,attempts) VALUES (?,?,?,?,?)",
    [
      doc.id,
      doc.file_name,
      doc.storage_provider || "local",
      new Date().toISOString(),
      0,
    ],
  );
}
