# UniArchive

UniArchive is a university academic repository built from the supplied SRS and UI reference. It includes a React frontend, an Express REST API, authenticated local/Google Drive PDF storage, and MySQL support. A persistent embedded SQLite database is the default for easy local setup. No ChatGPT account or sign-in is involved.

## Quick start

Install Node.js 20.19+ or 22.12+ (and npm). Extract this ZIP, open a terminal in the `UniArchive` folder, then run:

```sh
npm ci
npm run seed
npm start
```

Open **http://localhost:3000**. The production frontend build is already included in `dist`, so the quick start does not need a build step. `npm run seed` creates illustrative courses, actual sample PDFs, and three verified demo accounts. Seeding is optional and repeatable; it does not reset an existing account's password.

| Role                  | Email                    | Demo password  |
| --------------------- | ------------------------ | -------------- |
| Admin                 | admin@uniarchive.edu     | UniArchive123! |
| Moderator / Librarian | moderator@uniarchive.edu | UniArchive123! |
| Student               | student@uniarchive.edu   | UniArchive123! |

These credentials are for local demonstration only. For a clean installation, skip seeding and run `npm run admin:create` to create your own administrator interactively. Set `DEMO_PASSWORD` before seeding to use another demo password.

For frontend development use `npm run dev`. After editing, run `npm run build` before `npm start`. The frontend and API are served together on port 3000, avoiding cross-origin setup.

## What works

- Responsive landing page, split signup/login screens, dashboard, sidebar, saved light/dark theme, real repository counters, and resource cards.
- University email registration, email verification, login/logout and expiring one-use password reset links. Passwords are bcrypt hashed; JWT sessions expire after 8 hours and use HttpOnly cookies.
- Department → semester → course browsing, course-code/name search, document search and filters by type, year and resource category.
- PDF upload with title, type, year and course, server-side validation, admin-configured maximum of 1–20 MB, and a 10-document Free limit for student accounts.
- Pending/Approved/Rejected submissions. Admins and moderators can preview a file and approve/reject with a review note. Only approved files enter the library.
- Authorized PDF viewing/downloading, saved collections, upload statistics, download tracking and overview charts.
- Uploader/admin metadata editing and deletion. Editing returns a file to review. Deletion removes linked submission, download and saved records and queues PDF removal. Failed storage cleanup retries every minute and after restart.
- Admin department/course CRUD, university member invitations, role changes, suspension, bans and deletion. Access changes immediately invalidate existing sessions. The final active admin cannot be removed.
- User self-deletion with password confirmation. Deleting a course with approved files requires an additional confirmation.
- Plans, sample payment history, help FAQs, support email configuration, upload settings, daily backups, a Postman collection, and integration tests.

PDF types follow the SRS: **Note, Slide, Past Paper**. The separate resource category (**Notes, Assignment, Class Task, Summary**) makes the dashboard resource cards useful without changing those required document types.

Plans and payment history are explicitly sample data. No payment gateway, real subscriptions, priority scheduling, institutional bulk importer, or financial receipts are enabled. Core saved collections are available to all members in this project.

## Email and registration

Copy `.env.example` to `.env` to customize configuration. By default, university email addresses ending in `.edu`, `.edu.xx` or `.ac.xx` are accepted. Set `UNIVERSITY_DOMAINS` to a comma-separated allowlist to restrict registration to your institution, for example `student.example.edu.bd,example.edu.bd`. Domain checks alone do not prove enrollment; verification requires access to that university mailbox.

Without SMTP in local development, verification/reset messages are saved to the private `.data/mail` directory. Run:

```sh
npm run mail
```

Open the verification link in a browser and click **Verify email**. For a password reset, use **Forgot password?**, read the local message, and open its reset link. Account invitations send both a verification link and a password setup link. Links are single-use; verify links last 24 hours and reset links one hour. The local mail viewer shows only the last 10 messages. These files contain account links and should stay private.

For real email, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional SMTP credentials, and `SMTP_FROM`. `APP_URL` must be the browser-facing origin used in the email links (and request-origin checks). Production requires a real SMTP service. `SUPPORT_EMAIL` adds a mailto contact action to Help and plans.

## Google Drive storage

The application supports your personal Google Drive through an owner-authorized OAuth connection. New PDFs go into a private app folder; people use their UniArchive accounts to upload and read approved documents. Only the server holds Google credentials. Existing local PDFs continue to work and are not automatically migrated. See [the complete Drive and deployment guide](docs/GOOGLE_DRIVE.md).

## MySQL setup

The database adapter supports MySQL through parameterized `mysql2` queries. Create an empty database with UTF-8 encoding and a dedicated database user with privileges on that database. Tables and foreign keys are initialized on first startup; the reference schema is in `docs/schema.mysql.sql`.

```sql
CREATE DATABASE uniarchive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'uniarchive'@'localhost' IDENTIFIED BY 'your-unique-password';
GRANT ALL PRIVILEGES ON uniarchive.* TO 'uniarchive'@'localhost';
```

Configure `.env`:

