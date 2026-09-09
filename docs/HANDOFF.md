# FAM-AUTO handoff

Last updated: 2026-09-09 (hosted Local Agent status bridge added)

## Repository state

- Remote: `https://github.com/MrBlue2005/FAM-AUTO`
- Working branch: `main`
- Documented implementation: clean VPS-ready snapshot shared by `main` and `agent/release-1.1.0`
- The complete overlay source and documentation remain tracked; generated executables under `overlay-desktop/dist/` remain local-only.
- Previous draft pull request: `https://github.com/MrBlue2005/FAM-AUTO/pull/1` (superseded by the clean snapshot)
- Repository history was intentionally reinitialized on 2026-07-13 after verified local Git bundles and operational-data backups were created.

Always verify these values with `git status` and `git log`; this document describes the latest known handoff, not a replacement for Git.

## What is implemented

- Hosted `CLOUD_READ_ONLY` dashboard status now separates same-origin cloud BFF availability from a read-only, heartbeat-derived Local Agent status DTO. The bridge exposes no agent credential, task, lease, profile secret, or raw control-plane data; it does not implement remote execution, and Facebook publishing remains disabled. Local mode remains unchanged.

### Dashboard and workflow

- The Facebook posting application is branded `RX PROPULSE TOOL` with the motto `Stay active. Stay visible.` in the launcher, dashboard, robot controls, sidebar, browser title, and desktop overlay.
- Workspace background and dashboard decorative effects use static treatments rather than continuous fullscreen animations. Operational panels do not use glass `backdrop-filter` compositing and the sidebar mark is static, avoiding high CPU/GPU use during long sessions. The separate fullscreen Welcome experience retains its motion.
- Dashboard/status polling is adaptive: idle Workspace screens refresh their costly queue/preflight summary every 20 seconds, while active runs retain 5-second updates. Desktop notifications avoid overlapping requests and use 30-second checks while idle.
- The operational Workspace uses only the base body gradient: its former fixed fullscreen blur, starfield, and shell overlays are disabled to keep scrolling responsive in Chrome CPU-composited renderers.

