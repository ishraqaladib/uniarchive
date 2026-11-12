# Verified deployment

Public website: **https://uniarchive-psi.vercel.app**

Verified on November 12, 2026:

- Vercel workspace is on Hobby. The public landing page, privacy page and API work without Vercel or ChatGPT sign-in.
- TiDB Cloud Starter is MySQL compatible with a $0 monthly spending limit. The app uses a separate database user and verified TLS, and all 13 tables initialized successfully.
- Brevo uses a restricted transactional-email key. The sender is verified, the owner account setup email was delivered, and the owner completed password setup and administrator login. The key expires November 12, 2027 or after 90 days unused, according to Brevo's settings at creation.
- The operator's Google Drive folder remains private. The Google OAuth application is In production and owner authorization was renewed for only drive.file. No seven-day Testing token lifetime was reported for the renewed token.
- A 20 MB generated PDF was sent through the public chunk-upload API, stored privately in Drive and downloaded with identical bytes. Temporary database chunks and the generated verification account were removed afterward.
- Local automated verification passed 20 tests, including auth, moderation, permissions, persistence, PDF validation, 20 MB uploads, cloud cleanup retries, chunk isolation/idempotency/expiry and the HTTPS mail adapter.

The deployed course directory contains the finalized 81 CSE course codes, including 29 labeled as supported only by earlier sources. The original CSE 323 record and its document are retained. Credits and semesters absent from the source list display as Not set. The owner's administrator is the real initial account. Public demo accounts and local sample PDFs were not copied into the live database.

People sign up at `/signup` using any valid email address, verify the emailed link, and sign in with their own UniArchive password. Administrator invitations also accept any valid email address. The old UNIVERSITY_DOMAINS setting is no longer used. Uploads are Pending until reviewed. Student accounts currently have the application's Free-plan limit of 10 documents and a maximum PDF size of 20 MB, adjustable by the administrator within 1–20 MB.

Hosting, database and email use their free tiers. Drive uses the owner's existing storage subscription. Quotas and provider terms still apply; no extra paid plan was enabled by this deployment. The plans/billing screens inside UniArchive contain sample pricing and do not collect payments.

Private connection data is intentionally excluded from the source archive. It resides in server-side Vercel secrets and private local configuration. Keep those values private and use the existing linked project for future deployments. Review VERCEL.md for daily cleanup and backup limitations before real institutional use.
