'use strict';

const ROLES = Object.freeze({ ADMIN: 'ADMIN', USER: 'USER' });
const PERMISSIONS = Object.freeze({ CAMPAIGNS_READ: 'campaigns.read', CAMPAIGNS_WRITE: 'campaigns.write', MEDIA_READ: 'media.read', MEDIA_WRITE: 'media.write', TARGETS_READ: 'targets.read', TARGETS_WRITE: 'targets.write', SCHEDULES_READ: 'schedules.read', SCHEDULES_WRITE: 'schedules.write', DEVICES_READ: 'devices.read', DEVICES_MANAGE: 'devices.manage', USERS_MANAGE: 'users.manage', DIAGNOSTICS_READ: 'diagnostics.read', EXECUTION_PREFLIGHT: 'execution.preflight', EXECUTION_RUN: 'execution.run', REPORTS_READ: 'reports.read' });
const USER_PERMISSIONS = new Set([PERMISSIONS.CAMPAIGNS_READ, PERMISSIONS.CAMPAIGNS_WRITE, PERMISSIONS.MEDIA_READ, PERMISSIONS.MEDIA_WRITE, PERMISSIONS.TARGETS_READ, PERMISSIONS.TARGETS_WRITE, PERMISSIONS.SCHEDULES_READ, PERMISSIONS.SCHEDULES_WRITE]);
function hasPermission(role, permission) { return role === ROLES.ADMIN || (role === ROLES.USER && USER_PERMISSIONS.has(permission)); }
function requirePermission(permission) { return (req, res, next) => hasPermission(req.user?.role, permission) ? next() : res.status(403).json({ error: 'This action requires additional permission.' }); }
module.exports = { ROLES, PERMISSIONS, hasPermission, requirePermission };
