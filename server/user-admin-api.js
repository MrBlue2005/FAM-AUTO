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
  return { userId: String(user.user_id), username: String(user.username), role: ROLES.USER, enabled: user.enabled !== false, createdAt: user.created_at || null, updatedAt: user.updated_at || null, lastLoginAt: user.last_login_at || null };
}
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
  router.post('/:userId/reset-password', async (req, res) => {
    const password = validatePassword(req.body?.password); if (!password) return res.status(400).json({ error: 'Provide a valid replacement password.' });
    try { const user = await store.updateManagedUser(req.params.userId, { passwordScrypt: hashPassword(password), invalidateSessions: true }); if (!user) return res.status(404).json({ error: 'User is unavailable.' }); return res.json({ user: safeUser(user) }); } catch { return res.status(400).json({ error: 'Password could not be reset.' }); }
  });
  return router;
}
module.exports = { createUserAdminRouter, normalizeManagedUsername, validateManagedUsername, validatePassword, hashPassword, safeUser };
