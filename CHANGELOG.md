# Changelog

- Added a persistent windowed-mode sidebar toggle that expands the compact navigation and restores every tab name on narrower workspace windows.

## 2026-08-07

- Added custom group list categories and Queue/Scheduler filtering so Romanian, international, and other user-defined group sets can be managed and run separately, without changing the Facebook profile or campaign type.
- Kept existing group data compatible by treating groups without a list category as `Romania`.
- Updated the Zonere extractor for the current listing layout: it now reads the `Despre Proprietate` description and successive label/value details such as usable area, rooms, bathrooms, land, and construction year.
- Added persistent folders for campaign schedules. Folders can be created empty, existing schedules can be moved between folders or back to `Fara folder`, and deleting a folder preserves its schedules.
- Programările filtrează campaniile după profilul Facebook selectat și resping salvarea unei combinații campanie-profil incompatibile.

## Unreleased

- Added Facebook-profile report navigation and exact server-side run filtering. Reports now expose every configured or historical profile as a selectable card with run, posted, error, and posting-success statistics.
- Added per-profile Excel exports for the last 7, 30, 60, or 90 days and the complete history. Workbooks identify the Facebook profile in their metadata, titles, subtitles, and detail rows, while posting success is consistently calculated as `posted / (posted + errors)` in both UI and Excel summaries.
- Updated the transitive `qs`, `fast-uri`, and `@xmldom/xmldom` dependencies after newly published denial-of-service, URL-validation, and XML-serialization advisories, restoring zero-vulnerability audits across all workspaces.
- Fixed false continuous-update prompts when the launcher is run directly from a Git checkout. Development copies now compare the repository HEAD, hide automatic installation when the Electron executable is outside the Studio installation, and direct genuinely outdated source checkouts to Git instead of downloading an inapplicable package.
- Added commit-based continuous updates for installed Windows copies. Every push to `main` builds a precompiled, dependency-complete update ZIP plus a SHA-256 manifest under the moving `continuous-main` prerelease; the launcher compares the installed commit, downloads and validates the matching asset, preserves local data/secrets/runtime, applies through a detached helper, rolls back failed copies, and restarts itself. Semantic-version offline installers remain the fallback for bootstrap/runtime upgrades, with `1.1.3` as the corrected transition release.
- Standardized Scheduler navigation as a permanent Monday-through-Sunday calendar. Existing weekday folders are recognized as protected system folders, schedules appear by their actual configured weekday, every view sorts by posting time, and custom folders remain available separately.
- Added transaction filters to Properties for all, rental, and sale campaigns, with live counts that combine with the existing search and active/inactive filters.
- Restored zero-vulnerability audits after new advisories by pinning patched `browserslist` and Prisma's transitive `mysql2` releases.
- Prepared the complete portable/offline installer release as version 1.1.1 so existing 1.1.0 installations can detect the Gemini, security, and reliability updates.
- Added automatic Gemini model failover for transient capacity, quota, timeout, and network errors. The generator keeps `gemini-3.7-flash` as primary and falls back to the configurable stable `gemini-3.5-flash`, while permanent API/configuration errors still fail immediately and preserve the existing result.
- Restored zero-vulnerability npm audits across all four workspaces by updating lockfiles and pinning patched `deepmerge-ts`, `fast-uri`, `nanoid`, and `brace-expansion` transitive releases; Prisma remains on 7.9.0 and its schema/client workflows are revalidated against the safe dependency tree.
- Added backend-only Gemini description generation to RX CREATIVE Tool using the official `@google/genai` SDK and configurable `GEMINI_API_KEY`/`GEMINI_MODEL`. The new UI action reuses the validated property JSON and existing editorial/template guidance, writes into the existing result/history workflow, keeps prior results on failure, maps API/configuration/quota/network/timeout errors safely, and removes only the `Detalii esențiale` heading from Gemini output.
- Added a portable, self-contained Windows offline installer and ZIP containing the private Node.js runtime, all four npm dependency trees, both required Playwright Chromium revisions, prebuilt dashboard/copywriter/overlay/launcher applications, and the Microsoft VC++ runtime. A target PC needs neither Visual Studio, a global Node.js installation, nor internet access during setup.
- Connected the Windows Studio Launcher to public GitHub Releases. It compares semantic versions, displays `Update available`, downloads only the matching full offline installer after explicit confirmation, validates the GitHub SHA-256 digest, stops Studio only after validation succeeds, and then starts the installer.
- Added a tag-driven GitHub Actions release workflow that rebuilds the offline Setup/ZIP from lockfiles and publishes the installer, checksum, and portable archive, keeping future launcher updates synchronized with repository releases.
- Job schedules now rotate their configured posts automatically using each campaign's latest successfully prepared or published history and the chronological order of its upcoming schedules. The cursor is shared across weekday folders/schedules containing the same job (for example Tuesday gets day 11 and Thursday day 12), supports mixed 5-post and 20-post campaigns, ignores blocked/error-only attempts, and wraps to the first configured post after the last; real-estate schedules retain their fixed selected day.
- Scheduler cards expose the next post day for every included job campaign, while the job-schedule editor replaces the fixed day input with a clear automatic-rotation notice.
- Added the same day-by-day Facebook preview drawer to job campaigns as property campaigns. It opens from either the Preview button or the non-interactive area of a job card, while selection and action controls retain their own behavior.
- Fixed property-ID renames for campaigns that share another property's media: references are now migrated across every property and job, not only inside the renamed campaign. Existing broken references for `ADUNATII_COPACENI_ENG` were repaired and verified against all 33 media entries.
- Diagnostics now includes the exact preflight errors of blocked schedules and labels each issue with its schedule name, while Live Feed groups repeated per-group failures into unique root causes and still reports the number of affected tasks.
- Property IDs can now be edited from the existing-property form. Renaming validates collisions and migrates the property file, media folder/references, schedules, Queue state, history, and saved run references while campaign mutations remain blocked during active robot runs.
- Added a Windows `Setup.exe` workflow that bundles the application source, downloads a private Node.js 22 runtime, installs all npm/Playwright dependencies, initializes the local database and authentication, and creates the Desktop/startup launcher without packaging private runtime data.
- Made scheduled weekdays explicit on every saved schedule card, with a readable summary and individual full-name day badges.
- Extended the desktop overlay with a scrollable card for every simultaneous active campaign/profile, including independent Pause/Resume and Stop controls, while retaining Pause all, Resume all, Stop all, and Refresh controls. The overlay token is restricted to status plus those explicit robot-control endpoints.
- Fixed the desktop Studio Launcher so `Enter Workspace` is hidden in its normal control window and appears only in the fullscreen startup Welcome mode.
- Kept local campaign-folder and schedule-folder operational data out of Git, matching the repository's existing policy for runtime JSON state.
- Optimized the RX PROPULSE Workspace for Chrome sessions without GPU compositing: replaced continuously animated fullscreen blur/star layers, dashboard sweep, status pulse, and progress shimmer with lightweight static treatments while preserving the animated RX wordmark.
- Removed GPU-heavy glass blur compositing from every operational Workspace panel and stopped the continuously glowing sidebar logo; the separate fullscreen Welcome experience retains its motion.
- Reduced idle Workspace polling: queue/preflight dashboard and status refreshes run every 20 seconds while the robot is idle and retain rapid updates during an active run; desktop notifications use adaptive, non-overlapping checks.
- Removed the final fixed fullscreen blur, starfield, and shell-overlay layers from the operational Workspace, preventing costly recomposition while scrolling in Chrome renderers that disable GPU compositing.
- Updated the Property Copywriter Shortlink-uri Zonere button to the new CRM address: `https://crm.zonere.ro/shortlinks`.
- Added RX PROPULSE-style motion to the fullscreen Windows welcome screen: a slow nebula/starfield background, an animated logo pulse, and a light sweep, with reduced-motion support.
- Centered the `Enter Workspace` action on the fullscreen Windows welcome screen.
- Added a fullscreen `Welcome back, sir.` startup experience to the Windows Studio Launcher. The launcher can now be registered as a zero-delay user-logon Scheduled Task, starts the local Studio in the background, and keeps the welcome screen open until `Enter Workspace` is selected.
- Added per-run ETA details to every active campaign card on the Robot page: ETA for the current campaign and ETA for the full profile run are shown independently for parallel runs.
- Enlarged and fixed Media Library cards and file previews in both the main library and the picker: every picker card now reserves full preview height instead of clipping media into thin strips, and the picker is rendered above the scrolling page.
- Restricted the property-selection label to its checkbox and text, so clicking empty card space no longer changes selection.
- Added a `Deschide grupul` action to each group row, opening its configured Facebook group URL in a separate tab after safe URL validation.
- Property cards now open their preview directly when their non-control area is clicked; existing selection, detail, preview, and action buttons retain their individual behavior.
- Made the property Preview an animated right-side panel rendered above the page, with contained scrolling and a preserved Properties-list position while checking a post.
- Added a direct Preview button to every property in the Properties list. It opens the Facebook-style post preview with day-by-day tabs without entering edit mode, so the current list position is preserved.
- Hardened Zonere bathroom and construction-year extraction against shifted duplicate label/value pairs: bathroom counts must be realistic and construction years must be plausible calendar years.
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
