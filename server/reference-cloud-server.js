const express = require('express');
const { ReferenceControlPlane, ProtocolError, PROTOCOL_VERSION } = require('../app/cloud-reference/ReferenceControlPlane');

function bearer(req) {
  const value = String(req.get('authorization') || '');
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function createReferenceCloudApp(options = {}) {
  const plane = options.plane || new ReferenceControlPlane(options);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-RX-Agent-Protocol', String(PROTOCOL_VERSION)); next();
  });
  const fail = (res, error) => res.status(error.status || 500).json({ protocol_version: PROTOCOL_VERSION, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || 'Internal error.' } });
  const auth = (req) => {
    const agentId = req.get('x-rx-agent-id');
    return plane.authenticate(agentId, bearer(req));
  };
  const invoke = (handler) => (req, res) => {
    try { res.json(handler(req, res)); } catch (error) { fail(res, error); }
  };

  app.post('/v1/agents/enroll', invoke((req) => plane.enroll({ ...req.body, agent_secret: bearer(req), enrollment_token: req.get('x-rx-enrollment-token') })));
  app.post('/v1/agent/heartbeat', invoke((req) => { const agent = auth(req); return plane.heartbeat(agent.agent_id, req.body, req.get('x-rx-request-id')); }));
  app.post('/v1/agent/tasks/claim', invoke((req) => { const agent = auth(req); return plane.claim(agent.agent_id, req.body, req.get('x-rx-request-id')); }));
  app.post('/v1/agent/tasks/:taskId/renew', invoke((req) => { const agent = auth(req); return plane.renew(agent.agent_id, req.params.taskId, req.get('x-rx-lease-id'), req.body, req.get('x-rx-request-id')); }));
  app.post('/v1/agent/tasks/:taskId/running', invoke((req) => { const agent = auth(req); return plane.update(agent.agent_id, req.params.taskId, req.get('x-rx-lease-id'), req.body, req.get('x-rx-request-id'), 'RUNNING'); }));
  app.post('/v1/agent/tasks/:taskId/completed', invoke((req) => { const agent = auth(req); return plane.update(agent.agent_id, req.params.taskId, req.get('x-rx-lease-id'), req.body, req.get('x-rx-request-id'), 'COMPLETED'); }));
  app.post('/v1/agent/tasks/:taskId/failed', invoke((req) => { const agent = auth(req); return plane.update(agent.agent_id, req.params.taskId, req.get('x-rx-lease-id'), req.body, req.get('x-rx-request-id'), 'FAILED'); }));
  app.post('/v1/agent/tasks/:taskId/outcome-unknown', invoke((req) => { const agent = auth(req); return plane.update(agent.agent_id, req.params.taskId, req.get('x-rx-lease-id'), req.body, req.get('x-rx-request-id'), 'OUTCOME_UNKNOWN'); }));
  app.post('/v1/agent/tasks/:taskId/cancelled', invoke((req) => { const agent = auth(req); return plane.update(agent.agent_id, req.params.taskId, req.get('x-rx-lease-id'), req.body, req.get('x-rx-request-id'), 'CANCELLED'); }));
  app.get('/v1/agent/tasks/:taskId/cancellation', invoke((req) => { const agent = auth(req); return plane.cancellation(agent.agent_id, req.params.taskId, req.get('x-rx-lease-id')); }));
  app.use((error, req, res, next) => fail(res, error));
  return { app, plane };
}

if (require.main === module) {
  const { app } = createReferenceCloudApp({ filePath: process.env.RX_REFERENCE_CLOUD_DATA, enrollmentToken: process.env.RX_REFERENCE_ENROLLMENT_TOKEN });
  const port = Number(process.env.RX_REFERENCE_CLOUD_PORT || 3400);
  app.listen(port, '127.0.0.1', () => console.log(`RX reference cloud listening on http://127.0.0.1:${port}`));
}

module.exports = { createReferenceCloudApp };
