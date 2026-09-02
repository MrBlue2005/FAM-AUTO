# FAM-AUTO handoff

Last updated: 2026-09-02

## Repository state

- Remote: `https://github.com/MrBlue2005/FAM-AUTO`
- Working branch: `main`
- Documented implementation: clean VPS-ready snapshot shared by `main` and `agent/release-1.1.0`
- The complete overlay source and documentation remain tracked; generated executables under `overlay-desktop/dist/` remain local-only.
- Previous draft pull request: `https://github.com/MrBlue2005/FAM-AUTO/pull/1` (superseded by the clean snapshot)
- Repository history was intentionally reinitialized on 2026-07-13 after verified local Git bundles and operational-data backups were created.

Always verify these values with `git status` and `git log`; this document describes the latest known handoff, not a replacement for Git.

## What is implemented

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
- Filtered Excel campaign reports with formula-driven summary, campaign, group, and detailed result sheets.
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
- Reports dashboard page with filters, detailed events, per-run Excel export, controlled retry, and archiving.
- Reports use explicit white/high-contrast text and controls throughout the dark interface.
- Adding a Facebook profile now persists its runtime configuration before Chromium setup starts; setup/finalization failures are shown in the dashboard and duplicate setup clicks are blocked while a request is active.
- Groups support a separate, custom list category (for example `Romania`, `Internationale`, or `Diaspora`) in addition to the Imobiliare/Joburi campaign category. Queue Manager and each scheduled run save/select one list category so Romanian and international groups are not mixed; this selection never changes the Facebook profile or campaign type. Existing groups without this field are treated as `Romania`, which is also the safe default.
- Optional API key and role-based authentication groundwork for future hosting.
- Production authentication with Scrypt passwords, login throttling, HttpOnly sessions, protected media, and fail-closed dashboard access.
- Desktop notifications.
- Isolated end-to-end smoke coverage for one property, one job, one test group, queue rendering, and preflight in test mode.

### Robot and backend

- Express API in `server/server.js`.
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

1. Configure `property-copywriter/.env` and smoke-test one current public Zonere listing.
2. Run the integrated studio E2E suite and verify launcher navigation on this PC.
3. Decide the VPS provider, Linux distribution, resources, reverse proxy, process manager, and graphical browser approach.
4. Transfer operational media and other persistent data separately after the VPS storage paths are selected.
5. Exercise scheduling with representative TEST campaigns over several weekdays and review missed/skipped run behavior in normal operation.
6. Add or extend E2E coverage for property/job creation, media reuse, queue changes, saved runs, Excel export, and backup/restore.
7. Obtain a trusted Windows code-signing certificate before publishing the overlay as a production release.
8. After the VPS deployment is verified, define the normal feature-branch and pull-request flow from the clean baseline.

## Continuing from another computer

After cloning or pulling the active branch, start a Codex conversation with:

> Read AGENTS.md and docs/HANDOFF.md completely, inspect git status, and continue from the documented next work without discarding local changes.

This transfers the durable project context. The previous chat transcript itself is not required.
