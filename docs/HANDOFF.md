# FAM-AUTO handoff

Last updated: 2026-08-07

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

- A shared login page now protects the studio launcher, dashboard/robot, description generator, and their API routes before access is granted.
- Authentication uses versioned Scrypt hashes, a 12-hour HttpOnly/SameSite session cookie, login throttling, CSRF checks, no client-side token storage, and fail-closed generator checks.
- `npm run auth:setup` enables local authentication and writes only the password hash to the Git-ignored `.env`.
- Integrated studio launcher at `/` with separate entries for the dashboard/robot and description generator.
- Dashboard routes remain under `/dashboard` and the sidebar scrolls independently on short screens.
- `npm run studio` starts the API, dashboard/launcher, and property-copywriter together.
- Operational dashboard navigation and CTA buttons.
- Dashboard summary and live API status.
- Property and job creation with media drag-and-drop.
- Upload progress, cancel, preview, cover selection, and validation feedback.
- Reusable media library, SHA-256 deduplication, and safe unused-media cleanup.
- Media Library cards render the actual uploaded image/video preview, with a compact type badge and fallback when the underlying file is unavailable.
- Automatic form drafts and protection against losing unsaved changes.
- Unified campaign queue with exclusion, retry, and reordering.
- The live worker rebuilds Queue state before every task, so campaign deactivation/deletion, selection changes, exclusions, and new history entries take effect without restarting the robot.
- A property/group pair is treated as processed only after a `prepared` or `posted` entry from the current server-local calendar day, regardless of campaign content day or Facebook profile. Older history remains available for reports and no longer requires manual deletion; property progress spans all pending groups instead of resetting for every task.
- Campaign preview, validations, and mandatory preflight checks.
- Live Feed, reports, CSV exports, backup/restore, and audit log.
- Filtered Excel campaign reports with formula-driven summary, campaign, group, and detailed result sheets.
- Persistent campaign runs with unique IDs, configuration snapshots, lifecycle status, and per-run totals.
- Persistent weekly campaign scheduling by weekday and local time, with campaign/profile selection, post day, group range, late tolerance, pause/resume, and manual run controls.
- Deleting a property or job now removes its reference from mixed schedules and deletes schedules left without campaigns.
- Scheduled runs default to TEST mode; LIVE schedules require an explicit publishing confirmation and overlapping robot runs are skipped.
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
- Local JSON-backed weekly schedules, evaluated while the API process is running using the server's local timezone.
- Configurable persistent paths for data, logs, uploads, and browser profiles, plus atomic JSON writes.
- Same-origin production dashboard serving, `/healthz`, `/readyz`, production environment validation, and controlled process shutdown.
- Playwright Facebook workflow with profile setup, queue planning, posting verification, pause/resume, and stop controls.
- Manual and scheduled runs use the same worker. Facebook groups that display a paused/suspended/unavailable screen are recorded as `skipped`; if Facebook uses an unknown message but the group page has no composer, the worker records `composer_unavailable`. Login/checkpoint pages remain errors instead of being silently skipped.
- Local-first defaults: API bound to `127.0.0.1`, restricted CORS, publishing disabled unless configured.

### Property description generator

- Standalone Next.js application in `property-copywriter/`, served locally on port 3100.
- Its header uses the shared RX emblem in the generator green palette; the launcher displays red and green application-specific RX logos on the corresponding cards, with accessible labeling and reduced-motion support.
- Secure Zonere listing extraction, including catalog and shortlink support.
- Editable structured property data and formatted social-media descriptions.
- OpenAI/demo generation plus a manual ChatGPT copy/paste workflow.
- Reusable description models are managed from `/templates`. The selected model is sent in full to GPT together with explicit matching rules; inapplicable criteria are omitted, relevant data absent from the model may be added in the same style, and validated property data always takes precedence. History stores a snapshot, so editing or deleting a model does not alter previous generations.
- Local Prisma/SQLite history and dedicated unit tests.
- Integrated verification passes: dashboard lint and production build, 12 backend tests, and the complete 16-test studio E2E suite, including login, Facebook-profile persistence, Reports contrast, and real Media Library image-preview coverage.
- Full npm audit is clean. The vulnerable `eslint-config-next` bundle was replaced with explicit ESLint 10, TypeScript, React Hooks, and Next.js plugin configuration, preserving lint coverage without vulnerable legacy minimatch dependencies.

### Desktop overlay

- Desktop overlay launch now prefers the fast unpacked executable, confirms process creation, survives the Codex Electron-as-Node environment, and uses a process-only token restricted to `GET /api/overlay/status`.

- Electron overlay connected to the local API.
- Custom R.X. AI icon in the executable, window, and Windows taskbar.
- Portable Windows build workflow and rebuild scripts committed in `overlay-desktop/`.
- Current queue context with TEST/LIVE mode, active run ID, and upcoming tasks.
- Electron 43.1.0 and electron-builder 26.15.3 with a clean npm audit.
- Adaptive polling and optional API-key support for the backend connection.
- Digital-signing workflow is prepared, but no certificate is currently available.

## Reproducible clone baseline

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
