import { useEffect, useRef } from 'react';
import { api } from '../services/api';

function sendNotification(title, body) {
  if (window.Notification?.permission === 'granted' && window.localStorage.getItem('rx-desktop-notifications') === 'true') new Notification(title, { body, icon: '/favicon.svg' });
}

export default function DesktopNotifications() {
  const previousRef = useRef(null);
  useEffect(() => {
    let stopped = false;
    let timer;

    async function check() {
      try {
        const [robot, preflight] = await Promise.all([api.getRobotStatus(), api.getPreflight()]);
        if (stopped) return;
        const previous = previousRef.current;
        if (previous?.robotStatus === 'running' && robot.robotStatus === 'idle') sendNotification('Robot finalizat', robot.lastMessage || 'Rularea s-a incheiat.');
        if (previous?.preflightOk !== false && preflight.ok === false) sendNotification('Preflight blocat', preflight.issues?.[0]?.message || 'Exista probleme care blocheaza pornirea.');
        if (robot.lastError && robot.lastError !== previous?.lastError) sendNotification('Eroare robot', robot.lastError);
        previousRef.current = { robotStatus: robot.robotStatus, preflightOk: preflight.ok, lastError: robot.lastError };
        timer = window.setTimeout(check, robot.robotStatus === 'running' ? 7000 : 30000);
      } catch {
        // Keep polling silently, but avoid a tight retry loop when the API is unavailable.
        if (!stopped) timer = window.setTimeout(check, 30000);
      }
    }
    check();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);
  return null;
}
