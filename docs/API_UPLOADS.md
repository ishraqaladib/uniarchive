## Cloud uploads on serverless hosts

`POST /api/uploads` accepts document fields plus `filename` and `size` and returns an upload `id` and `chunkSize` (3 MiB). Send each chunk as `application/octet-stream` using `PUT /api/uploads/:id/chunks/:index`, with zero-based sequential indices. Then `POST /api/uploads/:id/complete` validates and saves the complete PDF as Pending. `DELETE /api/uploads/:id` cancels an unfinished session. All routes require the current uploader's session and the write header. Chunk and completion retries are idempotent. Sessions expire after one hour. `/api/config` advertises `chunkedUploads`.

`GET /api/maintenance` is restricted to the server's `CRON_SECRET` bearer token. It is used by the daily Vercel job for expired temporary chunks and queued storage cleanup, not by members.

## Course catalog metadata

Course credits and semester may be null when not verified. Blank optional fields on course create/edit become null. The interface displays Not set and supports filtering courses without a semester. Imported catalog_status, catalog_sources and catalog_note retain source evidence; these are read-only metadata in the ordinary course form. Earlier-source entries are not confirmed current-term offerings.
