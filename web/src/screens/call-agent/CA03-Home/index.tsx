import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton, SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatDayMonthIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { useHome, useResendRegistration, type MetricView, type WorkCategory } from '../_lib/api';
import { CallNextButton } from '../_lib/CallNextButton';
import { clock12, durationHM, stuckLabel } from '../_lib/format';
import { PersonRow } from '../_lib/PersonRow';

/**
 * Call agent Home — designs CA03-Home and CallAgentConsole. Call next (one
 * button, server-side queue, calling hours and Available only), the four
 * registrations, today's numbers against the team average, "My work today"
 * with its filters, this month's targets, stuck registrations with Resend,
 * people near a refund (counts only) and what was done today.
 */
const FILTERS: Array<{ key: 'all' | Exclude<WorkCategory, 'priority'>; label: MessageKey }> = [
  { key: 'all', label: 'ca.filter.all' },
  { key: 'callbacks', label: 'ca.filter.callbacks' },
  { key: 'follow_ups', label: 'ca.filter.followUps' },
  { key: 'offers', label: 'ca.filter.offers' },
  { key: 'new_leads', label: 'ca.filter.newLeads' },
];

function metricValue(m: MetricView, percent = false): string {
  if (m.achieved === null || m.achieved === undefined) return '—';
  return percent ? `${Math.round(m.achieved * 100)}%` : String(m.achieved);
}

