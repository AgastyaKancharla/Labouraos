import { useLocation } from 'react-router-dom';
import { useT } from '../i18n/I18nProvider';
import { useNow } from '../lib/useNow';
import { screenPath } from '../portals';
import { usePortal } from '../portals/PortalContext';
import { useAttendance } from './AttendanceProvider';
import { useAuth } from '../auth/AuthProvider';
import { clockTime } from './format';
import { breakClock } from './StatusMenu';
import { STATUS_DEFS, statusLabelKey } from './statuses';

/**
 * The banner at the top of every page showing the status picked (guide:
 * "the banner at the top of the page shows the status picked"). Shown while
 * the person is anything but Available — not started, a meeting, a break
 * (red once it runs over), Idle — with the one action that matters. On call
 * and After-call notes are left to the call screens; the Attendance page has
 * its own, larger banner.
 */
export function StatusBanner() {
  const t = useT();
  const attendance = useAttendance();
  const portal = usePortal();
  const location = useLocation();
  const now = useNow(1000);
  const auth = useAuth();
  if (!attendance || attendance.loading || attendance.failed || !attendance.today) return null;
  if (location.pathname === screenPath(portal, 'CA14b-AttendanceActive')) return null;
  const { today, phase, status, audience, busy } = attendance;
  const office = audience === 'office';

  if (phase === 'not_started' && today.startsAtSignIn) {
    // 22 Nov: the day opens at sign-in; a session from before that (or a failed start) signs in again.
    return (
      <div className="lb-att-banner lb-att-banner--info" role="status">
        <span>{t('att.banner.signInStarts')}</span>
        <button type="button" className="btn bg lb-btn lb-att-banner__btn" onClick={() => void auth.signOut()} disabled={busy}>
          {t('att.banner.signInAgain')}
        </button>
      </div>
    );
  }
  if (phase === 'not_started') {
    return (
      <div className="lb-att-banner lb-att-banner--info" role="status">
        <span>{t(office ? 'att.banner.notStartedOffice' : 'att.banner.notStarted')}</span>
        <button type="button" className="btn bg lb-btn lb-att-banner__btn" onClick={() => void attendance.start()} disabled={busy}>
          {t('att.menu.start')}
        </button>
      </div>
    );
  }
  if (phase === 'ended' && today.canResume) {
    // Ended with Log out today (decided 21 Nov): Resume my day, recorded.
    return (
      <div className="lb-att-banner lb-att-banner--info" role="status">
        <span>{t('att.resume.banner')}</span>
        <button type="button" className="btn bg lb-btn lb-att-banner__btn" onClick={() => void attendance.resume()} disabled={busy}>
          {t('att.resume.button')}
        </button>
      </div>
    );
  }
  if (phase !== 'open' || !status || status === 'available' || status === 'on_call' || status === 'after_call_notes') return null;
  if (status === 'start_of_day') {
    // 22 Nov: the day opened at sign-in; nothing counts and no calls come until a status is picked.
    return (
      <div className="lb-att-banner lb-att-banner--warn" role="status" data-testid="att-start-of-day">
        <span className="lb-att-banner__main">
          <span className="lb-att-dot" style={{ background: STATUS_DEFS.start_of_day.dot }} aria-hidden="true" />
          <strong>{t('att.banner.since', { status: t('att.status.start_of_day'), time: today.statusSince ? clockTime(today.statusSince) : '' })}</strong>
          <span className="lb-att-banner__sub">{t(office ? 'att.banner.startOfDayOffice' : 'att.banner.startOfDay')}</span>
        </span>
        <button type="button" className="btn bg lb-btn lb-att-banner__btn" onClick={() => void attendance.pick('available')} disabled={busy}>
          {t('att.banner.startWork')}
        </button>
      </div>
    );
  }

  const def = STATUS_DEFS[status];
  const clock = breakClock(today, status, now.getTime());
  const over = Boolean(clock && clock.over > 0);
  const tone = over ? 'crit' : def.kind === 'production' ? 'blue' : 'warn';
  const since = today.statusSince ? clockTime(today.statusSince) : '';
  const right = office
    ? t(def.kind === 'production' ? 'att.banner.production' : 'att.banner.notProduction')
    : t('att.banner.callsOff');
  return (
    <div className={`lb-att-banner lb-att-banner--${tone}`} role="status">
      <span className="lb-att-banner__main">
        <span className="lb-att-dot" style={{ background: over ? '#BB232B' : def.dot }} aria-hidden="true" />
        <strong>{t('att.banner.since', { status: t(statusLabelKey(status, audience)), time: since })}</strong>
        <span className="lb-att-banner__sub">{right}</span>
      </span>
      <button type="button" className="btn bg lb-btn lb-att-banner__btn" onClick={() => void attendance.pick('available')} disabled={busy}>
        {t('att.banner.back')}
      </button>
    </div>
  );
}
