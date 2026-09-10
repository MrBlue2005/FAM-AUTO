async function verifyPostPublished(page, composerDialog) {
  console.log('Astept confirmarea publicarii...');

  const successMessage = page
    .getByText(/postarea (ta )?(a fost|este acum) publicat[ăa]|your post (was|is now) published/i)
    .first();

  try {
    await Promise.any([
      composerDialog.waitFor({ state: 'hidden', timeout: 120000 }),
      successMessage.waitFor({ state: 'visible', timeout: 120000 }),
    ]);

    console.log('Publicarea a fost confirmata de interfata Facebook.');
    return true;
  } catch {
    console.log('Publicarea nu a putut fi confirmata in 120 secunde.');
    return false;
  }
}

// The legacy workflow accepts either UI signal. Future cloud-live execution is
// intentionally stricter: a hidden composer alone is not proof of publication.
async function verifyLivePostPublished(page, composerDialog, timeout = 120000) {
  const successMessage = page
    .getByText(/postarea (ta )?(a fost|este acum) publicat[ăa]|your post (was|is now) published/i)
    .first();
  const [composerClosed, acknowledgementVisible] = await Promise.all([
    composerDialog.waitFor({ state: 'hidden', timeout }).then(() => true).catch(() => false),
    successMessage.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false),
  ]);
  return composerClosed && acknowledgementVisible;
}

module.exports = {
  verifyPostPublished,
  verifyLivePostPublished,
};
