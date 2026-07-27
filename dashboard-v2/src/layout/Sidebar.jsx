import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ChartNoAxesCombined,
  GalleryHorizontalEnd,
  Grid2X2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Radio,
  Settings,
  FileSpreadsheet,
  UsersRound,
} from 'lucide-react';
import { PROPULSE_MOTTO, PROPULSE_NAME } from '../config/brand';

const primaryItems = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'campaigns', label: 'Campanii', Icon: Megaphone },
  { id: 'properties', label: 'Proprietati', Icon: Building2 },
  { id: 'jobs', label: 'Joburi', Icon: BriefcaseBusiness },
  { id: 'groups', label: 'Grupuri', Icon: UsersRound },
  { id: 'media', label: 'Media', Icon: GalleryHorizontalEnd },
  { id: 'queue', label: 'Queue', Icon: ChartNoAxesCombined },
  { id: 'scheduler', label: 'Programari', Icon: CalendarClock },
  { id: 'livefeed', label: 'Live Feed', Icon: Radio },
  { id: 'analytics', label: 'Analytics', Icon: BarChart3 },
  { id: 'reports', label: 'Rapoarte', Icon: FileSpreadsheet },
];

const secondaryItems = [
  { id: 'robot', label: 'Propulse Control', Icon: Bot },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export default function Sidebar({ activePage, auth, onChangePage }) {
  function renderItem(item) {
    const Icon = item.Icon;

    return (
      <button
        key={item.id}
        className={`sidebar-item ${activePage === item.id ? 'active' : ''}`}
        onClick={() => onChangePage(item.id)}
      >
        <span className="sidebar-icon">
          <Icon size={17} strokeWidth={2.35} />
        </span>
        <strong>{item.label}</strong>
      </button>
    );
  }

  return (
    <aside className="sidebar-v2">
      <div className="studio-brand">
        <div className="brand-mark" aria-label="R.X. AI Studio">
          <span className="brand-letter brand-r">R</span>
          <span className="brand-cut brand-cut-main" />
          <span className="brand-dot" />
          <span className="brand-letter brand-x">X</span>
          <span className="brand-cut brand-cut-sub" />
        </div>
        <div className="studio-brand-copy">
          <p>{PROPULSE_MOTTO}</p>
          <h1 className="propulse-sidebar-name">{PROPULSE_NAME}</h1>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button className="sidebar-item" onClick={() => window.location.assign('/')}>
          <span className="sidebar-icon">
            <Grid2X2 size={17} strokeWidth={2.35} />
          </span>
          <strong>Aplicații</strong>
        </button>

        {auth?.authRequired && (
          <button className="sidebar-item" onClick={auth.logout}>
            <span className="sidebar-icon">
              <LogOut size={17} strokeWidth={2.35} />
            </span>
            <strong>Deconectare</strong>
          </button>
        )}
        <div className="sidebar-separator" />

        {primaryItems.map(renderItem)}

        <div className="sidebar-separator" />

        {secondaryItems.map(renderItem)}
      </nav>

      <div className="sidebar-footer">
        <span>{PROPULSE_NAME}</span>
        <strong>{PROPULSE_MOTTO}</strong>
      </div>
    </aside>
  );
}
