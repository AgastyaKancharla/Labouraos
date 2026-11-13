import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { useAttendance } from '../../../attendance/AttendanceProvider';
import { useAttendanceMonth, useAttendanceToday, useLeaveBalance, type AttendanceToday, productionTarget } from '../../../attendance/api';
import { addMinutesToSetting, clockTime, hm, lastDayOf, settingClock, span, countdown, dayMonth } from '../../../attendance/format';
import { breakClock, optionLabel } from '../../../attendance/StatusMenu';
import { STATUS_DEFS, pickableStatuses, statusLabelKey, type AttendanceAudience, type AttendanceStatus } from '../../../attendance/statuses';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useFamily } from '../../../components/family';
import { useT, type Translate } from '../../../i18n/I18nProvider';
import { addDaysToKey, istDateKey, istPartOfDay } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { usePortal, useScreenPath } from '../../../portals/PortalContext';
import { shortBreakSpans, timelineBlocks } from './timeline';
import '../../../attendance/attendance.css';

/**
 * Attendance — designs CA14-Attendance (before the day starts), CA14b-
 * AttendanceActive (my status), CA14c-OnBreak, CA14d-DayEnded and, with the
 * "Still there?" check that every page shows, CA14i-Idle. The day starts only
 * when the person taps Start my day; times come from Laboura's server.
 *
 * The same screen is the Team Lead's, Manager's and Finance's own attendance
 * (owner decision 12 Nov), with their production statuses and wording.
 *
 * Right after sign-in a call agent lands here: if the day has already
 * started, they go straight on to Home.
 */
