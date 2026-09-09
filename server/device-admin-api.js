'use strict';
const express = require('express');
const { PERMISSIONS } = require('./hosted-rbac');
function createDeviceAdminRouter({ store, env, requirePermission }) {
  const router = express.Router();
  router.use(requirePermission(PERMISSIONS.DEVICES_MANAGE));
  router.patch('/:deviceId', async (req, res) => {
    const displayName = String(req.body?.displayName || '').trim();
    if (!displayName || displayName.length > 80) return res.status(400).json({ error: 'Device display name must contain 1 to 80 characters.' });
    try { const device = await store.renameControlPlaneAgent(req.params.deviceId, displayName); if (!device) return res.status(404).json({ error: 'Device is unavailable.' }); return res.json({ device: { deviceId: device.agent_id, displayName: device.display_name } }); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  });
  router.post('/enrollment-tokens', async (req, res) => {
    const base = String(env.RX_BFF_AGENT_PROTOCOL_URL || '').replace(/\/$/, ''); const token = String(env.RX_BFF_OPERATOR_API_TOKEN || '');
    if (!base || !token) return res.status(503).json({ error: 'Enrollment issuance is not configured.' });
    try { const response = await fetch(`${base}/v1/operator/enrollment-tokens`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rx-operator-token': token }, body: JSON.stringify({ resolver: `admin:${req.user.username}`, ttl_seconds: 900 }) }); const body = await response.json().catch(() => ({})); if (!response.ok || !body.enrollment_token) return res.status(502).json({ error: 'Enrollment token could not be issued.' }); return res.status(201).json({ enrollmentToken: body.enrollment_token, expiresAt: body.expires_at || null }); } catch { return res.status(502).json({ error: 'Enrollment token could not be issued.' }); }
  });
  return router;
}
module.exports = { createDeviceAdminRouter };
