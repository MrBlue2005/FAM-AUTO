import { useEffect, useRef } from 'react';
import { api } from '../services/api';

function sendNotification(title, body) {
  if (window.Notification?.permission === 'granted' && window.localStorage.getItem('rx-desktop-notifications') === 'true') new Notification(title, { body, icon: '/favicon.svg' });
}

export default function DesktopNotifications() {
  const previousRef = useRef(null);
  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const [robot, preflight] = await Promise.all([api.getRobotStatus(), api.getPreflight()]);
        if (stopped) return;
        const previous = previousRef.current;
        if (previous?.robotStatus === 'running' && robot.robotStatus === 'idle') sendNotification('Robot finalizat', robot.lastMessage || 'Rularea s-a incheiat.');
        if (previous?.preflightOk !== false && preflight.ok === false) sendNotification('Preflight blocat', preflight.issues?.[0]?.message || 'Exista probleme care blocheaza pornirea.');
        if (robot.lastError && robot.lastError !== previous?.lastError) sendNotification('Eroare robot', robot.lastError);
        previousRef.current = { robotStatus: robot.robotStatus, preflightOk: preflight.ok, lastError: robot.lastError };
      } catch { /* status polling remains silent */ }
    }
    check(); const interval = window.setInterval(check, 7000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, []);
  return null;
}
