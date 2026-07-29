const { openComposer } = require('./composer');
const { uploadImage } = require('./imageUploader');
const { selectPostingIdentity } = require('./postingIdentity');
const { writePostText } = require('./textWriter');

async function createPost(page, post) {
  await openComposer(page);

  const identityResult = await selectPostingIdentity(page, post);

  if (identityResult.selected) {
    console.log(`Postarea va fi facuta ca: ${identityResult.actorName}`);
  }

  await uploadImage(page, post);

  await writePostText(page, post.text);

  console.log('✅ Postarea a fost pregătită.');
}

module.exports = { createPost };