- A shared login page now protects the studio launcher, dashboard/robot, description generator, and their API routes before access is granted.
- Authentication uses versioned Scrypt hashes, a 12-hour HttpOnly/SameSite session cookie, login throttling, CSRF checks, no client-side token storage, and fail-closed generator checks.
- `npm run auth:setup` enables local authentication and writes only the password hash to the Git-ignored `.env`.
- Integrated studio launcher at `/` with separate entries for the dashboard/robot and description generator.
- Dashboard routes remain under `/dashboard` and the sidebar scrolls independently on short screens.
- In windowed layouts below 1180px, the compact sidebar has an explicit expand/collapse control that restores every tab name and remembers the operator's choice locally.
- `npm run studio` starts the API, dashboard/launcher, and property-copywriter together.
- Operational dashboard navigation and CTA buttons.
- Dashboard summary and live API status.
- Property and job creation with media drag-and-drop.
- Properties provides combined search/status filtering plus dedicated All/Rental/Sale transaction filters with live counts.
- Each group row has a `Deschide grupul` action that safely opens the configured Facebook group URL in a separate tab.
- Property and job rows open the same shared day-by-day Facebook-style preview when their card area is clicked; the explicit Preview action remains available, while selection, details, and action controls keep their individual behavior. The drawer slides in from the right and locks the current page scroll while keeping its own contained scroll.
- Existing property IDs are editable. A rename migrates the property JSON filename, owned media folder and references (including references reused by cloned properties or jobs), real-estate schedules, Queue selections/order/retry state, history, and saved real-estate run references; duplicate or invalid IDs are rejected and the existing robot-running mutation guard applies.
- The property selection control is restricted to its checkbox and `Selecteaza` text; unused card space does not alter selection.
- Upload progress, cancel, preview, cover selection, and validation feedback.
- Reusable media library, SHA-256 deduplication, and safe unused-media cleanup.
- Media Library cards render the actual uploaded image/video preview, with a compact type badge and fallback when the underlying file is unavailable.
- The Media Library uses 320px-minimum cards with 230px previews in the main library; its picker uses fixed 300px-tall cards with a 230px preview area, giving enough detail to identify images and videos before selection. The picker is rendered above the scrolling page, so its viewport layout is stable.
- Automatic form drafts and protection against losing unsaved changes.
- Unified campaign queue with exclusion, retry, and reordering.
- The live worker rebuilds Queue state before every task, so campaign deactivation/deletion, selection changes, exclusions, and new history entries take effect without restarting the robot.
- A property/group pair is treated as processed only after a `prepared` or `posted` entry from the current server-local calendar day, regardless of campaign content day or Facebook profile. Older history remains available for reports and no longer requires manual deletion; property progress spans all pending groups instead of resetting for every task.
- Campaign preview, validations, and mandatory preflight checks.
- Diagnostics rebuilds the isolated execution configuration of every blocked schedule, exposes its exact blocking preflight issues under the schedule name, and deduplicates repeated per-group failures in the Live Feed summary while retaining the affected-task count.
- Live Feed, reports, CSV exports, backup/restore, and audit log.
- Filtered Excel campaign reports with formula-driven summary, campaign, group, and detailed result sheets. Reports can be exported for one Facebook profile over the last 7, 30, 60, or 90 days or all history; every workbook identifies its profile owner and calculates posting success as posted divided by posted plus errors.
- Persistent campaign runs with unique IDs, configuration snapshots, lifecycle status, and per-run totals.
- Persistent weekly campaign scheduling by weekday and local time, with campaign/profile selection, post day, group range, late tolerance, pause/resume, and manual run controls.
- Real-estate schedules keep their explicitly selected fixed post day. Job schedules derive an independent next post for every included job from the latest successful `prepared`/`posted` history plus the chronological order of upcoming schedule slots, so Tuesday/Thursday folders using the same campaign receive consecutive days (for example 11 then 12), blocked/error-only attempts do not consume a day, and each campaign wraps across its actual configured post days (including mixed 5-post and 20-post campaigns). Scheduler cards show every job's assigned next post day.
- Scheduler navigation provides a permanent Monday-through-Sunday calendar in chronological order. Existing weekday-named folders are treated as protected system folders, schedules are selected by their actual `daysOfWeek`, every visible list is sorted by posting time, and independent custom folders remain available.
- Every saved schedule card shows its programmed weekdays prominently, using a readable summary plus full weekday badges.
- Persistent campaign folders: create and filter folders from the Campanii page, assign either property or job campaigns from the campaign action menu, and safely remove folders without deleting campaigns. Campaign folders are included in backup/restore.
- In Scheduler, the selected Facebook profile filters the campaign checklist. Explicitly assigned campaigns appear only for their assigned profile; legacy campaigns without a profile appear only for their category's default profile. Backend validation prevents incompatible profile/campaign combinations from being saved.
- Deleting a property or job now removes its reference from mixed schedules and deletes schedules left without campaigns.
- Scheduled runs default to TEST mode; LIVE schedules require an explicit publishing confirmation and overlapping robot runs are skipped.
- A confirmed LIVE schedule passes its isolated execution configuration through to the final Facebook publish action. This is required because the shared runtime configuration stays TEST-safe while parallel profile workers run.
- Different Facebook profiles can now run campaigns concurrently: every active profile has its own Node/Playwright worker and immutable configuration snapshot. A second worker for the same persistent browser profile is rejected. The Robot page shows all active profile runs; pause, resume, and stop-after-current-group remain intentionally shared safety controls for every active worker.
- Every active profile-run card on the Robot page displays its own current-campaign ETA and full-run ETA, so parallel campaigns can be tracked independently.
- Parallel worker status propagates property/total progress, average seconds per group, and both ETA values from the selected primary active run to the Robot dashboard.
- Every active run also has individual Pause/Resume and Stop controls. A per-profile pause is checked at the next safe point and does not affect the other workers; individual Stop terminates only that profile's worker.
- Schedules exclude groups with a successful `posted` history entry from the same server-local calendar day by default and recheck before every task.
- The scheduler profile selector loads configured Facebook profiles from `GET /api/facebook-profiles` and filters them by campaign category.
- Reports dashboard page with filters, detailed events, per-run Excel export, controlled retry, and archiving. Selectable profile cards filter runs and posted campaigns exactly by Facebook profile, include configured and historical profiles, and show per-profile post/error/success totals.
- Reports use explicit white/high-contrast text and controls throughout the dark interface.
- Adding a Facebook profile now persists its runtime configuration before Chromium setup starts; setup/finalization failures are shown in the dashboard and duplicate setup clicks are blocked while a request is active.
- Groups support a separate, custom list category (for example `Romania`, `Internationale`, or `Diaspora`) in addition to the Imobiliare/Joburi campaign category. Queue Manager and each scheduled run save/select one list category so Romanian and international groups are not mixed; this selection never changes the Facebook profile or campaign type. Existing groups without this field are treated as `Romania`, which is also the safe default.
- Optional API key and role-based authentication groundwork for future hosting.
- Production authentication with Scrypt passwords, login throttling, HttpOnly sessions, protected media, and fail-closed dashboard access.
- Desktop notifications.
- Isolated end-to-end smoke coverage for one property, one job, one test group, queue rendering, and preflight in test mode.

