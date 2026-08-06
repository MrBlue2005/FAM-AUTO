import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';

const defaultConfig = {
  campaignDay: 1,
  groupLimit: 1,
  startFromGroup: 1,
  publishEnabled: false,
  selectedPropertyIds: [],
  campaignCategory: 'real_estate',
  facebookProfileId: 'main',
  facebookProfiles: [
    {
      id: 'main',
      label: 'Profil principal',
      profilePath: 'chrome-profile',
      category: 'real_estate',
      useSavedLoginIdentity: true,
    },
    {
      id: 'jobs',
      label: 'Profil joburi',
      profilePath: 'chrome-profile-jobs',
      category: 'jobs',
      useSavedLoginIdentity: true,
    },
    {
      id: 'cherry_park_corbeanca',
      label: 'Cherry Park Corbeanca',
      profilePath: 'chrome-profile-cherry-park-corbeanca',
      category: 'real_estate',
      useSavedLoginIdentity: true,
    },
  ],
  postingIdentityByCategory: {},
  postingIdentityByProfile: {},
  facebookPostingIdentities: [],
};

function getCampaignTitle(item) {
  return item.name || item.title || item.id;
}

function getCampaignProfileLabel(campaign, config) {
  const profileId = campaign?.facebookProfileId || config.facebookProfileId;
  const profile = (config.facebookProfiles || []).find((item) => item.id === profileId);

  return profile?.label || profileId || 'Profil default';
}

function getProfileCategory(profile) {
  const text = [profile?.category, profile?.id, profile?.label, profile?.profilePath]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (text.includes('job') || text.includes('munca') || text.includes('cariere')) return 'jobs';
  return 'real_estate';
}

function getActiveCategory(config) {
  const selectedProfile = (config.facebookProfiles || []).find(
    (profile) => profile.id === config.facebookProfileId
  );

  return getProfileCategory(selectedProfile) || config.campaignCategory || 'real_estate';
}

function findProfileIdForCategory(config, category) {
  const profile = (config.facebookProfiles || []).find(
    (item) => getProfileCategory(item) === category
  );

  return profile?.id || config.facebookProfileId || 'main';
}

function campaignMatchesActiveProfile(campaign, config, activeCategory) {
  const activeProfileId = config.facebookProfileId || 'main';
  const explicitProfileId = campaign.facebookProfileId || campaign.postingProfileId || '';

  if (explicitProfileId) {
    return explicitProfileId === activeProfileId;
  }

  return activeProfileId === findProfileIdForCategory(config, activeCategory);
}

function getMediaPath(preview) {
  const firstMedia = preview?.media?.[0];

  if (typeof firstMedia === 'string') return firstMedia;
  return preview?.imagePath || firstMedia?.path || '';
}

function isVideoMedia(mediaPath) {
  return /\.(mp4|mov|quicktime)$/i.test(mediaPath || '');
}

function isRunning(status) {
  return status === 'running' || status === 'paused';
}

