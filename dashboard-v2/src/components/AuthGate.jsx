import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from '../services/api';
import LoginPage from './LoginPage';

const copywriterOrigin = new URL(import.meta.env.VITE_COPYWRITER_URL || 'http://127.0.0.1:3100').origin;

function trustedReturnUrl() {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return [window.location.origin, copywriterOrigin].includes(url.origin) ? url.href : '';
  } catch {
    return '';
  }
}

export default function AuthGate({ children }) {
  const [state, setState] = useState({ loading: true, required: true, authenticated: false, user: null, connectionError: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAuthStatus().then(({ enabled, authenticated, username, role }) => {
      setState({ loading: false, required: enabled, authenticated: !enabled || authenticated, user: username ? { username, role } : null, connectionError: '' });
    }).catch((statusError) => setState({
      loading: false,
      required: true,
      authenticated: false,
      user: null,
      connectionError: statusError.message || 'API-ul nu poate fi contactat.',
    }));
  }, []);

  async function login(credentials) {
    setSubmitting(true);
    setError('');
    try {
await api.login(credentials);
      const verified = await api.getAuthStatus();
      if (verified.enabled && !verified.authenticated) {
        throw new Error('Browserul nu a păstrat sesiunea. Deschide studioul pe http://127.0.0.1:5173.');
      }
      setState((current) => ({
        ...current,
        authenticated: !verified.enabled || verified.authenticated,
        user: verified.username ? { username: verified.username, role: verified.role } : null,
      }));
      const returnUrl = trustedReturnUrl();
      if (returnUrl) window.location.assign(returnUrl);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try { await api.logout(); } catch { /* The local state must still be cleared. */ }
    setState((current) => ({ ...current, authenticated: false, user: null }));
    window.location.assign('/');
  }

  if (state.loading) return <div className="auth-screen"><LoaderCircle className="spin" /></div>;
  if (state.required && !state.authenticated) {
    return <LoginPage connectionError={state.connectionError} error={error} loading={submitting} onLogin={login} />;
  }

  const auth = { authRequired: state.required, logout, user: state.user };
  return typeof children === 'function' ? children(auth) : children;
}
