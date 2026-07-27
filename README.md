# RX AI Studio

RX AI Studio reuneste doua aplicatii locale:

- **RX PROPULSE TOOL** — robotul Facebook, dashboardul si overlay-ul desktop; motto: **Stay active. Stay visible.**
- **Property Copywriter** — generatorul de descrieri imobiliare, cu modele reutilizabile trimise integral către GPT pentru adaptare.

Launcherul si ambele aplicatii folosesc o singura sesiune de autentificare.

## Instalare pe un PC nou

Cerinte: Windows 10/11, Git, Node.js 22.12 sau mai nou si Google Chrome. Deschide PowerShell:

```powershell
git clone https://github.com/MrBlue2005/FAM-AUTO.git
Set-Location FAM-AUTO
npm.cmd run setup:new-pc
npm.cmd run studio
```

Scriptul instaleaza cu `npm ci` toate cele patru seturi de dependente, creeaza configuratiile locale, initializeaza baza SQLite Prisma, instaleaza Chromium pentru Playwright, configureaza parola Scrypt si ruleaza verificarile de baza. Daca PowerShell nu recunoaste `npm`, instaleaza Node.js LTS si redeschide terminalul; foloseste `npm.cmd`, nu `npm.ps1`.

Deschide `http://127.0.0.1:5173`. Pastreaza exact hostul `127.0.0.1` pentru ca sesiunea unica sa functioneze intre launcher, dashboard si generator.

Procedura completa si depanarea sunt in [docs/SETUP_NEW_PC.md](docs/SETUP_NEW_PC.md).

## Pornire

Toate serviciile intr-un singur terminal:

```powershell
npm.cmd run studio
```

Adrese locale:

- launcher: `http://127.0.0.1:5173`;
- dashboard/robot: `http://127.0.0.1:5173/dashboard`;
- generator: `http://127.0.0.1:3100`;
- API: `http://127.0.0.1:3000/api`;
- readiness: `http://127.0.0.1:3000/readyz`.

Pornire separata pentru depanare:

```powershell
npm.cmd run server
npm.cmd --prefix dashboard-v2 run dev
npm.cmd --prefix property-copywriter run dev
```

## Securitate si date locale

Parola nu este salvata in clar. `npm.cmd run auth:setup` scrie in `.env` numai un hash Scrypt cu salt aleator. Sesiunea este HttpOnly si protejeaza launcherul, API-ul, dashboardul si generatorul.

Git nu include fisierele `.env`, datele operationale din `app/data`, uploadurile, logurile, bazele SQLite, profilurile Chrome/Facebook, `node_modules` sau buildurile generate. Pe alt PC, muta datele operationale prin exportul/importul privat de backup din dashboard. Aplicatia porneste si fara date, cu publicarea dezactivata si limita de un grup.

## Verificare dezvoltare

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

Auditurile celor patru workspace-uri trebuie sa raporteze zero vulnerabilitati:

```powershell
npm.cmd audit
npm.cmd --prefix dashboard-v2 audit
npm.cmd --prefix property-copywriter audit
npm.cmd --prefix overlay-desktop audit
```

## Reguli de siguranta

- Pentru teste: `publishEnabled: false` si `groupLimit: 1`.
- Pornirea LIVE necesita confirmare explicita.
- Nu modifica datele campaniilor in timp ce robotul ruleaza.
- Nu publica profiluri Facebook, secrete, certificate sau date de clienti.
- Overlay-ul Windows este nesemnat pana la obtinerea unui certificat, deci SmartScreen poate afisa un avertisment.

## Documentatie

- `AGENTS.md` — reguli de dezvoltare si siguranta;
- `docs/HANDOFF.md` — starea curenta;
- `docs/SETUP_NEW_PC.md` — clonare, instalare si depanare;
- `docs/VPS_READINESS.md` — pregatirea pentru hosting;
- `app/data/README.md` — politica datelor operationale.