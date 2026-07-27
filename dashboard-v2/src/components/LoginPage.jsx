import { Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import AnimatedBrand from './AnimatedBrand';

export default function LoginPage({ connectionError, error, loading, onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  function submit(event) {
    event.preventDefault();
    onLogin({ username: username.trim(), password });
  }

  return (
    <main className="login-shell">
      <div className="login-backdrop" aria-hidden="true"><i /><i /><i /></div>
      <section className="login-panel" aria-labelledby="login-title">
        <header className="login-brand">
          <span className="login-brand-icon"><LockKeyhole size={25} /></span>
          <div><p>Secure workspace</p><AnimatedBrand className="login-wordmark" /></div>
        </header>

        <div className="login-copy">
          <span className="login-security-pill"><ShieldCheck size={15} /> Sesiune protejată local</span>
          <h1 id="login-title">Bine ai revenit</h1>
          <p>Autentifică-te înainte de a accesa aplicațiile R.X. AI Studio.</p>
        </div>

        {connectionError ? (
          <div className="login-connection-error">
            <strong>Serverul de autentificare nu răspunde</strong>
            <p>{connectionError}</p>
            <button type="button" onClick={() => window.location.reload()}>Reîncearcă</button>
          </div>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <label>
              <span>Utilizator</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required />
            </label>
            <label>
              <span>Parolă</span>
              <div className="login-password-field">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={16} required />
                <button type="button" aria-label={showPassword ? 'Ascunde parola' : 'Arată parola'} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="login-submit" type="submit" disabled={loading || !username.trim() || password.length < 16}>
              {loading ? <><LoaderCircle className="spin" size={18} /> Se verifică…</> : 'Intră în studio'}
            </button>
          </form>
        )}

        <footer><ShieldCheck size={15} /><span>Parola este verificată prin Scrypt și nu este salvată în clar.</span></footer>
      </section>
    </main>
  );
}