const crypto = require('crypto');

const password = process.env.PASSWORD;
const N = 32768;
const r = 8;
const p = 1;

if (!password || password.length < 16) {
  console.error('Seteaza temporar PASSWORD cu o parola de cel putin 16 caractere.');
  process.exitCode = 1;
} else {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, {
    N,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });
  console.log(`scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`);
}
