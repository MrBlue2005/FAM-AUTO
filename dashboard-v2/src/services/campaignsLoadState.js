export const CAMPAIGN_LOAD_STATUS = Object.freeze({
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
});

// Campaigns is an aggregate view: rendering a partial aggregate would make
// folders and category counts misleading. Treat every required read as atomic.
export async function loadCampaignsData(apiClient) {
  const [properties, jobs, folders] = await Promise.all([
    apiClient.getProperties(),
    apiClient.getJobs(),
    apiClient.getCampaignFolders(),
  ]);

  if (!Array.isArray(properties) || !Array.isArray(jobs) || !Array.isArray(folders)) {
    throw new Error('Campaign read response is incomplete.');
  }

  return { properties, jobs, folders };
}

export async function loadCampaignsState(apiClient) {
  try {
    return { status: CAMPAIGN_LOAD_STATUS.SUCCESS, data: await loadCampaignsData(apiClient) };
  } catch {
    return { status: CAMPAIGN_LOAD_STATUS.ERROR, data: null };
  }
}

export function buildCampaignRows(properties, jobs) {
  return [
    ...properties.map((property) => ({
      id: property.id,
      title: property.name,
      type: 'real_estate',
      active: property.active,
      sequenceCount: property.posts?.length || 0,
      raw: property,
    })),
    ...jobs.map((job) => ({
      id: job.id,
      title: job.title,
      type: 'job',
      active: job.active,
      sequenceCount: job.posts?.length || 0,
      raw: job,
    })),
  ];
}

export function filterCampaignRows(campaigns, { search, typeFilter, statusFilter, folderFilter }) {
  return campaigns.filter((campaign) => {
    const matchesSearch = `${campaign.title} ${campaign.id}`
      .toLowerCase()
      .includes(search.toLowerCase());

    if (!matchesSearch) return false;
    if (typeFilter !== 'all' && campaign.type !== typeFilter) return false;
    if (statusFilter === 'active' && !campaign.active) return false;
    if (statusFilter === 'inactive' && campaign.active) return false;
    if (folderFilter === 'none' && campaign.raw.folderId) return false;
    if (folderFilter !== 'all' && folderFilter !== 'none' && campaign.raw.folderId !== folderFilter) return false;
    return true;
  });
}
