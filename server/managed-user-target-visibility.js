'use strict';

const { managedTaskOwnerId } = require('./task-ownership');

function managedTargetUserId(user) {
  return user?.role === 'USER' ? managedTaskOwnerId(user) : null;
}

async function listVisibleTargets(store, user) {
  if (user?.role === 'ADMIN') return store.listTargets();
  const userId = managedTargetUserId(user);
  if (!userId || typeof store.listTargetsForManagedUser !== 'function') return [];
  return store.listTargetsForManagedUser(userId);
}

module.exports = { managedTargetUserId, listVisibleTargets };
