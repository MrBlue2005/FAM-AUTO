import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock3, Pause, Play, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../services/api';

const weekDays = [
  { value: 1, short: 'Lun', label: 'Luni' },
  { value: 2, short: 'Mar', label: 'Marti' },
  { value: 3, short: 'Mie', label: 'Miercuri' },
  { value: 4, short: 'Joi', label: 'Joi' },
  { value: 5, short: 'Vin', label: 'Vineri' },
  { value: 6, short: 'Sam', label: 'Sambata' },
  { value: 0, short: 'Dum', label: 'Duminica' },
];

function freshForm(config = {}) {
  const profiles = config.facebookProfiles || [];
  const selectedProfile = profiles.find((profile) => profile.id === config.facebookProfileId) || profiles[0];
  const category = profileCategory(selectedProfile);
  return {
    name: '',
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    time: '09:00',
    campaignCategory: category,
    groupListCategory: config.selectedGroupListCategory && config.selectedGroupListCategory !== 'all'
      ? config.selectedGroupListCategory
      : 'Romania',
    campaignIds: [],
    facebookProfileId: selectedProfile?.id || 'main',
    campaignDay: Number(config.campaignDay || 1),
    groupLimit: 1,
    startFromGroup: 1,
    skipGroupsPostedToday: true,
    publishEnabled: false,
    confirmedPublishEnabled: false,
    maxLateMinutes: 10,
  };
}

