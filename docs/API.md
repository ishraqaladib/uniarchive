# UniArchive REST API

All paths are relative to the app origin. Responses use JSON except PDF files. Authentication is an HttpOnly session cookie; login sets it. Never place the JWT in localStorage. Mutating requests require X-UniArchive-Client: web; if an Origin header is present it must match APP_URL.

| Method | Path                           | Permission                                   |
| ------ | ------------------------------ | -------------------------------------------- |
| GET    | /api/config                    | Public                                       |
| GET    | /api/stats                     | Public                                       |
| GET    | /api/auth/me                   | Public                                       |
| POST   | /api/auth/register             | Public                                       |
| POST   | /api/auth/login                | Public                                       |
| POST   | /api/auth/logout               | Signed-in member                             |
| POST   | /api/auth/forgot-password      | Public                                       |
| POST   | /api/auth/resend-verification  | Public                                       |
| POST   | /api/auth/verify-email         | Public                                       |
| POST   | /api/auth/reset-password       | Public                                       |
| GET    | /api/departments               | Public                                       |
| POST   | /api/departments               | Admin                                        |
| PUT    | /api/departments/:id           | Admin                                        |
| DELETE | /api/departments/:id           | Admin                                        |
| GET    | /api/courses                   | Public                                       |
| POST   | /api/courses                   | Admin                                        |
| PUT    | /api/courses/:id               | Admin                                        |
| DELETE | /api/courses/:id               | Admin                                        |
| GET    | /api/documents                 | Signed-in member                             |
| POST   | /api/documents                 | Signed-in member                             |
| PUT    | /api/documents/:id             | Uploader / Admin                             |
| DELETE | /api/documents/:id             | Uploader / Admin                             |
| GET    | /api/documents/:id/file        | Signed-in; approved file, owner, or reviewer |
| PATCH  | /api/submissions/:id           | Admin / Moderator                            |
| POST   | /api/documents/:id/save        | Signed-in member                             |
| GET    | /api/overview                  | Signed-in member                             |
| GET    | /api/billing                   | Signed-in member                             |
| GET    | /api/users                     | Admin                                        |
| POST   | /api/users                     | Admin                                        |
| PATCH  | /api/users/:id                 | Admin                                        |
| DELETE | /api/users/:id                 | Admin                                        |
| DELETE | /api/account                   | Signed-in member                             |
| PATCH  | /api/settings                  | Admin                                        |
| GET    | /api/maintenance               | Cron bearer secret                           |
| POST   | /api/uploads                   | Signed-in member                             |
| PUT    | /api/uploads/:id/chunks/:index | Current uploader                             |
| POST   | /api/uploads/:id/complete      | Current uploader                             |
| DELETE | /api/uploads/:id               | Current uploader                             |

## Queries

- GET /api/courses: q searches code and name. Department and semester filtering is performed by the interface.
- GET /api/documents: mode=library (default), mine, saved, or queue. queue requires Admin/Moderator. Filters: course, type, year, kind, q. Queue status: Pending (default), Approved, Rejected.
- GET /api/documents/:id/file: authenticated inline PDF; download=true sends an attachment and records a download.
- DELETE /api/courses/:id: returns 409 if approved PDFs exist. Resubmit with confirm=true only after explicit confirmation.

## Input and response behavior

Use the Postman collection for request bodies. A PDF upload is multipart form-data with file, title, type, year, course_id, resource_kind. Maximum file size is configured by Admin between 1 and 20 MB. Types: Note, Slide, Past Paper. Resource categories: Notes, Assignment, Class Task, Summary. Document updates use JSON and return the document to Pending. Review accepts Approved or Rejected and an optional reason up to 500 characters.

New accounts must verify their university email. Public registration always assigns Student, regardless of extra request properties. Invitations also need password setup. Email tokens are SHA-256 hashed in the database and expire. Resetting a password and changing a role/status revokes existing sessions; logout revokes all the user’s sessions.

Errors use {"error":"Human-readable message"}. Common statuses: 400 invalid input, 401 authentication required, 403 permission denied, 404 missing record, 409 duplicate/conflict/last-admin guard, 429 too many auth attempts. Success responses return an object or list; actions usually return {"message":"..."}. No live billing or payment mutation endpoint exists.

## Cloud uploads on serverless hosts

`POST /api/uploads` accepts document fields plus `filename` and `size` and returns an upload `id` and `chunkSize` (3 MiB). Send each chunk as `application/octet-stream` using `PUT /api/uploads/:id/chunks/:index`, with zero-based sequential indices. Then `POST /api/uploads/:id/complete` validates and saves the complete PDF as Pending. `DELETE /api/uploads/:id` cancels an unfinished session. All routes require the current uploader's session and the write header. Chunk and completion retries are idempotent. Sessions expire after one hour. `/api/config` advertises `chunkedUploads`.

`GET /api/maintenance` is restricted to the server's `CRON_SECRET` bearer token. It is used by the daily Vercel job for expired temporary chunks and queued storage cleanup, not by members.
