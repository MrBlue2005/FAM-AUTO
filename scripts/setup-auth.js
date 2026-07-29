const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const rootPath = path.join(__dirname, '..');
const envPath = path.join(rootPath, '.env');
const examplePath = path.join(rootPath, '.env.example');
const password = process.env.PASSWORD || '';
const username = String(process.env.ADMIN_USERNAME || 'admin').trim();
const N = 32768;
const r = 8;
const p = 1;

if (password.length < 16) {
  console.error('Parola trebuie să aibă cel puțin 16 caractere. Nu a fost modificat niciun fișier.');
  process.exit(1);
}
if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
  console.error('ADMIN_USERNAME trebuie să aibă 3-64 caractere sigure. Nu a fost modificat niciun fișier.');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 });
const encoded = `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync(examplePath, 'utf8');

function setEnv(name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

setEnv('AUTH_ENABLED', 'true');
setEnv('ADMIN_USERNAME', username);
setEnv('ADMIN_PASSWORD_SCRYPT', encoded);
fs.writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });
try { fs.chmodSync(envPath, 0o600); } catch { /* Windows applies its own ACLs. */ }
console.log(`Autentificarea a fost activată pentru utilizatorul ${username}. În .env a fost salvat numai hashul Scrypt.`);
