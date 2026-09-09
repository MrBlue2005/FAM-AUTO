'use strict';

// A managed-user UUID in an authenticated session is the sole authority for task ownership.
// Bootstrap ADMIN and legacy environment USER sessions intentionally have no managed identity.
function managedTaskOwnerId(user) {
  if (user?.role !== 'USER' || typeof user.managedUserId !== 'string') return null;
  const value = user.managedUserId.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

function taskWithServerOwner(task, user) {
  return { ...task, owner_user_id: managedTaskOwnerId(user) };
}

module.exports = { managedTaskOwnerId, taskWithServerOwner };
