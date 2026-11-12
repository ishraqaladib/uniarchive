# Free Vercel deployment

UniArchive now includes a Vercel deployment adapter: React/Vite builds to `dist`, `api/index.js` hosts the Express API, and `vercel.json` routes browser/API requests under one origin. This keeps the existing HttpOnly login cookie and university registration flow. Visitors use UniArchive accounts; no ChatGPT or Vercel account is needed to use the deployed site.

The selected services are Vercel Hobby for hosting, TiDB Cloud Starter in MySQL compatibility mode for records, the operator's Google Drive for PDFs, and Brevo Free for verification/reset messages. Free tiers have quotas and can pause service when limits are reached. Hobby is for personal, non-commercial projects. No paid trial, credit-card-backed upgrade, or paid domain is required for this setup. Recheck each provider's current terms and limits before expanding usage.

## Uploads on Vercel

Vercel limits function request bodies. The browser therefore starts an upload session, sends PDF chunks no larger than 3 MiB, and requests completion. The server holds chunks temporarily in the cloud database, validates the full PDF (up to the administrator's 1–20 MB limit), uploads it to the private Drive folder, inserts its Pending document record, and removes the temporary chunks. Files are never stored on Vercel's ephemeral disk. Existing local storage remains available for local installations.

Incomplete sessions expire after an hour; maintenance or a new upload removes expired chunks. At most two sessions per member and 100 MiB of reserved temporary uploads globally are permitted. This bounds temporary database usage. The database is private application infrastructure and stores these temporary bytes until cleanup.

The old multipart API remains available for local/server installations. On Vercel, use the chunk API for files beyond the function request limit. PDF downloads use streaming responses after authorization.

## Server-side environment

Configure these in the linked Vercel project's Production environment. Secrets must never be placed in the React bundle or `VITE_` variables.

- `NODE_ENV=production`, `APP_URL=https://your-project.vercel.app`, `TRUST_PROXY=1`.
- `JWT_SECRET`: unique random value of at least 32 characters.
- `DB_CLIENT=mysql`, `MYSQL_HOST`, `MYSQL_PORT=4000`, `MYSQL_DATABASE=uniarchive`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_SSL=true`. TiDB usernames include the instance prefix. A dedicated application user is used instead of the root user. TLS verifies both the certificate chain and host identity.
- `STORAGE_PROVIDER=google-drive`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`, and `GOOGLE_REDIRECT_URI` matching the owner-authorized client.
- `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, and `EMAIL_FROM_ADDRESS` for a verified sender. Existing SMTP settings remain supported as an alternative.
- `CRON_SECRET`: random secret protecting daily maintenance.
- Optional `SUPPORT_EMAIL` as described in the README. Any valid email address can register; verification is required.

Set the TiDB spending limit to **$0** and keep Vercel on **Hobby** and Brevo on **Free**. Avoid enabling overage billing or paid trials. Access to the database must be permitted from the backend host's network; review a proposed firewall change before applying it.

## Deploy from this computer

```sh
npm ci
npm test
npm run build
npx vercel login
npx vercel link
npx vercel --prod
```

Use the linked UniArchive workspace/project. Supply private environment values through Vercel's secret settings or CLI stdin. Never put secret values into shell command arguments, source control, screenshots, or chat. `.vercelignore` excludes runtime data, environment files, old hosting metadata, tests, and local administrative scripts from uploaded source.

`api/index.js` requires the hosted database, Drive, and a configured email provider. It uses `/tmp` only for incidental runtime directories and starts neither a port listener nor local backup timers. The project must be redeployed after environment changes.

The initial public administrator should be a real owner account with a private password or one-use email setup link. Do not run demo seeding in production. Configure or import the institution's departments and courses before inviting members.

## Maintenance and backup limits

`vercel.json` schedules `/api/maintenance` once per day. The route checks `Authorization: Bearer <CRON_SECRET>`, removes expired upload sessions/chunks and retries queued Drive-file removals. It does not export the database to Vercel disk or keep an always-running timer. Immediate deletions also try cloud cleanup during the request. A queued cleanup may wait until the next daily run if Google is unavailable.

Local `npm run backup`/24-hour disk snapshots apply to the traditional server installation. Vercel does not retain those local snapshots. Configure an independent database export and cloud PDF backup for any real institutional use, and review what backups your chosen free database plan actually provides. A database backup cannot restore a Drive PDF that has been deleted. Do not treat Google Drive as a second independent backup of itself.

Google OAuth Testing refresh tokens expire after seven days for this Drive scope. Finish Branding using the deployed homepage and `/privacy` URL, review the production publishing change, and renew owner authorization before relying on ongoing uploads. See `GOOGLE_DRIVE.md`.

## Checks after deployment

Confirm the landing page and `/privacy` load without hosting-provider sign-in. Check anonymous PDF access is denied; register and verify a university account; sign in, upload a PDF, review it as an administrator/moderator, and download matching contents. Check files remain private in Drive and temporary chunks disappear from TiDB. Confirm password reset and account deletion, and check runtime/email logs for provider errors.

Local automated tests cover 20 MB chunked uploads, cross-user isolation, idempotent chunk/completion retries, chunk expiry, PDF validation, moderation, account workflows, and private cloud storage with a mocked Drive client. Actual provider connectivity must also be verified against the deployed instance.

References: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [function limits](https://vercel.com/docs/functions/limitations), [cron scheduling](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing), [TiDB Starter](https://docs.pingcap.com/tidbcloud/select-cluster-tier/), [Brevo Free](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans).
