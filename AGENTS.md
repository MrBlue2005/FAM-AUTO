# FAM-AUTO - project instructions for Codex

Read this file first in every new Codex session, then read `docs/HANDOFF.md`.

## Project purpose

FAM-AUTO / RX AI Studio is a local-first system composed of:

- Express API and local data store in `server/` and `app/`;
- Playwright Facebook robot in `app/facebook/`;
- React/Vite launcher and dashboard in `dashboard-v2/`;
- Next.js description generator in `property-copywriter/`;
- Electron desktop overlay in `overlay-desktop/`.

## Source of truth

- Repository: `https://github.com/MrBlue2005/FAM-AUTO`
- Active branch: `integration/launcher-copywriter-20260727`
- `main` remains the stable baseline until the draft pull request is approved.
- Inspect `git status --short --branch` before pulling or editing.
- Never discard local changes or use destructive Git commands without explicit approval and a backup.

## Install and run

From the repository root on Windows:

```powershell
npm.cmd run setup:new-pc
npm.cmd run studio
```

Local defaults:

- launcher/dashboard: `http://127.0.0.1:5173`;
- API: `http://127.0.0.1:3000/api`;
- property copywriter: `http://127.0.0.1:3100`.

Always use `127.0.0.1` consistently so the shared login session works across applications. See `README.md` and `docs/SETUP_NEW_PC.md` for separate service commands and troubleshooting.

## Verification

Run checks appropriate to the changed area:

```powershell
npm.cmd test
npm.cmd --prefix dashboard-v2 run lint
npm.cmd --prefix dashboard-v2 run build
npm.cmd --prefix property-copywriter test
npm.cmd --prefix property-copywriter run lint
npm.cmd --prefix property-copywriter run typecheck
npm.cmd --prefix property-copywriter run build
npm.cmd run test:e2e
npm.cmd run overlay:dist
```

Generated overlay files under `overlay-desktop/dist/` are intentionally not committed.

## Safety rules

- Default to test mode with `publishEnabled: false` and `groupLimit: 1`.
- Do not enable real Facebook publishing without explicit user confirmation.
- Do not edit campaign data while the robot is running.
- Never commit `.env`, API keys, password hashes, signing certificates, Chrome/Facebook profiles, operational JSON, databases, uploads, logs, `node_modules`, or generated `dist` folders.
- Move local operational state through a private dashboard backup, never through Git.
- There is no code-signing certificate; unsigned overlay builds may show a Windows warning.
- Preserve compatibility between dashboard API calls and endpoints in `server/server.js`.

## Durable handoff rule

After a meaningful implementation:

1. update `docs/HANDOFF.md` and `CHANGELOG.md`;
2. commit source, lockfiles, required assets, and documentation together;
3. keep operational data and secrets local;
4. never rely on chat history as the only record of a decision.