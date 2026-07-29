import Sidebar from '../layout/Sidebar';
import Topbar from '../layout/Topbar';
import Toolbar from '../layout/Toolbar';
import StatusBar from '../layout/StatusBar';

export default function AppLayout({ activePage, auth, onChangePage, children }) {
  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} auth={auth} onChangePage={onChangePage} />

      <div className="main-shell">
        <Topbar activePage={activePage} onChangePage={onChangePage} />
        <Toolbar activePage={activePage} onChangePage={onChangePage} />

        <main className="page-content">
          <div key={activePage} className="page-transition">
            {children}
          </div>
        </main>

        <StatusBar />
      </div>
    </div>
  );
}
