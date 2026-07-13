# FAM-AUTO

FAM-AUTO este un sistem local-first pentru pregatirea, programarea si executarea campaniilor Facebook.

Componente:

- API Express si stocare JSON in `server/` si `app/`;
- robot Playwright in `app/facebook/`;
- dashboard React/Vite in `dashboard-v2/`;
- overlay desktop Electron in `overlay-desktop/`.

## Cerinte

- Node.js 22.12 sau mai nou;
- Google Chrome sau runtime Playwright compatibil;
- Git;
- Windows pentru overlayul desktop. Backendul si dashboardul pot rula si pe Linux.

## Instalare locala

```powershell
npm ci
npm --prefix dashboard-v2 ci
npm --prefix overlay-desktop ci
npx playwright install
Copy-Item .env.example .env
Copy-Item dashboard-v2\.env.example dashboard-v2\.env
```

Porneste API-ul:

```powershell
npm run server
```

Porneste dashboardul de dezvoltare intr-un terminal separat:

```powershell
npm --prefix dashboard-v2 run dev
```

Valori locale implicite:

- dashboard: `http://localhost:5173`;
- API: `http://127.0.0.1:3000/api`;
- health: `http://127.0.0.1:3000/healthz`;
- readiness: `http://127.0.0.1:3000/readyz`.

## Verificare

```powershell
npm test
npm --prefix dashboard-v2 run lint
npm --prefix dashboard-v2 run build
npm run test:e2e
npm run overlay:dist
```

`npm run check` ruleaza verificarile de cod si dashboard intr-o singura comanda. E2E foloseste exclusiv `.tmp/e2e` pentru date, loguri, uploaduri si profiluri.

## Siguranta

- Pastreaza `publishEnabled: false` si `groupLimit: 1` pentru teste.
- Pornirea LIVE necesita confirmare explicita din dashboard/API.
- API-ul blocheaza modificarea campaniilor, configuratiei si media cat timp robotul ruleaza.
- Nu urca in Git `.env`, parole, chei, profile Chrome, builduri sau certificate.
- Profilurile Facebook contin sesiuni sensibile si trebuie transferate separat, securizat.

## Productie si VPS

Express poate servi dashboardul construit si API-ul pe acelasi origin. Datele persistente pot fi mutate in volume separate prin:

- `RX_DATA_PATH`;
- `RX_LOGS_PATH`;
- `RX_UPLOADS_PATH`;
- `RX_PROFILES_PATH`.

Pornirea cu `NODE_ENV=production` necesita autentificare configurata. Foloseste `.env.production.example`, construieste dashboardul si ruleaza:

```bash
npm run check:production
npm start
```

Checklistul complet si deciziile ramase sunt in `docs/VPS_READINESS.md`.

## Documentatie

- `AGENTS.md` - reguli de lucru si siguranta;
- `docs/HANDOFF.md` - starea curenta si urmatorii pasi;
- `docs/SETUP_NEW_PC.md` - instalare pe un calculator nou;
- `docs/VPS_READINESS.md` - contract generic de productie.
