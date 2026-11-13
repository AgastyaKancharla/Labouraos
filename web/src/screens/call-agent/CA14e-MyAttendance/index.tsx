import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAttendance } from '../../../attendance/AttendanceProvider';
import { useAttendanceMonth, useLeaveBalance, useMyRequests } from '../../../attendance/api';
import { dayLabel, dayMonth, hm, shortClock, lastDayOf, monthName, shiftMonth } from '../../../attendance/format';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { Skeleton, SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useI18n } from '../../../i18n/I18nProvider';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { dayChips, expectedDays, requestChip, requestTitle } from './chips';
import '../../../attendance/attendance.css';

/** The current month and the five before it. */
const MONTHS_BACK = 5;

/**
 * My attendance — design CA14e-MyAttendance. The person's own month: each
 * day, production against what was needed so far, make-up owed, leave left,
 * their leave and correction requests and where each one is. From here they
 * request leave (CA14f) or a correction (CA14h) and open payslips (CA14g).
 * The API always reads the signed-in person; nobody edits their own times.
 * Team Leads, Managers and Finance use it for their own month too.
 */
export default function MyAttendance() {
  const { t, language } = useI18n();
  const to = useScreenPath();
  const attendance = useAttendance();
  const now = useNow(60_000);
  const current = istDateKey(now).slice(0, 7);
  const [month, setMonth] = useState(current);
  const summary = useAttendanceMonth(month);
  const balance = useLeaveBalance();
  const requests = useMyRequests();
  const oldest = shiftMonth(current, -MONTHS_BACK);

  const data = summary.data;
  // A full day's hours; expectedDays counts a day with a half day of leave as half a day.
  const fullDay = (attendance?.today?.policy.productionHoursFullDay ?? 8) * 3600;
  const needed = data ? expectedDays(data.days, istDateKey(now)) * fullDay : 0;
  const days = data ? [...data.days].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const owed = data ? data.deductibleShortfallSeconds : 0;

  return (
    <div className="lb-page lb-att-page">
      <TopBar title={t('screen.CA14e-MyAttendance')} titleHidden />
      <div className="lb-att-titlebar">
        <span className="lb-att-monthnav">
          <button type="button" aria-label={t('att.mine.prev')} disabled={month <= oldest} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <h2 className="h1" aria-live="polite">
            {t('att.mine.title', { month: monthName(month, language) })}
          </h2>
          <button type="button" aria-label={t('att.mine.next')} disabled={month >= current} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </span>
        <span className="lb-att-actions">
          <Link className="btn bp lb-btn" to={to('CA14f-RequestLeave')}>
            {t('att.mine.requestLeave')}
          </Link>
          <Link className="btn bs lb-btn" to={to('CA14h-Correction')}>
            {t('att.mine.requestCorrection')}
          </Link>
          <Link className="btn bs lb-btn" to={to('CA14g-Payslip')}>
            {t('att.mine.payslips')}
          </Link>
        </span>
      </div>

      {summary.error && <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />}

      <div className="lb-att-grid3">
        <div className="card lb-att-stat">
          <span className="lbl">{t('att.mine.production')}</span>
          <b>{data ? hm(data.productionSeconds) : <Skeleton height={26} />}</b>
          <span className="sub">{data ? t('att.mine.neededSoFar', { needed: hm(needed), days: expectedDays(data.days, istDateKey(now)) }) : ''}</span>
        </div>
        <div className="card lb-att-stat">
          <span className="lbl">{t('att.mine.makeUp')}</span>
          <b style={owed > 0 ? { color: 'var(--tomato)' } : undefined}>{data ? hm(owed) : <Skeleton height={26} />}</b>
          <span className="sub">
            {data ? t('att.mine.makeUpLine', { short: hm(data.shortfallSeconds), madeUp: hm(data.makeUpSeconds), date: dayMonth(lastDayOf(month)) }) : ''}
          </span>
        </div>
        <div className="card lb-att-stat">
          <span className="lbl">{t('att.mine.leave')}</span>
          <b>{balance.data ? t('att.mine.leaveLeft', { count: balance.data.casual.left + balance.data.emergency.left }) : <Skeleton height={26} />}</b>
          <span className="sub">{balance.data ? t('att.mine.leaveLine', { casual: balance.data.casual.left, emergency: balance.data.emergency.left }) : ''}</span>
        </div>
      </div>

      <div className="card">
        <div className="lbl" style={{ marginBottom: 4 }}>
          {t('att.mine.requests')}
        </div>
        {requests.error && <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />}
        {requests.isPending && <Skeleton height={40} />}
        {requests.data && requests.data.length === 0 && <p className="lb-att-muted">{t('att.mine.noRequests')}</p>}
        {requests.data?.map((r) => {
          const chip = requestChip(r);
          return (
            <div key={`${r.kind}-${r.id}`} className="lb-att-row lb-att-row--split">
              <span>{requestTitle(t, r)}</span>
              <span className={`tag ${chip.tone}`}>{t(chip.key, chip.vars)}</span>
            </div>
          );
        })}
      </div>

      <div className="card scroll">
        {summary.isPending ? (
          <SkeletonCard height={220} />
        ) : days.length === 0 ? (
          <EmptyState title={t('att.mine.noDays')} />
        ) : (
          <table className="lb-att-table">
            <caption className="sr-only">{t('att.mine.daysCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('att.mine.col.day')}</th>
                <th scope="col">{t('att.mine.col.login')}</th>
                <th scope="col">{t('att.mine.col.logout')}</th>
                <th scope="col">{t('att.mine.col.production')}</th>
                <th scope="col">{t('att.mine.col.countsAs')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.id || day.date}>
                  <td className="nm">{dayLabel(day.date)}</td>
                  <td>{day.loginAt ? shortClock(day.loginAt) : '—'}</td>
                  <td>{day.logoutAt ? shortClock(day.logoutAt) : '—'}</td>
                  <td>
                    <strong>{day.dayType === 'open' ? t('att.mine.inProgress') : day.loginAt ? hm(day.productionSeconds) : '—'}</strong>
                  </td>
                  <td>
                    {(() => {
                      // One tag per day, as in the design: "Late 22m · 40m short", "Full day · +40m make-up".
                      const chips = dayChips(day);
                      return <span className={`tag ${chips[0]!.tone}`}>{chips.map((chip) => t(chip.key, chip.vars)).join(' · ')}</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="lb-att-warn">{t('att.mine.rules')}</div>
    </div>
  );
}
