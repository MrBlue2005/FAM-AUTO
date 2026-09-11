'use strict';

const { managedTaskOwnerId } = require('./task-ownership');

function managedCampaignUserId(user) {
  return user?.role === 'USER' ? managedTaskOwnerId(user) : null;
}

async function listVisibleCampaigns(store, user, kind) {
  if (user?.role === 'ADMIN') return store.listCampaigns(kind);
  const userId = managedCampaignUserId(user);
  if (!userId || typeof store.listCampaignsForManagedUser !== 'function') return [];
  return store.listCampaignsForManagedUser(userId, kind);
}

async function getVisibleCampaignPreflightSource(store, user, source) {
  if (user?.role === 'ADMIN') return store.getCampaignPreflightSource(source);
  const userId = managedCampaignUserId(user);
  if (!userId || typeof store.getCampaignPreflightSourceForManagedUser !== 'function') return { campaign: null, target: null };
  return store.getCampaignPreflightSourceForManagedUser({ ...source, userId });
}

module.exports = { managedCampaignUserId, listVisibleCampaigns, getVisibleCampaignPreflightSource };
