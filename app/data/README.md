# Date locale RX PROPULSE TOOL

Acest folder contine date operationale create pe calculatorul pe care ruleaza aplicatia:

- `groups.json`;
- `runtimeConfig.json`;
- campaniile din `properties/` si `jobs/`;
- `schedules.json`.

Aceste fisiere sunt excluse din Git deoarece pot contine informatii despre clienti, grupuri si profiluri Facebook. O clonare noua porneste sigur, cu liste goale, `publishEnabled: false` si `groupLimit: 1`; fisierele si directoarele sunt create automat la prima salvare.

Pentru mutarea pe alt PC, foloseste exportul de backup din dashboard si transfera arhiva privat. Nu copia prin Git fisierele `.env`, profilurile Chrome/Facebook, uploadurile sau logurile.