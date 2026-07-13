# Set up FAM-AUTO on another Windows PC

This procedure replaces an outdated checkout safely without deleting it first.

## 1. Prerequisites

Install:

- Git;
- Node.js LTS or Node.js 24+;
- Google Chrome;
- GitHub CLI (optional, useful for authentication and pull requests).

Check the tools:

```powershell
git --version
node --version
npm --version
```

## 2. Preserve the old checkout

First inspect the old project for work that exists only on that PC:

```powershell
Set-Location C:\path\to\old\FAM-AUTO
git status --short --branch
git diff
```

If there are unique changes, commit/push them to a separate branch or copy the entire folder to a backup location. Do not run `git reset --hard` and do not delete the old folder before this check.

Close the dashboard, API, robot, overlay, VS Code, and terminals using the old checkout. Rename the old folder to something such as `FAM-AUTO-backup-2026-07-12`.

## 3. Clone the current project

```powershell
Set-Location C:\path\to\parent
git clone https://github.com/MrBlue2005/FAM-AUTO.git
Set-Location FAM-AUTO
git switch agent/release-1.1.0
git status --short --branch
```

Expected branch: `agent/release-1.1.0`.

## 4. Install dependencies

```powershell
npm ci
npm --prefix dashboard-v2 ci
npm --prefix overlay-desktop ci
npx playwright install
```

## 5. Create local configuration

```powershell
Copy-Item .env.example .env
Copy-Item dashboard-v2\.env.example dashboard-v2\.env
```

The defaults are suitable for local development. If authentication is enabled later, place secrets only in the local `.env` files.

## 6. Restore Facebook login safely

The Facebook/Chrome profile is intentionally absent from GitHub. Choose one option:

- run the profile setup flow and log in manually on the new PC; or
- transfer the profile privately from the old PC while Chrome and the robot are fully closed.

Never upload the profile to GitHub, cloud storage shared publicly, or a pull request.

## 7. Verify and start

```powershell
npm test
npm --prefix dashboard-v2 run build
```

Start the API:

```powershell
npm run server
```

Start the dashboard in another terminal:

```powershell
npm --prefix dashboard-v2 run dev
```

Open `http://localhost:5173` and keep real publishing disabled for the first verification.

## 8. Rebuild the overlay

```powershell
npm run overlay:dist
```

Expected output:

```text
overlay-desktop\dist\RX-AI-Overlay-0.1.0.exe
```

The build has the custom R.X. AI icon. Without a code-signing certificate, Windows may still display an unknown-publisher warning.

## 9. Resume with Codex

Open the freshly cloned repository in Codex and use this prompt:

> Read AGENTS.md and docs/HANDOFF.md completely, inspect git status, and continue from the documented next work without discarding local changes.

After the clean checkout works and all needed local-only data has been restored, the backup folder can be archived or removed manually.

