'use strict';
const express = require('express');
function createCloudApplicationRouter(store) {
  const router = express.Router(); const send = (res, promise) => Promise.resolve(promise).then((data) => res.json(data)).catch((error) => res.status(error.status || 400).json({ error: error.message }));
  router.get('/properties', (req, res) => send(res, store.listCampaigns('property'))); router.get('/jobs', (req, res) => send(res, store.listCampaigns('job')));
  router.get('/groups', (req, res) => send(res, store.listTargets())); router.get('/campaign-folders', (req, res) => send(res, store.listCampaignFolders())); router.get('/schedule-folders', (req, res) => send(res, store.listScheduleFolders())); router.get('/schedules', (req, res) => send(res, store.listSchedules()));
  router.post('/media/initiate', (req, res) => send(res, store.initiateMedia({ ...req.body, requestId: req.get('x-rx-request-id') })));
  router.post('/media/:mediaId/finalize', (req, res) => send(res, store.finalizeMedia({ mediaId: req.params.mediaId, requestId: req.get('x-rx-request-id') })));
  router.get('/media/:mediaId/preview', (req, res) => send(res, store.createPreview(req.params.mediaId)));
  return router;
}
module.exports = { createCloudApplicationRouter };