```dotenv
DB_CLIENT=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=uniarchive
MYSQL_USER=uniarchive
MYSQL_PASSWORD=your-unique-password
```

Then run the same seed/start commands. MySQL starts with its own empty database; this does not migrate an existing SQLite file. Keep database credentials in `.env`, which is excluded from version control and the ZIP. Automated MySQL backups require the `mysqldump` client in the server environment.

The optional `compose.yaml` runs MySQL and the app locally with Docker Compose. Copy `.env.example` to `.env`, set `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`, then run `docker compose up --build`. Once healthy, run `docker compose exec app npm run seed`. It binds port 3000 to localhost and uses development email delivery. This is a local demo configuration, not an HTTPS production deployment.

## Production operation

Use MySQL for shared deployment. The embedded sql.js database loads SQLite into memory and writes snapshots atomically; it is intended for a single local process. Never run multiple server, seed, admin or backup processes against the same SQLite database at the same time. Stop the app before running those CLI commands against SQLite.

Set `NODE_ENV=production`, a unique random `JWT_SECRET` of at least 32 characters, the public HTTPS `APP_URL`, SMTP settings and `DB_CLIENT=mysql`. Set `HOST=0.0.0.0` only when the server must listen beyond loopback. Put it behind an HTTPS reverse proxy and set `TRUST_PROXY=1` only for a single trusted proxy. Session cookies are Secure in production. Set proxy upload limits above 20 MB to allow multipart overhead. Do not seed the publicly documented demo credentials on a real deployment; use `npm run admin:create` instead. The application deliberately disables demo seeding in production.

Authorization is checked on every protected API request against current account status and role. Writes require the application's custom header and a matching request origin when supplied. Passwords and file paths never appear in user/list responses. Uploads stay outside the web root; each file request requires a valid session and document access. Rate limits cover authentication attempts. User input is validated and database values use bound parameters.

## Backups and restore

The running server snapshots the database and uploaded PDFs on startup if no recent backup exists, then every 24 hours while it remains running. It retains the latest 7 snapshots under `.data/backups`. Its write queue prevents local upload/deletion operations during each snapshot. MySQL backups use `mysqldump --single-transaction`; direct external database writes are outside that queue.

To make a manual backup, stop the server and run `npm run backup`. This records the database and local PDFs together. Drive documents are recorded in `cloud-files.json` by their file identifiers; their cloud contents are not downloaded into these backups. Keep a separate protected copy of cloud PDFs and the private connection credentials. Deleting a Drive file through this application removes its contents from Drive, so a database snapshot alone cannot restore it. Move backups to separate protected storage if you need protection against loss of this computer/server. Failed scheduled backups log a message on the server; monitor those logs.

To restore SQLite: stop the server, copy a snapshot's `uniarchive.sqlite` into `.data/uniarchive.sqlite`, replace `.data/uploads` with that snapshot's `uploads` directory, then start the server. Restore the database and uploads from the **same snapshot**. To restore MySQL: stop the app, import `database.sql` into an empty database and restore the matching `uploads` directory before restarting. Backups contain user data and password hashes and must remain private.

## API and project structure

Import `docs/UniArchive.postman_collection.json` in Postman. Set its `baseUrl` to `http://localhost:3000`; login requests populate Postman's cookie jar. Set `courseId`, `documentId`, `userId`, `departmentId` and `token` as appropriate. Mutating requests include `X-UniArchive-Client: web`. An endpoint/permission summary is in `docs/API.md`.

- `src/`: React interface and responsive/theme styles.
- `server/`: Express routes, validation, authentication, database adapter and backups.
- `scripts/`: sample data, initial admin, local email viewer and backup commands.
- `tests/`: isolated API integration tests using real PDFs and temporary data.
- `dist/`: built browser assets served by `npm start`.
- `.data/`: runtime database, uploads, email outbox, private development signing secret and backups (created locally, excluded from ZIP).

The JWT development secret is generated locally and persisted privately, so sessions survive restart. Setting your own `JWT_SECRET` overrides it. Role/status changes, logout and password resets revoke existing sessions.

## Verification and limits

Run `npm test` and `npm run build`. The integration suite exercises registration/verification, role isolation, actual PDF upload/download, review decisions, metadata re-review, ownership, cascade deletion, settings, session revocation, password reset, persistence, a 20 MB upload, the Free upload cap, cloud storage authorization and deletion retries using a mocked Drive client, and 100 simultaneous directory requests on the local machine. Browser QA covers login, dashboard, library, moderation dialog, account/course administration, themes, and narrow-screen layout.

A live Drive check also uploaded a generated PDF into the connected private folder, approved it through the API, and verified an identical download. That owner-specific connection is excluded from this distribution.

The MySQL adapter and Docker configuration are provided but were not executed against a live MySQL/Docker service in this environment. SMTP delivery needs your provider configuration; local-outbox delivery was exercised. Local concurrency results do not certify campus-network latency or production capacity. See `docs/REQUIREMENTS.md` for coverage and deployment-dependent requirements.
