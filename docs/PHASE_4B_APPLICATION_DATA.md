# Phase 4B: cloud application data foundation

## Scope and status

Phase 4B-A adds an additive local-validated schema and a read-only import planner. Phase 4B-B adds an opt-in server-side Supabase store and `/api/cloud` BFF router. It does not deploy to hosted Supabase, replace `DataManager`, alter `TaskContract`, start a Local Agent, cut over the dashboard, or enable Facebook publishing.

`202609080003_application_data_foundation.sql` creates the `app_*` application-data model. It is separate from Protocol V1 control-plane tables (`agents`, `profiles`, `tasks`, `task_events`, credentials and idempotency state).

## Ownership and schema

- Postgres owns `app_campaigns`, `app_campaign_posts`, targets, folders, schedules, execution-run metadata and posting-result history.
- The private `fam-app-media` Supabase Storage bucket owns immutable photo/video bytes.
- `app_media_objects` identifies immutable content by `media_id`, bucket/key, SHA-256, byte size, MIME type and original name. The database trigger rejects changes to identity fields; replacement content requires a new row and object key.
- `app_post_media.ordinal` makes media ordering deterministic.
- `app_execution_runs` and `app_posting_results` may refer to control-plane agent/profile/task IDs through constrained FKs. Historical imported results may omit `task_id`, because no Protocol V1 task existed when they were created.

Every application table has RLS enabled. `anon` and `authenticated` receive no table privileges; only `service_role` has the future BFF/Edge access path. The migration also creates `fam-app-media` as `public = false`, revokes direct `storage.objects`/`storage.buckets` privileges from browser roles, and grants the server role. No permanent public URL is created.

`202609080004_application_transactional_rpcs.sql` adds only the compound-write boundary: `rx_app_write_campaign_with_posts`, `rx_app_write_schedule_with_campaigns`, and `rx_app_set_post_media`. Each accepts an expected revision and a request ID/hash. A stale revision with a new request is rejected; an exact retry returns its saved result. The RPC transaction rolls back its idempotency row, parent row and relation changes if any later write fails. They are `SECURITY INVOKER` functions with `search_path = pg_catalog, public`, no PUBLIC/anon/authenticated execute grant, and service-role-only execution. Results/execution runs intentionally have no RPC because the present schema has no required multi-table write invariant there.

## Snapshot compatibility

Future task creation reads a coherent application revision and writes the complete immutable material into the existing `tasks.payload`:

```text
app_campaign + app_campaign_post + app_post_media + app_media_objects + app_target + config revision
  -> TaskContract payload { campaign, group, campaign_day, posting_identity_id, execution_config,
                            media: [{ media_id, bucket, object_key, sha256, byte_size, mime_type, ordinal }] }
  -> Protocol V1 task lifecycle
```

No runner should re-read live `app_*` rows after task creation. The later Local Agent media-acquisition slice will materialize verified local temporary files before `RUNNING`; it will not change Protocol V1 semantics.

## Importer foundation

`node scripts/import-application-data.js [--report <ignored-path>]` is DRY_RUN-only by default. It reads current local JSON and media, computes SHA-256 for referenced files, detects missing media, invalid/duplicate campaign records, targets and schedules, and reports counts without source text, target URL, local path or media name.

It never writes to Postgres/Storage and never changes local JSON, uploads, logs or SQLite. `--apply` additionally requires `RX_APP_IMPORT_CONFIRM=IMPORT_APPLICATION_DATA`, then deliberately fails because Phase 4B-A has no hosted writer. A later reviewed slice must supply explicit credentials, conflict handling and upload implementation before real import is allowed.

Property Copywriter remains intentionally separate: its Prisma SQLite `PropertyRecord` and `DescriptionTemplate` records need an approved field-level mapping and are not imported by this foundation.

## Phase 4B-B BFF and media flows

`SupabaseApplicationDataStore` is constructed only when both server-only `RX_APP_SUPABASE_URL` and `RX_APP_SUPABASE_SERVICE_ROLE_KEY` exist. It is never imported by dashboard code. The optional `/api/cloud` router is behind the existing Express authentication middleware. This is a single-operator model; no tenant ownership model exists yet, so multi-tenant authorization is intentionally not claimed.

`POST /api/cloud/media/initiate` validates MIME, max 500 MB size and SHA-256, creates a new STAGED immutable metadata row/key, then returns a short-lived Storage upload authorization. `POST .../finalize` changes only STAGED media to READY; abandoned staged rows cannot preview. `GET .../preview` only signs READY media related through `app_post_media`; no permanent URL is stored. Browser responses contain signed URLs/tokens only, never a service-role/operator/agent credential.

