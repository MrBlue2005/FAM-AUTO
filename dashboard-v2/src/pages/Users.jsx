import { useEffect, useState } from "react";
import { api } from "../services/api";
import {
  credentialCopyText,
  generateStrongPassword,
} from "../services/userCredentialHandoff";

function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("ro-RO", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Niciodată";
}

function HostedUsers() {
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [targets, setTargets] = useState({});
  const [selection, setSelection] = useState({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ username: "", password: "", confirm: "" });
  const [resetId, setResetId] = useState(null);
  const [reset, setReset] = useState({ password: "", confirm: "" });
  const [handoff, setHandoff] = useState(null);
  const [handoffMessage, setHandoffMessage] = useState("");
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showHandoffPassword, setShowHandoffPassword] = useState(false);
  async function load() {
    try {
      const [result, deviceResult] = await Promise.all([
        api.getManagedUsers(),
        api.getDevices(),
      ]);
      const nextUsers = result.users || [];
      const nextTargets = Object.fromEntries(
        await Promise.all(
          nextUsers.map(async (user) => [
            user.userId,
            (await api.getManagedUserExecutionTargets(user.userId)).targets ||
              [],
          ]),
        ),
      );
      setUsers(nextUsers);
      setDevices(deviceResult.devices || []);
      setTargets(nextTargets);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Utilizatorii nu au putut fi încărcați.");
    }
  }
  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) return load();
    });
    return () => {
      ignore = true;
    };
  }, []);
  function generateCreatePassword() {
    const password = generateStrongPassword();
    setForm({ ...form, password, confirm: password });
    setShowCreatePassword(true);
  }
  function generateResetPassword() {
    const password = generateStrongPassword();
    setReset({ password, confirm: password });
    setShowResetPassword(true);
  }
  async function copy(value) {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setHandoffMessage("Copiat");
    } catch {
      setHandoffMessage("Copierea nu a reușit.");
    }
  }
  function dismissHandoff() {
    setHandoff(null);
    setHandoffMessage("");
    setShowHandoffPassword(false);
  }
  async function create() {
    if (form.password !== form.confirm)
      return setMessage("Parolele nu corespund.");
    const password = form.password;
    try {
      const result = await api.createManagedUser({
        username: form.username,
        password,
      });
      setForm({ username: "", password: "", confirm: "" });
      setHandoff({ username: result.user.username, password });
      setShowHandoffPassword(false);
      setHandoffMessage("");
      setMessage("Utilizator creat.");
      await load();
    } catch (createError) {
      setMessage(createError.message || "Utilizatorul nu a putut fi creat.");
    }
  }
  async function toggle(user) {
    try {
      await api.updateManagedUser(user.userId, { enabled: !user.enabled });
      setMessage(
        user.enabled
          ? "Utilizator dezactivat; sesiunile existente au fost invalidate."
          : "Utilizator activat.",
      );
      await load();
    } catch (updateError) {
      setMessage(
        updateError.message || "Utilizatorul nu a putut fi actualizat.",
      );
    }
  }
  async function toggleControlledExecution(user) {
    try {
      await api.updateManagedUserControlledExecutionPolicy(user.userId, { controlledExecutionEnabled: !user.controlledExecutionEnabled });
      setMessage(user.controlledExecutionEnabled ? 'Execuția controlată a fost dezactivată.' : 'Execuția controlată a fost activată. Fără publicare Facebook.');
      await load();
    } catch (updateError) {
      setMessage(updateError.message || 'Politica nu a putut fi actualizată.');
    }
  }
  async function resetPassword(userId) {
    if (reset.password !== reset.confirm)
      return setMessage("Parolele nu corespund.");
    const password = reset.password;
    try {
      const result = await api.resetManagedUserPassword(userId, { password });
      setResetId(null);
      setReset({ password: "", confirm: "" });
      setHandoff({ username: result.user.username, password });
      setShowHandoffPassword(false);
      setHandoffMessage("");
      setMessage("Parolă resetată; sesiunile existente au fost invalidate.");
      await load();
    } catch (resetError) {
      setMessage(resetError.message || "Parola nu a putut fi resetată.");
    }
  }
  async function assign(userId) {
    const value = selection[userId] || {};
    if (!value.deviceId || !value.profileId) return;
    try {
      await api.createManagedUserExecutionTarget(userId, value);
      setMessage("Accesul de execuție a fost atribuit.");
      await load();
    } catch (assignError) {
      setMessage(assignError.message || "Accesul nu a putut fi atribuit.");
    }
  }
  async function setTarget(userId, assignmentId, enabled) {
    try {
      await api.updateManagedUserExecutionTarget(userId, assignmentId, {
        enabled,
      });
      await load();
    } catch (targetError) {
      setMessage(targetError.message || "Accesul nu a putut fi actualizat.");
    }
  }
  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <span className="hero-eyebrow">HOSTED ADMIN</span>
          <h1>Utilizatori</h1>
          <p>
            Conturi USER cloud-managed. Administratorul bootstrap rămâne
            configurat server-side.
          </p>
        </div>
      </header>
      <section className="editor-panel">
        <h2>Adaugă utilizator</h2>
        <div className="button-row">
          <input
            placeholder="username"
            value={form.username}
            onChange={(event) =>
              setForm({ ...form, username: event.target.value })
            }
          />
          <input
            type={showCreatePassword ? "text" : "password"}
            placeholder="parolă"
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
          />
          <button
            className="ghost-button"
            onClick={() => setShowCreatePassword(!showCreatePassword)}
          >
            {showCreatePassword ? "Ascunde parola" : "Arată parola"}
          </button>
          <button className="secondary-button" onClick={generateCreatePassword}>
            Generează
          </button>
          <input
            type={showCreatePassword ? "text" : "password"}
            placeholder="confirmă parola"
            value={form.confirm}
            onChange={(event) =>
              setForm({ ...form, confirm: event.target.value })
            }
          />
          <button className="primary-button" onClick={create}>
            Adaugă utilizator
          </button>
        </div>
        <p className="muted-text">
          Rol fix: USER. Parola nu este afișată sau păstrată după creare.
        </p>
      </section>
      {error && (
        <section className="editor-panel">
          <p className="save-message">{error}</p>
        </section>
      )}
      {message && (
        <section className="editor-panel">
          <p className="save-message">{message}</p>
        </section>
      )}
      {handoff && (
        <section className="editor-panel">
          <div className="panel-title-row">
            <div>
              <h2>Date de acces — afișate o singură dată</h2>
              <p className="muted-text">
                Salvează parola acum. După închiderea acestei ferestre parola nu
                mai poate fi afișată din nou. Serverul stochează doar hash-ul
                Scrypt.
              </p>
            </div>
            <button className="ghost-button" onClick={dismissHandoff}>
              Închide și șterge
            </button>
          </div>
          <p>
            Username: <code>{handoff.username}</code>
          </p>
          <p>
            Parolă:{" "}
            <code>
              {showHandoffPassword ? handoff.password : "••••••••••••••••••••"}
            </code>{" "}
            <button
              className="ghost-button"
              onClick={() => setShowHandoffPassword(!showHandoffPassword)}
            >
              {showHandoffPassword ? "Ascunde parola" : "Arată parola"}
            </button>
          </p>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={() => copy(handoff.username)}
            >
              Copiază username
            </button>
            <button
              className="secondary-button"
              onClick={() => copy(handoff.password)}
            >
              Copiază parola
            </button>
            <button
              className="secondary-button"
              onClick={() => copy(credentialCopyText(handoff))}
            >
              Copiază datele
            </button>
          </div>
          {handoffMessage && <p className="muted-text">{handoffMessage}</p>}
        </section>
      )}
      {users.map((user) => {
        const selected = selection[user.userId] || {};
        const profiles =
          devices.find((device) => device.deviceId === selected.deviceId)
            ?.profiles || [];
        return (
          <section className="editor-panel" key={user.userId}>
            <div className="panel-title-row">
              <div>
                <h2>{user.username}</h2>
                <p className="muted-text">
                  USER · creat: {formatDate(user.createdAt)} · ultima
                  autentificare: {formatDate(user.lastLoginAt)}
                </p>
              </div>
              <span
                className={`status-pill ${user.enabled ? "active" : "inactive"}`}
              >
                {user.enabled ? "ACTIV" : "DEZACTIVAT"}
              </span>
            </div>
            <div className="button-row">
              <button className="secondary-button" onClick={() => toggle(user)}>
                {user.enabled ? "Dezactivează" : "Activează"}
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setResetId(user.userId);
                  setReset({ password: "", confirm: "" });
                }}
              >
                Resetează parola
              </button>
            </div>
            <h3>Execuție controlată</h3>
            <p className="muted-text">{user.controlledExecutionEnabled ? 'Activată · fără publicare Facebook.' : 'Dezactivată'}</p>
            <button className="secondary-button" onClick={() => toggleControlledExecution(user)}>
              {user.controlledExecutionEnabled ? 'Dezactivează execuția controlată' : 'Activează execuția controlată'}
            </button>
            <h3>Acces execuție</h3>
            <p className="muted-text">
              Autorizarea nu implică disponibilitate; preflight-ul rămâne fără
              publicare.
            </p>
            {(targets[user.userId] || []).map((target) => (
              <p key={target.assignmentId}>
                {target.deviceDisplayName} · {target.profileDisplayName} ·{" "}
                {target.enabled ? "activ" : "dezactivat"}{" "}
                <button
                  className="ghost-button"
                  onClick={() =>
                    setTarget(user.userId, target.assignmentId, !target.enabled)
                  }
                >
                  {target.enabled ? "Revocă" : "Reactivează"}
                </button>
              </p>
            ))}
            <div className="button-row">
              <select
                value={selected.deviceId || ""}
                onChange={(event) =>
                  setSelection({
                    ...selection,
                    [user.userId]: {
                      deviceId: event.target.value,
                      profileId: "",
                    },
                  })
                }
              >
                <option value="">Dispozitiv</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.displayName}
                  </option>
                ))}
              </select>
              <select
                value={selected.profileId || ""}
                disabled={!selected.deviceId}
                onChange={(event) =>
                  setSelection({
                    ...selection,
                    [user.userId]: {
                      ...selected,
                      profileId: event.target.value,
                    },
                  })
                }
              >
                <option value="">Profil</option>
                {profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.displayName}
                  </option>
                ))}
              </select>
              <button
                className="secondary-button"
                onClick={() => assign(user.userId)}
              >
                Atribuie
              </button>
            </div>
            {resetId === user.userId && (
              <div className="button-row">
                <input
                  type={showResetPassword ? "text" : "password"}
                  placeholder="parolă nouă"
                  value={reset.password}
                  onChange={(event) =>
                    setReset({ ...reset, password: event.target.value })
                  }
                />
                <button
                  className="ghost-button"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                >
                  {showResetPassword ? "Ascunde parola" : "Arată parola"}
                </button>
                <button
                  className="secondary-button"
                  onClick={generateResetPassword}
                >
                  Generează
                </button>
                <input
                  type={showResetPassword ? "text" : "password"}
                  placeholder="confirmă parola"
                  value={reset.confirm}
                  onChange={(event) =>
                    setReset({ ...reset, confirm: event.target.value })
                  }
                />
                <button
                  className="primary-button"
                  onClick={() => resetPassword(user.userId)}
                >
                  Salvează parola
                </button>
              </div>
            )}
          </section>
        );
      })}
      {!error && users.length === 0 && (
        <section className="empty-state-v2">
          <strong>Niciun utilizator USER</strong>
          <span>Adaugă un cont cloud-managed; ștergerea este deferred.</span>
        </section>
      )}
    </div>
  );
}
export default function Users({ isAdmin = false }) {
  if (!api.isCloudReadOnly()) return null;
  if (!isAdmin)
    return (
      <div className="management-page">
        <section className="editor-panel">
          <h1>Acces restricționat</h1>
          <p>Utilizatorii sunt disponibili numai administratorilor.</p>
        </section>
      </div>
    );
  return <HostedUsers />;
}
