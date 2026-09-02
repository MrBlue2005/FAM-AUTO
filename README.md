# RX AI Studio

RX AI Studio reuneste doua aplicatii locale:

- **RX PROPULSE TOOL** — robotul Facebook, dashboardul si overlay-ul desktop; motto: **Stay active. Stay visible.**
- **Property Copywriter** — generatorul de descrieri imobiliare, cu OpenAI, flux manual ChatGPT și generare automată Gemini pe baza JSON-ului validat.

Launcherul si ambele aplicatii folosesc o singura sesiune de autentificare.

In RX PROPULSE TOOL, tabul **Diagnostic** interpreteaza erorile preflight, explica de ce este blocata pornirea si indica pagina in care trebuie corectata configuratia. Mesajul tehnic original ramane disponibil pentru investigatii.

Cele trei descrieri generate in RX CREATIVE Tool pot fi trimise direct in formularul unei proprietati: Comerciala devine Ziua 1, Emotionala Ziua 2, iar Premium Ziua 3.

## Instalare pe un PC nou

### Installer Windows (recomandat)

Ruleaza `RX-AI-Studio-Offline-Setup-1.1.2.exe`. Setup-ul instaleaza aplicatia completa, runtime-ul privat Node.js, dependintele, Chromium, buildurile web, overlay-ul si launcherul. Nu este necesar ca Visual Studio, Node.js sau Git sa fie instalate pe PC-ul destinatie.

Installerul nu contine si nu suprascrie date private: parole, fisiere `.env` existente, profiluri Facebook, media si date operationale. Pachetul offline nu are nevoie de descarcari npm, Playwright sau Visual Studio in timpul instalarii.

Incepand cu bootstrap-ul `1.1.2`, butonul **Check for updates** urmareste direct ultimul commit precompilat din `main`. GitHub Actions publica automat un pachet verificat dupa fiecare push, iar launcherul il aplica cu backup si rollback fara a cere un installer nou. Un release semantic nou este necesar numai cand se schimba bootstrap-ul, runtime-ul Node/Chromium sau cerintele installerului.

Pentru a construi setup-ul din sursa pe PC-ul de dezvoltare:

```powershell
winget install --id JRSoftware.InnoSetup -e
npm.cmd run installer:dist
npm.cmd run installer:offline
npm.cmd run update:build
```

Executabilul rezultat este creat in `installer\dist`.

### Instalare din sursa

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

Pornire recomandata pe Windows: dublu-click pe shortcutul **RX AI Studio** de pe Desktop. Launcherul verifica si porneste automat API-ul, dashboardul si generatorul complet in fundal, fara ferestre CMD, apoi deschide Studio in browser.

Butonul **Opreste Studio** inchide controlat procesele locale ale API-ului, dashboardului si generatorului. Launcherul cere confirmare deoarece oprirea in timpul unei campanii intrerupe robotul.

Construire si instalare manuala a shortcutului:

```powershell
npm.cmd run launcher:dist
npm.cmd run launcher:install
```

Toate serviciile intr-un singur terminal:

```powershell
npm.cmd run studio
npm.cmd run studio:stop
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
npm.cmd run launcher:dist
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
