import { useCallback, useState } from 'react';
import AppLayout from './AppLayout';

import Dashboard from '../pages/Dashboard';
import Campaigns from '../pages/Campaigns';
import Properties from '../pages/Properties';
import Jobs from '../pages/Jobs';
import Groups from '../pages/Groups';
import Media from '../pages/Media';
import Queue from '../pages/Queue';
import LiveFeed from '../pages/LiveFeed';
import Analytics from '../pages/Analytics';
import Reports from '../pages/Reports';
import Scheduler from '../pages/Scheduler';
import Robot from '../pages/Robot';
import Settings from '../pages/Settings';
import DesktopOverlay from '../pages/DesktopOverlay';
import ToastViewport from '../components/ToastViewport';
import AuthGate from '../components/AuthGate';
import DesktopNotifications from '../components/DesktopNotifications';

function DashboardApp() {
  const [activePage, setActivePage] = useState('dashboard');
  const [editRequest, setEditRequest] = useState(null);
  const [dirtyEditor, setDirtyEditor] = useState(false);

  const clearEditRequest = useCallback(() => {
    setEditRequest(null);
  }, []);

  function handleChangePage(page) {
    if (page !== activePage && dirtyEditor) {
      const leave = window.confirm('Ai modificari nesalvate. Draftul este pastrat automat. Parasesti pagina?');
      if (!leave) return;
      setDirtyEditor(false);
    }
    setActivePage(page);
  }

  function handleCampaignEdit(request) {
    setEditRequest(request);
    setActivePage(request.page);
  }

  function renderPage() {
    if (activePage === 'campaigns') {
      return <Campaigns onChangePage={handleChangePage} onEditCampaign={handleCampaignEdit} />;
    }
    if (activePage === 'properties') {
      return (
        <Properties
          editRequest={editRequest?.page === 'properties' ? editRequest : null}
          onEditHandled={clearEditRequest}
          onDirtyChange={setDirtyEditor}
          onChangePage={handleChangePage}
        />
      );
    }
    if (activePage === 'jobs') {
      return (
        <Jobs
          editRequest={editRequest?.page === 'jobs' ? editRequest : null}
          onEditHandled={clearEditRequest}
          onDirtyChange={setDirtyEditor}
          onChangePage={handleChangePage}
        />
      );
    }
    if (activePage === 'groups') return <Groups />;
    if (activePage === 'media') return <Media />;
    if (activePage === 'queue') return <Queue />;
    if (activePage === 'livefeed') return <LiveFeed />;
    if (activePage === 'analytics') return <Analytics />;
    if (activePage === 'reports') return <Reports onChangePage={handleChangePage} />;
    if (activePage === 'scheduler') return <Scheduler />;
    if (activePage === 'robot') return <Robot />;
    if (activePage === 'settings') return <Settings />;

    return <Dashboard onChangePage={handleChangePage} />;
  }

  return (
    <>
      <AuthGate><AppLayout activePage={activePage} onChangePage={handleChangePage}>{renderPage()}</AppLayout></AuthGate>
      <ToastViewport />
      <DesktopNotifications />
    </>
  );
}

export default function App() {
  if (window.location.pathname === '/overlay') {
    return <DesktopOverlay />;
  }

  return <DashboardApp />;
}
