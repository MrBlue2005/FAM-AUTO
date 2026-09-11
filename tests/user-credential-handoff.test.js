'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const root = path.join(__dirname, '..');
test('credential generator uses crypto.getRandomValues and produces a policy-compliant 20-character password', async () => {
  const { generateStrongPassword, PASSWORD_LENGTH, credentialCopyText } = await import('../dashboard-v2/src/services/userCredentialHandoff.js');
  let value = 0; const cryptoSource = { getRandomValues: (array) => { array[0] = value++ * 104729; return array; } }; const password = generateStrongPassword(cryptoSource);
  assert.equal(PASSWORD_LENGTH, 20); assert.equal(password.length, 20); assert.match(password, /[A-Z]/); assert.match(password, /[a-z]/); assert.match(password, /[0-9]/); assert.match(password, /[!#$%*+\-=?@]/);
  assert.equal(credentialCopyText({ username: 'qa_user', password: 'Secret-123!' }), 'Username: qa_user\nParolă: Secret-123!');
});
test('Users credential handoff is ephemeral, copyable, revealable, and has no browser persistence path', () => {
  const page = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'pages', 'Users.jsx'), 'utf8'); const helper = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'services', 'userCredentialHandoff.js'), 'utf8');
  assert.match(helper, /cryptoSource\.getRandomValues/); assert.doesNotMatch(helper, /Math\.random/);
  for (const expected of ['generateCreatePassword', 'generateResetPassword', "setForm({ ...form, password, confirm: password })", "setReset({ password, confirm: password })", 'showCreatePassword', 'showResetPassword', 'showHandoffPassword', 'Copiază username', 'Copiază parola', 'Copiază datele', 'credentialCopyText(handoff)', 'Salvează parola acum', 'setHandoff(null)']) assert.ok(page.includes(expected), expected);
  assert.match(page, /setHandoff\(\{ username: result\.user\.username, password \}\)/); assert.match(page, /setForm\(\{ username: "", password: "", confirm: "" \}\)/); assert.match(page, /setReset\(\{ password: "", confirm: "" \}\)/);
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'URLSearchParams', 'console.', 'password_scrypt']) assert.equal(page.includes(forbidden), false, forbidden);
});
test('Users list remains ADMIN-only and never contains a permanent password retrieval action', () => {
  const page = fs.readFileSync(path.join(root, 'dashboard-v2', 'src', 'pages', 'Users.jsx'), 'utf8');
  assert.match(page, /if \(!isAdmin\)/); assert.match(page, /Utilizatorii sunt disponibili numai administratorilor/); assert.doesNotMatch(page, /View password|Vezi parola|Recuperează parola/);
});