### Robot and backend

- Express API in `server/server.js`.
- Phase 1 of the cloud/local split is implemented without cloud dependencies: the existing API and scheduler now create immutable local task snapshots and deliver them to the Windows worker through an `AgentTransport` abstraction with a JSON-backed local adapter.
- Every installation adopts a persistent `agent_...` identity and every existing Chromium directory receives a persistent `profile_...` identity in ignored local registry state. Legacy dashboard IDs such as `main` and `jobs` remain compatibility aliases; profile directories are never copied, moved, renamed, or exposed by the cloud-safe metadata DTO.
- Same-profile execution is defended twice: `RobotManager` rejects a second run by immutable physical-profile identity, and the worker holds an inter-process filesystem lock for its complete Playwright session. Duplicate executor requests report `PROFILE_BUSY`; dead-owner locks can be recovered without eagerly stealing a fresh lock.
- Task lifecycle state is stored locally as `QUEUED`, `CLAIMED`, `RUNNING`, and a terminal status. Execution reads snapshotted campaign text, media references, target group, day, identity, and safe configuration, so later edits do not alter already-created task content.
- The authenticated `GET /api/local-agent` endpoint exposes only future-cloud-safe agent/profile IDs, display names, and states. It excludes Chromium paths and all browser/Facebook session material. See `docs/CLOUD_AGENT_ARCHITECTURE.md`.
- Phase 2 adds the versioned outbound Agent Protocol v1, `HttpAgentTransport`, persistent local agent credentials, lease/idempotency/cancellation semantics, and a localhost-only reference cloud backend. The default remains local transport; HTTP requires explicit `RX_AGENT_TRANSPORT_MODE=HTTP`. See `docs/AGENT_PROTOCOL_V1.md`.
- Phase 3 implements Protocol v1 on Supabase/Postgres with versioned SQL migrations, RLS, Edge Function endpoints, enrollment-token hashing/single use, credential hashing/rotation overlap, atomic database claim, profile-level active-task invariant, durable idempotency, conservative lease expiry, and operator resolution for `OUTCOME_UNKNOWN`. Windows credentials use CurrentUser DPAPI when available. See `docs/SUPABASE_CONTROL_PLANE.md`.
- Phase 3.5 live-validated the local Supabase stack (CLI 2.117.0 / PostgreSQL 17.6) with clean database resets, real Edge HTTP enrollment/heartbeat, safe profile sync, non-publishing task claim/lifecycle, and concurrent claim behavior. It fixed Supabase extension qualification, Edge syntax, PL/pgSQL ambiguities, claim progress, and stale-transition handling. See the live-validation section in `docs/SUPABASE_CONTROL_PLANE.md`.
- Final Phase 3 hosted-readiness validation on 2026-09-08 repeated real HTTP/Postgres terminal races and claim/idempotency races against the restored local stack. It found and fixed one retained-lease terminal-overwrite path with additive migration `202609080001`; first valid terminal result now wins permanently. The final matrix, RLS denial, privileged Edge/API flow, Local Agent HTTP DRY_RUN E2E, DPAPI, and manual reconnect recovery are documented in `docs/SUPABASE_CONTROL_PLANE.md`. No Phase 4 work was started.
- Local JSON-backed properties, jobs, groups, runtime configuration, and history.
- Parallel workers lock history and group-discovery updates per file, preventing read-modify-write data loss while two profiles post at the same time.
- Local JSON-backed weekly schedules, evaluated while the API process is running using the server's local timezone.
- Configurable persistent paths for data, logs, uploads, and browser profiles, plus atomic JSON writes.
- Same-origin production dashboard serving, `/healthz`, `/readyz`, production environment validation, and controlled process shutdown.
- Playwright Facebook workflow with profile setup, queue planning, posting verification, pause/resume, and stop controls.
- Manual and scheduled runs use the same worker. Facebook groups that display a paused/suspended/unavailable screen are recorded as `skipped`; if Facebook uses an unknown message but the group page has no composer, the worker records `composer_unavailable`. Login/checkpoint pages remain errors instead of being silently skipped.
- Local-first defaults: API bound to `127.0.0.1`, restricted CORS, publishing disabled unless configured.

