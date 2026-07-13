# R.X. AI Desktop Overlay

Overlay desktop separat pentru statusul campaniilor. Aplicatia se conecteaza la API-ul local:

```powershell
http://127.0.0.1:3000/api
```

## Rulare in development

Porneste API-ul din proiectul principal:

```powershell
node server\server.js
```

Instaleaza pachetele overlay-ului o singura data:

```powershell
cd overlay-desktop
npm install
```

Porneste overlay-ul:

```powershell
npm run dev
```

Sau din root:

```powershell
npm run overlay:dev
```

## Build EXE portabil

```powershell
cd overlay-desktop
npm run dist
```

Fisierul portabil apare in:

```powershell
overlay-desktop\dist\RX-AI-Overlay-0.1.0.exe
```

## Functii

- fereastra transparenta si always-on-top
- opacitate reglabila
- dimensiune pe preseturi: Compact, Mediu si Mare
- API URL editabil
- status robot, ETA campanie, ETA total si progres
- grupuri campanie si total campanii
- mod TEST/LIVE, ID rulare si urmatoarele taskuri din queue
- live feed + istoric recent
- butoane Pauza, Resume si Refresh
- notificari Windows pentru erori, avertizari, succes si schimbari de status
- polling adaptiv pentru consum redus cand robotul este idle
- suport pentru cheia API optionala din configurarea backend