Local Storage E2E now validates the lifecycle with a synthetic 1×1 PNG: the browser authorization PUTs directly to the private bucket using only its short-lived upload token. Before finalization, the server streams the exact private object with service-role authority, independently counts bytes and calculates SHA-256, comparing both against immutable STAGED metadata. Only an exact match can atomically PATCH `STAGED` to `READY`; a mismatch remains STAGED. Preview requires a READY `app_post_media` relationship and returns a short-lived signed URL whose downloaded bytes hash-match the fixture. Initiation refuses an existing SHA-256 identity so it cannot issue an overwrite authorization for an immutable object. Anonymous Storage list access returns no RLS-visible objects, direct read/write is denied, and the bucket is `public = false`.

The server store now consumes the three reviewed transactional RPCs for campaign/post snapshots, schedules/ordered campaign links, and post-media replacement. It uses revision-guarded ordinary table writes for targets and other single-table metadata; a stale revision is surfaced as `APP_REVISION_CONFLICT`. The `/api/cloud` BFF exposes only these application-data reads/mutations and inherits the existing Express session/CSRF gate. It has no route or store method for Protocol V1 state.

The importer writer is enabled only by `--apply` plus `RX_APP_IMPORT_CONFIRM=IMPORT_APPLICATION_DATA`. It upserts folders, campaigns/posts, targets, schedules/links and execution-run metadata by legacy identity, reporting every record outcome. It is restartable: an identical import detects existing logical records rather than duplicating them. Media files are hashed and create/reuse deterministic immutable metadata in `STAGED`; this task deliberately does not upload bytes, attach STAGED media to posts, or claim Storage completion. Historical posting-result rows without a stable unique source/result key are reported as `HISTORY_MAPPING_DEFERRED`, never silently skipped.

Hosted deployment later requires migrations `202609080003` and `202609080004`, the existing private bucket, and server/BFF environment values `RX_APP_SUPABASE_URL` and `RX_APP_SUPABASE_SERVICE_ROLE_KEY` in a server secret store. Do not add either variable to `VITE_*`, `NEXT_PUBLIC_*`, browser code, agent settings, or the existing `agent-protocol` function.

## Hostable same-origin BFF authentication

`server/hosted-bff.js` is the serverless-safe same-origin BFF seam for a future Vercel dashboard. `api/[...path].js` is its Node catch-all entrypoint, keeping browser routes under `/api/*` and mounting the existing server-only application router only when the application Supabase URL and service-role key are present. No dashboard caller was changed in this step.

