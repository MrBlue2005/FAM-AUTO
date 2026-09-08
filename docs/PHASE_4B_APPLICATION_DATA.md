# Phase 4B: cloud application data foundation

## Scope and status

Phase 4B-A adds only an additive local-validated schema and a read-only import planner. It does not deploy to hosted Supabase, upload media, replace `DataManager`, alter `server/server.js`, alter `TaskContract`, start a Local Agent, or enable Facebook publishing.

`202609080003_application_data_foundation.sql` creates the `app_*` application-data model. It is separate from Protocol V1 control-plane tables (`agents`, `profiles`, `tasks`, `task_events`, credentials and idempotency state).

## Ownership and schema

- Postgres owns `app_campaigns`, `app_campaign_posts`, targets, folders, schedules, execution-run metadata and posting-result history.
- The private `fam-app-media` Supabase Storage bucket owns immutable photo/video bytes.
- `app_media_objects` identifies immutable content by `media_id`, bucket/key, SHA-256, byte size, MIME type and original name. The database trigger rejects changes to identity fields; replacement content requires a new row and object key.
- `app_post_media.ordinal` makes media ordering deterministic.
- `app_execution_runs` and `app_posting_results` may refer to control-plane agent/profile/task IDs through constrained FKs. Historical imported results may omit `task_id`, because no Protocol V1 task existed when they were created.

Every application table has RLS enabled. `anon` and `authenticated` receive no table privileges; only `service_role` has the future BFF/Edge access path. The migration also creates `fam-app-media` as `public = false`, revokes direct `storage.objects`/`storage.buckets` privileges from browser roles, and grants the server role. No permanent public URL is created.

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

## Cutover and rollback

Keep local `DataManager` authoritative until an explicit later cutover. The `ApplicationDataStore` abstract interface is a compatibility seam only; existing API and dashboard calls remain unchanged. A future importer must be idempotent by `(kind, legacy_id)` / folder, target and schedule legacy IDs, preserve media hashes, report every conflict and never delete sources.

Rollback before cutover is simply to not use the new tables/bucket. No automated schema/data rollback or cleanup is permitted; a hosted deployment, when authorized, requires an operator-reviewed additive/reversal migration.

## Local validation evidence

The migration was applied during a clean local Supabase rebuild. It created eleven `app_*` tables, RLS on all eleven, the private bucket, service-role table access, anon denial, and an immutable-media update rejection. The importer DRY_RUN found no eligible local JSON/media in this checkout; it wrote only an ignored `.tmp` sanitized report and performed zero cloud writes/uploads.

## Next implementation step

Phase 4B-B should implement the server-side application repository plus authenticated upload-session/metadata APIs. It must not cut over the dashboard or Local Agent and must keep all Supabase service-role credentials server-only.
