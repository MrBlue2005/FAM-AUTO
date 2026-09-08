# Instalare RX AI Studio pe alt PC Windows

## Local Agent gazduit si interfata dubla

Pe un PC nou, dintr-o clonare Git curata, ruleaza `npm.cmd run setup:new-pc`. Comanda pastreaza orice `.env` existent, instaleaza dependintele, creeaza directoarele de stocare goale si genereaza automat un ID Local Agent nou in `app/data/localAgentRegistry.json` plus credentialul asociat in `app/data/localAgentCredentials.json`. Pe Windows credentialul este protejat cu DPAPI pentru utilizatorul Windows curent; nu este copiat si nu este afisat.

In `.env` pastreaza numai configuratia locala non-secret a agentului:

```dotenv
RX_AGENT_TRANSPORT_MODE=HTTP
RX_AGENT_CLOUD_URL=https://rccefdsmvtsnpsaouzba.supabase.co/functions/v1/agent-protocol
RX_AGENT_REFERENCE_ALLOW_HTTP=false
```

Nu pune in `.env` tokenul de enrollment, secretul agentului, service-role, tokenul operatorului sau parole. `npm.cmd run agent:http` valideaza configuratia inainte sa faca orice apel cloud si refuza modul Local, URL-ul lipsa sau HTTP necriptat (cu exceptia backend-ului local de referinta activat explicit). Tokenul unic este furnizat separat de operator si exista numai in procesul de prima pornire; runnerul il elimina din propriul mediu imediat dupa enrollment reusit. Terminalul PowerShell trebuie curatat si el dupa aceea:

```powershell
$env:RX_AGENT_ENROLLMENT_TOKEN = '<token-unic-primit-separat>'
try {
  npm.cmd run agent:http
} finally {
  Remove-Item Env:RX_AGENT_ENROLLMENT_TOKEN -ErrorAction SilentlyContinue
}
```

Prima pornire trebuie sa afiseze `RX_AGENT_EVENT:{"type":"HEARTBEAT_OK"...}`. Daca enrollment-ul esueaza sau procesul este intrerupt, nu presupune ca tokenul a fost consumat: verifica starea agentului cu operatorul inainte de a cere un token nou. Pentru urmatoarele porniri nu mai seta tokenul: ruleaza numai `npm.cmd run agent:http`.

Interfetele pot rula simultan si nu folosesc acelasi endpoint local: dashboard-ul hosted (`https://fam-auto-git-vercel-preview-rx-d568.vercel.app` sau URL-ul hosted curent) afiseaza datele/statusul cloud, iar `npm.cmd run studio` porneste API-ul, Studio-ul si runtime-ul local la `http://127.0.0.1:5173`. Local Agent face exclusiv conexiuni HTTPS outbound spre control plane. Bootstrap-ul nu creeaza proprietati, joburi, media, profiluri Chromium sau sesiuni Facebook si nu activeaza publicarea.

| Clasificare | Fisiere/directoare |
| --- | --- |
| Recreeaza pe fiecare PC | `.env` din `.env.example` (completeaza local), `app/data/localAgentRegistry.json`, `app/data/localAgentCredentials.json`, `app/data/local-agent-locks/`, `chrome-profile*`, `playwright/.auth/` |
| Se pot copia manual numai dupa revizuire | `app/uploads/`, `logs/`, exporturi de proprietati/joburi/grupuri/programari/foldere; nu sunt necesare pentru bootstrap |
| Nu copia intre PC-uri | `app/data/localAgentCredentials.json` (DPAPI CurrentUser), `app/data/localAgentRegistry.json` pentru un agent nou, `chrome-profile*`, `playwright/.auth/`, tokenuri de enrollment sau orice secret din `.env` |
| Date operationale pe care utilizatorul le recreeaza/importa | `app/data/properties/`, `app/data/jobs/`, `app/data/groups.json`, `app/data/schedules.json`, `app/data/campaignFolders.json`, `app/data/scheduleFolders.json`, `app/uploads/`, `logs/` |

## Varianta recomandata: pachetul offline complet

Descarca sau muta arhiva `RX-AI-Studio-Offline-<versiune>.zip`, extrage-o complet si ruleaza executabilul `RX-AI-Studio-Offline-Setup-<versiune>.exe` din interior. Pachetul instaleaza aplicatia completa, Node.js privat, toate dependentele npm, Chromium Playwright, baza Prisma/SQLite, parola, overlay-ul, launcherul, shortcutul Desktop si pornirea la logare.

Pe calculatorul destinatie nu sunt necesare Visual Studio, Git, Node.js global sau conexiune la internet. Fisierul `SHA256.txt` din ZIP permite verificarea installerului. Datele private, configuratiile `.env`, media operationala si profilurile Facebook nu sunt incluse; acestea se muta separat prin backup.

Dupa instalare, launcherul verifica automat ultimul GitHub Release. Daca exista o versiune mai noua, afiseaza `Update available`. Update-ul porneste numai dupa apasarea butonului si confirmare, iar Studio este oprit numai dupa ce descarcarea a trecut verificarea SHA-256.

Pentru generarea pachetului offline din repository:

```powershell
winget install --id JRSoftware.InnoSetup -e
npm.cmd run installer:offline
```