### Property description generator

- Standalone Next.js application in `property-copywriter/`, served locally on port 3100.
- The `Shortlink-uri Zonere` action in the Property Copywriter opens the CRM Shortlinks page at `https://crm.zonere.ro/shortlinks`.
- The Zonere adapter supports the current listing layout, including the `Despre Proprietate` description and `Toate Caracteristicile` as the authoritative, bounded source of property details. It supports both card-based and successive label/value details and was validated against the Adunații Copăceni listing supplied on 2026-08-24.
- Room-count normalization rejects area units (`mp`, `m²`, `m2`) and enforces one room for a garsonieră/studio, preventing a title or detail such as `18 mp` from being shown as `18 camere`.
- Bathroom counts and construction years are validated independently (realistic count versus a plausible calendar year), preventing shifted duplicate details from swapping those two fields.
- Its header uses the shared RX emblem in the generator green palette; the launcher displays red and green application-specific RX logos on the corresponding cards, with accessible labeling and reduced-motion support.
- Secure Zonere listing extraction, including catalog and shortlink support.
- Editable structured property data and formatted social-media descriptions.
- OpenAI/demo generation plus a manual ChatGPT copy/paste workflow. A separate backend-only Gemini flow uses the official `@google/genai` SDK, defaults to configurable `gemini-3.7-flash` with `gemini-3.5-flash` failover for transient capacity/quota/timeout/network errors, sends only the existing validated property/options JSON (never the full HTML), validates the same three-description schema, persists through the existing history path, and leaves the previous UI result untouched on failure. Gemini output removes only the `Detalii esențiale` heading while retaining the facts below it; `GEMINI_API_KEY` stays in the Git-ignored `property-copywriter/.env`.
- Reusable description models are managed from `/templates`. The selected model is sent in full to GPT together with explicit matching rules; inapplicable criteria are omitted, relevant data absent from the model may be added in the same style, and validated property data always takes precedence. History stores a snapshot, so editing or deleting a model does not alter previous generations.
- Local Prisma/SQLite history and dedicated unit tests.
- Integrated verification passes: dashboard lint and production build, 12 backend tests, and the complete 16-test studio E2E suite, including login, Facebook-profile persistence, Reports contrast, and real Media Library image-preview coverage.
- The earlier vulnerable `eslint-config-next` bundle was replaced with explicit ESLint 10, TypeScript, React Hooks, and Next.js plugin configuration. The 2026 advisories in Prisma's transitive `deepmerge-ts` plus `fast-uri`, `nanoid`, and `brace-expansion` are pinned through targeted overrides to their patched releases; both full and production-only `property-copywriter` npm audits report zero vulnerabilities, while Prisma stays on 7.9.0.

### Desktop overlay

