# Changelog

## 2026-08-07

- Added custom group list categories and Queue/Scheduler filtering so Romanian, international, and other user-defined group sets can be managed and run separately, without changing the Facebook profile or campaign type.
- Kept existing group data compatible by treating groups without a list category as `Romania`.
- Updated the Zonere extractor for the current listing layout: it now reads the `Despre Proprietate` description and successive label/value details such as usable area, rooms, bathrooms, land, and construction year.
- Added persistent folders for campaign schedules. Folders can be created empty, existing schedules can be moved between folders or back to `Fara folder`, and deleting a folder preserves its schedules.
- Programările filtrează campaniile după profilul Facebook selectat și resping salvarea unei combinații campanie-profil incompatibile.

## Unreleased

- Prevented Zonere room-count extraction from treating area values such as `18 m²` as rooms; studio/garsonieră listings are normalized to one room.
- Updated the Zonere extractor to treat `Toate Caracteristicile` as the authoritative property-detail section, including the current card and successive-label/value layouts.
- Fixed LIVE schedules preparing instead of publishing: the Facebook publish action now uses the schedule worker's isolated LIVE configuration, rather than the shared runtime TEST default used for parallel-run safety.
- Enlarged Media Library picker cards and preview area so images can be identified before selecting them for a campaign.
- Restored property and total ETA propagation from each profile worker to the Robot dashboard after parallel campaign support was added.
- Added persistent folders for campaigns. Campaigns can be assigned from their action menu, filtered by folder, and safely detached when a folder is deleted; folders are included in private backups.
- Added per-profile controls to every active campaign run: Pause/Resume affects only that worker, while Stop terminates only its selected Facebook-profile worker.
- Allowed two or more campaigns to run concurrently when each uses a different Facebook profile. Each worker now receives an independent immutable execution configuration; attempting to start a second run for the same persistent browser profile is blocked.
- Updated Scheduler and Robot controls to show active profile runs, permit a different-profile schedule to start, and apply pause/resume/stop-after-current-group as explicit shared safety controls for all active workers.
- Protected concurrent history writes and group discovery updates with per-file locks so parallel workers do not overwrite each other's results.
- Synchronized all three property description textareas continuously while any one is resized, preventing the neighboring post cards from shifting until pointer release.
- Connected RX CREATIVE Tool to the property editor through an authenticated, short-lived transfer: the three generated variants populate days 1-3, preserve existing media draft fields, and open RX PROPULSE directly on the property form without exposing descriptions in the URL.
- Added automatic smooth scrolling to the edit form for properties and jobs, plus an explicit group edit action that centers and focuses the selected group's editable fields.
- Fixed the property editor leaking the last edited property into the new-property form by separating edit state from creation drafts and cleaning up legacy stale drafts.
- Added a Diagnostic dashboard tab that interprets preflight and validation codes in plain language, identifies empty-queue root causes such as active Facebook profile mismatches, recommends corrective actions, preserves the original technical message, and links directly to the relevant configuration page.
- Added a portable Windows RX AI Studio Launcher with automatic service checks, fully hidden background startup, browser opening, Desktop shortcut installation, and a guarded stop action restricted to the Studio process tree and ports.
- Added a Reports dashboard panel that groups posting errors and availability skips by Facebook group, standardizes the visible reason as `Grup pus pe pauză` or `Grup indisponibil`, and keeps technical details available on demand.
- Added explicit and fallback detection for paused, suspended, unavailable, or read-only Facebook groups so manual and scheduled runs record them as skipped and continue instead of timing out on a missing composer button, while login/checkpoint failures remain errors.
- Fixed campaign/group history deduplication so only prepared or posted entries from the current server-local calendar day block a task; older history remains available for reports without requiring manual deletion.
- Added real image and video thumbnails to Media Library cards, with lazy loading, cropped previews, type badges, and a safe fallback for missing files.
- Fixed new Facebook profile setup by persisting the profile configuration before launching Chromium, surfacing launch/finalization errors, and preventing duplicate setup actions while a request is active.
- Improved Reports readability on the dark dashboard with explicit white controls/headings and high-contrast secondary text.
- Added reusable description templates with local CRUD, defaults, immutable history snapshots, and full-model GPT guidance for layout, section order, spacing, emojis, tone, omissions, and safe completion of missing criteria.
- Added color-coded RX application logos: red for RX PROPULSE TOOL and green for Property Copywriter, including matching logos on both launcher cards and reduced-motion support.

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