Rezultatele sunt scrise in `installer\dist`: Setup-ul complet, checksum-ul `.sha256` si arhiva ZIP portabila. Un tag Git cu forma `v<versiune>` declanseaza workflow-ul GitHub care construieste aceleasi fisiere si le publica in Releases.

## Varianta online: Setup.exe compact

Ruleaza `RX-AI-Studio-Setup-1.1.0.exe`. Installerul copiaza aplicatia in `%LOCALAPPDATA%\Programs\RX AI Studio`, descarca un runtime privat Node.js 22 si ruleaza automat configurarea completa: dependinte, Chromium Playwright, Prisma/SQLite, parola, launcher, shortcut Desktop si task-ul de pornire la logare.

Nu sunt necesare Git sau Node.js instalate anterior. Este necesara o conexiune la internet. Setup-ul nu include date private si pastreaza configuratiile locale existente la reinstalare. Inaintea unei reinstalari, opreste Studio si orice campanie activa.

Pentru generarea installerului din repository:

```powershell
winget install --id JRSoftware.InnoSetup -e
npm.cmd run installer:dist
```

Rezultatul este `installer\dist\RX-AI-Studio-Setup-1.1.0.exe`. Buildul include numai fisierele urmarite sau neignorate de Git; `.env`, datele operationale, media, logurile, profilele Facebook si `node_modules` nu sunt incluse.

## Varianta pentru dezvoltare: instalare din sursa

## 1. Instaleaza uneltele

Instaleaza Git, Node.js 22.12+ (LTS recomandat), Google Chrome si GitHub CLI:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id GitHub.cli -e
```

Redeschide PowerShell si verifica:

```powershell
git --version
node --version
npm.cmd --version
gh --version
```

Daca `npm` nu este recunoscut, reinstaleaza Node.js LTS si redeschide terminalul. Daca `npm.ps1` este blocat, foloseste `npm.cmd`.

## 2. Cloneaza sursa

```powershell
Set-Location D:\
git clone https://github.com/MrBlue2005/FAM-AUTO.git
Set-Location FAM-AUTO
git status --short --branch
```

Pentru un checkout vechi cu modificari locale, ruleaza intai `git status` si fa backup. Nu folosi `git reset --hard` si nu sterge folderul vechi pana nu ai salvat modificarile si datele operationale.

## 3. Ruleaza instalarea automata

```powershell
npm.cmd run setup:new-pc
```

Scriptul verifica uneltele, ruleaza `npm ci` pentru toate cele patru componente, creeaza configuratiile locale, executa `prisma db push`, instaleaza Chromium pentru Playwright, solicita parola si ruleaza verificarile de baza. Astfel este creata automat si tabela `PropertyRecord`.

Pentru CI sau verificarea unei clone fara prompt:

```powershell
npm.cmd run setup:new-pc -- -NonInteractive
```

Optiuni: `-SkipBrowserInstall` si `-SkipChecks`.

## 4. Porneste studioul

Instalarea interactiva creeaza automat shortcutul **RX AI Studio** pe Desktop. Deschide-l prin dublu-click; aplicatia porneste cele trei servicii in fundal si deschide Studio cand toate sunt online.

Pentru oprire foloseste butonul **Opreste Studio** din launcher. Confirma oprirea numai daca robotul nu ruleaza sau daca vrei sa intrerupi campania activa.

Pentru reconstruire sau reinstalarea shortcutului:

```powershell
npm.cmd run launcher:dist
npm.cmd run launcher:install
```

Pornirea manuala ramane disponibila:

```powershell
npm.cmd run studio
```

Deschide `http://127.0.0.1:5173`. Nu amesteca `localhost` cu `127.0.0.1`; acelasi hostname pastreaza sesiunea unica intre aplicatii.

Servicii: API `127.0.0.1:3000`, launcher/dashboard `127.0.0.1:5173`, generator `127.0.0.1:3100`. Opreste-le cu `Ctrl+C`.

## 5. Date mutate separat

GitHub contine sursa, lockfile-urile si documentatia, nu datele private. Foloseste exportul de backup din dashboard pentru grupuri, campanii si configuratie. Transfera sau recreeaza separat profilurile Chrome/Facebook, cu procesele inchise.

Nu publica `.env`, `dev.db`, fisierele JSON operationale din `app/data`, `app/uploads`, `logs` sau `chrome-profile*`.

## 6. Probleme frecvente

### `PropertyRecord` nu exista

```powershell
npm.cmd --prefix property-copywriter run db:push
```

### Loginul apare de doua ori

Redeschide numai `http://127.0.0.1:5173`, verifica URL-urile din cele trei fisiere `.env` si reporneste studioul.

### `Failed to fetch` sau API oprit

Verifica `http://127.0.0.1:3000/readyz`. Daca nu raspunde, elibereaza porturile 3000/3100/5173 si porneste din radacina repository-ului.

### Overlay-ul nu porneste

```powershell
npm.cmd run overlay:dist
```

Dashboardul prefera executabilul rapid din `overlay-desktop\dist\win-unpacked`. Fara certificat de semnare, Windows poate afisa SmartScreen.

### Audit de securitate

```powershell
npm.cmd audit
npm.cmd --prefix dashboard-v2 audit
npm.cmd --prefix property-copywriter audit
npm.cmd --prefix overlay-desktop audit
```

Rezultat asteptat: `found 0 vulnerabilities` pentru fiecare.