Unlike the local Express server, this hosted seam has no in-memory session or CSRF map. Login issues an HMAC-SHA-256 signed, 12-hour `rx_session` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` in production). Its signed payload has the single operator identity, expiry, and a random CSRF value. The login/session-status response supplies that CSRF value to same-origin browser code; each authenticated mutation must present it in `x-rx-csrf`, and it is constant-time compared with the value authenticated by the cookie. Logout clears the client cookie; stateless sessions require no sticky instance or local persistence.

`RX_BFF_SESSION_SIGNING_SECRET` is a dedicated server-only secret (minimum 32 characters), distinct from `ADMIN_PASSWORD_SCRYPT`, `RX_OPERATOR_API_TOKEN`, Supabase service-role credentials, and agent credentials. Production additionally requires `AUTH_ENABLED=true`, a valid `ADMIN_PASSWORD_SCRYPT`, `RX_BFF_PUBLIC_ORIGIN`, `RX_APP_SUPABASE_URL`, and `RX_APP_SUPABASE_SERVICE_ROLE_KEY`; startup fails closed when any are absent or invalid. Authenticated mutations require an exact `Origin` match to `RX_BFF_PUBLIC_ORIGIN` in production. Development only permits the explicit `RX_BFF_ALLOWED_ORIGINS` list (with documented localhost defaults), never a wildcard credentialed CORS policy. `/api/bff/healthz`, `/api/auth/*`, and the CSRF-protected no-write `/api/bff/csrf-probe` form the minimum smoke surface.

The scheduler, Facebook/Chromium execution, and Property Copywriter remain local. Browser bundles and BFF JSON responses must never expose the service-role key, signing secret, password hash, operator token, agent credential, enrollment token, or database credentials.

## Feature-gated cloud dashboard reads

The dashboard defaults to `VITE_DASHBOARD_DATA_MODE=LOCAL`. Setting it to `CLOUD_READ_ONLY` makes the existing service abstraction read only the same-origin authenticated `/api/cloud-read/*` BFF routes for properties, jobs, targets/groups, campaign folders, schedule folders, schedules with ordered campaign links, minimal campaign preview text, and safe media-library metadata. Browser code never queries Supabase directly.

The cloud read adapter maps application rows to legacy-shaped dashboard DTOs and intentionally omits raw database internals such as UUID relationship keys, revisions, JSON payloads, bucket/object keys, SHA-256 values, and all credentials. Media metadata has no local path. READY media linked to an application post exposes only `previewAvailable: true`; the dashboard must make a separate authenticated request for each short-lived preview authorization.

`CLOUD_READ_ONLY` rejects every dashboard application mutation before network fallback, with a clear no-local-write-fallback error. Authentication login/logout remain available so the hosted BFF session can be established and cleared. Local-only runtime configuration, queue/robot state, history/runs/reports, exports, scheduler execution, and Property Copywriter are explicitly unavailable through this mode rather than silently read from the local API. The scheduler itself remains local; the cloud schedule DTO is display data only and carries `timezone: cloud-read-only`.

`GET /api/cloud-read/media/:mediaId/preview` requires the same signed BFF session as all cloud reads. The server authorizes only a READY media object with an existing `app_post_media` relationship; STAGED, absent, and unlinked objects receive no preview. Its browser response is the minimum `{ url, expiresIn }` short-lived signed authorization, never a media row, bucket/object key, hash, or server credential. The dashboard keeps this URL only in an in-memory TTL cache, invalidates it after media-load failure, and obtains one fresh authorization. It is never saved into campaign data, browser storage, or any durable application state. Local mode keeps its existing `/uploads/...` resolution and does not call the cloud preview route.

The Media Library, post preview, and read-only media picker use this resolver. CLOUD_READ_ONLY visibly disables upload, media cleanup, and media deletion; centralized capability helpers also make the remaining unsupported runtime/queue/robot/scheduler/history/report/copywriter surfaces reject clearly rather than falling back locally.

## Narrow cloud media upload capability

Cloud media writes require both `VITE_CLOUD_MEDIA_UPLOAD_ENABLED=true` in a `CLOUD_READ_ONLY` dashboard build and `RX_BFF_CLOUD_MEDIA_UPLOAD_ENABLED=true` on the BFF. This is deliberately separate from general application mutations; all other cloud-mode writes remain blocked. The browser first sends metadata plus SHA-256 to the authenticated, CSRF- and Origin-protected `/api/cloud-media/initiate` route, receives a short-lived scoped upload authorization, and PUTs bytes directly to private Storage. The BFF never proxies media bytes.

The browser then calls `/api/cloud-media/:mediaId/finalize`; server-side streaming verification must confirm the private object, immutable size, and SHA-256 before STAGED becomes READY. Only READY media may be appended through the narrow `/api/cloud-media/attach` route, which resolves the legacy campaign/day server-side and uses the existing ordered post-media RPC. A failed upload or failed verification leaves STAGED media unattached and unusable. Upload/finalize responses expose only scoped authorization or safe state/size/MIME fields, never service credentials or raw Storage identity fields. Local mode retains Multer and `app/uploads` unchanged.

## Cutover and rollback

Keep local `DataManager` authoritative until an explicit later cutover. The `ApplicationDataStore` abstract interface is a compatibility seam only; existing API and dashboard calls remain unchanged. A future importer must be idempotent by `(kind, legacy_id)` / folder, target and schedule legacy IDs, preserve media hashes, report every conflict and never delete sources.

Rollback before cutover is simply to not use the new tables/bucket. No automated schema/data rollback or cleanup is permitted; a hosted deployment, when authorized, requires an operator-reviewed additive/reversal migration.

## Local validation evidence

The foundation migration was applied during a clean local Supabase rebuild. It created eleven `app_*` tables, RLS on all eleven, the private bucket, service-role table access, anon denial, and an immutable-media update rejection. The transactional-RPC migration was then applied locally and tested using rolled-back synthetic fixtures: all three RPCs succeeded, stale revisions were rejected, exact retries were idempotent, a deliberate second-stage schedule FK failure left neither schedule nor idempotency row, anon/authenticated/PUBLIC execution was denied, and service-role execution succeeded. The test confirms no `rx_app_*` function refers to Protocol V1 control-plane tables. A separate ignored synthetic fixture then passed importer DRY_RUN and two local APPLY runs: two campaigns/two posts, one target, both folders, one schedule/link and one SHA-256 media identity were created once; APPLY #2 reported idempotent records and created no duplicates. The media row remained `STAGED` and no Storage request was made.

## Next implementation step

Phase 4B-B is complete. Future work requires an explicitly scoped next phase; no dashboard or Local Agent cutover is implied.

## Local Agent media materialization

For cloud task snapshots carrying `payload.media`, the agent requests a lease-scoped manifest while the task is `CLAIMED`, materializes and verifies every ordered item under its task-only temporary root, and only then reports `RUNNING` and invokes the executor. Byte size and SHA-256 must both match the immutable snapshot. The derived execution payload contains local verified paths only; it does not modify the stored task snapshot or pass signed URLs, service credentials, agent credentials, or operator credentials to Chromium. Download retries are bounded, and exactly one failed signed-URL materialization can request a fresh manifest. Zero-media tasks bypass materialization. Pre-execution manifest/download/hash/size failures are ordinary `FAILED` results rather than `OUTCOME_UNKNOWN`; executor errors use their existing failure semantics and cleanup still runs in `finally`. Task/media IDs are path-safe and every task root is isolated, so no partial output or sibling task data survives a failure.
