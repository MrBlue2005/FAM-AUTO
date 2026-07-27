import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App/App';
import './styles/global.css';

const canonicalHost = import.meta.env.VITE_CANONICAL_HOST || '127.0.0.1';
if (['localhost', '::1'].includes(window.location.hostname) && window.location.hostname !== canonicalHost) {
  const canonicalUrl = new URL(window.location.href);
  canonicalUrl.hostname = canonicalHost;
  window.location.replace(canonicalUrl);
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
