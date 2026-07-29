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

function classifyGroupAvailabilityText(value) {
  const text = normalizeText(value);

  if (PAUSED_MESSAGES.some((message) => text.includes(message))) {
    return { available: false, reason: 'group_paused' };
  }

  if (UNAVAILABLE_MESSAGES.some((message) => text.includes(message))) {
    return { available: false, reason: 'group_unavailable' };
  }

  return { available: true, reason: null };
}

async function detectGroupAvailability(page) {
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    return classifyGroupAvailabilityText(bodyText);
  } catch {
    return { available: true, reason: null };
  }
}

module.exports = {
  classifyGroupAvailabilityText,
  detectGroupAvailability,
};