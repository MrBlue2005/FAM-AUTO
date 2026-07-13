function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const rentKeywords = [
  'chirii',
  'chirie',
  'inchirieri',
  'inchiriere',
  'inchiriat',
  'de inchiriat',
];

const saleKeywords = [
  'vanzari',
  'vanzare',
  'vand',
  'de vanzare',
  'cumparari',
  'cumparare',
];

function classifyGroup(group) {
  if (group.overrideType) {
    return group.overrideType;
  }

  const name = normalizeText(group.name);

  const hasRent = rentKeywords.some((keyword) =>
    name.includes(normalizeText(keyword))
  );

  const hasSale = saleKeywords.some((keyword) =>
    name.includes(normalizeText(keyword))
  );

  if (hasRent && hasSale) return 'mixed';
  if (hasRent) return 'rent';
  if (hasSale) return 'sale';

  return 'mixed';
}

module.exports = { classifyGroup };