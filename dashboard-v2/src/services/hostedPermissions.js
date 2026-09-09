export const hostedPermissions = Object.freeze({ devicesRead: 'devices.read', executionPreflight: 'execution.preflight' });
export function canHostedPermission(role, permission) { return role === 'ADMIN' && Boolean(permission); }