function profileCategory(profile) {
  const value = `${profile?.category || ''} ${profile?.id || ''} ${profile?.label || ''} ${profile?.profilePath || ''}`.toLowerCase();
  return value.includes('job') || value.includes('munca') || value.includes('cariere') ? 'jobs' : 'real_estate';
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function schedulePayload(schedule) {
  return {
    ...schedule,
    confirmedPublishEnabled: schedule.publishEnabled === true && schedule.liveConfirmed === true,
  };
}

export default function Scheduler() {
  const [schedules, setSchedules] = useState([]);
  const [timezone, setTimezone] = useState('local');
  const [properties, setProperties] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [groups, setGroups] = useState([]);
  const [config, setConfig] = useState({ facebookProfiles: [] });
  const [facebookProfiles, setFacebookProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState('');
  const [robot, setRobot] = useState(null);
  const [form, setForm] = useState(freshForm());
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadData() {
    const [scheduleData, propertyData, jobData, groupData, configData, profileData, robotData] = await Promise.all([
      api.getSchedules(),
      api.getProperties(),
      api.getJobs(),
      api.getGroups(),
      api.getRuntimeConfig(),
      api.getFacebookProfiles(),
      api.getRobotStatus(),
    ]);
    const fetchedProfiles = profileData.profiles || [];
    const mergedConfig = { ...configData, facebookProfiles: fetchedProfiles };
    setSchedules(scheduleData.schedules || []);
    setTimezone(scheduleData.timezone || 'local');
    setProperties(propertyData);
    setJobs(jobData);
    setGroups(groupData);
    setConfig(mergedConfig);
    setFacebookProfiles(fetchedProfiles);
    setProfilesLoading(false);
    setProfilesError('');
    setRobot(robotData);
    if (!editingId && !form.facebookProfileId) setForm(freshForm(mergedConfig));
  }

  useEffect(() => {
    let ignore = false;
    Promise.all([api.getSchedules(), api.getProperties(), api.getJobs(), api.getGroups(), api.getRuntimeConfig(), api.getFacebookProfiles(), api.getRobotStatus()])
      .then(([scheduleData, propertyData, jobData, groupData, configData, profileData, robotData]) => {
        if (ignore) return;
        const fetchedProfiles = profileData.profiles || [];
        const mergedConfig = { ...configData, facebookProfiles: fetchedProfiles };
        setSchedules(scheduleData.schedules || []);
        setTimezone(scheduleData.timezone || 'local');
        setProperties(propertyData);
        setJobs(jobData);
        setGroups(groupData);
        setConfig(mergedConfig);
        setFacebookProfiles(fetchedProfiles);
        setProfilesLoading(false);
        setProfilesError('');
        setRobot(robotData);
        setForm(freshForm(mergedConfig));
      })
      .catch((error) => {
        if (ignore) return;
        setProfilesLoading(false);
        setProfilesError(error.message || 'Profilurile Facebook nu au putut fi incarcate.');
      });
    return () => { ignore = true; };
  }, []);

  const campaigns = form.campaignCategory === 'jobs' ? jobs : properties;
  const profiles = useMemo(() => facebookProfiles.filter(
    (profile) => profileCategory(profile) === form.campaignCategory
  ), [facebookProfiles, form.campaignCategory]);
  const groupListCategories = useMemo(
    () => Array.from(new Set([
      'Romania',
      'Internationale',
      ...groups.map((group) => String(group.groupListCategory || '').trim() || 'Romania'),
    ]))
      .sort((a, b) => a.localeCompare(b, 'ro')),
    [groups]
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function setCategory(category) {
    const firstProfile = facebookProfiles.find((profile) => profileCategory(profile) === category);
    setForm((current) => ({
      ...current,
      campaignCategory: category,
      campaignIds: [],
      facebookProfileId: firstProfile?.id || current.facebookProfileId,
    }));
  }

  function toggleDay(day) {
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((value) => value !== day)
        : [...current.daysOfWeek, day],
    }));
  }

  function toggleCampaign(campaignId) {
    setForm((current) => ({
      ...current,
      campaignIds: current.campaignIds.includes(campaignId)
        ? current.campaignIds.filter((id) => id !== campaignId)
        : [...current.campaignIds, campaignId],
    }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(freshForm(config));
    setMessage('');
  }

  async function saveSchedule() {
    if (!form.name.trim()) return setMessage('Adauga un nume pentru programare.');
    if (!form.daysOfWeek.length) return setMessage('Selecteaza cel putin o zi.');
    if (!form.campaignIds.length) return setMessage('Selecteaza cel putin o campanie.');
    if (form.publishEnabled && !form.confirmedPublishEnabled) {
      return setMessage('Confirma explicit publicarea LIVE inainte de salvare.');
    }

    setSaving(true);
    try {
      if (editingId) await api.updateSchedule(editingId, form);
      else await api.createSchedule(form);
      setMessage(editingId ? 'Programarea a fost actualizata.' : 'Programarea a fost creata.');
      setEditingId(null);
      setForm(freshForm(config));
      await loadData();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  function editSchedule(schedule) {
    setEditingId(schedule.id);
    setForm({
      ...freshForm(config),
      ...schedule,
      confirmedPublishEnabled: schedule.publishEnabled && schedule.liveConfirmed,
    });
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function toggleSchedule(schedule) {
    await api.updateSchedule(schedule.id, { ...schedulePayload(schedule), enabled: !schedule.enabled });
    await loadData();
  }

  async function deleteSchedule(schedule) {
    if (!window.confirm(`Stergi programarea ${schedule.name}?`)) return;
    await api.deleteSchedule(schedule.id);
    if (editingId === schedule.id) resetForm();
    await loadData();
  }

  async function runNow(schedule) {
    if (schedule.publishEnabled && !window.confirm(`Pornesti acum programarea LIVE ${schedule.name}?`)) return;
    const result = await api.runScheduleNow(schedule.id);
    setMessage(result.lastMessage || 'Comanda a fost trimisa.');
    await loadData();
  }

  return (
    <div className="scheduler-page">
      <header className="management-header">
        <div>
          <h1>Programari campanii</h1>
          <p>Executii saptamanale persistente. Fus orar server: {timezone}.</p>
        </div>
        <span className={`status-pill ${['running', 'paused'].includes(robot?.robotStatus) ? 'warning' : 'active'}`}>
          Robot {robot?.robotStatus || 'idle'}
        </span>
      </header>

      <section className="schedule-editor">
        <div className="panel-title-row">
          <div>
            <h2>{editingId ? 'Editeaza programarea' : 'Programare noua'}</h2>
            <p className="muted-text">Rularile intarziate peste toleranta sunt marcate ratate; cele suprapuse sunt sarite.</p>
          </div>
          {editingId && <button className="secondary-button" onClick={resetForm}>Renunta</button>}
        </div>

        <div className="schedule-form-grid">
          <label className="schedule-span-2">Nume programare<input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Ex: Campanii chirii dimineata" /></label>
          <label>Ora<input type="time" value={form.time} onChange={(event) => updateField('time', event.target.value)} /></label>
          <label>Stare<select value={form.enabled ? 'on' : 'off'} onChange={(event) => updateField('enabled', event.target.value === 'on')}><option value="on">Activa</option><option value="off">Pauza</option></select></label>
        </div>

        <div className="schedule-field-group">
          <span>Zilele saptamanii</span>
          <div className="weekday-picker">
            {weekDays.map((day) => <button type="button" className={form.daysOfWeek.includes(day.value) ? 'active' : ''} onClick={() => toggleDay(day.value)} key={day.value} title={day.label}>{day.short}</button>)}
          </div>
        </div>

        <div className="schedule-form-grid">
          <label>Tip campanie<select value={form.campaignCategory} onChange={(event) => setCategory(event.target.value)}><option value="real_estate">Imobiliare</option><option value="jobs">Joburi</option></select></label>
          <label>Profil Facebook<select value={profiles.some((profile) => profile.id === form.facebookProfileId) ? form.facebookProfileId : ''} onChange={(event) => updateField('facebookProfileId', event.target.value)} disabled={profilesLoading || !profiles.length}><option value="" disabled>{profilesLoading ? 'Se incarca profilurile...' : profiles.length ? 'Selecteaza profilul' : 'Niciun profil pentru categorie'}</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.label || profile.id}</option>)}</select>{profilesError && <small className="schedule-field-error">{profilesError}</small>}</label>
          <label>Lista grupuri<select value={form.groupListCategory || 'Romania'} onChange={(event) => updateField('groupListCategory', event.target.value)}>{groupListCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select><small>Nu schimba profilul Facebook.</small></label>
          <label>Ziua postarii<input type="number" min="1" max="31" value={form.campaignDay} onChange={(event) => updateField('campaignDay', Number(event.target.value))} /></label>
          <label>Limita grupuri<select value={form.groupLimit} onChange={(event) => updateField('groupLimit', event.target.value === 'all' ? 'all' : Number(event.target.value))}><option value="1">1 grup</option><option value="5">5 grupuri</option><option value="10">10 grupuri</option><option value="all">Toate</option></select></label>
          <label>Incepe de la grupul<input type="number" min="1" value={form.startFromGroup} onChange={(event) => updateField('startFromGroup', Number(event.target.value))} /></label>
          <label className="schedule-live-confirm"><input type="checkbox" checked={form.skipGroupsPostedToday !== false} onChange={(event) => updateField('skipGroupsPostedToday', event.target.checked)} /><span>Exclude grupurile in care s-a publicat deja astazi.</span></label>
          <label>Toleranta intarziere<input type="number" min="1" max="1440" value={form.maxLateMinutes} onChange={(event) => updateField('maxLateMinutes', Number(event.target.value))} /><small>minute</small></label>
          <label>Mod executie<select value={form.publishEnabled ? 'live' : 'test'} onChange={(event) => setForm((current) => ({ ...current, publishEnabled: event.target.value === 'live', confirmedPublishEnabled: false }))}><option value="test">TEST - doar pregatire</option><option value="live">LIVE - publica pe Facebook</option></select></label>
          {form.publishEnabled && <label className="schedule-live-confirm"><input type="checkbox" checked={form.confirmedPublishEnabled} onChange={(event) => updateField('confirmedPublishEnabled', event.target.checked)} /><span>Confirm explicit ca aceasta programare poate publica automat LIVE.</span></label>}
        </div>

        <div className="schedule-field-group">
          <div className="schedule-campaign-head"><span>Campanii incluse</span><strong>{form.campaignIds.length} selectate</strong></div>
          <div className="schedule-campaign-picker">
            {campaigns.map((campaign) => (
              <label key={campaign.id}>
                <input type="checkbox" checked={form.campaignIds.includes(campaign.id)} onChange={() => toggleCampaign(campaign.id)} />
                <span><strong>{campaign.name || campaign.title || campaign.id}</strong><small>{campaign.id}</small></span>
              </label>
            ))}
            {!campaigns.length && <div className="schedule-empty">Nu exista campanii pentru categoria selectata.</div>}
          </div>
        </div>

        <div className="button-row">
          <button className="primary-button" disabled={saving} onClick={saveSchedule}>{editingId ? <Save size={16} /> : <Plus size={16} />}{saving ? 'Salvez...' : editingId ? 'Salveaza modificarile' : 'Creeaza programarea'}</button>
        </div>
        {message && <p className="save-message">{message}</p>}
      </section>

      <section className="schedule-list-section">
        <div className="panel-title-row"><div><h2>Programari salvate</h2><p className="muted-text">Schedulerul functioneaza cat timp API-ul este pornit.</p></div><strong>{schedules.length}</strong></div>
        <div className="schedule-list">
          {schedules.map((schedule) => (
            <article className={`schedule-card ${schedule.enabled ? '' : 'disabled'}`} key={schedule.id}>
              <div className="schedule-card-main">
                <div className="schedule-card-title"><span className={`schedule-state ${schedule.enabled ? 'active' : ''}`}><CalendarClock size={15} />{schedule.enabled ? 'Activa' : 'Pauza'}</span><h3>{schedule.name}</h3></div>
                <div className="schedule-when"><Clock3 size={16} /><strong>{schedule.time}</strong><span>{weekDays.filter((day) => schedule.daysOfWeek.includes(day.value)).map((day) => day.short).join(', ')}</span></div>
                <p>{schedule.campaignIds.length} campanii / {schedule.groupListCategory || 'Romania'} / Ziua {schedule.campaignDay} / {schedule.groupLimit === 'all' ? 'toate grupurile' : `${schedule.groupLimit} grupuri`} / {schedule.publishEnabled ? 'LIVE' : 'TEST'} / {schedule.skipGroupsPostedToday !== false ? 'fara repetare zilnica' : 'repetare permisa'}</p>
                <div className="schedule-run-meta"><span>Urmatoarea: <strong>{formatDate(schedule.nextRunAt)}</strong></span><span>Ultima: <strong>{schedule.lastStatus === 'never' ? 'niciodata' : `${schedule.lastStatus} / ${formatDate(schedule.lastRunAt)}`}</strong></span></div>
                {schedule.lastMessage && <small className="schedule-last-message">{schedule.lastMessage}</small>}
              </div>
              <div className="schedule-actions">
                <button title="Ruleaza acum" onClick={() => runNow(schedule)}><Play size={16} /></button>
                <button title={schedule.enabled ? 'Pune pe pauza' : 'Activeaza'} onClick={() => toggleSchedule(schedule)}>{schedule.enabled ? <Pause size={16} /> : <Play size={16} />}</button>
                <button className="text-action" onClick={() => editSchedule(schedule)}>Editeaza</button>
                <button className="danger-icon" title="Sterge" onClick={() => deleteSchedule(schedule)}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
          {!schedules.length && <div className="schedule-empty large">Nu exista programari. Creeaza prima programare folosind formularul de mai sus.</div>}
        </div>
      </section>
    </div>
  );
}
