const DataManager = require('../app/core/DataManager');
const { LocalAgentRegistry } = require('../app/local-agent/LocalAgentRegistry');
const { LocalAgentCredentials } = require('../app/local-agent/LocalAgentCredentials');
const { HttpAgentTransport } = require('../app/local-agent/HttpAgentTransport');

(async () => {
  if (String(process.env.RX_AGENT_TRANSPORT_MODE || 'LOCAL').toUpperCase() !== 'HTTP') throw new Error('Credential rotation requires RX_AGENT_TRANSPORT_MODE=HTTP.');
  const registry = new LocalAgentRegistry(); const agent = registry.load(DataManager.getRuntimeConfig().facebookProfiles || []).agent;
  const credentials = new LocalAgentCredentials(); const current = credentials.ensure(agent.agentId); const nextSecret = credentials.stageRotation(agent.agentId);
  const transport = new HttpAgentTransport({ baseUrl: process.env.RX_AGENT_CLOUD_URL, agentId: agent.agentId, agentSecret: current.agent_secret, allowInsecureHttp: process.env.RX_AGENT_REFERENCE_ALLOW_HTTP === 'true' });
  await transport.rotateCredential(nextSecret, Number(process.env.RX_AGENT_CREDENTIAL_OVERLAP_SECONDS || 900)); credentials.commitRotation();
  console.log('RX_AGENT_EVENT:{"type":"AGENT_CREDENTIAL_ROTATED"}');
})().catch((error) => { console.error(`RX_AGENT_ERROR:${JSON.stringify({ code: error.code || 'ROTATION_FAILED', message: error.message })}`); process.exitCode = 1; });