- The desktop overlay lists every simultaneous active profile run with its campaign, current group, progress, ETA, and separate Pause/Resume and Stop actions. Global Pause all, Resume all, and Stop all controls remain available. Its process-only token is authorized only for overlay status and these explicit robot control endpoints, with CSRF still required for mutations.
- Desktop overlay launch now prefers the fast unpacked executable, confirms process creation, survives the Codex Electron-as-Node environment, and uses a process-only token restricted to overlay status plus the explicit global/per-profile Pause, Resume, and Stop endpoints.
- The Windows Studio Launcher supports a `--startup` mode: a fullscreen `Welcome back, sir.` screen is displayed while Studio starts. It uses the RX PROPULSE motion language (slow nebula/starfield drift, logo pulse, and light sweep) and honors Windows reduced-motion preferences. Its centered `Enter Workspace` button activates once Studio is ready and opens the local dashboard. `npm.cmd run launcher:install` creates the Desktop shortcut and the `RX AI Studio Welcome` user-logon Scheduled Task with no configured delay. Windows does not guarantee an absolute ordering against every third-party startup app, but the task starts as soon as the user logon trigger is available.
- `Enter Workspace` is scoped to fullscreen startup Welcome mode and remains hidden in the launcher's normal service-control window.
- The normal Windows Studio Launcher first checks the `continuous-main` prerelease manifest. It compares the installed source commit rather than only the semantic version, validates the manifest, GitHub asset digest, size, and SHA-256, then applies the precompiled/dependency-complete ZIP through a detached PowerShell helper. The helper protects `.env`, operational JSON, uploads, browser profiles, logs, SQLite data, and bundled runtime; it keeps rollback backups, restores overwritten files/state on failure, and restarts the launcher. Stable semantic-version installers remain the fallback for bootstrap or runtime upgrades.
- When the launcher runs from a development Git checkout, it reads the local repository HEAD as its current commit. If that checkout is outdated it points the operator to Git and does not expose automatic installation, because the development Electron executable lives outside the Studio root; installed copies retain the normal one-click updater.

- Electron overlay connected to the local API.
- Custom R.X. AI icon in the executable, window, and Windows taskbar.
- Portable Windows build workflow and rebuild scripts committed in `overlay-desktop/`.
- Current queue context with TEST/LIVE mode, active run ID, and upcoming tasks.
- Electron 43.1.0 and electron-builder 26.15.3 with a clean npm audit.
- Adaptive polling and optional API-key support for the backend connection.
- Digital-signing workflow is prepared, but no certificate is currently available.

## Reproducible clone baseline

- `npm.cmd run installer:offline` builds a movable, self-contained Windows Setup and ZIP under `installer/dist/`. It includes the private Node runtime, lockfile-installed dependencies for every application, both Playwright Chromium versions, compiled web/Electron outputs, and a Microsoft-signed VC++ runtime. The install itself does not need Visual Studio, global Node.js, npm downloads, or Playwright downloads. Generated staging, packages, binaries, operational state, secrets, and browser profiles remain Git-ignored.
- `.github/workflows/release-offline.yml` runs the same build on Windows for version tags (`v*`) and publishes the Setup, its `.sha256`, and the ZIP as GitHub Release assets. The root `package.json` version, release tag, and generated filename must agree (for example version `1.1.0` and tag `v1.1.0`). A manual workflow run produces a downloadable Actions artifact but does not create a release.
- `.github/workflows/continuous-update.yml` runs on every push to `main`, verifies the apply/rollback helper, rebuilds all runtime dependencies and production outputs from lockfiles, and atomically advances the `continuous-main` manifest after its commit-specific ZIP is uploaded. `npm.cmd run update:build` reproduces the bundle locally; `npm.cmd run test:update` exercises successful application, local-data preservation, and rollback.
- `npm.cmd run installer:dist` builds a Windows online installer with Inno Setup. The generated `RX-AI-Studio-Setup-1.1.0.exe` installs under the current user's LocalAppData, provisions a private Node.js 22 runtime, runs the full dependency/Playwright/Prisma/auth setup, and installs the launcher shortcuts. The payload is assembled only from Git-tracked or non-ignored files, so private runtime data is excluded.
- `npm.cmd run setup:new-pc` installs root, dashboard, copywriter, and overlay dependencies from lockfiles; creates missing local env files; initializes Prisma/SQLite; installs Playwright Chromium; configures the Scrypt login; and runs baseline checks.
- Operational groups, runtime configuration, schedules, property/job campaigns, uploads, logs, databases, and browser profiles are excluded from Git. Existing files remain local; new clones start safely with empty data and publishing disabled.
- All four npm dependency audits report zero vulnerabilities after pinning the fixed overlay transitive packages.
- GitHub CLI 2.96.0 is installed and authenticated locally as `MrBlue2005`.
## Important local-only state

