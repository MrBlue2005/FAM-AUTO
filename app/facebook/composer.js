async function openComposer(page) {
  const composerButton = page.getByRole('button', { name: 'Scrie ceva...' });

  await composerButton.waitFor({ state: 'visible', timeout: 30000 });
  await composerButton.click();

  console.log('Composerul a fost deschis.');
}

module.exports = { openComposer };