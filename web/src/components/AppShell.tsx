import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { MANAGEMENT_ROLES, ROLE_LABEL } from '../auth/roles';
import { useT } from '../i18n/I18nProvider';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { formatDayMonthIST } from '../lib/format/date';
import { useNow } from '../lib/useNow';
import { useNavBadgeCounts } from '../portals/badges';
import { screenPath, type PortalDef } from '../portals';
import { PortalContext } from '../portals/PortalContext';
import { NavBadge } from './Badge';
import { FamilyContext } from './family';
import { NavIcon, UiIcon } from './Icon';
import { IncomingCallWatcher } from '../screens/call-agent/_lib/IncomingCallWatcher';
import { AttendanceProvider } from '../attendance/AttendanceProvider';
import { StatusBanner } from '../attendance/StatusBanner';
import { StatusMenu } from '../attendance/StatusMenu';
import type { PortalKey } from '../portals';

/**
 * Portals whose people mark attendance in the web app: call agents, and Team
 * Leads, Managers and Finance (owner decision 12 Nov). The CEO does not.
 */
const OFFICE_ATTENDANCE_PORTALS: readonly PortalKey[] = ['team-lead', 'manager', 'finance'];

/**
 * The frame around every screen. Three variants, one per design family:
 *
 * - PortalShell: the blue gradient sidebar (logo, swoosh, sections, items
 *   with badges, the signed-in person and Log out) from Main.dc.html,
 *   MG-Home, T-Home and FN-Home. Below 900 px the sidebar becomes a drawer
 *   opened from a menu button.
 * - ConsoleShell: the call agent console's top header (CA03-Home), with the
 *   attendance status menu.
 * - PublicShell: the phone header with the language switcher (P00…P06).
 *
 * <AppShell portal={…}> picks the right one and provides the portal and the
 * design family to everything inside.
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}logo-mark.png`;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function SkipLink() {
  const t = useT();
  return (
    <a className="skip-link" href="#main">
      {t('common.skipToContent')}
    </a>
  );
}

function Sidebar({ portal, onNavigate }: { portal: PortalDef; onNavigate?: () => void }) {
  const t = useT();
  const { session, signOut } = useAuth();
  const counts = useNavBadgeCounts(portal.sidebar);
  if (!portal.sidebar) return null;
  const staff = session?.staff;
  const management = staff ? MANAGEMENT_ROLES.includes(staff.role) : false;

  return (
    <div className="lb-sidebar">
      <div className="lb-sidebar__brand">
        <img src={LOGO_SRC} alt="" width={40} height={40} />
        <div>
          <span className="lb-sidebar__name">LABOURA</span>
          <span className="lb-sidebar__sub">{t(portal.sidebar.subtitle)}</span>
        </div>
      </div>
      <div className="swoosh lb-sidebar__swoosh" />
      <nav aria-label={t('common.mainNav')} className="lb-sidebar__nav">
        {portal.sidebar.sections.map((section) => (
          <div key={section.label} role="group" aria-labelledby={`nav-${section.label}`}>
            <div className="nav-label" id={`nav-${section.label}`}>
              {t(section.label)}
            </div>
            {section.items.map((item) => {
              const to = screenPath(portal, item.screen);
              const count = item.badge ? counts[item.badge.source] : undefined;
              return (
                <NavLink
                  key={item.screen}
                  to={to}
                  end={to === portal.root}
                  className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                  onClick={onNavigate}
                >
                  <span className="lb-nav-item__main">
                    <NavIcon name={item.icon} />
                    {t(item.label)}
                  </span>
                  {item.badge && count !== undefined && count > 0 && <NavBadge tone={item.badge.tone} count={count} />}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      {staff && (
        <div className="lb-sidebar__me">
          <div className="lb-avatar" aria-hidden="true">
            {initials(staff.name)}
          </div>
          <div className="lb-sidebar__who">
            <span className="lb-sidebar__person">{staff.name}</span>
            <span className="lb-sidebar__role">
              {ROLE_LABEL[staff.role]}
              {management ? ` · ${t('common.twoFactorOn')}` : ''}
            </span>
          </div>
          <button type="button" className="lb-logout" onClick={() => void signOut()}>
            {t('common.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

function PortalShell({ portal, children }: { portal: PortalDef; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="portal lb-shell">
      <SkipLink />
      <div className="lb-mobilebar">
        <button
          ref={menuButton}
          type="button"
          className="lb-mobilebar__menu"
          aria-label={open ? t('common.closeMenu') : t('common.openMenu')}
          aria-expanded={open}
          aria-controls="lb-sidebar"
          onClick={() => setOpen((o) => !o)}
        >
          <UiIcon name={open ? 'close' : 'menu'} size={20} />
        </button>
        <img src={LOGO_SRC} alt="" width={28} height={28} />
        <span className="lb-mobilebar__name">LABOURA</span>
      </div>
      <aside id="lb-sidebar" className={open ? 'lb-shell__side is-open' : 'lb-shell__side'}>
        <Sidebar portal={portal} onNavigate={() => setOpen(false)} />
      </aside>
      {open && <div className="lb-shell__scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <main id="main" className="lb-shell__main" tabIndex={-1}>
        <div className="swoosh lb-shell__swoosh" />
        <div className="lb-shell__content">
          {OFFICE_ATTENDANCE_PORTALS.includes(portal.key) && <StatusBanner />}
          {children}
        </div>
      </main>
    </div>
  );
}

function ConsoleShell({ portal, children }: { portal: PortalDef; children: ReactNode }) {
  const t = useT();
  const { session, signOut } = useAuth();
  const now = useNow(60_000);
  const staff = session?.staff;
  return (
    <div className="console lb-console">
      <SkipLink />
      <header className="hdr lb-console__hdr">
        <div className="lb-console__brand">
          <img src={LOGO_SRC} alt="" width={32} height={32} />
          <div>
            <span className="t">{t('subtitle.callAgent')}</span>
            <span className="s">
              {formatDayMonthIST(now)} · {t('subtitle.callingHours')}
            </span>
          </div>
        </div>
        <div className="lb-console__right">
          <nav className="nav" aria-label={t('common.mainNav')}>
            {(portal.topNav ?? []).map((item) => {
              const to = screenPath(portal, item.screen);
              return (
                <NavLink key={item.screen} to={to} end={to === portal.root} className={({ isActive }) => (isActive ? 'on' : '')}>
                  {t(item.label)}
                </NavLink>
              );
            })}
          </nav>
          <StatusMenu tone="onDark" />
          {staff && (
            <div className="chip">
              <div className="av" aria-hidden="true">
                {initials(staff.name)}
              </div>
              <span>{staff.name}</span>
              <button type="button" className="lb-logout" onClick={() => void signOut()}>
                {t('common.logout')}
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="swoosh lb-console__swoosh" />
      <main id="main" className="wrap lb-console__main" tabIndex={-1}>
        <StatusBanner />
        {children}
      </main>
      {portal.key === 'call-agent' && <IncomingCallWatcher />}
    </div>
  );
}

function PublicShell({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="console lb-public">
      <SkipLink />
      <div className="lb-public__phone">
        <header className="hdr lb-public__hdr">
          <div className="lb-console__brand">
            <img src={LOGO_SRC} alt="" width={30} height={30} />
            <div>
              <span className="t">{t('app.name')}</span>
              <span className="s">{t('subtitle.public')}</span>
            </div>
          </div>
          <LanguageSwitcher />
        </header>
        <div className="swoosh lb-console__swoosh" />
        <main id="main" className="pb lb-public__main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({ portal, children }: { portal: PortalDef; children: ReactNode }) {
  let body: ReactNode;
  if (portal.key === 'public') body = <PublicShell>{children}</PublicShell>;
  else if (portal.family === 'console')
    body = (
      <AttendanceProvider audience="agent">
        <ConsoleShell portal={portal}>{children}</ConsoleShell>
      </AttendanceProvider>
    );
  else if (OFFICE_ATTENDANCE_PORTALS.includes(portal.key))
    body = (
      <AttendanceProvider audience="office">
        <PortalShell portal={portal}>{children}</PortalShell>
      </AttendanceProvider>
    );
  else body = <PortalShell portal={portal}>{children}</PortalShell>;
  return (
    <PortalContext.Provider value={portal}>
      <FamilyContext.Provider value={portal.family}>{body}</FamilyContext.Provider>
    </PortalContext.Provider>
  );
}
