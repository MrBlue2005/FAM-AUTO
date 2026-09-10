'use strict';

const crypto = require('crypto');
const express = require('express');
const { PERMISSIONS, ROLES } = require('./hosted-rbac');

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const RESERVED_USERNAMES = new Set(['admin', 'root', 'system', 'operator']);
function normalizeManagedUsername(value) { return String(value || '').trim().toLowerCase(); }
function validateManagedUsername(value, reserved = []) {
  const username = normalizeManagedUsername(value);
  if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(username) || reserved.map(normalizeManagedUsername).includes(username)) return null;
  return username;
}
function validatePassword(value) { const password = String(value || ''); return password.length >= 12 && password.length <= 256 ? password : null; }
function hashPassword(password) {
  const salt = crypto.randomBytes(16); const options = { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
  const derived = crypto.scryptSync(password, salt, 64, options);
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}
function safeUser(user) {
  return { userId: String(user.user_id), username: String(user.username), role: ROLES.USER, enabled: user.enabled !== false, controlledExecutionEnabled: user.controlled_execution_enabled === true, liveExecutionEnabled: user.live_execution_enabled === true, createdAt: user.created_at || null, updatedAt: user.updated_at || null, lastLoginAt: user.last_login_at || null };
}
function safeAssignment(row, agent, profile) { return { assignmentId: String(row.assignment_id), deviceId: String(row.device_id), deviceDisplayName: String(agent?.display_name || 'Dispozitiv indisponibil'), profileId: String(row.profile_id), profileDisplayName: String(profile?.display_name || 'Profil indisponibil'), enabled: row.enabled !== false, createdAt: row.created_at || null, updatedAt: row.updated_at || null }; }
function createUserAdminRouter({ store, env, requirePermission }) {
  const router = express.Router(); router.use(requirePermission(PERMISSIONS.USERS_MANAGE));
  const reserved = [env.ADMIN_USERNAME || 'admin', env.USER_USERNAME || ''];
  router.get('/', async (_req, res) => { try { res.json({ users: (await store.listManagedUsers()).map(safeUser) }); } catch { res.status(503).json({ error: 'User management is unavailable.' }); } });
  router.post('/', async (req, res) => {
    const username = validateManagedUsername(req.body?.username, reserved); const password = validatePassword(req.body?.password);
    if (!username || !password || req.body?.role && req.body.role !== ROLES.USER) return res.status(400).json({ error: 'Provide a valid USER username and password.' });
    try { const existing = await store.getManagedUserByUsername(username); if (existing) return res.status(409).json({ error: 'Username is unavailable.' }); const user = await store.createManagedUser({ username, passwordScrypt: hashPassword(password) }); return res.status(201).json({ user: safeUser(user) }); } catch (error) { return res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'Username is unavailable.' : 'User could not be created.' }); }
  });
  router.patch('/:userId', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean.' });
    try { const user = await store.updateManagedUser(req.params.userId, { enabled: req.body.enabled, invalidateSessions: true }); if (!user) return res.status(404).json({ error: 'User is unavailable.' }); return res.json({ user: safeUser(user) }); } catch { return res.status(400).json({ error: 'User could not be updated.' }); }
  });
  router.patch('/:userId/controlled-execution-policy', async (req, res) => {
    if (typeof req.body?.controlledExecutionEnabled !== 'boolean') return res.status(400).json({ error: 'controlledExecutionEnabled must be boolean.' });
    try { const user = await store.updateManagedUser(req.params.userId, { controlledExecutionEnabled: req.body.controlledExecutionEnabled }); if (!user) return res.status(404).json({ error: 'User is unavailable.' }); return res.json({ user: safeUser(user) }); } catch { return res.status(400).json({ error: 'Controlled execution policy could not be updated.' }); }
  });
  router.post('/:userId/reset-password', async (req, res) => {
    const password = validatePassword(req.body?.password); if (!password) return res.status(400).json({ error: 'Provide a valid replacement password.' });
    try { const user = await store.updateManagedUser(req.params.userId, { passwordScrypt: hashPassword(password), invalidateSessions: true }); if (!user) return res.status(404).json({ error: 'User is unavailable.' }); return res.json({ user: safeUser(user) }); } catch { return res.status(400).json({ error: 'Password could not be reset.' }); }
  });
  router.get('/:userId/execution-targets', async (req, res) => {
    try { const [user, rows, agents, profiles] = await Promise.all([store.getManagedUserById(req.params.userId), store.listManagedUserExecutionTargets(req.params.userId), store.listControlPlaneAgents(), store.listControlPlaneProfiles()]); if (!user) return res.status(404).json({ error: 'User is unavailable.' }); const agentById = new Map(agents.map((agent) => [agent.agent_id, agent])); const profileById = new Map(profiles.map((profile) => [profile.profile_id, profile])); return res.json({ targets: rows.map((row) => safeAssignment(row, agentById.get(row.device_id), profileById.get(row.profile_id))) }); } catch { return res.status(503).json({ error: 'Execution target management is unavailable.' }); }
  });
  router.post('/:userId/execution-targets', async (req, res) => {
    const deviceId = String(req.body?.deviceId || '').trim(); const profileId = String(req.body?.profileId || '').trim();
    try { const [user, agent, profile] = await Promise.all([store.getManagedUserById(req.params.userId), store.getControlPlaneAgent(deviceId), store.getControlPlaneProfile(profileId)]); if (!user) return res.status(404).json({ error: 'User is unavailable.' }); if (!agent) return res.status(400).json({ error: 'Device is unavailable.' }); if (!profile) return res.status(400).json({ error: 'Profile is unavailable.' }); if (profile.agent_id !== deviceId) return res.status(400).json({ error: 'Profile does not belong to the selected device.' }); const row = await store.createManagedUserExecutionTarget({ userId: user.user_id, deviceId, profileId }); return res.status(201).json({ target: safeAssignment(row, agent, profile) }); } catch (error) { return res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'Execution target is already assigned.' : 'Execution target could not be assigned.' }); }
  });
  router.patch('/:userId/execution-targets/:assignmentId', async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean.' });
    try { const rows = await store.listManagedUserExecutionTargets(req.params.userId); if (!rows.some((row) => row.assignment_id === req.params.assignmentId)) return res.status(404).json({ error: 'Execution target is unavailable.' }); const row = await store.updateManagedUserExecutionTarget(req.params.assignmentId, { enabled: req.body.enabled }); return res.json({ target: { assignmentId: String(row.assignment_id), enabled: row.enabled !== false } }); } catch { return res.status(400).json({ error: 'Execution target could not be updated.' }); }
  });
  return router;
}
module.exports = { createUserAdminRouter, normalizeManagedUsername, validateManagedUsername, validatePassword, hashPassword, safeUser };
