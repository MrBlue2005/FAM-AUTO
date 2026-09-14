const { openComposer } = require('./composer');
const { uploadImage } = require('./imageUploader');
const { selectPostingIdentity } = require('./postingIdentity');
const { writePostText } = require('./textWriter');

function skipImmutableZeroMediaUpload(composerOptions) {
  // Only the real live adapter supplies this count, derived from the immutable
  // server snapshot. Legacy/manual callers retain their existing upload path.
  if (!Object.hasOwn(composerOptions, 'expectedMediaCount')) return false;
  const count = composerOptions.expectedMediaCount;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw Object.assign(new Error('Live execution media snapshot is invalid.'), { code: 'LIVE_EXECUTION_SNAPSHOT_INVALID' });
  }
  return count === 0;
}

async function createPost(page, post, composerOptions = {}) {
  const skipMediaUpload = skipImmutableZeroMediaUpload(composerOptions);
  const composer = await openComposer(page, composerOptions);
  const identityResult = await selectPostingIdentity(page, post);
  if (identityResult.selected) console.log(`Postarea va fi facuta ca: ${identityResult.actorName}`);
  if (!skipMediaUpload) await uploadImage(page, post, composer);
  await writePostText(page, post.text, composer);
  console.log('Postarea a fost pregatita.');
  // Legacy callers may ignore this optional metadata. Real live execution
  // consumes it to retain only the composer created by this operation.
  return { composer };
}

module.exports = { createPost };
