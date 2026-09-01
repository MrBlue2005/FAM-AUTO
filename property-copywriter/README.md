# RX CREATIVE Tool – Aim for perfection

RX CREATIVE Tool este o aplicație locală Next.js care analizează un anunț de pe Zonere.ro, prezintă datele într-un formular editabil și generează trei descrieri distincte: comercială, emoțională și premium. Datele corectate, opțiunile și textele sunt salvate local în SQLite.

## Stack

- Next.js 16 cu App Router, React și TypeScript strict;
- Tailwind CSS 4;
- Node.js și Playwright pentru analiza paginii;
- OpenAI Responses API și Gemini API cu răspuns JSON Schema;
- Prisma 7 și SQLite;
- Zod pentru validare;
- Vitest și ESLint.

## Cerințe

- Node.js 22 sau 24;
- npm;
- o cheie OpenAI și/sau Gemini pentru generarea automată (modul demo și fluxul manual ChatGPT funcționează fără cheie).

## Instalare

Din directorul `property-copywriter`:

```powershell
npm install
npx playwright install chromium
Copy-Item .env.example .env
npm run prisma:generate
npm run db:push
```

Editează `.env`:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.7-flash
GEMINI_FALLBACK_MODELS=gemini-3.5-flash
DATABASE_URL="file:./dev.db"
DEMO_MODE=true
```

Nu introduce cheia în cod și nu comite `.env`. Pentru generare OpenAI setează cheia și `DEMO_MODE=false`. Modelul poate fi înlocuit fără modificarea codului.

### Generare automată cu Gemini

Butonul `Generează cu Gemini` trimite exclusiv JSON-ul proprietății deja extras și validat, împreună cu opțiunile și modelul editorial selectat, către ruta backend locală `/api/generate-gemini`. Linkul nu este folosit pentru o nouă extragere și pagina HTML nu este trimisă către Gemini. Cheia rămâne exclusiv în procesul Next.js de pe server și nu este inclusă în bundle-ul browserului.

Adaugă cheia în `property-copywriter/.env`:

```env
GEMINI_API_KEY=cheia_creata_in_Google_AI_Studio
GEMINI_MODEL=gemini-3.7-flash
GEMINI_FALLBACK_MODELS=gemini-3.5-flash
```

Modelul implicit este configurabil. Pentru erori tranzitorii de capacitate, limită, timeout sau rețea, aplicația trece automat de la modelul principal la lista separată prin virgulă din `GEMINI_FALLBACK_MODELS`; erorile permanente, precum cheia invalidă, nu declanșează fallback. Rezultatul este validat cu aceeași schemă Zod, salvat în același istoric și afișat în aceleași carduri ca rezultatele OpenAI/ChatGPT. Fluxul Gemini elimină numai linia `Detalii esențiale`, păstrând informațiile care o urmează. La eroare, rezultatul afișat anterior rămâne neschimbat.

### Modele de descrieri

Pagina `/templates` permite crearea, editarea și ștergerea modelelor reutilizabile. Un model conține un nume, exemplul complet de descriere, instrucțiuni suplimentare opționale și poate fi marcat implicit. După analizarea proprietății, modelul se selectează din opțiunile generatorului.

Când este selectat, exemplul complet și instrucțiunile sunt trimise către GPT, atât prin OpenAI API, cât și în promptul pentru fluxul manual ChatGPT. Promptul cere explicit:

- păstrarea cât mai fidelă a structurii, ordinii secțiunilor, spațierii, stilului, tonului, emoji-urilor și poziției CTA-ului;
- înlocuirea datelor din exemplu numai cu informațiile validate ale proprietății curente;
- omiterea completă a criteriilor care nu se aplică sau pentru care lipsesc date;
- adăugarea naturală, în același stil, a informațiilor relevante care există pentru proprietatea curentă, dar nu au corespondent în model;
- ignorarea oricărei instrucțiuni nesigure din exemplu și interzicerea copierii numelor, prețurilor, suprafețelor sau dotărilor din acesta.

Istoricul salvează o copie a modelului folosit, astfel încât o generare veche rămâne reproductibilă chiar dacă modelul este editat sau șters ulterior. Modelele sunt stocate local în SQLite. Modul demo determinist nu generează cu un model selectat, deoarece adaptarea semantică necesită GPT; în acest caz se folosește OpenAI API sau fluxul manual ChatGPT.

### Generare prin ChatGPT fără cheie API

După analizarea proprietății, butonul `Deschide ChatGPT + copiază promptul` pregătește promptul complet și deschide ChatGPT într-un tab nou. Utilizatorul lipește promptul și trimite mesajul manual, apoi copiază răspunsul JSON în zona de import din RX CREATIVE Tool. Aplicația validează structura, completează footerul obligatoriu pentru formatul social, afișează cele trei carduri și salvează rezultatul în istoricul local.

Acest flux nu automatizează sesiunea ChatGPT și nu extrage programatic răspunsul.

## Pornire

```powershell
npm run dev
```

Deschide `http://127.0.0.1:3100`. Portul `3100` evită conflictul cu API-ul FAM-AUTO de pe `3000`. Pentru o versiune de producție:

