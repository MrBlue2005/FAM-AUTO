const DataManager = require('../app/core/DataManager');
const { LocalAgentRegistry } = require('../app/local-agent/LocalAgentRegistry');
const { LocalAgentCredentials } = require('../app/local-agent/LocalAgentCredentials');
const { HttpAgentTransport } = require('../app/local-agent/HttpAgentTransport');
const { CloudAgentService } = require('../app/local-agent/CloudAgentService');
const { AgentConnectionManager } = require('../app/local-agent/AgentConnectionManager');
const { createCloudFacebookTaskExecutor } = require('../app/local-agent/CloudFacebookTaskExecutor');
const { validateHttpAgentConfig } = require('../app/local-agent/bootstrap');

const agentConfig = validateHttpAgentConfig();
const registry = new LocalAgentRegistry(); const runtimeProfiles = () => DataManager.getRuntimeConfig().facebookProfiles || [];
const agent = registry.load(runtimeProfiles()).agent; const credentials = new LocalAgentCredentials().ensure(agent.agentId);
const transport = new HttpAgentTransport({ baseUrl: agentConfig.cloudUrl, agentId: agent.agentId, agentSecret: credentials.agent_secret, allowInsecureHttp: agentConfig.allowInsecureHttp });
const dryRun = process.env.RX_AGENT_DRY_RUN === 'true';
const executeTask = dryRun
  ? async (task) => {
    if (task.task_type !== 'DRY_RUN') throw Object.assign(new Error('Dry-run agent accepts only DRY_RUN tasks.'), { code: 'UNSUPPORTED_TASK_TYPE' });
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.RX_AGENT_DRY_RUN_DELAY_MS || 0)));
    return { dry_run: true, publishEnabled: false };
  }
  : createCloudFacebookTaskExecutor(registry, runtimeProfiles);
const events = (type, data) => console.log(`RX_AGENT_EVENT:${JSON.stringify({ type, ...data })}`);
const service = new CloudAgentService({ transport, registry, runtimeProfiles, executeTask, intervalMs: Number(process.env.RX_AGENT_HEARTBEAT_INTERVAL_MS || 30000), leaseRenewIntervalMs: Number(process.env.RX_AGENT_LEASE_RENEW_INTERVAL_MS || 30000), connectionManager: new AgentConnectionManager({ transport, metadata: () => { const metadata = registry.getSafeMetadata(runtimeProfiles()); return { ...metadata, agent_status: metadata.status || 'ONLINE', agent_version: require('../package.json').version, active_task_ids: [] }; }, events }), events });
(async () => { if (process.env.RX_AGENT_ENROLLMENT_TOKEN) { await transport.enroll(process.env.RX_AGENT_ENROLLMENT_TOKEN, { agent_id: agent.agentId, display_name: agent.displayName }); delete process.env.RX_AGENT_ENROLLMENT_TOKEN; } if (process.env.RX_AGENT_ONCE === 'true') await service.runOnce(); else service.start(); })().catch((error) => { console.error(`RX_AGENT_ERROR:${JSON.stringify({ code: error.code || 'START_FAILED', message: error.message })}`); process.exitCode = 1; });
