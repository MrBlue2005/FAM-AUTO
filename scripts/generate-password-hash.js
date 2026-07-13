const crypto = require('crypto');

const password = process.env.PASSWORD;

if (!password || password.length < 12) {
  console.error('Seteaza temporar PASSWORD cu o parola de cel putin 12 caractere.');
  process.exitCode = 1;
} else {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  console.log(`${salt.toString('hex')}:${hash.toString('hex')}`);
}
