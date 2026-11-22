import { Link } from 'react-router-dom';
import { useAttendance } from '../../../attendance/AttendanceProvider';
import { clockTime, hm, span } from '../../../attendance/format';
import { chipText } from '../../../attendance/StatusMenu';
import { Skeleton } from '../../../components/Skeleton';
import { useT } from '../../../i18n/I18nProvider';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { formatLateMinutes } from '../../../lib/format/late';

/**
 * "Today" at the top of My attendance (Master Guide rev 194, 17 Nov), on every
 * staff portal: logged in at, logged out at (or still working), productive
 * hours, unproductive = breaks + idle (each shown too), late minutes and the
 * status now. The day comes from the attendance provider (GET
 * /attendance/today, refreshed every 30 s and on every status change) and the
 * status line ticks every second, as on the attendance page (CA14b). Not
 * logged in yet: says so, with the way to start the day.
 */
export function TodayCard() {
  const t = useT();
  const to = useScreenPath();
  const attendance = useAttendance();
  const now = useNow(1000);
  const today = attendance?.today;

  if (!attendance) return null;
  if (!today) {
    return attendance.failed ? null : (
      <div className="card" aria-busy="true">
        <Skeleton height={64} />
      </div>
    );
  }

  if (!today.loginAt) {
    return (
      <section className="card lb-att-today" aria-labelledby="att-today-title" data-testid="att-today">
        <div className="lbl" id="att-today-title">
          {t('att.today.title')}
        </div>
        <p className="lb-att-muted" style={{ margin: '4px 0 8px' }}>
          {t('att.today.notLoggedIn')}
        </p>
        {/* 22 Nov: the day opens at sign-in for call agents, Team Leads and Managers; Finance still starts it here. */}
        {today.startsAtSignIn ? (
          <p className="sub" style={{ margin: 0 }}>{t('att.start.signInNote')}</p>
        ) : (
          <Link className="btn bg lb-btn" to={to('CA14b-AttendanceActive')}>
            {t('att.menu.start')}
          </Link>
        )}
      </section>
    );
  }

  const startOfDay = today.startOfDaySeconds ?? 0;
  const unproductive = startOfDay + today.breakSeconds + today.idleSeconds;
  const status = chipText(t, attendance.audience, today, attendance.status, now.getTime());
  const cells: Array<[string, string, string | null]> = [
    [t('att.today.loggedIn'), clockTime(today.loginAt), null],
    [t('att.today.loggedOut'), today.logoutAt ? clockTime(today.logoutAt) : t('att.today.stillWorking'), null],
    [t('att.today.productive'), hm(today.productionSeconds), null],
    [t('att.today.unproductive'), hm(unproductive), t('att.today.unproductiveSub', { start: span(startOfDay), breaks: span(today.breakSeconds), idle: span(today.idleSeconds) })],
    [t('att.today.late'), today.lateMinutes > 0 ? t('att.today.lateValue', { late: formatLateMinutes(today.lateMinutes) }) : t('att.onTime'), null],
    [t('att.today.status'), status.text, null],
  ];
  return (
    <section className="card lb-att-today" aria-labelledby="att-today-title" data-testid="att-today">
      <div className="lbl" id="att-today-title" style={{ marginBottom: 8 }}>
        {t('att.today.title')}
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px', margin: 0 }}>
        {cells.map(([label, value, sub]) => (
          <div key={label} style={{ display: 'grid', gap: 2 }}>
            <dt className="sub">{label}</dt>
            <dd style={{ margin: 0 }}>
              <b style={{ fontSize: 17 }}>{value}</b>
              {sub && <div className="sub">{sub}</div>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
