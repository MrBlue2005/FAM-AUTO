'use strict';

// Compatibility seam only. DataManager and server/server.js remain unchanged in Phase 4B-A.
class ApplicationDataStore {
  async listCampaigns() { throw new Error('ApplicationDataStore.listCampaigns is not implemented'); }
  async getCampaignPreflightSource(_selection) { throw new Error('ApplicationDataStore.getCampaignPreflightSource is not implemented'); }
  async getActiveControlPlaneTaskForProfile(_profileId) { throw new Error('ApplicationDataStore.getActiveControlPlaneTaskForProfile is not implemented'); }
  async listControlPlaneTasks(_filters) { throw new Error('ApplicationDataStore.listControlPlaneTasks is not implemented'); }
  async getControlPlaneTaskHistory(_taskId) { throw new Error('ApplicationDataStore.getControlPlaneTaskHistory is not implemented'); }
  async saveCampaign(_campaign) { throw new Error('ApplicationDataStore.saveCampaign is not implemented'); }
  async listPosts(_campaignId) { throw new Error('ApplicationDataStore.listPosts is not implemented'); }
  async savePost(_post) { throw new Error('ApplicationDataStore.savePost is not implemented'); }
  async listTargets() { throw new Error('ApplicationDataStore.listTargets is not implemented'); }
  async saveTarget(_target) { throw new Error('ApplicationDataStore.saveTarget is not implemented'); }
  async deleteTarget(_target) { throw new Error('ApplicationDataStore.deleteTarget is not implemented'); }
  async targetHasReferences(_target) { throw new Error('ApplicationDataStore.targetHasReferences is not implemented'); }
  async listCampaignFolders() { throw new Error('ApplicationDataStore.listCampaignFolders is not implemented'); }
  async saveCampaignFolder(_folder) { throw new Error('ApplicationDataStore.saveCampaignFolder is not implemented'); }
  async updateCampaignFolder(_folder) { throw new Error('ApplicationDataStore.updateCampaignFolder is not implemented'); }
  async deleteCampaignFolder(_folder) { throw new Error('ApplicationDataStore.deleteCampaignFolder is not implemented'); }
  async listScheduleFolders() { throw new Error('ApplicationDataStore.listScheduleFolders is not implemented'); }
  async saveScheduleFolder(_folder) { throw new Error('ApplicationDataStore.saveScheduleFolder is not implemented'); }
  async updateScheduleFolder(_folder) { throw new Error('ApplicationDataStore.updateScheduleFolder is not implemented'); }
  async deleteScheduleFolder(_folder) { throw new Error('ApplicationDataStore.deleteScheduleFolder is not implemented'); }
  async listSchedules() { throw new Error('ApplicationDataStore.listSchedules is not implemented'); }
  async listMedia() { throw new Error('ApplicationDataStore.listMedia is not implemented'); }
  async saveSchedule(_schedule) { throw new Error('ApplicationDataStore.saveSchedule is not implemented'); }
  async deleteCampaign(_campaign) { throw new Error('ApplicationDataStore.deleteCampaign is not implemented'); }
  async deleteSchedule(_schedule) { throw new Error('ApplicationDataStore.deleteSchedule is not implemented'); }
  async findMediaByHash(_sha256) { throw new Error('ApplicationDataStore.findMediaByHash is not implemented'); }
  async saveMediaMetadata(_media) { throw new Error('ApplicationDataStore.saveMediaMetadata is not implemented'); }
  async setPostMedia(_relation) { throw new Error('ApplicationDataStore.setPostMedia is not implemented'); }
  async createExecutionRun(_run) { throw new Error('ApplicationDataStore.createExecutionRun is not implemented'); }
  async recordPostingResult(_result) { throw new Error('ApplicationDataStore.recordPostingResult is not implemented'); }
  async listManagedUsers() { throw new Error('ApplicationDataStore.listManagedUsers is not implemented'); }
  async getManagedUserByUsername(_username) { throw new Error('ApplicationDataStore.getManagedUserByUsername is not implemented'); }
  async getManagedUserById(_userId) { throw new Error('ApplicationDataStore.getManagedUserById is not implemented'); }
  async createManagedUser(_user) { throw new Error('ApplicationDataStore.createManagedUser is not implemented'); }
  async updateManagedUser(_userId, _change) { throw new Error('ApplicationDataStore.updateManagedUser is not implemented'); }
  async recordManagedUserLogin(_userId) { throw new Error('ApplicationDataStore.recordManagedUserLogin is not implemented'); }
}
module.exports = { ApplicationDataStore };
