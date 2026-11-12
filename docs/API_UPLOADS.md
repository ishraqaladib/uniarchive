## Cloud uploads on serverless hosts

`POST /api/uploads` accepts document fields plus `filename` and `size` and returns an upload `id` and `chunkSize` (3 MiB). Send each chunk as `application/octet-stream` using `PUT /api/uploads/:id/chunks/:index`, with zero-based sequential indices. Then `POST /api/uploads/:id/complete` validates and saves the complete PDF as Pending. `DELETE /api/uploads/:id` cancels an unfinished session. All routes require the current uploader's session and the write header. Chunk and completion retries are idempotent. Sessions expire after one hour. `/api/config` advertises `chunkedUploads`.

`GET /api/maintenance` is restricted to the server's `CRON_SECRET` bearer token. It is used by the daily Vercel job for expired temporary chunks and queued storage cleanup, not by members.
