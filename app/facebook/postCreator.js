const { openComposer } = require('./composer');
const { uploadImage } = require('./imageUploader');
const { selectPostingIdentity } = require('./postingIdentity');
const { writePostText } = require('./textWriter');

async function createPost(page, post) {
  const composer = await openComposer(page);
  const identityResult = await selectPostingIdentity(page, post);
  if (identityResult.selected) console.log(`Postarea va fi facuta ca: ${identityResult.actorName}`);
  await uploadImage(page, post, composer);
  await writePostText(page, post.text, composer);
  console.log('Postarea a fost pregatita.');
  // Legacy callers may ignore this optional metadata. Real live execution
  // consumes it to retain only the composer created by this operation.
  return { composer };
}

module.exports = { createPost };
