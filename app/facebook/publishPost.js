const DataManager = require('../core/DataManager');
const { verifyPostPublished } = require('./verifyPost');

async function findPublishButton(page) {
  const possibleButtons = [
    page.getByRole('button', { name: /Posteaz[ăa]/i }),
    page.getByRole('button', { name: /Public[ăa]/i }),
    page.getByRole('button', { name: 'Post' }),
    page.getByRole('button', { name: 'Publish' }),
  ];

  for (const button of possibleButtons) {
    try {
      await button.waitFor({ state: 'visible', timeout: 5000 });
      return button;
    } catch {
      // Try the next supported Facebook language.
    }
  }

  throw new Error('Butonul de publicare nu a fost gasit.');
}

async function publishPost(page) {
  const runtimeConfig = DataManager.getRuntimeConfig();
  const publishButton = await findPublishButton(page);

  if (!runtimeConfig.publishEnabled) {
    console.log('Publish dezactivat. Postarea ramane pregatita, fara click.');
    return false;
  }

  const composerDialog = page.getByRole('dialog').last();
  await composerDialog.waitFor({ state: 'visible', timeout: 5000 });

  console.log('Apas butonul de publicare...');
  await publishButton.click();

  const confirmed = await verifyPostPublished(page, composerDialog);
  if (!confirmed) {
    throw new Error('Facebook nu a confirmat publicarea postarii.');
  }

  return true;
}

module.exports = {
  publishPost,
};
