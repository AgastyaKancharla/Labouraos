import { useState } from 'react';
import { CallRoutingPhoneCard } from '../_lib/CallRoutingPhoneCard';
import { ToneTile } from '../../../components/ToneTile';
import { Link } from 'react-router-dom';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton, SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatDayMonthIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { useHome, type MetricView, type WorkCategory } from '../_lib/api';
import { CallNextButton } from '../_lib/CallNextButton';
import { clock12, durationHM, whenShort } from '../_lib/format';
import { useStuckList } from '../../shared/StuckList';
import { HomeDoneRows, HomeStuckRows } from '../_lists/HomeLists';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';
import { useNow } from '../../../lib/useNow';
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
  { key: 'app_signups', label: 'ca.filter.appSignups' },
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
  const qc = useQueryClient();
  const now = useNow(60_000);
  // "Not a lead": an unknown caller handled without registering (every repeat call from the number goes too).
  const closeCaller = useMutation({
    mutationFn: (callbackTaskId: string) => api.post(`/telephony/callbacks/${encodeURIComponent(callbackTaskId)}/complete`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['call-work'] }),
  });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const data = home.data;
  const newCallers = data?.newCallers ?? [];
  // 22 Nov: the count is every row shown (it said 1 with two people listed).
  const stuckList = useStuckList();
  const stuckCount = stuckList.data?.rows.length ?? 0;

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

      {data?.callRoutingPhoneSet === false && <CallRoutingPhoneCard isSet={false} onSaved={() => void home.refetch()} />}

      {home.error && <ErrorState error={home.error} onRetry={() => void home.refetch()} />}

      <div className="card lb-ca-stats" aria-label={t('ca.stat.title')}>
        {!data ? (
          <Skeleton height={44} />
        ) : (
          <>
            <Stat bar="var(--royal)" label={t('ca.stat.callsAnswered')} value={String(data.today.callsAnswered)} sub={t('ca.stat.teamAvg', { value: data.today.teamAverage.callsAnswered })} />
            <Stat bar="var(--cyan-raw)" label={t('ca.stat.talkTime')} value={durationHM(data.today.talkSeconds)} sub={t('ca.stat.teamAvg', { value: durationHM(data.today.teamAverage.talkSeconds) })} />
            <Stat bar="var(--good)" label={t('ca.stat.production')} value={durationHM(data.today.productionSeconds)} sub={t('ca.stat.of', { value: durationHM(data.today.productionTargetSeconds) })} />
            <Stat bar="var(--gold-raw)" label={t('ca.stat.registrations')} value={String(data.today.registrations)} sub={t('ca.stat.teamAvg', { value: data.today.teamAverage.registrations })} />
            <Stat bar="var(--orange-raw)" label={t('ca.stat.interviews')} value={String(data.today.interviewsBooked)} sub={t('ca.stat.teamAvg', { value: data.today.teamAverage.interviewsBooked })} />
          </>
        )}
      </div>

      <div className="grid2 lb-ca-home-grid">
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }} aria-labelledby="ca-work">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 className="h2 lb-h-tile" id="ca-work">
              <ToneTile icon="workList" tone="royal" size="sm" />
              {t('ca.work.title')}
            </h2>
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
          {newCallers.length > 0 && (filter === 'all' || filter === 'callbacks') && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="new-callers">
              <div className="lbl lb-h-tile">
                <ToneTile icon="callCenter" tone="cyan" size="sm" />
                {t('ca.newCallers.title', { count: newCallers.length })}
              </div>
              {newCallers.map((c) => (
                <div className="row" key={c.callbackTaskId}>
                  <Link to={`${to('CA17b-UnknownCaller')}?task=${encodeURIComponent(c.callbackTaskId)}`} style={{ color: 'var(--ink)', minWidth: 0 }}>
                    <span className="nm">{t('ca.newCallers.row', { phone: c.maskedPhone })}</span>{' '}
                    <span className="sub">
                      {c.count > 1
                        ? t('ca.newCallers.times', { count: c.count, time: whenShort(c.lastCalledAt, now, t) })
                        : t('ca.newCallers.when', { time: whenShort(c.firstCalledAt, now, t) })}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="tag tn lb-ca-chip"
                    disabled={closeCaller.isPending}
                    onClick={() =>
                      closeCaller.mutate(c.callbackTaskId, {
                        onSuccess: () => toast.success(t('ca.newCallers.doneToast')),
                        onError: (err) => toast.error((err as Error).message),
                      })
                    }
                  >
                    {t('ca.newCallers.done')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="h2 lb-h-tile">
              <ToneTile icon="targets" tone="gold" size="sm" />
              {t('ca.month.title')}
            </h2>
            {!data ? (
              <Skeleton height={40} />
            ) : (
              <div className="grid3">
                <div className="stat">
                  <span className="lb-ca-bar" style={{ background: 'var(--cyan-raw)' }} aria-hidden="true" />
                  <span className="lbl">{t('ca.month.activated')}</span>
                  <b>
                    {metricValue(data.month.candidatesActivated)}{' '}
                    {data.month.candidatesActivated.target !== null && <span className="sub" style={{ fontSize: 13 }}>/ {data.month.candidatesActivated.target}</span>}
                  </b>
                </div>
                <div className="stat">
                  <span className="lb-ca-bar" style={{ background: 'var(--gold-raw)' }} aria-hidden="true" />
                  <span className="lbl">{t('ca.month.vacancies')}</span>
                  <b>
                    {metricValue(data.month.vacanciesCaptured)}{' '}
                    {data.month.vacanciesCaptured.target !== null && <span className="sub" style={{ fontSize: 13 }}>/ {data.month.vacanciesCaptured.target}</span>}
                  </b>
                </div>
                <div className="stat">
                  <span className="lb-ca-bar" style={{ background: 'var(--orange-raw)' }} aria-hidden="true" />
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

          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))' }}>
            <div className="card">
              <div className="lbl lb-h-tile" style={{ marginBottom: 4 }}>
                <ToneTile icon="requests" tone="orange" size="sm" />
                {t('ca.stuck.title', { count: stuckCount })}
              </div>
              {/* 22 Nov: every stuck job seeker, business and partner of his (GET /profile-stuck/list), with the
                  profile box's buttons; waiting for the Team Lead's ID check shows that, with no resend. */}
              {/* 23 Nov (rev 210): the console lists' row style — bold name, one status line, one button. */}
              <HomeStuckRows rows={stuckList.data?.rows} />
            </div>
            <div className="card">
              <div className="lbl lb-h-tile" style={{ marginBottom: 4 }}>
                <ToneTile icon="refundApprovals" tone="red" size="sm" />
                {t('ca.risk.title')}
              </div>
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
            <div className="lbl lb-h-tile" style={{ marginBottom: 6 }}>
              <ToneTile icon="checkRegistrations" tone="good" size="sm" />
              {t('ca.done.title')}
            </div>
            {/* 23 Nov (rev 210): the same row style; tapping a row opens the person (a vacancy, its business). */}
            <HomeDoneRows rows={data?.doneToday} tagOf={(d) => doneTag(d, t)} />
          </div>
        </section>
      </div>
      {/* Set: a small card at the end to change it (not set: the warning card at the top). */}
      {data?.callRoutingPhoneSet === true && <CallRoutingPhoneCard isSet onSaved={() => void home.refetch()} />}
    </div>
  );
}

const OUTCOMES = ['interested', 'accepted_offer', 'rejected_offer', 'callback_requested', 'not_interested', 'working_now', 'wrong_number', 'do_not_call', 'busy', 'switched_off', 'other'];
const SEEKER_STATUSES = ['lead', 'consented', 'pending_activation', 'active', 'paused', 'deactivated', 'placed', 'closed', 'refunded'];

function doneTag(d: { kind: string; status: string; extra: string | null }, t: ReturnType<typeof useT>): string {
  if (d.kind === 'interview_booked' && d.extra) return t('ca.done.interviewOn', { date: formatDayMonthIST(d.extra) });
  if (d.kind === 'vacancy_added') return t('ca.done.captured');
  if (d.kind === 'business_registered') return t('ca.done.businessTag');
  if (d.kind === 'partner_registered') return t('ca.done.partnerTag');
  if (d.kind === 'call_outcome' && OUTCOMES.includes(d.status)) return t(`ca.outcome.${d.status}` as MessageKey);
  if (d.kind === 'registered' && SEEKER_STATUSES.includes(d.status)) return t(`ca.seekerStatus.${d.status}` as MessageKey);
  return d.status;
}

function Stat({ label, value, sub, bar }: { label: string; value: string; sub: string; bar: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 110 }}>
      <span className="lb-ca-bar" style={{ background: bar }} aria-hidden="true" />
      <span className="lbl">{label}</span>
      <b style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink)' }}>{value}</b>
      <span className="sub">{sub}</span>
    </span>
  );
}
