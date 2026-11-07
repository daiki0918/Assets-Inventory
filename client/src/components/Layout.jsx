import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ScanOverlay from './ScanOverlay';

const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  alerts: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  assets: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></>,
  transfers: <><path d="M7 7h14l-4-4" /><path d="m17 17H3l4 4" /><path d="M21 7 17 3" /><path d="m3 17 4 4" /></>,
  maintenance: <><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 12l-3-3 3.7-2.7Z" /><path d="m16 5 3-3 3 3-3 3" /></>,
  inventory: <><path d="M4 5V3h2" /><path d="M20 5V3h-2" /><path d="M4 19v2h2" /><path d="M20 19v2h-2" /><path d="M8 12h8" /></>,
  audit: <><path d="M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /><path d="M9 3h6v4H9z" /><path d="m8 13 2 2 5-5" /></>,
  reports: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="M8 15v-4" /><path d="M13 15V7" /><path d="M18 15v-6" /></>,
  branches: <><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
  scan: <><path d="M4 7V5a1 1 0 0 1 1-1h2" /><path d="M17 4h2a1 1 0 0 1 1 1v2" /><path d="M20 17v2a1 1 0 0 1-1 1h-2" /><path d="M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M7 12h10" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.42 1.42" /><path d="m17.65 17.65 1.42 1.42" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.35 17.65-1.42 1.42" /><path d="m19.07 4.93-1.42 1.42" /></>,
  moon: <><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></>,
  signout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
};