GitHub does not restore these items:

- `.env`, `dashboard-v2/.env`, and `property-copywriter/.env`;
- Chrome/Facebook login profiles such as `chrome-profile/`;
- `node_modules/` directories;
- dashboard and overlay build output;
- signing certificates and their passwords;
- uploaded campaign media under `app/uploads/`;
- runtime log/history files under `logs/`.

Use `.env.example` files as templates. Never place credentials or authentication profiles in the repository.

## Current operating assumptions

- Development is currently Windows-first and uses PowerShell.
- API default: `http://127.0.0.1:3000/api`.
- Studio launcher default: `http://127.0.0.1:5173`; dashboard route: `/dashboard`.
- Property copywriter default: `http://127.0.0.1:3100`.
- Real Facebook publishing must remain off during ordinary development and automated tests.
- E2E tests use `.tmp/e2e/` storage and never read or overwrite local operational data or logs.
- The scheduler only evaluates due work while the API is running; keep the API process active for unattended scheduled runs.
- Hosting is intentionally deferred, but backend environment controls are already present.
- Generic VPS readiness is documented in `docs/VPS_READINESS.md`; provider, proxy, process manager, backup strategy, and graphical browser session are intentionally not selected yet.
- The completed code/security audit and remaining risks are recorded in `docs/INTERNAL_AUDIT.md`.

## Recommended next work

1. Task C3 of the future hosted dashboard is complete locally at this checkpoint. Application metadata editing requires both `VITE_CLOUD_APP_MUTATIONS_ENABLED=true` and server-only `RX_BFF_CLOUD_APP_MUTATIONS_ENABLED=true`, separately from the C2 cloud-media flags. The narrow BFF surface supports campaign/posts, targets, folders, and schedule metadata/ordered campaign links using revision-aware writes and the existing compound RPCs. A text-complete cloud campaign can make its first durable save before media exists, allowing the separate READY-only upload attachment flow; local required-media validation remains unchanged. The root `vercel.json` builds `dashboard-v2/dist` and supplies SPA deep-link fallback while filesystem `/api/[...path]` stays the BFF route; no Vercel project was linked or deployed. Reads stay cloud-backed and unsupported writes have no local fallback. Scheduler execution/run-now, queue/robot/runtime, history/reports, Property Copywriter, Protocol V1, Facebook/Chromium, Local Agent, import, deployment, and production cutover remain out of scope. Local mode is unchanged.
2. Phase 3 is CLOSED at `1b96ff3` (`READY_FOR_HOSTED_SUPABASE = YES`). Phase 4 hosted control-plane deployment is validated: all five migrations through `202609080002` and `agent-protocol` are deployed to the dedicated hosted project, and the first isolated synthetic-agent task passed `QUEUED -> CLAIMED -> RUNNING -> COMPLETED` with one lease and three renewals. `HOSTED_CONTROL_PLANE = VALIDATED`; `HOSTED_DRY_RUN_E2E = PASS`. The operational hosted agent stayed ONLINE with zero assigned tasks. Facebook publishing remains disabled and unvalidated.
3. Phase 4B-A is implemented and locally validated only: migration `202609080003_application_data_foundation.sql` adds separate RLS-protected `app_*` metadata tables and a private `fam-app-media` bucket. `ApplicationDataStore` is only a compatibility seam; the dashboard, scheduler, Local Agent, existing API and Protocol V1 remain unchanged. The importer is DRY_RUN by default and contains no configured hosted writer. See `docs/PHASE_4B_APPLICATION_DATA.md`.
4. Phase 4B-B now also has the local-only additive migration `202609080004_application_transactional_rpcs.sql`: service-role-only, SECURITY INVOKER application RPCs atomically write campaign/posts, schedule/campaign links, and ordered post-media relations. They use expected revisions plus durable request ID/hash retries; a synthetic local test proved stale rejection, exact retry behavior, second-stage rollback without a durable partial row, ACL denials and control-plane isolation. No execution/result RPC was added because the schema has no multi-table invariant there. Existing dashboard routes, Local Agent, Protocol V1 and real importer apply mode remain unchanged. Hosted deployment is not authorized yet.
5. Phase 4B-B mutation/import wiring is locally validated: the server-only store consumes the reviewed compound RPCs and revision-guarded ordinary app-table writes; `/api/cloud` has only application-data mutation routes under existing session/CSRF middleware; and the gated importer completed synthetic DRY_RUN/APPLY/APPLY idempotency with STAGED-only media metadata. No Storage upload/finalize/preview, hosted deployment, dashboard/scheduler/Local Agent cutover, Facebook or Chromium action occurred. The only remaining Phase 4B-B task is local synthetic Storage E2E: signed upload → object verification → STAGED -> READY → authorized preview → negative/security tests.
6. Phase 4B-B Storage E2E is now complete locally: a short-lived browser upload authorization was used against the private bucket; the server independently streamed and verified exact byte size and SHA-256 before READY; linked signed preview, mismatch/abandoned rejection, private-bucket/RLS checks, and immutable READY identity all passed. No hosted deployment, dashboard/Local Agent cutover, Facebook or Chromium action occurred.
7. Configure `property-copywriter/.env` and smoke-test one current public Zonere listing.

