# Changelog

## Unreleased

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
