# Internal audit - 2026-07-13

## Scope

- backend Express, robot manager, scheduler and JSON persistence;
- dashboard build, runtime API URLs, authentication gate and media previews;
- E2E isolation and production smoke coverage;
- root, dashboard and overlay dependency audits;
- Electron packaging and renderer security;
- repository integrity and tracked-file size;
- generic production/VPS startup contract.

## Resolved findings

- Removed the Queue hardcoded `localhost:3000` media origin and made production API calls same-origin.
- Added configurable persistent paths for data, logs, uploads and browser profiles.
- Kept media references portable when uploads live outside the repository.
- Added atomic JSON writes and upfront backup campaign-ID validation.
- Blocked campaign/config/media mutations while the robot process is active.
- Added production environment validation, static dashboard serving, health/readiness probes and controlled shutdown.
- Required authentication in production and added Scrypt passwords, login throttling, stricter roles and session cleanup.
- Changed dashboard authentication from fail-open to fail-closed.
- Added HttpOnly, Secure, SameSite sessions and protected `/uploads` when authentication is enabled.
- Added explicit API and media 404 responses so missing resources do not fall through to the SPA.
- Isolated E2E ports and all four persistent paths from local operational data.
- Upgraded Electron from 34 to 43 and electron-builder from 25 to 26; all npm audits now report zero findings.
- Enabled Electron renderer sandboxing and restricted navigation/external URL IPC to HTTP(S).
- Replaced the outdated, encoding-damaged README.

## Verification completed

- `npm run check`: 7 Node tests, dashboard lint/build and 8 E2E tests passed.
- Production smoke test: auth required, Scrypt login succeeds, protected API/media reject anonymous access.
- Production preflight: environment, dashboard build and persistent volume checks passed with isolated fixture paths.
- Root, dashboard and overlay `npm audit`: zero known vulnerabilities after the overlay upgrade.
- Electron 43 unpacked package built successfully; portable executable was generated and remains unsigned.
- `git fsck --full --no-reflogs`: no broken reachable objects; only dangling/temporary garbage was reported.

## Open deployment decisions and residual risks

- JSON persistence is intended for one backend process. Do not run multiple API replicas against the same files.
- Auth sessions are in memory; a backend restart logs users out. This is acceptable for one instance but not horizontal scaling.
- HTTPS is not implemented in Node and must terminate at the chosen reverse proxy.
- Automated off-machine backup and retention are not selected yet.
- The Facebook browser needs an interactive graphical session for login, challenges and headed execution.
- The repository still tracks about 242 MB of operational media in 140 files. Removing it from Git history requires a coordinated history rewrite.
- Git has about 30 MB of unreachable/temporary objects. No `git gc` was run because cleanup is destructive and not required for correctness.
- The Windows overlay has no trusted code-signing certificate.
- Real Facebook behavior can change independently of this code; a TEST campaign must be exercised on the target host before LIVE is enabled.
