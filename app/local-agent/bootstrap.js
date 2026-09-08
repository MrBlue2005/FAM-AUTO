'use strict';

const { ensureStoragePaths } = require('../config/storagePaths');
const { LocalAgentRegistry } = require('./LocalAgentRegistry');
const { LocalAgentCredentials } = require('./LocalAgentCredentials');

function validateHttpAgentConfig(environment = process.env) {
  const transportMode = String(environment.RX_AGENT_TRANSPORT_MODE || '').trim().toUpperCase();
  if (transportMode !== 'HTTP') {
    throw new Error('Set RX_AGENT_TRANSPORT_MODE=HTTP in the private .env before starting the hosted Local Agent.');
  }

  const cloudUrl = String(environment.RX_AGENT_CLOUD_URL || '').trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(cloudUrl);
  } catch {
    throw new Error('Set RX_AGENT_CLOUD_URL to the HTTPS hosted agent-protocol URL in the private .env.');
  }
  const allowInsecureHttp = String(environment.RX_AGENT_REFERENCE_ALLOW_HTTP || 'false').trim().toLowerCase() === 'true';
  if (parsedUrl.protocol !== 'https:' && !(allowInsecureHttp && parsedUrl.protocol === 'http:')) {
    throw new Error('RX_AGENT_CLOUD_URL must use HTTPS. HTTP is permitted only for the explicit local reference backend.');
  }
  return { transportMode, cloudUrl: parsedUrl.toString().replace(/\/$/, ''), allowInsecureHttp };
}

function validateHostedAgentConfig(environment = process.env) {
  const config = validateHttpAgentConfig(environment);
  if (config.allowInsecureHttp || !config.cloudUrl.startsWith('https://')) {
    throw new Error('RX_AGENT_REFERENCE_ALLOW_HTTP must be false for the hosted Local Agent.');
  }
  return config;
}

function bootstrapLocalAgent(options = {}) {
  const environment = options.environment || process.env;
  const validateConfig = options.validateConfig;
  const makeDirectories = options.ensureStoragePaths || ensureStoragePaths;
  const registry = options.registry || new LocalAgentRegistry();
  const credentials = options.credentials || new LocalAgentCredentials();
  const runtimeProfiles = options.runtimeProfiles || [];

  const config = validateConfig ? validateConfig(environment) : null;
  makeDirectories();
  const agent = registry.load(runtimeProfiles).agent;
  const credential = credentials.ensure(agent.agentId);
  if (credential.agent_id !== agent.agentId) {
    throw new Error('Local Agent credential identity does not match the registry.');
  }
  return { agentId: agent.agentId, credentialProtection: credential.protection, config };
}

module.exports = { bootstrapLocalAgent, validateHostedAgentConfig, validateHttpAgentConfig };
