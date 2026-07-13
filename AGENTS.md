# FAM-AUTO - project instructions for Codex

Read this file first in every new Codex session, then read `docs/HANDOFF.md`.

## Project purpose

FAM-AUTO is a local-first Facebook posting automation system composed of:

- an Express API and local data store in `server/` and `app/`;
- a Playwright-based automation robot in `app/facebook/`;
- a React/Vite dashboard in `dashboard-v2/`;
- a standalone Electron desktop overlay in `overlay-desktop/`.

## Source of truth

- GitHub repository: `https://github.com/MrBlue2005/FAM-AUTO`
- Active development branch: `agent/release-1.1.0`
- `main` remains the stable baseline until the draft pull request is approved.
- Never overwrite local changes blindly. Before pulling, inspect `git status --short --branch`.
- Do not use destructive Git commands unless the user explicitly approves them and a backup exists.

## Start every task

1. Read `docs/HANDOFF.md` and `CHANGELOG.md`.
2. Run `git status --short --branch` and confirm the current branch.
3. Inspect the relevant implementation before editing it.
4. Preserve unrelated user changes and local operational data.

## Install and run

From the repository root:

```powershell
npm ci
npm --prefix dashboard-v2 ci
npm --prefix overlay-desktop ci
Copy-Item .env.example .env
Copy-Item dashboard-v2\.env.example dashboard-v2\.env
npm run server
```

In another terminal:

```powershell
npm --prefix dashboard-v2 run dev
```

Local defaults:

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3000/api`

## Verification

Run checks appropriate to the modified area:

```powershell
npm test
npm --prefix dashboard-v2 run lint
npm --prefix dashboard-v2 run build
npm run test:e2e
```

For overlay changes:

```powershell
npm run overlay:dist
```

The generated executable is placed under `overlay-desktop/dist/` and is intentionally not committed.

## Safety rules

- Default to test mode with `publishEnabled: false` and `groupLimit: 1`.
- Do not enable real Facebook publishing without explicit user confirmation.
- Do not edit campaign data while the robot is running.
- Never commit `.env`, API keys, password hashes, signing certificates, Chrome/Facebook profiles, `node_modules`, or generated `dist` folders.
- The local Chrome profile contains the Facebook login and must be recreated or transferred separately and securely.
- There is currently no code-signing certificate. Unsigned overlay builds may show a Windows warning.
- Preserve compatibility between dashboard API calls and endpoints in `server/server.js`.

## Durable handoff rule

After a meaningful implementation:

1. update `docs/HANDOFF.md` with the outcome and next steps;
2. update `CHANGELOG.md` for user-visible changes;
3. commit source, lockfiles, required assets, and documentation together;
4. never rely on chat history as the only record of a decision.

