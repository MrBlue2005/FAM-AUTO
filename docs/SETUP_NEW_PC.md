# Instalare RX AI Studio pe alt PC Windows

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
