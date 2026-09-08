'use strict';
const express = require('express');

const safeMedia = (media) => ({ mediaId: media.media_id, state: media.state, byteSize: Number(media.byte_size), mimeType: media.mime_type, originalName: media.original_name });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function createCloudMediaUploadRouter(store) {
  const router = express.Router(); const send = (res, promise, status = 200) => Promise.resolve(promise).then((value) => res.status(status).json(value)).catch((error) => res.status(error.status || 400).json({ error: error.message }));
  router.post('/initiate', (req, res) => send(res, store.initiateMedia({ originalName: req.body?.originalName, mimeType: req.body?.mimeType, byteSize: req.body?.byteSize, sha256: req.body?.sha256, requestId: req.get('x-rx-request-id') }).then((result) => ({ media: { mediaId: result.media.media_id, state: result.media.state, byteSize: Number(result.media.byte_size), mimeType: result.media.mime_type }, upload: result.upload, expiresIn: Number(result.expires_in) || 120 }))));
  router.post('/:mediaId/finalize', (req, res) => send(res, store.finalizeMedia({ mediaId: req.params.mediaId }).then((result) => ({ media: safeMedia(result.media), verification: { byteSize: Number(result.verification.byte_size) } }))));
  router.post('/attach', (req, res) => send(res, (async () => {
    const kind = req.body?.kind === 'job' ? 'job' : 'property'; const campaignId = String(req.body?.campaignId || ''); const day = Number(req.body?.day); const mediaId = String(req.body?.mediaId || '');
    const campaign = (await store.listCampaigns(kind)).find((row) => String(row.legacy_id) === campaignId); const post = campaign?.app_campaign_posts?.find((row) => Number(row.day) === day);
    if (!post || !mediaId) throw fail('The requested campaign post is unavailable for media attachment.', 404);
    const mediaIds = [...new Set([...(post.app_post_media || []).sort((a, b) => Number(a.ordinal) - Number(b.ordinal)).map((row) => row.app_media_objects?.media_id).filter(Boolean), mediaId])];
    const result = await store.setPostMedia({ postId: post.post_id, mediaIds, expectedRevision: post.revision, requestId: req.get('x-rx-request-id') });
    return { post: { day, mediaIds: result.media_ids || mediaIds } };
  })()));
  return router;
}
module.exports = { createCloudMediaUploadRouter };
