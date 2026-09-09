export const PASSWORD_LENGTH = 20;
export const PASSWORD_GROUPS = Object.freeze(['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%*+-=?@']);
const PASSWORD_CHARSET = PASSWORD_GROUPS.join('');

function secureIndex(max, cryptoSource = globalThis.crypto) {
  if (!cryptoSource?.getRandomValues) throw new Error('Generatorul securizat de parole nu este disponibil în acest browser.');
  const limit = Math.floor(0x100000000 / max) * max;
  const value = new Uint32Array(1);
  do { cryptoSource.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % max;
}

export function generateStrongPassword(cryptoSource = globalThis.crypto) {
  const characters = PASSWORD_GROUPS.map((group) => group[secureIndex(group.length, cryptoSource)]);
  while (characters.length < PASSWORD_LENGTH) characters.push(PASSWORD_CHARSET[secureIndex(PASSWORD_CHARSET.length, cryptoSource)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = secureIndex(index + 1, cryptoSource); [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join('');
}

export function credentialCopyText({ username, password }) { return `Username: ${username}\nParolă: ${password}`; }
