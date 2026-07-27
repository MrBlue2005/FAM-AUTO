import {
  ArrowRight,
  Bot,
  Building2,
  FileText,
  LayoutDashboard,
  LogOut,
  Radio,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import AnimatedBrand from '../components/AnimatedBrand';
import { PROPULSE_MOTTO, PROPULSE_NAME } from '../config/brand';
import './AppLauncher.css';

const copywriterUrl = import.meta.env.VITE_COPYWRITER_URL || 'http://127.0.0.1:3100';

const applications = [
  {
    id: 'posting',
    eyebrow: PROPULSE_MOTTO,
    title: PROPULSE_NAME,
    description: 'Pregătește proprietăți, campanii și media, apoi controlează robotul de publicare dintr-un singur loc.',
    href: '/dashboard',
    Icon: Bot,
    accent: 'red',
    features: [
      { Icon: LayoutDashboard, label: 'Dashboard operațional' },
      { Icon: Radio, label: 'Robot și Live Feed' },
      { Icon: Building2, label: 'Proprietăți și campanii' },
    ],
  },
  {
    id: 'copywriter',
    eyebrow: 'Aim for perfection',
    title: 'RX CREATIVE Tool',
    description: 'Analizează un anunț Zonere și transformă datele validate în trei texte distincte, gata de publicat.',
    href: copywriterUrl,
    Icon: FileText,
    accent: 'green',
    features: [
      { Icon: Sparkles, label: '3 variante editoriale' },
      { Icon: ShieldCheck, label: 'Date validate, fără invenții' },
      { Icon: FileText, label: 'Istoric local' },
    ],
  },
];

export default function AppLauncher({ auth }) {
  return (
    <main className="launcher-shell">
      {auth?.authRequired && (
        <button className="launcher-logout" type="button" onClick={auth.logout}>
          <LogOut size={16} /> Deconectare
        </button>
      )}
      <section className="launcher-hero">
        <div className="launcher-brand-mark" aria-hidden="true">
          <span>R</span><i /><span>X</span>
        </div>
        <p className="launcher-kicker">R.X. AI Studio</p>
        <h1>Alege aplicația pe care vrei să o deschizi</h1>
        <p className="launcher-intro">
          Două instrumente separate, aceeași zonă de lucru pentru proprietățile și campaniile tale.
        </p>
      </section>

      <section className="launcher-grid" aria-label="Aplicații disponibile">
        {applications.map(({ id, eyebrow, title, description, href, Icon, accent, features }) => (
          <a className={`launcher-card launcher-card-${accent}`} href={href} key={id}>
            <span className="launcher-card-glow" />
            <header>
              <span className="launcher-app-icon"><Icon size={34} strokeWidth={1.9} /></span>
              <div>
                <p>{eyebrow}</p>
                <h2>{title}</h2>
              </div>
            </header>

            <p className="launcher-description">{description}</p>

            <div className="launcher-features">
              {features.map(({ Icon: FeatureIcon, label }) => (
                <span key={label}><FeatureIcon size={15} />{label}</span>
              ))}
            </div>

            <footer>
              <strong>Deschide aplicația</strong>
              <span><ArrowRight size={20} /></span>
            </footer>
          </a>
        ))}
      </section>

      <footer className="launcher-footer">
        <AnimatedBrand className="launcher-wordmark" />
        <span>Local-first workspace</span>
      </footer>
    </main>
  );
}
