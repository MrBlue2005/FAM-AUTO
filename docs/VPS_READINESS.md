# VPS readiness

Acest document descrie contractul generic de productie. Providerul, reverse proxy-ul si managerul de procese se aleg separat.

## Ce este pregatit

- Express poate servi buildul din `dashboard-v2/dist` si API-ul pe acelasi origin.
- Datele, logurile, uploadurile si profilurile browserului pot folosi volume persistente prin `RX_DATA_PATH`, `RX_LOGS_PATH`, `RX_UPLOADS_PATH` si `RX_PROFILES_PATH`.
- `GET /healthz` verifica procesul, iar `GET /readyz` verifica accesul la volume.
- Pornirea in `NODE_ENV=production` este blocata daca autentificarea de administrator nu este configurata.
- Procesul trateaza `SIGINT` si `SIGTERM`, opreste schedulerul si robotul, apoi inchide serverul HTTP.
- Scrierile JSON folosesc un fisier temporar si rename pentru a evita fisiere partiale dupa un crash.

## Pregatirea mediului

1. Foloseste Node.js `22.12` sau mai nou.
2. Copiaza `.env.production.example` ca `.env` si inlocuieste valorile placeholder.
3. Genereaza parola Scrypt fara sa o salvezi in Git:

```powershell
$env:PASSWORD='o-parola-lunga-si-unica'
npm run auth:hash
Remove-Item Env:PASSWORD
```

4. Pune rezultatul in `ADMIN_PASSWORD_SCRYPT`.
5. Creeaza directoarele persistente si acorda utilizatorului serviciului drepturi de citire/scriere.
6. Construieste dashboardul cu `VITE_API_URL=/api`:

```bash
npm ci
npm --prefix dashboard-v2 ci
npm run build
npm run check:production
npm start
```

## Date care nu trebuie tratate ca source code

Pe VPS trebuie transferate separat si pastrate in volume/backup:

- datele active (`app/data` in instalarea locala);
- media (`app/uploads`);
- istoricul, runurile si auditul (`logs`);
- profilurile Chrome/Facebook (`chrome-profile*`).

Checkoutul actual urmareste inca media operationala in Git. Sunt aproximativ 242 MB in 140 de fisiere. Scoaterea lor din istoricul Git necesita o operatie separata, cu backup si coordonare pentru toate clonele.

## Browser Facebook pe Linux

Robotul foloseste un profil persistent Playwright. Cu `BROWSER_HEADLESS=false`, VPS-ul are nevoie de sesiune grafica, VNC/RDP sau Xvfb. Loginul initial si provocarile Facebook trebuie rezolvate intr-o sesiune interactiva. Nu transfera profilul prin Git si nu il expune prin HTTP.

## Reguli de expunere

- Tine Node pe `127.0.0.1` si expune-l doar printr-un reverse proxy cu HTTPS.
- Nu pune `API_KEY` in `VITE_API_KEY`; variabilele Vite sunt publice in bundle.
- Permite public doar porturile reverse proxy-ului, nu portul intern Node.
- Verifica backupul si restore-ul inainte de activarea schedulerului.
- Primul deploy ramane cu `publishEnabled: false` si `groupLimit: 1`.

## Decizii ramase pentru discutia VPS

- providerul, sistemul de operare si resursele;
- reverse proxy si certificate TLS;
- systemd, PM2 sau container;
- strategie de backup si retentie;
- metoda securizata de transfer pentru media si profilurile Chrome;
- sesiune grafica pentru setup si depanare Facebook.
