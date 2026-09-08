'use strict';
const express = require('express');
function createCloudApplicationRouter(store) {
  const router = express.Router(); const send = (res, promise) => Promise.resolve(promise).then((data) => res.json(data)).catch((error) => res.status(error.status || 400).json({ error: error.message }));
  router.get('/properties', (req, res) => send(res, store.listCampaigns('property'))); router.get('/jobs', (req, res) => send(res, store.listCampaigns('job')));
  router.get('/groups', (req, res) => send(res, store.listTargets())); router.get('/campaign-folders', (req, res) => send(res, store.listCampaignFolders())); router.get('/schedule-folders', (req, res) => send(res, store.listScheduleFolders())); router.get('/schedules', (req, res) => send(res, store.listSchedules()));
  router.post('/campaigns', (req, res) => send(res.status(201), store.saveCampaign({ ...req.body, requestId: req.get('x-rx-request-id') })));
  router.post('/posts', (req, res) => send(res.status(201), store.savePost({ ...req.body, requestId: req.get('x-rx-request-id') })));
  router.post('/groups', (req, res) => send(res.status(201), store.saveTarget(req.body)));
  router.post('/campaign-folders', (req, res) => send(res.status(201), store.saveCampaignFolder(req.body)));
  router.post('/schedule-folders', (req, res) => send(res.status(201), store.saveScheduleFolder(req.body)));
  router.post('/schedules', (req, res) => send(res.status(201), store.saveSchedule({ ...req.body, requestId: req.get('x-rx-request-id') })));
  router.post('/posts/:postId/media', (req, res) => send(res.status(201), store.setPostMedia({ ...req.body, postId: req.params.postId, requestId: req.get('x-rx-request-id') })));
  router.post('/execution-runs', (req, res) => send(res.status(201), store.createExecutionRun(req.body)));
  router.post('/posting-results', (req, res) => send(res.status(201), store.recordPostingResult(req.body)));
  router.post('/media/initiate', (req, res) => send(res, store.initiateMedia({ ...req.body, requestId: req.get('x-rx-request-id') })));
  router.post('/media/:mediaId/finalize', (req, res) => send(res, store.finalizeMedia({ mediaId: req.params.mediaId, requestId: req.get('x-rx-request-id') })));
  router.get('/media/:mediaId/preview', (req, res) => send(res, store.createPreview(req.params.mediaId)));
  return router;
}
module.exports = { createCloudApplicationRouter };
