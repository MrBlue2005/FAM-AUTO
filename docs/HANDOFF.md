# FAM-AUTO handoff

Last updated: 2026-07-13

## Repository state

- Remote: `https://github.com/MrBlue2005/FAM-AUTO`
- Working branch: `agent/release-1.1.0`
- Documented implementation: clean VPS-ready snapshot shared by `main` and `agent/release-1.1.0`
- The complete overlay source and documentation remain tracked; generated executables under `overlay-desktop/dist/` remain local-only.
- Previous draft pull request: `https://github.com/MrBlue2005/FAM-AUTO/pull/1` (superseded by the clean snapshot)
- Repository history was intentionally reinitialized on 2026-07-13 after verified local Git bundles and operational-data backups were created.

Always verify these values with `git status` and `git log`; this document describes the latest known handoff, not a replacement for Git.

## What is implemented

### Dashboard and workflow

- Operational dashboard navigation and CTA buttons.
- Dashboard summary and live API status.
- Property and job creation with media drag-and-drop.
- Upload progress, cancel, preview, cover selection, and validation feedback.
- Reusable media library, SHA-256 deduplication, and safe unused-media cleanup.
- Automatic form drafts and protection against losing unsaved changes.
- Unified campaign queue with exclusion, retry, and reordering.
- The live worker rebuilds Queue state before every task, so campaign deactivation/deletion, selection changes, exclusions, and new history entries take effect without restarting the robot.
- A property/group pair is treated as processed after any `prepared` or `posted` entry regardless of campaign content day or Facebook profile; property progress spans all pending groups instead of resetting for every task.
- Campaign preview, validations, and mandatory preflight checks.
- Live Feed, reports, CSV exports, backup/restore, and audit log.
- Filtered Excel campaign reports with formula-driven summary, campaign, group, and detailed result sheets.
- Persistent campaign runs with unique IDs, configuration snapshots, lifecycle status, and per-run totals.
- Persistent weekly campaign scheduling by weekday and local time, with campaign/profile selection, post day, group range, late tolerance, pause/resume, and manual run controls.
- Scheduled runs default to TEST mode; LIVE schedules require an explicit publishing confirmation and overlapping robot runs are skipped.
- Schedules exclude groups with a successful `posted` history entry from the same server-local calendar day by default and recheck before every task.
- The scheduler profile selector loads configured Facebook profiles from `GET /api/facebook-profiles` and filters them by campaign category.
- Reports dashboard page with filters, detailed events, per-run Excel export, controlled retry, and archiving.
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
- Local-first defaults: API bound to `127.0.0.1`, restricted CORS, publishing disabled unless configured.

### Desktop overlay

- Electron overlay connected to the local API.
- Custom R.X. AI icon in the executable, window, and Windows taskbar.
- Portable Windows build workflow and rebuild scripts committed in `overlay-desktop/`.
- Current queue context with TEST/LIVE mode, active run ID, and upcoming tasks.
- Electron 43.1.0 and electron-builder 26.15.3 with a clean npm audit.
- Adaptive polling and optional API-key support for the backend connection.
- Digital-signing workflow is prepared, but no certificate is currently available.

## Important local-only state

GitHub does not restore these items:

- `.env` and `dashboard-v2/.env`;
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
- Dashboard default: `http://localhost:5173`.
- Real Facebook publishing must remain off during ordinary development and automated tests.
- E2E tests use `.tmp/e2e/` storage and never read or overwrite local operational data or logs.
- The scheduler only evaluates due work while the API is running; keep the API process active for unattended scheduled runs.
- Hosting is intentionally deferred, but backend environment controls are already present.
- Generic VPS readiness is documented in `docs/VPS_READINESS.md`; provider, proxy, process manager, backup strategy, and graphical browser session are intentionally not selected yet.
- The completed code/security audit and remaining risks are recorded in `docs/INTERNAL_AUDIT.md`.

## Recommended next work

1. Decide the VPS provider, Linux distribution, resources, reverse proxy, process manager, and graphical browser approach.
2. Transfer operational media and other persistent data separately after the VPS storage paths are selected.
3. Exercise scheduling with representative TEST campaigns over several weekdays and review missed/skipped run behavior in normal operation.
4. Add or extend E2E coverage for property/job creation, media reuse, queue changes, saved runs, Excel export, and backup/restore.
5. Obtain a trusted Windows code-signing certificate before publishing the overlay as a production release.
6. After the VPS deployment is verified, define the normal feature-branch and pull-request flow from the clean baseline.

## Continuing from another computer

After cloning or pulling the active branch, start a Codex conversation with:

> Read AGENTS.md and docs/HANDOFF.md completely, inspect git status, and continue from the documented next work without discarding local changes.

This transfers the durable project context. The previous chat transcript itself is not required.
