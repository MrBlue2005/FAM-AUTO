import { useEffect, useState } from 'react';
import { LockKeyhole, LoaderCircle } from 'lucide-react';
import { api } from '../services/api';

export default function AuthGate({ children }) {
  const [state, setState] = useState({ loading: true, required: false, authenticated: false, connectionError: '' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAuthStatus().then(({ enabled, authenticated }) => {
      if (enabled && !authenticated) window.localStorage.removeItem('rx-auth-token');
      setState({ loading: false, required: enabled, authenticated: !enabled || authenticated, connectionError: '' });
    }).catch((statusError) => setState({
      loading: false,
      required: true,
      authenticated: false,
      connectionError: statusError.message || 'API-ul nu poate fi contactat.',
    }));
  }, []);

  async function login(event) {
    event.preventDefault(); setError('');
    try {
      const result = await api.login({ username, password });
      window.localStorage.setItem('rx-auth-token', result.token);
      window.localStorage.setItem('rx-auth-role', result.role);
      setState((current) => ({ ...current, authenticated: true }));
    } catch (loginError) { setError(loginError.message); }
  }

  if (state.loading) return <div className="auth-screen"><LoaderCircle className="spin" /></div>;
  if (state.connectionError) return <div className="auth-screen"><div className="auth-card"><span><LockKeyhole size={24} /></span><h1>Conexiune indisponibila</h1><p>{state.connectionError}</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>Reincearca</button></div></div>;
  if (state.required && !state.authenticated) return <div className="auth-screen"><form className="auth-card" onSubmit={login}><span><LockKeyhole size={24} /></span><h1>R.X. AI Studio</h1><p>Autentifica-te pentru a continua.</p><label>Utilizator<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus /></label><label>Parola<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>{error && <p className="media-upload-error">{error}</p>}<button className="primary-button" type="submit">Autentificare</button></form></div>;
  return children;
}