export default function CallAgentHome() {
  const t = useT();
  const to = useScreenPath();
  const toast = useToast();
  const home = useHome();
  const resend = useResendRegistration();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const data = home.data;

  const items = data ? data.work.items.filter((i) => filter === 'all' || i.category === filter) : [];
  const blockedHint = data && !data.canCall
    ? !data.inCallingHours
      ? t('ca.blocked.outside_calling_hours', { start: clock12(data.callingHours.start), end: clock12(data.callingHours.end) })
      : t('ca.blocked.not_available')
    : null;

  return (
    <div className="lb-page lb-ca">
      <TopBar title={t('screen.CA03-Home')} titleHidden />

      <div className="lb-ca-actions">
        <CallNextButton name={data?.callNext?.name} disabled={!data || !data.canCall} />
        <Link className="btn bs lb-btn lb-ca-small" to={to('CA08-Register')}>{t('ca.registerSeeker')}</Link>
        <Link className="btn bs lb-btn lb-ca-small" to={to('CA09-AddVacancy')}>{t('ca.addVacancy')}</Link>
        <Link className="btn bs lb-btn lb-ca-small" to={to('CA13-BusinessLead')}>{t('ca.registerBusiness')}</Link>
        <Link className="btn bs lb-btn lb-ca-small" to={to('CA15-RegisterReferral')}>{t('ca.registerReferral')}</Link>
      </div>
      {blockedHint && (
        <div className="warn" role="status">
          {blockedHint}{' '}
          {data?.inCallingHours && <Link to={to('CA14b-AttendanceActive')}>{t('ca.goAttendance')}</Link>}
        </div>
      )}

      {home.error && <ErrorState error={home.error} onRetry={() => void home.refetch()} />}

      <div className="card lb-ca-stats" aria-label={t('ca.stat.title')}>
        {!data ? (
          <Skeleton height={44} />
        ) : (
          <>
            <Stat label={t('ca.stat.callsAnswered')} value={String(data.today.callsAnswered)} sub={t('ca.stat.teamAvg', { value: data.today.teamAverage.callsAnswered })} />
            <Stat label={t('ca.stat.talkTime')} value={durationHM(data.today.talkSeconds)} sub={t('ca.stat.teamAvg', { value: durationHM(data.today.teamAverage.talkSeconds) })} />
            <Stat label={t('ca.stat.production')} value={durationHM(data.today.productionSeconds)} sub={t('ca.stat.of', { value: durationHM(data.today.productionTargetSeconds) })} />
            <Stat label={t('ca.stat.registrations')} value={String(data.today.registrations)} sub={t('ca.stat.teamAvg', { value: data.today.teamAverage.registrations })} />
            <Stat label={t('ca.stat.interviews')} value={String(data.today.interviewsBooked)} sub={t('ca.stat.teamAvg', { value: data.today.teamAverage.interviewsBooked })} />
          </>
        )}
      </div>

      <div className="grid2 lb-ca-home-grid">
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} aria-labelledby="ca-work">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 className="h2" id="ca-work">{t('ca.work.title')}</h2>
            {data && <span className="tag lb-ca-todo">{t('ca.work.toDo', { count: data.work.counts.all })}</span>}
          </div>
          <div role="group" aria-label={t('ca.work.filters')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`tag ${filter === f.key ? 'tb' : 'tn'} lb-ca-chip`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {t(f.label, { count: data ? data.work.counts[f.key] : 0 })}
              </button>
            ))}
          </div>
          {!data && !home.error && <SkeletonCard height={260} />}
          {data && items.length === 0 && <p className="sub">{filter === 'all' ? t('ca.work.empty') : t('ca.work.emptyFilter')}</p>}
          {items.map((item) => (
            <PersonRow key={item.key} item={item} callingHours={data?.callingHours} />
          ))}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="h2">{t('ca.month.title')}</h2>
            {!data ? (
              <Skeleton height={40} />
            ) : (
              <div className="grid3">
                <div className="stat">
                  <span className="lbl">{t('ca.month.activated')}</span>
                  <b>
                    {metricValue(data.month.candidatesActivated)}{' '}
                    {data.month.candidatesActivated.target !== null && <span className="sub" style={{ fontSize: 13 }}>/ {data.month.candidatesActivated.target}</span>}
                  </b>
                </div>
                <div className="stat">
                  <span className="lbl">{t('ca.month.vacancies')}</span>
                  <b>
                    {metricValue(data.month.vacanciesCaptured)}{' '}
                    {data.month.vacanciesCaptured.target !== null && <span className="sub" style={{ fontSize: 13 }}>/ {data.month.vacanciesCaptured.target}</span>}
                  </b>
                </div>
                <div className="stat">
                  <span className="lbl">{t('ca.month.refundRate')}</span>
                  <b>
                    {metricValue(data.month.refundRate, true)}{' '}
                    {data.month.refundRate.target !== null && (
                      <span className="sub" style={{ fontSize: 13 }}>/ {t('ca.month.under', { value: Math.round(data.month.refundRate.target * 100) })}</span>
                    )}
                  </b>
                </div>
              </div>
            )}
            <Link to={to('CA11-Targets')} style={{ fontSize: 13, fontWeight: 600 }}>{t('ca.month.seeTargets')}</Link>
          </div>

          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
            <div className="card">
              <div className="lbl" style={{ marginBottom: 4 }}>{t('ca.stuck.title', { count: data?.stuck.length ?? 0 })}</div>
              {data && data.stuck.length === 0 && <p className="sub">{t('ca.stuck.none')}</p>}
              {data?.stuck.map((s) => (
                <div className="row" key={s.jobSeekerId}>
                  <Link to={to('CA08c-InProgress', { id: s.code })} style={{ color: 'var(--ink)' }}>
                    {s.name} · {stuckLabel(s.step, s.failures, t)}
                  </Link>
                  <button
                    type="button"
                    className={`tag ${s.step === 'payment_failed' ? 'tr' : 'ta'} lb-ca-chip`}
                    disabled={resend.isPending}
                    onClick={() =>
                      resend.mutate(s.jobSeekerId, {
                        onSuccess: () => toast.success(t('ca.stuck.sent', { name: s.name })),
                        onError: (err) => toast.error((err as Error).message),
                      })
                    }
                  >
                    {t('ca.stuck.resend')}
                  </button>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="lbl" style={{ marginBottom: 4 }}>{t('ca.risk.title')}</div>
              {data && data.nearRefund.count > 0 ? (
                <>
                  <button type="button" className="row lb-ca-rowbtn" onClick={() => setFilter('all')}>
                    <span>{t('ca.risk.line', { count: data.nearRefund.count })}</span>
                    <span className="tag tr">{data.nearRefund.count}</span>
                  </button>
                  <span className="sub">{t('ca.risk.note')}</span>
                </>
              ) : (
                data && <p className="sub">{t('ca.risk.none')}</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="lbl" style={{ marginBottom: 6 }}>{t('ca.done.title')}</div>
            {data && data.doneToday.length === 0 && <p className="sub">{t('ca.done.none')}</p>}
            {data?.doneToday.map((d, i) => (
              <div className="row" key={`${d.kind}-${d.at}-${i}`}>
                <span>{doneText(d, t)}</span>
                <span className={`tag ${DONE_TONE[d.kind] ?? 'tn'}`}>{doneTag(d, t)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const DONE_TONE: Record<string, string> = { registered: 'tg', interview_booked: 'tb', vacancy_added: 'tc', call_outcome: 'ta' };

function doneText(d: { kind: string; name: string; extra: string | null; status: string }, t: ReturnType<typeof useT>): string {
  switch (d.kind) {
    case 'registered':
      return t('ca.done.registered', { name: d.name });
    case 'interview_booked':
      return t('ca.done.interview_booked', { name: d.name });
    case 'vacancy_added':
      return t('ca.done.vacancy_added', { name: d.name, trade: d.extra ?? '' });
    default:
      return t('ca.done.call_outcome', { name: d.name });
  }
}

const OUTCOMES = ['interested', 'accepted_offer', 'rejected_offer', 'callback_requested', 'not_interested', 'working_now', 'other'];
const SEEKER_STATUSES = ['lead', 'consented', 'pending_activation', 'active', 'paused', 'deactivated', 'placed', 'closed', 'refunded'];

function doneTag(d: { kind: string; status: string; extra: string | null }, t: ReturnType<typeof useT>): string {
  if (d.kind === 'interview_booked' && d.extra) return t('ca.done.interviewOn', { date: formatDayMonthIST(d.extra) });
  if (d.kind === 'vacancy_added') return t('ca.done.captured');
  if (d.kind === 'call_outcome' && OUTCOMES.includes(d.status)) return t(`ca.outcome.${d.status}` as MessageKey);
  if (d.kind === 'registered' && SEEKER_STATUSES.includes(d.status)) return t(`ca.seekerStatus.${d.status}` as MessageKey);
  return d.status;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 110 }}>
      <span className="lbl">{label}</span>
      <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink)' }}>{value}</b>
      <span className="sub">{sub}</span>
    </span>
  );
}
