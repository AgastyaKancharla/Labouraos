import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/I18nProvider';
import type { Period } from '../lib/period';
import { usePortalNotifications, type NotificationItem } from '../portals/notifications';
import { usePortal } from '../portals/PortalContext';
import { useFamily } from './family';
import { NotificationBell } from './NotificationBell';
import { PeriodPicker } from './PeriodPicker';
import { SearchBox } from './SearchBox';

/**
 * The header block at the top of every staff screen, as in the designs:
 * back link · eyebrow · page title (h1) · subtitle on the left; search, the
 * notification bell and page actions on the right; the date presets
 * (Today / This week / This month / Custom + from–to) underneath when the
 * page is about a period. Also sets the browser tab title.
 */
export interface TopBarProps {
  title: string;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  /** Shown next to the title ("8 items need your review"). */
  titleBadge?: ReactNode;
  back?: { to: string; label: string };
  /** Buttons on the right (Export, Add…). */
  actions?: ReactNode;
  period?: Period;
  onPeriodChange?: (period: Period) => void;
  /** Search is on every staff screen; turn off only where the design has none. */
  showSearch?: boolean;
  notifications?: { items: NotificationItem[]; count: number };
}

export function TopBar({
  title,
  eyebrow,
  subtitle,
  titleBadge,
  back,
  actions,
  period,
  onPeriodChange,
  showSearch = true,
  notifications,
}: TopBarProps) {
  const t = useT();
  const family = useFamily();
  const portal = usePortal();
  const portalNotifications = usePortalNotifications(portal.key);
  const bell = notifications ?? portalNotifications;
  const notificationsScreen = portal.screens.find((s) => s.path === 'notifications');

  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
  }, [title, t]);

  return (
    <header className={`lb-topbar lb-topbar--${family}`}>
      <div className="lb-topbar__row">
        <div className="lb-topbar__titles">
          {back && (
            <Link to={back.to} className="lb-topbar__back">
              ← {back.label}
            </Link>
          )}
          {eyebrow && <div className="eyebrow lb-topbar__eyebrow">{eyebrow}</div>}
          <div className="lb-topbar__h1row">
            <h1 className="lb-topbar__h1">{title}</h1>
            {titleBadge}
          </div>
          {subtitle && <p className="lb-topbar__subtitle">{subtitle}</p>}
        </div>
        <div className="lb-topbar__tools">
          {showSearch && <SearchBox />}
          {family === 'portal' && (
            <NotificationBell
              items={bell.items}
              count={bell.count}
              allPath={notificationsScreen ? `${portal.root}/${notificationsScreen.path}` : undefined}
            />
          )}
          {actions}
        </div>
      </div>
      {period && onPeriodChange && <PeriodPicker value={period} onChange={onPeriodChange} />}
    </header>
  );
}