export default function AttendanceScreen() {
  const t = useT();
  const attendance = useAttendance();
  const location = useLocation();
  const portal = usePortal();
  const family = useFamily();
  const landing = Boolean((location.state as { landing?: boolean } | null)?.landing);
  const query = useAttendanceToday();

  if (!attendance) return null;
  const { today, phase } = attendance;
  if (landing && phase === 'open') return <Navigate to={portal.root} replace />;

  return (
    <div className="lb-page lb-att-page">
      {/* Office portals already have a team "Attendance" page, so this one is "My attendance" there. */}
      <TopBar title={t(family === 'console' ? 'screen.CA14b-AttendanceActive' : 'att.menu.open')} titleHidden={family === 'console'} />
      {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {!today && !attendance.failed && <SkeletonCard height={260} />}
      {today && (phase === 'not_started' || phase === 'leave') && <BeforeStart today={today} />}
      {today && phase === 'ended' && <DayEnded today={today} />}
      {today && phase === 'open' && <DayOpen today={today} />}
    </div>
  );
}

function greetingKey(now: Date) {
  const part = istPartOfDay(now);
  return part === 'morning' ? 'greeting.morning' : part === 'afternoon' ? 'greeting.afternoon' : 'greeting.evening';
}

function shiftText(today: AttendanceToday): string {
  return `${settingClock(today.clocks.shiftStart)} – ${settingClock(today.clocks.shiftEnd)}`;
}

/** CA14 — Good morning, Deepa · Start my day · yesterday, this month, leave left. */
function BeforeStart({ today }: { today: AttendanceToday }) {
  const t = useT();
  const attendance = useAttendance()!;
  const { session } = useAuth();
  const now = useNow(60_000);
  const office = attendance.audience === 'office';
  const firstName = session?.staff.name.split(/\s+/)[0] ?? '';
  const todayKey = today.date || istDateKey(now);
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const month = useAttendanceMonth(todayKey.slice(0, 7));
  const lastMonth = useAttendanceMonth(yesterdayKey.slice(0, 7));
  const balance = useLeaveBalance();
  const yesterday = lastMonth.data?.days.find((d) => d.date === yesterdayKey);
  const lateFrom = settingClock(addMinutesToSetting(today.clocks.shiftStart, today.policy.lateGraceMinutes));
  const short = month.data?.deductibleShortfallSeconds ?? 0;
  // "Your shift today: **9:30 AM – 6:30 PM**." with the shift in bold, as in the design.
  const [shiftBefore = '', shiftAfter = ''] = t('att.start.shift', { shift: '\u0000' }).split('\u0000');

  return (
    <>
      <div className="card lb-att-hero">
        <span className="h1">{t(greetingKey(now), { name: firstName })}</span>
        <span className="lb-att-muted">
          {shiftBefore}
          <strong>{shiftText(today)}</strong>
          {shiftAfter} {t(office ? 'att.start.unlockOffice' : 'att.start.unlock')}
        </span>
        {attendance.phase === 'leave' && <span className="lb-att-warn">{t('att.start.onLeave')}</span>}
        <button type="button" className="btn bg lb-btn lb-att-cta" onClick={() => void attendance.start()} disabled={attendance.busy} aria-busy={attendance.busy || undefined}>
          {t('att.menu.start')}
        </button>
        <span className="sub">{t('att.start.serverTime', { time: lateFrom })}</span>
      </div>
      <div className="lb-att-grid3">
        <div className="card lb-att-stat">
          <span className="lbl">{t('att.tile.yesterday')}</span>
          <b>{yesterday && yesterday.loginAt ? hm(yesterday.productionSeconds) : '—'}</b>
          <span className="sub">
            {!yesterday || !yesterday.loginAt
              ? t('att.tile.yesterdayNone')
              : yesterday.lateMinutes > 0
                ? t('att.tile.yesterdayLate', { minutes: yesterday.lateMinutes })
                : t('att.tile.yesterdayOnTime')}
          </span>
        </div>
        <div className="card lb-att-stat">
          <span className="lbl">{t('att.tile.month')}</span>
          <b>{month.data ? (short > 0 ? t('att.tile.monthShort', { time: hm(short) }) : t('att.tile.monthOk')) : '—'}</b>
          <span className="sub">{short > 0 ? t('att.tile.monthShortSub', { date: dayMonth(lastDayOf(todayKey.slice(0, 7))) }) : t('att.tile.monthOkSub')}</span>
        </div>
        <div className="card lb-att-stat">
          <span className="lbl">{t('att.tile.leave')}</span>
          <b>{balance.data ? balance.data.casual.left + balance.data.emergency.left : '—'}</b>
          <span className="sub">{balance.data ? t('att.tile.leaveSub', { casual: balance.data.casual.left, emergency: balance.data.emergency.left }) : ''}</span>
        </div>
      </div>
    </>
  );
}

/** The three tiles of CA14b and CA14c: logged in, production, breaks. */
function DayTiles({ today, audience }: { today: AttendanceToday; audience: AttendanceAudience }) {
  const t = useT();
  const full = productionTarget(today);
  const percent = Math.min(100, Math.round((today.productionSeconds / Math.max(1, full)) * 100));
  return (
    <div className="lb-att-grid3">
      <div className="card lb-att-stat">
        <span className="lbl">{t('att.tile.loggedIn')}</span>
        <b>{today.loginAt ? clockTime(today.loginAt) : '—'}</b>
        <span className="sub">
          {t('att.tile.shift', { shift: shiftText(today), state: today.lateMinutes > 0 ? t('att.late', { minutes: today.lateMinutes }) : t('att.onTime') })}
        </span>
      </div>
      <div className="card lb-att-stat">
        <span className="lbl">{t('att.tile.production')}</span>
        <b>
          {hm(today.productionSeconds)} <span className="sub">{t('att.tile.of', { total: hm(full) })}</span>
        </b>
        <div className="lb-att-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('att.tile.production')}>
          <i style={{ width: `${percent}%` }} />
        </div>
        <span className="sub">{t(audience === 'agent' ? 'att.tile.productionSub' : 'att.tile.productionSubOffice')}</span>
      </div>
      <div className="card lb-att-stat">
        <span className="lbl">{t('att.tile.breaks')}</span>
        <b>
          {span(today.shortBreakSeconds)} <span className="sub">{t('att.tile.of', { total: span(2 * today.policy.shortBreakMinutes * 60) })}</span>
        </b>
        <span className="sub">
          {t('att.tile.breaksSub', { lunch: span(today.lunchSeconds), lunchAllowance: span(today.policy.lunchMinutes * 60), meetings: span(today.meetingSeconds) })}
        </span>
      </div>
    </div>
  );
}

function bannerFor(t: Translate, status: AttendanceStatus, audience: AttendanceAudience, today: AttendanceToday) {
  const def = STATUS_DEFS[status];
  const label = t('att.banner.since', { status: t(statusLabelKey(status, audience)), time: today.statusSince ? clockTime(today.statusSince) : '' });
  const working = status === 'available' || status === 'on_call' || status === 'after_call_notes';
  const sub = audience === 'agent' ? t(working ? 'att.banner.callsOn' : 'att.banner.callsOff') : t(def.kind === 'production' ? 'att.banner.production' : 'att.banner.notProduction');
  const tone = status === 'available' ? '' : def.kind === 'production' ? ' lb-att-ok--blue' : ' lb-att-ok--warn';
  return { label, sub, tone };
}

/** CA14b (my status) and CA14c (on a break). */
function DayOpen({ today }: { today: AttendanceToday }) {
  const t = useT();
  const attendance = useAttendance()!;
  const to = useScreenPath();
  const now = useNow(1000);
  const { audience, status } = attendance;
  if (!status) return <SkeletonCard height={200} />;
  const office = audience === 'office';
  const clock = breakClock(today, status, now.getTime());

  if (clock) {
    const over = clock.over > 0;
    const allowance = status === 'lunch' ? today.policy.lunchMinutes : today.policy.shortBreakMinutes;
    const spans = shortBreakSpans(today.segments, now.getTime());
    return (
      <>
        <div className={`card lb-att-hero lb-att-hero--break${over ? ' lb-att-hero--over' : ''}`} role="timer" aria-live="off">
          <span className="lbl">{t(statusLabelKey(status, audience))}</span>
          <span className="h1 lb-att-big">{over ? t('att.break.over', { time: countdown(clock.over) }) : t('att.break.left', { time: countdown(clock.left) })}</span>
          <span className="lb-att-muted">
            {t(office ? 'att.break.startedOffice' : 'att.break.started', { time: today.statusSince ? clockTime(today.statusSince) : '', minutes: allowance })}
          </span>
          {over && <span className="lb-att-muted" role="alert">{t(office ? 'att.break.overNowOffice' : 'att.break.overNow', { minutes: allowance })}</span>}
          <button type="button" className="btn bg lb-btn lb-att-cta" onClick={() => void attendance.pick('available')} disabled={attendance.busy}>
            {t('att.banner.back')}
          </button>
        </div>
        <DayTiles today={today} audience={audience} />
        <div className="lb-att-warn">
          {status === 'short_break' && spans.length > 1 && <>{t('att.break.count', { count: spans.length, used: spans.map((s) => span(s)).join(' + ') })} </>}
          {t('att.break.note')}
        </div>
      </>
    );
  }

  const banner = bannerFor(t, status, audience, today);
  const pickable = pickableStatuses(audience);
  const blocks = timelineBlocks(today.segments);
  return (
    <>
      <div className={`lb-att-ok${banner.tone}`} role="status">
        <span>● {banner.label}</span>
        <span className="lb-att-ok__sub">{banner.sub}</span>
        {status !== 'available' && STATUS_DEFS[status].kind !== 'production' && (
          <button type="button" className="btn bg lb-btn" onClick={() => void attendance.pick('available')} disabled={attendance.busy}>
            {t('att.banner.back')}
          </button>
        )}
      </div>
      <DayTiles today={today} audience={audience} />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label className="lbl" htmlFor="att-status-select">
          {t('att.menu.title')}
        </label>
        <select
          id="att-status-select"
          className="lb-att-select"
          value={pickable.includes(status) ? status : ''}
          disabled={attendance.busy}
          onChange={(e) => {
            const next = e.target.value as AttendanceStatus;
            if (next && next !== status) void attendance.pick(next);
          }}
        >
          {!pickable.includes(status) && (
            <option value="" disabled>
              {t(statusLabelKey(status, audience))}
            </option>
          )}
          {pickable.map((s) => (
            <option key={s} value={s}>
              {optionLabel(t, s, audience, today)}
            </option>
          ))}
        </select>
        <span className="sub">{t(office ? 'att.change.autoOffice' : 'att.change.auto')}</span>
      </div>
      <div className="card">
        <div className="lbl" style={{ marginBottom: 4 }}>
          {t('att.timeline.title')}
        </div>
        <ol className="lb-att-timeline" aria-label={t('att.timeline.title')}>
          {blocks.map((block, i) => {
            const known = block.status in STATUS_DEFS ? (block.status as AttendanceStatus) : null;
            const name = known ? t(statusLabelKey(known, audience)) : block.status;
            const what = i === 0 ? t('att.timeline.loggedIn', { status: name }) : name;
            const calls = block.calls === 1 ? t('att.timeline.oneCall') : block.calls > 1 ? t('att.timeline.calls', { count: block.calls }) : '';
            const length = block.endedAt ? span((Date.parse(block.endedAt) - Date.parse(block.startedAt)) / 1000) : t('att.timeline.now');
            return (
              <li key={`${block.startedAt}-${i}`} className="lb-att-row">
                <span className="sub lb-att-row__time">{clockTime(block.startedAt)}</span>
                <span className="lb-att-dot" style={{ background: known ? STATUS_DEFS[known].dot : '#8290B8' }} aria-hidden="true" />
                <span className="lb-att-row__what">
                  {calls ? `${what} · ${calls}` : what}
                  {block.waitingApproval && <span className="sub"> · {t('att.timeline.notApproved')}</span>}
                </span>
                <span className="sub">{length}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="lb-att-actions lb-att-actions--split">
        <Link className="btn bs lb-btn" to={to('CA14e-MyAttendance')}>
          {t('att.link.mine')}
        </Link>
        <button type="button" className="btn bd lb-btn" onClick={attendance.requestEnd} disabled={attendance.busy}>
          {t('att.menu.end')}
        </button>
      </div>
    </>
  );
}

/** CA14d — the end-of-day summary that goes to the Team Lead, Managers, Finance and the Command Center. */
function DayEnded({ today }: { today: AttendanceToday }) {
  const t = useT();
  const attendance = useAttendance()!;
  const portal = usePortal();
  const office = attendance.audience === 'office';
  const full = productionTarget(today);
  const spans = shortBreakSpans(today.segments, Date.parse(today.logoutAt ?? today.clocks.now));
  const dayTag: Record<string, { key: Parameters<Translate>[0]; tone: string }> = {
    full: { key: 'att.day.full', tone: 'tg' },
    half: { key: 'att.day.half', tone: 'tr' },
    absent: { key: 'att.day.absent', tone: 'tt' },
    off: { key: 'att.day.off', tone: 'tn' },
  };
  const tag = dayTag[today.dayType] ?? { key: 'att.day.open' as const, tone: 'tn' };
  return (
    <div className="lb-att-ended">
      <div className="card">
        <div className="lb-att-ok">{t('att.ended.title', { time: today.logoutAt ? clockTime(today.logoutAt) : '' })}</div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.loggedIn')}</span>
          <strong>{today.loginAt ? clockTime(today.loginAt) : '—'}</strong>
        </div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.loggedOut')}</span>
          <strong>{today.logoutAt ? clockTime(today.logoutAt) : '—'}</strong>
        </div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.production', { meetings: span(today.meetingSeconds) })}</span>
          <strong style={{ color: today.productionSeconds >= full ? 'var(--green)' : 'var(--amber)' }}>
            {hm(today.productionSeconds)}
            {today.productionSeconds >= full ? ' ✓' : ''}
          </strong>
        </div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.shortBreaks')}</span>
          <span>{spans.length ? spans.map((s) => span(s)).join(' + ') : '0m'}</span>
        </div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.lunch')}</span>
          <span>{span(today.lunchSeconds)}</span>
        </div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.idle')}</span>
          <span>{span(today.idleSeconds)}</span>
        </div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.late')}</span>
          <span>{today.lateMinutes > 0 ? t('att.ended.lateYes', { minutes: today.lateMinutes }) : t('att.ended.no')}</span>
        </div>
        <div className="lb-att-row lb-att-row--split">
          <span>{t('att.ended.countsAs')}</span>
          <span className={`tag ${tag.tone}`}>{t(tag.key)}</span>
        </div>
        {today.flagged && <p className="lb-att-warn" style={{ margin: 0 }}>{t('att.ended.flagged')}</p>}
        <p className="lb-att-muted" style={{ margin: 0 }}>
          {t(office ? 'att.ended.wrongOffice' : 'att.ended.wrong')}
        </p>
        <Link className="btn bs lb-btn" to={portal.root}>
          {t('common.close')}
        </Link>
      </div>
    </div>
  );
}
