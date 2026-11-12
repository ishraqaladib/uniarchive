# Google Drive storage for UniArchive

## How it works

The browser sends a PDF to the Express server using the member's UniArchive session. The server checks the file, stores it in the owner's private Google Drive folder, and records its Drive file ID in the application database. The document remains pending until a moderator or administrator approves it. Reading and downloading go through the same server authorization checks. Members do not receive Google credentials or public Drive links and do not need Google accounts.

Drive stores PDF contents. MySQL stores accounts, password hashes, courses, permissions, document metadata, collections, and review history. You still need a running backend, database, and email delivery for a public website. The React frontend alone cannot provide those services.

Only the `https://www.googleapis.com/auth/drive.file` scope is used. It allows the app to manage files it creates or that a user explicitly opens with the app, rather than your entire existing Drive library. The setup creates a restricted folder named **UniArchive Uploads**. Keep that folder restricted; do not add public sharing. Avoid moving or editing application PDFs directly in Drive, because the server checks their folder and document identifiers.

## Status of this computer

The owner completed authorization, the private upload folder was created, and the local app was configured to use Drive. A generated **UniArchive cloud connection check** PDF was uploaded, approved, and downloaded through the application API; its downloaded bytes matched the original and its Drive permissions had no public or domain sharing.

Local credentials are stored in `.data/google-drive-client.json` with owner-only file permissions. `.env` selects `STORAGE_PROVIDER=google-drive`. Neither file is included in Git or the downloadable ZIP. Extracting the ZIP on another machine does not transfer your Google authorization.

The deployed instance's OAuth app was switched to **In production** after owner approval. Branding now uses the public Vercel homepage and `/privacy` page. Owner consent was renewed with the same `drive.file` scope, the returned refresh token did not report a seven-day Testing expiry, and the server-side Vercel secret was updated. Tokens can still expire or be revoked for other reasons. When creating a new Google project, finish production publishing and renew consent before relying on long-running uploads; a previously issued Testing token does not become a lasting token merely because publishing status changed.

## Reconnect or configure another server

1. Open Google Cloud Console and select the UniArchive project. Enable the Google Drive API if needed.
2. In Google Auth Platform, configure Branding, an External audience, and Data Access with only `drive.file`. While Testing, add the storage owner's Google account as a test user.
3. Create a Web application OAuth client with `https://developers.google.com/oauthplayground` as an authorized redirect URI. Keep the client secret private.
4. Open the official [OAuth Playground](https://developers.google.com/oauthplayground). In its settings select **Use your own OAuth credentials**, enter that client ID and secret, and use offline access. Authorize the `drive.file` scope with the intended storage account and exchange the authorization code. Keep the returned refresh token private.
5. On a local setup, place those values in `.env` using the names below, or save them to the private JSON file using `client_id`, `client_secret`, `refresh_token`, and `redirect_uri` keys. Do not paste them into chat or a public repository.
6. Stop the local server before running CLI commands against SQLite. Run `npm run drive:setup` to create/reuse the app folder. It saves the selected folder ID in the private JSON file and selects Drive in `.env`.
7. For the seeded local demo only, run `npm run drive:check` with the server stopped. It leaves one small connection-check PDF in the library. It requires development dependencies and the demo administrator account. On a real deployment use your own account to upload, approve, preview and download a test PDF instead.
8. Restart the server. Old local files retain their local provider. New uploads use Drive.

Official references: [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [OAuth web-server authorization](https://developers.google.com/identity/protocols/oauth2/web-server), and [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## Production configuration

Store these as **server-side secrets** on the backend host. Never put secrets in React source, `VITE_` variables, the ZIP, or browser storage.

```dotenv
STORAGE_PROVIDER=google-drive
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-private-client-secret
GOOGLE_REFRESH_TOKEN=your-private-owner-refresh-token
GOOGLE_DRIVE_FOLDER_ID=your-app-folder-id
GOOGLE_REDIRECT_URI=https://developers.google.com/oauthplayground
```

For the existing folder, copy its ID from the owner's private configuration or Drive folder URL. The credentials must belong to the same OAuth client and authorized owner. A production server reads these environment variables by default. Alternatively mount an owner-only secret JSON file and set `GOOGLE_DRIVE_CREDENTIALS_FILE` to its absolute path. Do not run `drive:setup` in a public environment just to copy credentials; configure the known folder ID directly.

Also configure the application settings from `.env.example`: `NODE_ENV=production`, a strong `JWT_SECRET`, public HTTPS `APP_URL`, MySQL connection values, SMTP email settings, and appropriate `HOST`, `PORT` and trusted-proxy configuration. Use `npm ci`, `npm run build`, and `npm start` on a host that supports this Express Node server. Create your own administrator with `npm run admin:create`; do not seed public demo credentials.

This project currently serves the frontend and API together. Its `npm start` process and scheduled backup/cleanup jobs require a Node server. Uploading only `dist/` to Netlify or Vercel does not deploy the API, login, or file uploads. Running this backend as serverless functions requires a separate adapter, external MySQL, scheduled maintenance jobs, and upload handling compatible with that host's request limits. This project now includes a Vercel adapter with 3 MiB upload chunks, hosted MySQL/TiDB and daily cleanup. See `VERCEL.md` for its configuration; the standard `npm start` instructions still describe the traditional Node server. Keep browser and API under the same public origin unless you also implement and test cross-origin cookie and CSRF handling.

Do not use the in-memory SQLite adapter on an ephemeral filesystem or with multiple server processes. Hosted MySQL needs its own backup policy; application backup jobs additionally need `mysqldump` and persistent protected backup storage. Existing local sample PDFs would also need persistent backend disk if retained in a production installation.

## Operations and recovery

- A startup check confirms the selected Drive folder is accessible. An expired authorization can prevent startup and requires reconnection.
- Authentication, document access, validation and upload limits remain enforced by UniArchive. Drive storage capacity and API quotas apply separately.
- Deleting a document removes its database record and queues cloud-file deletion. If Google fails, the cleanup job stays in the database and retries every minute and after restart. Keep that database until queued removals finish.
- Application backups contain the database, local PDFs, and a cloud-file manifest. They do **not** copy Drive PDFs. Maintain an independent backup of cloud PDFs and private credentials. A database restore cannot recreate a PDF already deleted from Drive.
- An interrupted request or server crash can leave an app-created file without a completed database record. Periodically reconcile the private app folder with the database before manually removing anything.
- If access fails, check the owner's refresh token, folder ID, Drive sharing, available storage, and API quota. Reauthorize the same owner and update the backend secret if the grant expired or was revoked.
