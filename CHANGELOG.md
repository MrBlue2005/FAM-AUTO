# Changelog

## Unreleased

- Added a one-command Windows bootstrap for all applications, Prisma schema creation, Playwright browsers, Scrypt authentication, and baseline verification; removed operational JSON from Git tracking while preserving local data.

- Made the desktop overlay launch reliably and quickly by preferring the unpacked executable, stripping the inherited Electron-as-Node flag, confirming process spawn, adding dashboard feedback/fallback, and granting a scoped in-memory read token for authenticated status polling.
- Branded the Facebook posting application and robot as `RX PROPULSE TOOL` with the motto `Stay active. Stay visible.` across the launcher, dashboard, control center, sidebar, and live overlay.
- Added a login page before the studio launcher, protected both applications with shared HttpOnly sessions and CSRF checks, moved password storage to versioned Scrypt hashes, and added a safe local auth setup command.
- Replaced the vulnerable generator ESLint bundle with an explicit ESLint 10 toolchain, resolving all npm audit findings while retaining Next.js, TypeScript, and React Hooks rules.
- Integrated a studio launcher that opens either the existing dashboard/robot or the property description generator.
- Made the dashboard sidebar independently scrollable on short screens while preserving the current robot workflow.
- Added the standalone `property-copywriter` application with secure Zonere extraction, structured social copy, local history, and OpenAI/demo generation.
- Added catalog and shortlink handling, a dark creative theme, and a manual ChatGPT generation workflow.
- Kept campaign schedules consistent when a property or job is deleted by removing the campaign from mixed schedules and deleting schedules that become empty.
- Refreshed both GitHub branches from one clean VPS-ready snapshot after the Queue fixes, retaining the complete overlay source and documentation while excluding generated executables.
- Fixed property progress to span all pending groups and made property/group history deduplication independent of the campaign content-day variant.
- Fixed live Queue revalidation so deactivated, deleted, deselected, excluded, or newly processed tasks are skipped before posting, including history created through another Facebook profile.
- Added daily group deduplication for schedules, filtering groups already posted to on the server's local day and rechecking immediately before each task.
- Reinitialized the GitHub branches from a clean VPS-ready source snapshot, removing operational uploads and logs from repository history while preserving them as local persistent data.
- Added generic VPS readiness with configurable persistent data, log, upload, and browser-profile volumes, same-origin dashboard serving, health/readiness probes, production validation, and controlled shutdown.
- Hardened production access with required authentication, Scrypt password support, login throttling, HttpOnly sessions, protected media, stricter operator permissions, security headers, and fail-closed dashboard authentication.
- Made JSON writes atomic, validated backup campaign IDs before restore, blocked campaign mutations while the robot runs, and kept external-upload references portable.
- Isolated E2E API, dashboard, data, logs, uploads, and profiles on dedicated ports and paths; added production-auth, readiness, and external-upload coverage.
- Upgraded Electron to 43.1.0 and electron-builder to 26.15.3, removed the dependency audit findings, sandboxed the renderer, and restricted external navigation.
- Added persistent weekly campaign scheduling with weekday/time selection, campaign and profile targeting, post day, group limits, late tolerance, pause/resume, and manual run controls.
- Added scheduler safety rules for explicit LIVE confirmation, late runs, and overlapping robot executions, plus backup/restore coverage for schedules.
- Fixed scheduler form contrast and added a dedicated Facebook-profile fetch for its profile selector.
- Added repository-level Codex instructions and a durable cross-PC project handoff.
- Added a safe Windows setup and overlay rebuild guide for a clean checkout.
- Added filtered Excel campaign reports with summary, campaign, group, and detailed result sheets.
- Added persistent campaign run IDs, per-run results, lifecycle status, and backup coverage.
- Added a Reports page with filtering, details, per-run Excel export, controlled retry, and archiving.
- Fixed dashboard app import casing for consistent Windows and Linux behavior.
- Added isolated E2E smoke coverage for test-mode campaign data, preflight, queue, and dashboard rendering without touching local operational data.
- Added a Windows-safe E2E runner that manages the API and Vite lifecycle reliably on Node 24.
- Updated the desktop overlay with TEST/LIVE mode, active run ID, upcoming queue tasks, adaptive polling, and optional API-key support.

## 1.1.0 - 2026-07-12

- Dashboard operational, CTA-uri funcționale și status API live.
- Preflight obligatoriu, Queue unificat și verificarea publicării.
- Upload media drag-and-drop, progres, anulare, preview și copertă.
- Media Library reutilizabilă, deduplicare SHA-256 și curățare sigură.
- Draft automat, protecție la modificări nesalvate și validări vizuale.
- Backup/restaurare, exporturi CSV și jurnal de audit.
- Autentificare opțională cu roluri și configurare backend pentru hosting.
- Notificări desktop și iconiță proprie pentru overlay.
