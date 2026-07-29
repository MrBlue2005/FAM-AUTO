import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';

function groupTasksByProfile(tasks = []) {
  return tasks.reduce((acc, task) => {
    const profileId = task.facebookProfileId || 'main';

    acc[profileId] = acc[profileId] || {
      id: profileId,
      label: task.facebookProfileLabel || profileId,
      total: 0,
    };

    if (!task.excluded) acc[profileId].total += 1;
    return acc;
  }, {});
}

export default function ProfileStartModal({ open, onClose, onConfirm }) {
  const [config, setConfig] = useState(null);
  const [queuePlan, setQueuePlan] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [liveConfirmed, setLiveConfirmed] = useState(false);

  useEffect(() => {
    let ignore = false;

    if (!open) return undefined;

    Promise.all([api.getRuntimeConfig(), api.getQueuePlan(), api.getPreflight()])
      .then(([configData, planData, preflightData]) => {
        if (ignore) return;

        setConfig(configData);
        setQueuePlan(planData);
        setPreflight(preflightData);
        setSelectedProfileId(configData.facebookProfileId || configData.facebookProfiles?.[0]?.id || 'main');
        setLiveConfirmed(false);
      });

    return () => {
      ignore = true;
    };
  }, [open]);

  const profileTasks = useMemo(
    () => groupTasksByProfile(queuePlan?.tasks || []),
    [queuePlan]
  );

  if (!open) return null;

  const profiles = config?.facebookProfiles || [];
  const loading = !config || !queuePlan || !preflight;
  const liveMode = config?.publishEnabled === true;
  const canStart = Boolean(selectedProfileId) && !loading && preflight?.ok && (!liveMode || liveConfirmed);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="profile-start-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>Verifica profilul Facebook</h2>
            <p>Alege profilul fallback pentru campaniile fara profil dedicat.</p>
          </div>
          <button className="ghost-button small-button" onClick={onClose}>Inchide</button>
        </header>

        {loading ? (
          <div className="empty-state-v2">Incarc profilurile si queue-ul...</div>
        ) : (
          <>
            <label className="modal-field">
              Profil fallback la pornire
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label || profile.id}
                  </option>
                ))}
              </select>
            </label>

            <div className="profile-run-summary">
              <strong>Profiluri care apar in queue</strong>
              {profiles.map((profile) => (
                <div
                  className={profile.id === selectedProfileId ? 'selected' : ''}
                  key={profile.id}
                >
                  <span>{profile.label || profile.id}</span>
                  <small>{profileTasks[profile.id]?.total || 0} taskuri active</small>
                </div>
              ))}
            </div>

            <div className={`validation-alert ${preflight.ok ? 'success' : ''}`}>
              <strong>{preflight.ok ? 'Preflight trecut' : 'Pornire blocata'}</strong>
              <span>
                {preflight.summary.active} taskuri active / {preflight.summary.errors} erori / {preflight.summary.warnings} avertismente
              </span>
            </div>

            {preflight.issues.length > 0 && (
              <div className="profile-run-summary">
                {preflight.issues.slice(0, 8).map((issue, index) => (
                  <div key={`${issue.code}-${index}`}>
                    <span>{issue.level === 'error' ? 'Eroare' : 'Atentie'}</span>
                    <small>{issue.message}</small>
                  </div>
                ))}
              </div>
            )}

            {liveMode && (
              <label className="modal-field">
                <span>
                  <input
                    type="checkbox"
                    checked={liveConfirmed}
                    onChange={(event) => setLiveConfirmed(event.target.checked)}
                  />
                  Confirm ca doresc publicarea LIVE pentru {preflight.summary.active} taskuri.
                </span>
              </label>
            )}

            <div className="button-row">
              <button className="secondary-button" onClick={onClose}>
                Renunta
              </button>
              <button
                className="primary-button"
                disabled={!canStart}
                onClick={() => onConfirm({
                  facebookProfileId: selectedProfileId,
                  confirmedPublishEnabled: liveMode && liveConfirmed,
                })}
              >
                Porneste cu profilul confirmat
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
