import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import ProfileStartModal from '../components/ProfileStartModal';

function getCampaignIcon(type) {
  if (type === 'job') return 'JOB';
  return 'IMB';
}

function getCampaignTypeLabel(type) {
  if (type === 'job') return 'Job';
  return 'Imobiliara';
}

export default function Campaigns({ onChangePage, onEditCampaign }) {
  const [properties, setProperties] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [message, setMessage] = useState('');
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [pendingCampaignName, setPendingCampaignName] = useState('');

  async function loadCampaigns() {
    const [propertiesData, jobsData] = await Promise.all([api.getProperties(), api.getJobs()]);
    setProperties(propertiesData);
    setJobs(jobsData);
  }

  useEffect(() => {
    let ignore = false;

    Promise.all([api.getProperties(), api.getJobs()]).then(([propertiesData, jobsData]) => {
      if (ignore) return;
      setProperties(propertiesData);
      setJobs(jobsData);
    });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    function closeActionMenu(event) {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('.menu-wrap')) {
        setOpenMenuId(null);
      }
    }

    function closeActionMenuOnEscape(event) {
      if (event.key === 'Escape') {
        setOpenMenuId(null);
      }
    }

    document.addEventListener('pointerdown', closeActionMenu);
    document.addEventListener('keydown', closeActionMenuOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeActionMenu);
      document.removeEventListener('keydown', closeActionMenuOnEscape);
    };
  }, []);

  const campaigns = useMemo(() => {
    const propertyCampaigns = properties.map((property) => ({
      id: property.id,
      title: property.name,
      type: 'real_estate',
      active: property.active,
      sequenceCount: property.posts?.length || 0,
      raw: property,
    }));

    const jobCampaigns = jobs.map((job) => ({
      id: job.id,
      title: job.title,
      type: 'job',
      active: job.active,
      sequenceCount: job.posts?.length || 0,
      raw: job,
    }));

    return [...propertyCampaigns, ...jobCampaigns];
  }, [properties, jobs]);

  const filteredCampaigns = campaigns.filter((campaign) => {
    const matchesSearch = `${campaign.title} ${campaign.id}`
      .toLowerCase()
      .includes(search.toLowerCase());

    if (!matchesSearch) return false;
    if (typeFilter !== 'all' && campaign.type !== typeFilter) return false;
    if (statusFilter === 'active' && !campaign.active) return false;
    if (statusFilter === 'inactive' && campaign.active) return false;

    return true;
  });

  const activeCount = campaigns.filter((campaign) => campaign.active).length;
  const jobCount = campaigns.filter((campaign) => campaign.type === 'job').length;
  const realEstateCount = campaigns.filter(
    (campaign) => campaign.type === 'real_estate'
  ).length;

  function getCampaignKey(campaign) {
    return `${campaign.type}-${campaign.id}`;
  }

  function getCampaignName(campaign) {
    return campaign.type === 'job' ? campaign.raw.title : campaign.raw.name;
  }

  function getCampaignApi(campaign) {
    if (campaign.type === 'job') {
      return {
        save: api.saveJob,
        delete: api.deleteJob,
        editPage: 'jobs',
        category: 'jobs',
      };
    }

    return {
      save: api.saveProperty,
      delete: api.deleteProperty,
      editPage: 'properties',
      category: 'real_estate',
    };
  }

  function handleNewCampaign() {
    onChangePage?.('properties');
  }

  function handleEditCampaign(campaign) {
    const config = getCampaignApi(campaign);
    setOpenMenuId(null);
    onEditCampaign?.({
      id: campaign.id,
      page: config.editPage,
      type: campaign.type,
    });
  }

  async function handleToggleCampaign(campaign) {
    const config = getCampaignApi(campaign);
    const updatedCampaign = { ...campaign.raw, active: !campaign.active };

    await config.save(updatedCampaign);
    await loadCampaigns();

    setOpenMenuId(null);
    setMessage(
      updatedCampaign.active
        ? `${getCampaignName(campaign)} este activa.`
        : `${getCampaignName(campaign)} este inactiva.`
    );
  }

  async function handleCloneCampaign(campaign) {
    const config = getCampaignApi(campaign);
    const nameField = campaign.type === 'job' ? 'title' : 'name';
    const clonedCampaign = {
      ...campaign.raw,
      id: `${campaign.id}_COPY_${Date.now()}`,
      [nameField]: `${getCampaignName(campaign)} - copie`,
      active: false,
    };

    await config.save(clonedCampaign);
    await loadCampaigns();

    setOpenMenuId(null);
    setMessage(`Campanie clonata: ${clonedCampaign[nameField]}.`);
  }

  function handleExportCampaign(campaign) {
    const blob = new Blob([JSON.stringify(campaign.raw, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${campaign.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setOpenMenuId(null);
  }

  async function handleRunCampaign(campaign) {
    const config = getCampaignApi(campaign);
    const runtimeConfig = await api.getRuntimeConfig();

    await api.saveRuntimeConfig({
      ...runtimeConfig,
      campaignCategory: config.category,
      selectedPropertyIds: [campaign.id],
    });

    setOpenMenuId(null);
    setPendingCampaignName(getCampaignName(campaign));
    setStartModalOpen(true);
  }

  async function handleDeleteCampaign(campaign) {
    const ok = window.confirm(
      `Stergi definitiv campania "${getCampaignName(campaign)}"?\n\nAceasta actiune nu poate fi anulata.`
    );

    if (!ok) return;

    const config = getCampaignApi(campaign);
    await config.delete(campaign.id);
    await loadCampaigns();

    setOpenMenuId(null);
    setMessage(`Campania ${getCampaignName(campaign)} a fost stearsa.`);
  }

  return (
    <div className="campaigns-page">
      <section className="campaigns-header-v2">
        <div>
          <h1>Campanii</h1>
          <p>Toate campaniile imobiliare si de joburi intr-o singura lista.</p>
        </div>

        <button className="primary-button" onClick={handleNewCampaign}>+ Campanie noua</button>
      </section>

      <section className="campaign-stats-grid">
        <div>
          <span>Total campanii</span>
          <strong>{campaigns.length}</strong>
        </div>

        <div>
          <span>Active</span>
          <strong>{activeCount}</strong>
        </div>

        <div>
          <span>Imobiliare</span>
          <strong>{realEstateCount}</strong>
        </div>

        <div>
          <span>Joburi</span>
          <strong>{jobCount}</strong>
        </div>
      </section>

      <section className="campaigns-toolbar-v2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cauta campanie dupa nume sau ID..."
        />

        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">Toate tipurile</option>
          <option value="real_estate">Imobiliare</option>
          <option value="job">Joburi</option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">Toate statusurile</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </section>

      {message && <p className="save-message">{message}</p>}

      <ProfileStartModal
        open={startModalOpen}
        onClose={() => setStartModalOpen(false)}
        onConfirm={async (options) => {
          const result = await api.startRobot(options);
          setStartModalOpen(false);
          setMessage(result.robotStatus === 'running'
            ? `Robot pornit doar pentru ${pendingCampaignName}.`
            : result.lastMessage || 'Pornirea robotului a fost blocata.');
        }}
      />

      <section className="campaign-list-v2">
        {filteredCampaigns.map((campaign) => (
          <div className="campaign-row-v2" key={getCampaignKey(campaign)}>
            <div className="campaign-row-main">
              <div className="campaign-icon">{getCampaignIcon(campaign.type)}</div>

              <div>
                <strong>{campaign.title}</strong>
                <span>{campaign.id}</span>
              </div>
            </div>

            <span className="campaign-type-pill">
              {getCampaignTypeLabel(campaign.type)}
            </span>

            <span className={campaign.active ? 'status-pill active' : 'status-pill inactive'}>
              {campaign.active ? 'Activa' : 'Inactiva'}
            </span>

            <span className="sequence-count">
              {campaign.sequenceCount} secvente
            </span>

            <div className="menu-wrap">
              <button
                className="ghost-button menu-button"
                onClick={() =>
                  setOpenMenuId(openMenuId === getCampaignKey(campaign) ? null : getCampaignKey(campaign))
                }
              >
                More
              </button>

              {openMenuId === getCampaignKey(campaign) && (
                <div className="action-menu">
                  <button onClick={() => handleEditCampaign(campaign)}>Editeaza</button>
                  <button onClick={() => handleToggleCampaign(campaign)}>
                    {campaign.active ? 'Dezactiveaza' : 'Activeaza'}
                  </button>
                  <button onClick={() => handleRunCampaign(campaign)}>Ruleaza doar aceasta</button>
                  <button onClick={() => handleCloneCampaign(campaign)}>Cloneaza</button>
                  <button onClick={() => handleExportCampaign(campaign)}>Export JSON</button>
                  <button className="danger-link" onClick={() => handleDeleteCampaign(campaign)}>
                    Sterge definitiv
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {filteredCampaigns.length === 0 && (
          <div className="empty-state-v2">
            Nu exista campanii care se potrivesc filtrelor.
          </div>
        )}
      </section>
    </div>
  );
}
