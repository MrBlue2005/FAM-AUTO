function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const PAUSED_MESSAGES = [
  'acest grup este pus pe pauza',
  'acest grup a fost pus pe pauza',
  'acest grup este momentan in pauza',
  'grupul este pus pe pauza',
  'grupul a fost pus pe pauza',
  'grupul a fost suspendat',
  'administratorii au pus acest grup pe pauza',
  'this group is paused',
  'this group is currently paused',
  'this group has been paused',
  'this group has been suspended',
  'admins have paused this group',
  'the admins paused this group',
];

const UNAVAILABLE_MESSAGES = [
  'acest continut nu este disponibil momentan',
  'acest grup nu este disponibil',
  'pagina nu este disponibila',
  "this content isn't available right now",
  'this content is not available right now',
  'this group is unavailable',
  'this page is unavailable',
];

const AUTHENTICATION_MESSAGES = [
  'conecteaza-te la facebook',
  'conectati-va la facebook',
  'adresa de e-mail sau numarul de telefon',
  'log into facebook',
  'email or phone',
  'forgot password',
];

const PAUSED_PATTERNS = [
  /\bgrup.{0,80}\bpauz/,
  /\bpauz.{0,80}\bgrup/,
  /\bgrup.{0,80}\bsuspend/,
  /\bsuspend.{0,80}\bgrup/,
  /\bgroup.{0,80}\bpaus/,
  /\bpaus.{0,80}\bgroup/,
  /\bgroup.{0,80}\bsuspend/,
  /\bsuspend.{0,80}\bgroup/,
];

function classifyGroupAvailabilityText(value, options = {}) {
  const text = normalizeText(value);

  if (
    PAUSED_MESSAGES.some((message) => text.includes(message)) ||
    PAUSED_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return { available: false, reason: 'group_paused' };
  }

  if (UNAVAILABLE_MESSAGES.some((message) => text.includes(message))) {
    return { available: false, reason: 'group_unavailable' };
  }

  const authenticationRequired = AUTHENTICATION_MESSAGES.some((message) =>
    text.includes(message)
  );
  if (
    options.fallbackOnMissingComposer &&
    /facebook\.com\/groups\//i.test(options.url || '') &&
    !authenticationRequired
  ) {
    return { available: false, reason: 'composer_unavailable' };
  }

  return { available: true, reason: null };
}

async function detectGroupAvailability(page, options = {}) {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    return classifyGroupAvailabilityText(bodyText, {
      ...options,
      url: page.url(),
    });
  } catch {
    return { available: true, reason: null };
  }
}

module.exports = {
  classifyGroupAvailabilityText,
  detectGroupAvailability,
};