export default function Queue({ onChangePage }) {
  const [config, setConfig] = useState(defaultConfig);
  const [properties, setProperties] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [groups, setGroups] = useState([]);
  const [queuePlan, setQueuePlan] = useState({ tasks: [], activeTasks: [], summary: {} });
  const [preview, setPreview] = useState(null);
  const [validations, setValidations] = useState(null);
  const [robot, setRobot] = useState(null);
  const [message, setMessage] = useState('');
  const pollingFast = isRunning(robot?.robotStatus || 'idle');

  async function loadQueue() {
    const [configData, propertiesData, jobsData, groupsData, planData, validationData, robotData] =
      await Promise.all([
        api.getRuntimeConfig(),
        api.getProperties(),
        api.getJobs(),
        api.getGroups(),
        api.getQueuePlan(),
        api.getValidations(),
        api.getRobotStatus(),
      ]);

    setConfig({ ...defaultConfig, ...configData });
    setProperties(propertiesData);
    setJobs(jobsData);
    setGroups(groupsData);
    setQueuePlan(planData);

    setValidations(validationData);
    setRobot(robotData);

    const activeCategory = getActiveCategory(configData);
    const firstCampaign = (activeCategory === 'jobs' ? jobsData : propertiesData).find(
      (item) => item.active && campaignMatchesActiveProfile(item, configData, activeCategory)
    );

    if (!firstCampaign) {
      setPreview(null);
      return;
    }

    const previewData = await api.getCampaignPreview({
      category: activeCategory,
      campaignId: firstCampaign.id,
      day: configData.campaignDay,
    });
    setPreview(previewData);
  }

  useEffect(() => {
    let ignore = false;

    Promise.all([
      api.getRuntimeConfig(),
      api.getProperties(),
      api.getJobs(),
      api.getGroups(),
      api.getQueuePlan(),
      api.getValidations(),
      api.getRobotStatus(),
    ]).then(async ([configData, propertiesData, jobsData, groupsData, planData, validationData, robotData]) => {
      if (ignore) return;

      setConfig({ ...defaultConfig, ...configData });
      setProperties(propertiesData);
      setJobs(jobsData);
      setGroups(groupsData);
      setQueuePlan(planData);
      setValidations(validationData);
      setRobot(robotData);

      const activeCategory = getActiveCategory(configData);
      const firstCampaign = (activeCategory === 'jobs' ? jobsData : propertiesData).find(
        (item) => item.active && campaignMatchesActiveProfile(item, configData, activeCategory)
      );

      if (!firstCampaign) {
        if (!ignore) setPreview(null);
        return;
      }

      const previewData = await api.getCampaignPreview({
        category: activeCategory,
        campaignId: firstCampaign.id,
        day: configData.campaignDay,
      });

      if (!ignore) setPreview(previewData);
    });

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;

      api.getRobotStatus().then((robotData) => {
        if (!ignore) setRobot(robotData);
      });
    }, pollingFast ? 1500 : 6000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [pollingFast]);

  const activeCategory = getActiveCategory(config);
  const robotStatus = robot?.robotStatus || 'idle';
  const running = isRunning(robotStatus);
  const activeCampaigns = activeCategory === 'jobs'
    ? jobs.filter((item) => item.active).length
    : properties.filter((item) => item.active).length;
  const activeGroups = groups.filter(
    (group) => group.active && (group.category || 'real_estate') === activeCategory
  ).length;
  const postingIdentityId =
    config.postingIdentityByProfile?.[config.facebookProfileId] ||
    config.postingIdentityByCategory?.[activeCategory] || 'default';
  const postingIdentity = (config.facebookPostingIdentities || []).find(
    (identity) => identity.id === postingIdentityId
  );
  const categoryCampaigns = useMemo(
    () =>
      (activeCategory === 'jobs' ? jobs : properties).filter((item) =>
        campaignMatchesActiveProfile(item, config, activeCategory)
      ),
    [activeCategory, config, jobs, properties]
  );
  const activeQueueCampaigns = useMemo(
    () => categoryCampaigns.filter((item) => item.active),
    [categoryCampaigns]
  );
  const selectedCampaignIds = config.selectedPropertyIds || [];
  const mediaPath = getMediaPath(preview);
  const mediaPreviewUrl = api.getMediaUrl(mediaPath);
  const hasBlockingIssues = (validations?.summary?.error || 0) > 0;

  async function saveConfigChange(updates, successMessage = 'Queue actualizat.') {
    const updatedConfig = { ...config, ...updates };
    const saved = await api.saveRuntimeConfig(updatedConfig);
    setConfig({ ...defaultConfig, ...saved });
    setMessage(successMessage);
    await loadQueue();
  }

  async function saveField(field, value) {
    await saveConfigChange({ [field]: value });
  }

  async function saveCampaignCategory(category) {
    await saveConfigChange({
      campaignCategory: category,
      facebookProfileId: findProfileIdForCategory(config, category),
      selectedPropertyIds: [],
      queueExcludedTaskIds: [],
      queueRetryTaskIds: [],
      queueOrder: [],
    }, 'Tipul campaniei a fost schimbat si queue-ul a fost recalculat.');
  }

  async function saveFacebookProfile(profileId) {
    const profile = (config.facebookProfiles || []).find((item) => item.id === profileId);
    const category = getProfileCategory(profile);

    await saveConfigChange({
      facebookProfileId: profileId,
      campaignCategory: category,
      selectedPropertyIds: [],
      queueExcludedTaskIds: [],
      queueRetryTaskIds: [],
      queueOrder: [],
    }, 'Profilul activ a fost schimbat si queue-ul a fost recalculat.');
  }

  async function savePostingIdentity(identityId) {
    const categoryDefaultProfileId = findProfileIdForCategory(config, activeCategory);
    const profileSpecific = config.facebookProfileId && config.facebookProfileId !== categoryDefaultProfileId;

    await saveConfigChange(
      profileSpecific
        ? {
            postingIdentityByProfile: {
              ...(config.postingIdentityByProfile || {}),
              [config.facebookProfileId]: identityId,
            },
          }
        : {
            postingIdentityByCategory: {
              ...(config.postingIdentityByCategory || {}),
              [activeCategory]: identityId,
            },
          },
      'Pagina de postare a fost salvata.'
    );
  }

  async function toggleCampaign(campaignId) {
    const currentSelected = selectedCampaignIds.length
      ? selectedCampaignIds
      : activeQueueCampaigns.map((campaign) => campaign.id);

    const nextSelected = currentSelected.includes(campaignId)
      ? currentSelected.filter((item) => item !== campaignId)
      : [...currentSelected, campaignId];

    await saveConfigChange({
      selectedPropertyIds: nextSelected,
      queueExcludedTaskIds: [],
      queueRetryTaskIds: [],
      queueOrder: [],
    }, 'Selectia de campanii a fost actualizata.');
  }

  async function clearCampaignSelection() {
    await saveConfigChange({
      selectedPropertyIds: [],
      queueExcludedTaskIds: [],
      queueRetryTaskIds: [],
      queueOrder: [],
    }, 'Queue-ul va rula toate campaniile active.');
  }

  async function toggleExcluded(task) {
    const plan = await api.excludeQueueTask({ taskId: task.id, excluded: !task.excluded });
    setQueuePlan(plan);
  }

  async function toggleRetry(task) {
    const plan = await api.retryQueueTask({ taskId: task.id, retry: !task.retry });
    setQueuePlan(plan);
  }

  async function moveTask(taskId, direction) {
    const taskIds = queuePlan.tasks.map((task) => task.id);
    const index = taskIds.indexOf(taskId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= taskIds.length) return;

    const reordered = [...taskIds];
    const [item] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, item);

    const plan = await api.reorderQueue(reordered);
    setQueuePlan(plan);
  }

  async function loadPreview(campaignId) {
    if (!campaignId) return;

    const previewData = await api.getCampaignPreview({
      category: activeCategory,
      campaignId,
      day: config.campaignDay,
    });
    setPreview(previewData);
  }

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Queue Manager</h1>
          <p>Coadata reala calculata din campanii, grupuri si runtime config.</p>
        </div>

        <button
          className={`danger-button ${running ? 'control-active-danger' : ''}`}
          disabled={!running}
          onClick={async () => {
            const result = await api.stopRobot();
            setRobot(result);
            setMessage('Robot oprit.');
          }}
        >
          Stop
        </button>
      </header>

      <section className="summary-grid">
        <div>Taskuri active: <strong>{queuePlan.summary?.active || 0}</strong></div>
        <div>Scoase: <strong>{queuePlan.summary?.excluded || 0}</strong></div>
        <div>Retry: <strong>{queuePlan.summary?.retry || 0}</strong></div>
        <div>Campanii active: <strong>{activeCampaigns}</strong></div>
        <div>Grupuri active: <strong>{activeGroups}</strong></div>
        <div>Pagina: <strong>{postingIdentity?.label || postingIdentityId}</strong></div>
      </section>

      {hasBlockingIssues && (
        <section className="validation-alert">
          <div>
            <strong>Validari rosii detectate</strong>
            <span>Rezolva problemele inainte sa pornesti robotul.</span>
          </div>
          <button className='secondary-button' type='button' onClick={() => onChangePage?.('diagnostics')}>
            Interpreteaza erorile
          </button>
        </section>
      )}

      <section className="editor-panel">
        <h2>Setari queue</h2>

        <div className="form-grid">
          <label>
            Tip campanie
            <select
              value={activeCategory}
              onChange={(event) => saveCampaignCategory(event.target.value)}
            >
              <option value="real_estate">Imobiliare</option>
              <option value="jobs">Joburi</option>
            </select>
          </label>

          <label>
            Profil browser
            <select
              value={config.facebookProfileId || 'main'}
              onChange={(event) => saveFacebookProfile(event.target.value)}
            >
              {(config.facebookProfiles || []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label || profile.id}
                </option>
              ))}
            </select>
          </label>

          <label>
            Pagina de postare
            <select
              value={postingIdentityId}
              onChange={(event) => savePostingIdentity(event.target.value)}
            >
              {(config.facebookPostingIdentities || []).map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.label || identity.id}
                </option>
              ))}
            </select>
          </label>

          <label>
            Ziua campaniei
            <input
              type="number"
              min="1"
              value={config.campaignDay}
              onChange={(event) => saveField('campaignDay', Number(event.target.value))}
            />
          </label>

          <label>
            Cate grupuri
            <select
              value={config.groupLimit}
              onChange={(event) => saveField('groupLimit', event.target.value)}
            >
              <option value={1}>1 grup</option>
              <option value={5}>5 grupuri</option>
              <option value={10}>10 grupuri</option>
              <option value="all">Toate grupurile</option>
            </select>
          </label>

          <label>
            Incepe de la grupul
            <input
              type="number"
              min="1"
              value={config.startFromGroup}
              onChange={(event) => saveField('startFromGroup', Number(event.target.value))}
            />
          </label>

          <label>
            Publicare
            <select
              value={config.publishEnabled ? 'on' : 'off'}
              onChange={(event) => saveField('publishEnabled', event.target.value === 'on')}
            >
              <option value="off">OFF - doar pregateste</option>
              <option value="on">ON - posteaza live</option>
            </select>
          </label>

          <label>
            Preview campanie
            <select
              value={preview?.campaignId || ''}
              onChange={(event) => loadPreview(event.target.value)}
            >
              <option value="">Alege campanie...</option>
              {categoryCampaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {getCampaignTitle(campaign)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {message && <p className="save-message">{message}</p>}
      </section>

      <section className="editor-panel">
        <div className="panel-title-row">
          <h2>Campanii in queue</h2>
          <button className="secondary-button" onClick={clearCampaignSelection}>
            Ruleaza toate activele
          </button>
        </div>

        <div className="settings-campaign-list">
          {activeQueueCampaigns.map((campaign) => (
            <label className="settings-campaign-row" key={campaign.id}>
              <input
                type="checkbox"
                checked={selectedCampaignIds.length === 0 || selectedCampaignIds.includes(campaign.id)}
                onChange={() => toggleCampaign(campaign.id)}
              />
              <div>
                <strong>{getCampaignTitle(campaign)}</strong>
                <span>{campaign.id} · {getCampaignProfileLabel(campaign, config)}</span>
              </div>
              <span className="status-pill active">Activ</span>
            </label>
          ))}

          {activeQueueCampaigns.length === 0 && (
            <div className="empty-state-v2">Nu exista campanii active pentru categoria curenta.</div>
          )}
        </div>
      </section>

      <section className="editor-panel post-preview-panel">
        <div className="panel-title-row">
          <h2>Preview postare</h2>
          <span className="status-pill active">Ziua {preview?.day || config.campaignDay}</span>
        </div>

        <div className="post-preview-grid">
          <div>
            <strong>{preview?.campaignTitle || 'Alege o campanie'}</strong>
            {preview?.facebookProfileLabel && (
              <span className="preview-meta">Profil: {preview.facebookProfileLabel}</span>
            )}
            {preview?.postingIdentityLabel && (
              <span className="preview-meta">Pagina: {preview.postingIdentityLabel}</span>
            )}
            <p>{preview?.text || 'Nu exista text pentru preview.'}</p>
          </div>

          <div className="post-preview-media">
            <span>Media</span>
            {mediaPreviewUrl && isVideoMedia(mediaPath) && (
              <video src={mediaPreviewUrl} controls />
            )}
            {mediaPreviewUrl && !isVideoMedia(mediaPath) && (
              <img src={mediaPreviewUrl} alt="Preview media postare" />
            )}
            <strong>{mediaPath || 'Fara media'}</strong>
          </div>
        </div>

        {(preview?.warnings || []).length > 0 && (
          <div className="preview-warnings">
            {preview.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}
      </section>

      <section className="queue-list-v2">
        {queuePlan.tasks.map((task, index) => (
          <article className={`queue-row-v2 ${task.excluded || task.status === 'done' ? 'muted-row' : ''}`} key={task.id}>
            <span>#{index + 1}</span>
            <div>
              <strong>{task.campaignTitle}</strong>
              <small>
                {task.campaignId} · {task.facebookProfileLabel || 'Profil default'} · {task.postingIdentityLabel || 'Pagina default'}
              </small>
            </div>
            <div>
              <strong>{task.groupName}</strong>
              <small>{task.groupId}</small>
            </div>
            <span>Ziua {task.day}</span>
            <span className={task.excluded || task.status === 'done' ? 'status-pill inactive' : 'status-pill active'}>
              {task.excluded ? 'Scos' : task.retry ? 'Retry' : task.status === 'done' ? 'Finalizat' : task.mode}
            </span>
            <div className="queue-actions">
              <button className="secondary-button small-button" onClick={() => moveTask(task.id, -1)}>
                Sus
              </button>
              <button className="secondary-button small-button" onClick={() => moveTask(task.id, 1)}>
                Jos
              </button>
              <button className="secondary-button small-button" onClick={() => toggleRetry(task)}>
                {task.retry ? 'Unretry' : 'Retry'}
              </button>
              <button className="danger-button small-button" onClick={() => toggleExcluded(task)}>
                {task.excluded ? 'Adauga' : 'Scoate'}
              </button>
            </div>
          </article>
        ))}

        {queuePlan.tasks.length === 0 && (
          <div className="empty-state-v2">Queue-ul este gol. Verifica activele si grupurile active.</div>
        )}
      </section>

    </div>
  );
}
