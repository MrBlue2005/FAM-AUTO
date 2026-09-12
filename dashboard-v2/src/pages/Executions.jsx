import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../services/api";
import {
  EXECUTION_STATUS,
  deviceOptionLabel,
  executionStatusView,
  failureMessage,
  executionTypeLabel,
  sideEffectStateLabel,
  historyCards,
  profilesForDevice,
} from "../services/executionHistory";
import { createLiveConfirmationFlow } from "../services/liveConfirmationFlow";

function date(value) {
  return value
    ? new Intl.DateTimeFormat("ro-RO", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}

function devicesFromTasks(tasks) {
  const devices = new Map();
  for (const task of tasks) {
    if (!task?.deviceId || devices.has(task.deviceId)) continue;
    devices.set(task.deviceId, {
      deviceId: task.deviceId,
      displayName: task.deviceDisplayName || "Dispozitiv necunoscut",
      profiles: [],
    });
  }
  for (const task of tasks) {
    const device = devices.get(task?.deviceId);
    if (
      !device ||
      !task?.profileId ||
      device.profiles.some((profile) => profile.profileId === task.profileId)
    )
      continue;
    device.profiles.push({
      profileId: task.profileId,
      displayName: task.profileDisplayName || "Profil necunoscut",
    });
  }
  return [...devices.values()];
}

export default function Executions({ isAdmin = false, isManagedUser = false, canControlledExecute = false, canLiveExecute = false }) {
  const [devices, setDevices] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [detail, setDetail] = useState(null);
  const [executionTargets, setExecutionTargets] = useState([]);
  const [preflightSources, setPreflightSources] = useState({
    campaigns: [],
    targets: [],
  });
  const [preflight, setPreflight] = useState({
    deviceId: "",
    profileId: "",
    kind: "property",
    campaignId: "",
    day: "",
    targetId: "",
  });
  const [preflightMessage, setPreflightMessage] = useState("");
  const [controlledPending, setControlledPending] = useState(false);
  const [liveConfirmationFlow] = useState(() => createLiveConfirmationFlow());
  const [liveFlow, setLiveFlow] = useState(() => liveConfirmationFlow.snapshot());
  const preflightRef = useRef(preflight);
  const [filters, setFilters] = useState({
    deviceId: "",
    profileId: "",
    status: "ALL",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { deviceId, profileId, status } = filters;
  const profiles = useMemo(
    () => profilesForDevice(devices, filters.deviceId),
    [devices, filters.deviceId],
  );
  const cards = historyCards(tasks, devices);
  const syncLiveFlow = useCallback(() => setLiveFlow(liveConfirmationFlow.snapshot()), [liveConfirmationFlow]);
  const liveConfirm = liveFlow.dialogOpen;
  const livePending = liveFlow.pending;
  const liveIssuing = liveFlow.issuing;
  const updatePreflight = (next) => {
    preflightRef.current = next;
    if (liveConfirmationFlow.invalidateIfIntentChanged(next)) {
      syncLiveFlow();
      setPreflightMessage("Selecția s-a modificat. Deschide din nou publicarea.");
    }
    setPreflight(next);
  };
  const load = async () => {
    setLoading(true);
    try {
      const taskResult = await api.getCloudTasks({ ...filters, limit: 25 });
      const nextTasks = taskResult.tasks || [];
      const deviceResult = isAdmin
        ? await api.getDevices()
        : { devices: devicesFromTasks(nextTasks) };
      setDevices(deviceResult.devices || []);
      setTasks(nextTasks);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Istoricul nu a putut fi încărcat.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let ignore = false;
    api
      .getCloudTasks({ deviceId, profileId, status, limit: 25 })
      .then(async (taskResult) => {
        const nextTasks = taskResult.tasks || [];
        const deviceResult = isAdmin
          ? await api.getDevices()
          : { devices: devicesFromTasks(nextTasks) };
        if (!ignore) {
          setDevices(deviceResult.devices || []);
          setTasks(nextTasks);
          setError("");
        }
      })
      .catch((loadError) => {
        if (!ignore)
          setError(loadError.message || "Istoricul nu a putut fi încărcat.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [deviceId, profileId, status, isAdmin]);
  useEffect(() => {
    if (!isManagedUser) return undefined;
    let ignore = false;
    api
      .getMyExecutionTargets()
      .then((result) => {
        if (!ignore) setExecutionTargets(result.targets || []);
      })
      .catch((loadError) => {
        if (!ignore)
          setPreflightMessage(
            loadError.message || "Țintele autorizate nu au putut fi încărcate.",
          );
      });
    return () => {
      ignore = true;
    };
  }, [isManagedUser]);
  useEffect(() => {
    if (!isManagedUser) return undefined;
    let ignore = false;
    api
      .getCampaignPreflightSources()
      .then((result) => {
        if (!ignore) setPreflightSources(result);
      })
      .catch((loadError) => {
        if (!ignore)
          setPreflightMessage(
            loadError.message ||
              "Sursele de preflight nu au putut fi încărcate.",
          );
      });
    return () => {
      ignore = true;
    };
  }, [isManagedUser]);
  useEffect(() => { preflightRef.current = preflight; }, [preflight]);
  useEffect(() => {
    if (!liveFlow.dialogOpen || liveFlow.expired) return undefined;
    const delay = Math.max(0, Number(liveFlow.expiresAt) * 1000 - Date.now());
    const timer = window.setTimeout(syncLiveFlow, delay);
    return () => window.clearTimeout(timer);
  }, [liveFlow.dialogOpen, liveFlow.expiresAt, liveFlow.expired, syncLiveFlow]);
  async function openDetail(taskId) {
    try {
      setDetail(await api.getCloudTask(taskId));
    } catch (detailError) {
      setError(detailError.message || "Detaliul nu a putut fi încărcat.");
    }
  }
  async function requestPreflight() {
    try {
      const result = await api.createCampaignPreflightTask({
        ...preflight,
        day: Number(preflight.day),
      });
      setPreflightMessage(`Preflight solicitat: ${result.task.status}`);
      await load();
    } catch (requestError) {
      setPreflightMessage(
        requestError.message || "Preflight-ul nu a putut fi solicitat.",
      );
    }
  }
  async function requestControlledExecution() {
    if (controlledPending) return;
    setControlledPending(true);
    try {
      const result = await api.createControlledExecutionTask({ ...preflight, day: Number(preflight.day) });
      setPreflightMessage(`Execuție controlată solicitată: ${result.task.status}`);
      await load();
    } catch (requestError) {
      setPreflightMessage(requestError.message || "Execuția controlată nu a putut fi solicitată.");
    } finally { setControlledPending(false); }
  }
  async function openLiveConfirmation() {
    const outcome = await liveConfirmationFlow.open(preflight, api.issueLiveConfirmation, () => preflightRef.current);
    syncLiveFlow();
    if (outcome.error) setPreflightMessage(outcome.error.message || "Confirmarea nu a putut fi inițiată.");
    else if (outcome.selectionChanged) setPreflightMessage("Selecția s-a modificat. Deschide din nou publicarea.");
  }
  function cancelLiveConfirmation() { liveConfirmationFlow.cancel(); syncLiveFlow(); }
  async function confirmLiveExecution() {
    const outcome = await liveConfirmationFlow.submit(preflightRef.current, api.createLiveCampaignExecutionTask);
    syncLiveFlow();
    if (outcome.expired) { setPreflightMessage("Confirmarea a expirat. Deschide din nou publicarea."); return; }
    if (outcome.selectionChanged) { setPreflightMessage("Selecția s-a modificat. Deschide din nou publicarea."); return; }
    if (outcome.error) { setPreflightMessage(outcome.error.message || "Execuția live nu a putut fi solicitată."); return; }
    if (outcome.result) { setPreflightMessage(`Publicare solicitată: ${outcome.result.task.status}`); await load(); }
  }
  if (!api.isCloudReadOnly()) return null;
  if (!isAdmin && !isManagedUser)
    return (
      <div className="management-page">
        <section className="editor-panel">
          <h1>Acces restricționat</h1>
          <p>
            Istoricul execuțiilor nu este disponibil pentru această sesiune.
          </p>
        </section>
      </div>
    );
  const title = isAdmin ? "Execuții" : "Execuțiile mele";
  const description = isAdmin
    ? "Istoric cloud sigur, multi-dispozitiv. Jurnalele locale detaliate rămân în Local Studio."
    : "Istoric cloud sigur al taskurilor inițiate de tine. Execuția rămâne dezactivată pentru utilizatorii gestionați.";
  const cardValues = [
    ["În rulare", cards.running],
    ["În așteptare", cards.queued],
    ["Finalizate", cards.completed],
    ["Eșuate / verificare", cards.failed],
    ...(isAdmin ? [["Dispozitive online", cards.onlineDevices]] : []),
  ];
  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <span className="hero-eyebrow">HOSTED CONTROL PLANE</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <button className="ghost-button" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> Actualizează
        </button>
      </header>
      <section className="form-grid">
        {cardValues.map(([label, value]) => (
          <article className="editor-panel" key={label}>
            <strong>{value}</strong>
            <p className="muted-text">{label}</p>
          </article>
        ))}
      </section>
      {isManagedUser && (
        <section className="editor-panel">
          <h2>Preflight autorizat</h2>
          <p className="muted-text">
            Alege exclusiv o țintă atribuită de administrator. Publicarea rămâne
            dezactivată.
          </p>
          <div className="form-grid">
            <label>
              Țintă autorizată
              <select
                value={`${preflight.deviceId}|${preflight.profileId}`}
                onChange={(event) => {
                  const target = executionTargets.find(
                    (item) =>
                      `${item.deviceId}|${item.profileId}` ===
                      event.target.value,
                  );
                  updatePreflight({
                    ...preflight,
                    deviceId: target?.deviceId || "",
                    profileId: target?.profileId || "",
                  });
                }}
              >
                <option value="|">Selectează</option>
                {executionTargets.map((target) => (
                  <option
                    key={`${target.deviceId}|${target.profileId}`}
                    value={`${target.deviceId}|${target.profileId}`}
                    disabled={!target.canRequestPreflight}
                  >
                    {target.deviceDisplayName} · {target.profileDisplayName} ·{" "}
                    {target.canRequestPreflight
                      ? "disponibil"
                      : target.online
                        ? "profil indisponibil"
                        : "offline"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tip campanie
              <select
                value={preflight.kind}
                onChange={(event) =>
                  updatePreflight({
                    ...preflight,
                    kind: event.target.value,
                    campaignId: "",
                    day: "",
                    campaignRevision: undefined,
                    postRevision: undefined,
                  })
                }
              >
                <option value="property">Proprietate</option>
                <option value="job">Job</option>
              </select>
            </label>
            <label>
              Campanie
              <select
                value={preflight.campaignId}
                onChange={(event) => {
                  const campaign = preflightSources.campaigns.find(
                    (item) => item.campaignId === event.target.value,
                  );
                  updatePreflight({
                    ...preflight,
                    campaignId: event.target.value,
                    day: String(campaign?.posts?.[0]?.day || ""),
                    campaignRevision: campaign?.revision,
                    postRevision: campaign?.posts?.[0]?.revision,
                  });
                }}
              >
                <option value="">Selectează</option>
                {preflightSources.campaigns
                  .filter((item) => item.kind === preflight.kind)
                  .map((item) => (
                    <option key={item.campaignId} value={item.campaignId}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Zi
              <select
                value={preflight.day}
                onChange={(event) => {
                  const campaign = preflightSources.campaigns.find(
                    (item) => item.campaignId === preflight.campaignId,
                  );
                  const post = campaign?.posts?.find(
                    (item) => Number(item.day) === Number(event.target.value),
                  );
                  updatePreflight({ ...preflight, day: event.target.value, postRevision: post?.revision });
                }}
              >
                <option value="">Selectează</option>
                {(
                  preflightSources.campaigns.find(
                    (item) => item.campaignId === preflight.campaignId,
                  )?.posts || []
                ).map((post) => (
                  <option key={post.day} value={post.day}>
                    Ziua {post.day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Target
              <select
                value={preflight.targetId}
                onChange={(event) =>
                  updatePreflight({ ...preflight, targetId: event.target.value })
                }
              >
                <option value="">Selectează</option>
                {preflightSources.targets.map((target) => (
                  <option key={target.targetId} value={target.targetId}>
                    {target.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="secondary-button"
            disabled={
              !preflight.deviceId ||
              !preflight.profileId ||
              !preflight.campaignId ||
              !preflight.day ||
              !preflight.targetId
            }
            onClick={requestPreflight}
          >
            Rulează preflight
          </button>
          {api.isControlledExecutionEnabled() && canControlledExecute && (
            <><p className="muted-text">Execuție controlată · fără publicare Facebook.</p><button className="secondary-button" disabled={controlledPending || !preflight.deviceId || !preflight.profileId || !preflight.campaignId || !preflight.day || !preflight.targetId || !executionTargets.some((target) => target.deviceId === preflight.deviceId && target.profileId === preflight.profileId && target.canRequestPreflight)} onClick={requestControlledExecution}>Validează execuția</button></>
          )}
          {api.isLiveExecutionEnabled() && canLiveExecute && executionTargets.some((target) => target.deviceId === preflight.deviceId && target.profileId === preflight.profileId && target.canRequestPreflight) && preflight.campaignId && preflight.day && preflight.targetId && (
            <><p className="muted-text">Execuție reală — această acțiune va publica pe Facebook.</p><button className="primary-button" disabled={livePending || liveIssuing || liveConfirm} onClick={openLiveConfirmation}>Publică pe Facebook</button></>
          )}
          {liveConfirm && <section className="editor-panel" role="dialog" aria-label="Confirmă publicarea"><h3>Confirmă publicarea</h3><p>Această acțiune va publica efectiv conținutul pe Facebook.</p><p>Campanie: {liveFlow.intent.campaignId} · Ziua {liveFlow.intent.day} · Target: {liveFlow.intent.targetId}</p><p>Dispozitiv: {liveFlow.intent.deviceId} · Profil: {liveFlow.intent.profileId}</p>{liveFlow.expired && <p className="save-message">Confirmarea a expirat. Deschide din nou publicarea.</p>}<button className="secondary-button" disabled={livePending} onClick={cancelLiveConfirmation}>Renunță</button><button className="primary-button" disabled={livePending || liveFlow.expired} onClick={confirmLiveExecution}>Confirm publicarea</button></section>}
          {preflightMessage && (
            <p className="save-message">{preflightMessage}</p>
          )}
        </section>
      )}
      <section className="editor-panel">
        <div className="form-grid">
          <label>
            Dispozitiv
            <select
              value={filters.deviceId}
              onChange={(event) =>
                setFilters({
                  deviceId: event.target.value,
                  profileId: "",
                  status: filters.status,
                })
              }
            >
              <option value="">Toate dispozitivele</option>
              {devices.map((device) => (
                <option value={device.deviceId} key={device.deviceId}>
                  {deviceOptionLabel(device)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Profil
            <select
              value={filters.profileId}
              disabled={!filters.deviceId}
              onChange={(event) =>
                setFilters({ ...filters, profileId: event.target.value })
              }
            >
              <option value="">Toate profilurile</option>
              {profiles.map((profile) => (
                <option value={profile.profileId} key={profile.profileId}>
                  {profile.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, status: event.target.value })
              }
            >
              {Object.values(EXECUTION_STATUS).map((status) => (
                <option value={status} key={status}>
                  {status === "ALL" ? "Toate stările" : status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {error && (
        <section className="editor-panel">
          <p className="save-message">{error}</p>
        </section>
      )}
      <section className="editor-panel">
        <h2>Taskuri recente</h2>
        {loading ? (
          <p>Se încarcă…</p>
        ) : !tasks.length ? (
          <p className="muted-text">
            Nu există taskuri pentru filtrele selectate.
          </p>
        ) : (
          <div className="schedule-list">
            {tasks.map((task) => {
              const view = executionStatusView(task.status);
              return (
                <button
                  className="schedule-card"
                  key={task.taskId}
                  onClick={() => openDetail(task.taskId)}
                >
                  <div className="schedule-card-main">
                    <div className="schedule-card-title">
                      <span className={`schedule-state ${view.tone}`}>
                        {view.label}
                      </span>
                      <h3>{executionTypeLabel(task.taskType)}</h3>
                      {task.executionRehearsal && <p className="muted-text">Simulare â€” nu s-a publicat pe Facebook</p>}
                      {sideEffectStateLabel(task.sideEffectState) && <p className="muted-text">{sideEffectStateLabel(task.sideEffectState)}</p>}
                    </div>
                    <p>
                      {task.deviceDisplayName} · {task.profileDisplayName} ·
                      Creat: {date(task.createdAt)} · Finalizat:{" "}
                      {date(task.completedAt)}
                    </p>
                    <p>
                      Media: {task.mediaCount} · verificată:{" "}
                      {task.mediaVerified ? "da" : "nu"}
                      {task.outcomeUnknown
                        ? " · verificare manuală necesară"
                        : ""}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {detail && (
        <section className="editor-panel" aria-label="Detaliu task">
          <div className="panel-title-row">
            <div>
              <h2>Detaliu execuție</h2>
              <p className="muted-text">ID: {detail.task.taskId}</p>
            </div>
            <button className="ghost-button" onClick={() => setDetail(null)}>
              Închide
            </button>
          </div>
          <p>
            <strong>{detail.task.deviceDisplayName}</strong> ·{" "}
            {detail.task.profileDisplayName} · încercări: {detail.task.attempt}
          </p>
          <p>
            Media: {detail.task.mediaCount} · verificată:{" "}
            {detail.task.mediaVerified ? "da" : "nu"} · preflight:{" "}
            {detail.task.preflightPassed ? "reușit" : "neconfirmat"}
          </p>
          {detail.task.executionRehearsal && <p className="save-message">Simulare: nu a fost publicat nimic pe Facebook.</p>}
          {failureMessage(detail.task) && (
            <p className="save-message">{failureMessage(detail.task)}</p>
          )}
          {detail.task.taskType === 'LIVE_CAMPAIGN_EXECUTION' && detail.task.status === 'OUTCOME_UNKNOWN' && <p className="save-message">Necesită verificare manuală</p>}
          <ol>
            {(detail.events || []).map((event, index) => (
              <li key={`${event.type}-${index}`}>
                {event.type} · {date(event.occurredAt)}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
