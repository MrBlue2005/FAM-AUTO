import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, X } from 'lucide-react';

export default function ToastViewport() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handleToast = (event) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-3), { id, ...event.detail }]);
      window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
    };
    window.addEventListener('rx:toast', handleToast);
    return () => window.removeEventListener('rx:toast', handleToast);
  }, []);

  return <div className="toast-viewport" aria-live="polite">{toasts.map((toast) => <div className={`app-toast ${toast.type || 'success'}`} key={toast.id}>{toast.type === 'error' ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} aria-label="Inchide notificarea"><X size={15} /></button></div>)}</div>;
}
