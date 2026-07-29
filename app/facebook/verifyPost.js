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

module.exports = {
  verifyPostPublished,
};