## Latest local validation

- A validation-only hosted remote-task seam is gated off by default. It requires both `RX_BFF_CLOUD_REMOTE_TASKS_ENABLED=true` on the BFF and `VITE_CLOUD_REMOTE_TASKS_ENABLED=true` in the Preview dashboard, plus server-only `RX_BFF_SYNTHETIC_AGENT_ID` and `RX_BFF_SYNTHETIC_PROFILE_ID`. It creates only a fixed `DRY_RUN` payload with `publishEnabled=false`, rejects an offline synthetic agent without queueing work, and returns only safe task lifecycle/result fields. Browser callers cannot select an agent, profile, task type, payload, media, or publish setting. Scheduler authority, operational execution, Facebook, and Chromium remain unchanged.

- `HOSTED_REMOTE_TASK_ROUNDTRIP = PASS`: one isolated synthetic Preview task completed through the hosted BFF and Local Agent with `DRY_RUN` and `publishEnabled=false`; Facebook, Chromium, and operational identities were untouched. Temporary configured-target fingerprint diagnostics were removed after validation. The authenticated admin availability endpoint remains as a boolean-only preflight check, and safe target-availability failure codes remain available.

- The local agent media negative-matrix continuation used only isolated local Supabase/Storage fixtures. Immutable snapshot-size mismatch was rejected before `RUNNING` and executor invocation; real stale-lease reconciliation and valid-lease wrong-task manifest requests were denied without URL/metadata leakage; and a fresh signed-download/hash/size happy path completed once and removed its temporary materialization.
- That validation exposed a Protocol V1 defect: pre-execution media failure could not transition `CLAIMED` to `FAILED`, leaving a lease held. Additive local migration `202609080005_allow_preexecution_failure.sql` fixes the transition and the reference control-plane now has regression coverage. It is local-only and has not been deployed hosted.
- Deterministic Local Agent runtime coverage now proves bounded retry exhaustion and interrupted-stream cleanup, exactly one stale signed-URL manifest refresh, zero-media bypass, and executor-error cleanup. These cases do not contact hosted Supabase, Facebook, Chromium, or operational media.
- `LOCAL_AGENT_MEDIA_FOUNDATION = PASS`: the complete local matrix and the full repository regression suite now pass. The Local Agent receives only lease-scoped signed manifests, verifies size/SHA-256 into isolated temporary paths before `RUNNING`, preserves immutable task payloads, and exposes only verified local paths to the executor. No hosted media validation, dashboard cutover, Facebook publishing validation, or Local Agent Chromium execution is implied.

## Continuing from another computer

After cloning or pulling the active branch, start a Codex conversation with:

> Read AGENTS.md and docs/HANDOFF.md completely, inspect git status, and continue from the documented next work without discarding local changes.

This transfers the durable project context. The previous chat transcript itself is not required.