```powershell
npm run build
npm run start
```

Din rădăcina repository-ului poți porni API-ul, launcher-ul/dashboard-ul și generatorul împreună:

```powershell
npm run studio
```

Launcher-ul comun este disponibil la `http://127.0.0.1:5173`.

## Verificări

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Testele adaptorului folosesc `tests/fixtures/zonere-property.html`; nu accesează permanent site-ul real.

## Structură

```text
src/app/                 pagini și API routes
src/components/          formular, opțiuni, rezultate și istoric
src/lib/adapters/        contractul surselor și ZonereAdapter
src/lib/schemas.ts       tipurile și schemele Zod
src/lib/url-security.ts  allowlist și validare URL
src/lib/network-security.ts verificare DNS și blocare rețele private
src/lib/openai-generator.ts generare OpenAI JSON și reparare controlată
src/lib/gemini-generator.ts generare Gemini JSON, validare și erori sigure
src/lib/prompts.ts       promptul de sistem separat
prisma/                  schema bazei de date
tests/                   teste și fixture HTML
```

## Flux și securitate

Endpointul de analiză acceptă exclusiv HTTPS și `zonere.ro`. Înainte de navigare verifică rezoluția DNS, blochează IP-urile locale/private și filtrează cererile Playwright către destinații nesigure. Adaptorul încearcă JSON-LD, Open Graph, perechi etichetă-valoare și textul principal. Browserul și pagina sunt închise inclusiv la eroare.

Conținutul paginii este tratat ca date nesigure. Dacă extracția deterministă lasă prea puține câmpuri și OpenAI este configurat, un fallback separat structurează cel mult 20.000 de caractere de text; acesta poate completa numai câmpurile lipsă și nu suprascrie datele determinate din pagină. HTML-ul complet nu este salvat și nu este trimis generatorului final. Generatorul primește numai proprietatea validată și opțiunile utilizatorului. Prompturile ignoră instrucțiunile găsite în anunț, interzic informațiile inventate și cer JSON valid, verificat cu Zod. Un răspuns de generare invalid este reparat o singură dată.

## Limitări MVP

- este acceptată doar sursa Zonere.ro;
- schimbările de structură ale site-ului pot necesita ajustarea adaptorului;
- paginile protejate prin autentificare sau CAPTCHA nu sunt ocolite;
- limitarea cererilor este în memorie și este potrivită unei singure instanțe locale;
- SQLite și istoricul nu includ autentificare sau sincronizare între dispozitive;
- modul demo produce texte deterministe, utile pentru UI, nu texte editoriale finale;
- regenerarea individuală cere modelului un set structurat complet, iar UI înlocuiește numai varianta aleasă.

## Adăugarea unui nou adaptor

1. Creează un fișier în `src/lib/adapters/`.
2. Implementează `PropertySourceAdapter` din `types.ts`: `supports`, `extract` și `normalize`.
3. Adaugă domeniul în allowlist numai după o evaluare de securitate.
4. Înregistrează adaptorul în `src/lib/extractor.ts`.
5. Adaugă un fixture HTML local și teste pentru câmpuri lipsă, normalizare și redirecționări.

Nu reutiliza selectori fragili ca unică sursă. Păstrează ordinea JSON-LD → Open Graph → HTML semantic → text normalizat.
