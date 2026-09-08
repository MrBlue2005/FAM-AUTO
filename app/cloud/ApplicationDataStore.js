'use strict';

// Compatibility seam only. DataManager and server/server.js remain unchanged in Phase 4B-A.
class ApplicationDataStore {
  async listCampaigns() { throw new Error('ApplicationDataStore.listCampaigns is not implemented'); }
  async saveCampaign(_campaign) { throw new Error('ApplicationDataStore.saveCampaign is not implemented'); }
  async listPosts(_campaignId) { throw new Error('ApplicationDataStore.listPosts is not implemented'); }
  async savePost(_post) { throw new Error('ApplicationDataStore.savePost is not implemented'); }
  async listTargets() { throw new Error('ApplicationDataStore.listTargets is not implemented'); }
  async saveTarget(_target) { throw new Error('ApplicationDataStore.saveTarget is not implemented'); }
  async listCampaignFolders() { throw new Error('ApplicationDataStore.listCampaignFolders is not implemented'); }
  async saveCampaignFolder(_folder) { throw new Error('ApplicationDataStore.saveCampaignFolder is not implemented'); }
  async listScheduleFolders() { throw new Error('ApplicationDataStore.listScheduleFolders is not implemented'); }
  async saveScheduleFolder(_folder) { throw new Error('ApplicationDataStore.saveScheduleFolder is not implemented'); }
  async listSchedules() { throw new Error('ApplicationDataStore.listSchedules is not implemented'); }
  async saveSchedule(_schedule) { throw new Error('ApplicationDataStore.saveSchedule is not implemented'); }
  async findMediaByHash(_sha256) { throw new Error('ApplicationDataStore.findMediaByHash is not implemented'); }
  async saveMediaMetadata(_media) { throw new Error('ApplicationDataStore.saveMediaMetadata is not implemented'); }
  async setPostMedia(_relation) { throw new Error('ApplicationDataStore.setPostMedia is not implemented'); }
  async createExecutionRun(_run) { throw new Error('ApplicationDataStore.createExecutionRun is not implemented'); }
  async recordPostingResult(_result) { throw new Error('ApplicationDataStore.recordPostingResult is not implemented'); }
}
module.exports = { ApplicationDataStore };