function Icon({ name, className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const PRIMARY_TABS = [
  ['/dashboard', 'dashboard', 'Home'],
  ['/assets', 'assets', 'Assets'],
  ['/inventory', 'scan', 'Scan'],
];

export default function Layout({ children, theme, setTheme, onSignOut }) {
  const { user } = useAuth();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const signOutTimer = useRef(null);

  useEffect(() => () => clearTimeout(signOutTimer.current), []);
  useEffect(() => {
    if (!confirmSignOut || signingOut) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setConfirmSignOut(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmSignOut, signingOut]);

  const requestSignOut = () => {
    setMoreOpen(false);
    setConfirmSignOut(true);
  };
  const confirmSignOutAction = () => {
    if (signingOut) return;
    setSigningOut(true);
    signOutTimer.current = setTimeout(onSignOut, 240);
  };

  const groups = [
    { title: 'Overview', links: [['/dashboard', 'dashboard', 'Dashboard'], ['/alerts', 'alerts', 'Alerts']] },
    { title: 'Assets', links: [['/assets', 'assets', 'All assets']] },
    { title: 'Operations', links: [['/transfers', 'transfers', 'Transfers'], ['/maintenance', 'maintenance', 'Maintenance'], ['/inventory', 'inventory', 'Monthly inventory']] },
    { title: 'Reports', links: [['/reports', 'reports', 'Reports']] },
  ];
  if (user.role === 'superadmin') {
    groups.find((group) => group.title === 'Operations').links.push(['/audit', 'audit', 'Audit log']);
    groups.push({ title: 'Admin', links: [['/admin/branches', 'branches', 'Branches & locations'], ['/admin/users', 'users', 'Users']] });
  }

  // Scan uses the inventory path as its mobile action, but Monthly inventory
  // must remain available as a regular page in the More menu.
  const primaryPaths = PRIMARY_TABS.filter(([, , label]) => label !== 'Scan').map(([to]) => to.split('?')[0]);
  const moreLinks = groups.flatMap((group) => group.links).filter(([to]) => !primaryPaths.includes(to));
  const isDark = theme === 'dark';
  const moreLinkActive = moreLinks.some(([to]) => location.pathname === to || location.pathname.startsWith(`${to}/`));
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');

  return (
    <div className="shell min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sidebar flex flex-col">
        <Link to="/dashboard" className="brand flex items-center">
          <img src="/logo-blue.png" alt="" />
          <span>Cosmopolitan<small>Asset Register</small></span>
        </Link>

        <nav aria-label="Main navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <span className="nav-label">{group.title}</span>
              {group.links.map(([to, icon, label]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/assets' || to === '/dashboard'}
                  className={({ isActive }) => `flex min-h-10 items-center rounded-[10px] px-3 py-2 ${isActive ? 'active' : ''}`}
                >
                  <Icon name={icon} className="nav-icon" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="user-summary flex items-center">
            <span className="user-avatar">{user.name?.slice(0, 1).toUpperCase() || 'U'}</span>
            <span>
              <b>{user.name || 'Staff user'}</b>
              <small>{user.role === 'superadmin' ? 'Super admin' : 'Operator'}</small>
            </span>
          </div>
          <button className="theme-toggle flex min-h-10 items-center rounded-[10px] px-3 py-2" onClick={toggleTheme}>
            <Icon name={isDark ? 'sun' : 'moon'} className="nav-icon" />
            <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button className="signout-trigger flex min-h-10 items-center rounded-[10px] px-3 py-2" onClick={requestSignOut}>
            <Icon name="signout" className="nav-icon signout-icon" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content: takes whatever width the sidebar leaves */}
      <main className="main-content min-w-0 flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-8 lg:pb-8">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>

      {/* Mobile bottom tabs (siblings of <main>, not inside it) */}
      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {PRIMARY_TABS.map(([to, icon, label]) => (
          label === 'Scan' ? <button key={to} type="button" onClick={() => { setMoreOpen(false); setScanOpen(true); }}>
            <Icon name={icon} className="nav-icon" />
            <small>{label}</small>
          </button> : <NavLink key={to} to={to} onClick={() => setMoreOpen(false)}>
            <span>{icon}</span>
            <small>{label}</small>
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={moreOpen}
          className={moreLinkActive ? 'active' : ''}
          aria-controls="mobile-more-menu"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <Icon name="more" className="nav-icon" />
          <small>More</small>
        </button>
      </nav>

      {moreOpen && (
        <>
          <button className="mobile-menu-scrim" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="mobile-more-menu" id="mobile-more-menu" aria-label="More navigation">
            {moreLinks.map(([to, icon, label]) => (
              <NavLink key={to} to={to} onClick={() => setMoreOpen(false)}>
                <Icon name={icon} className="nav-icon" />
                {label}
              </NavLink>
            ))}
            <button className="theme-toggle" onClick={() => { toggleTheme(); setMoreOpen(false); }}>
              <Icon name={isDark ? 'sun' : 'moon'} className="nav-icon" />
              {isDark ? 'Light mode' : 'Dark mode'}
            </button>
            <button className="signout-trigger" onClick={requestSignOut}>
              <Icon name="signout" className="nav-icon signout-icon" />
              Sign out
            </button>
          </div>
        </>
      )}
      {scanOpen && <ScanOverlay onClose={() => setScanOpen(false)} />}
      {confirmSignOut && (
        <div
          className={`modal-backdrop signout-backdrop ${signingOut ? 'is-closing' : ''}`}
          onMouseDown={(event) => event.target === event.currentTarget && !signingOut && setConfirmSignOut(false)}
        >
          <div
            className={`modal-dialog confirm-dialog signout-dialog ${signingOut ? 'is-closing' : ''}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="signout-title"
            aria-describedby="signout-description"
          >
            <div className="signout-mark" aria-hidden="true"><Icon name="signout" /></div>
            <div className="modal-heading">
              <p className="eyebrow">Leaving workspace</p>
              <h2 id="signout-title">Sign out?</h2>
              <p className="sub" id="signout-description">You’ll need to sign in again to access your asset register.</p>
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setConfirmSignOut(false)} disabled={signingOut}>Stay signed in</button>
              <button className="btn danger signout-confirm" type="button" onClick={confirmSignOutAction} disabled={signingOut}>
                {signingOut ? <><span className="spinner" aria-hidden="true" /> Signing out…</> : 'Sign out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}