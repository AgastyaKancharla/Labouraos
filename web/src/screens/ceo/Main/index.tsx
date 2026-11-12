import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { NavIcon, UiIcon } from '../../../components/Icon';
import { Skeleton, SkeletonCard } from '../../../components/Skeleton';
import { HomeNotifications } from '../../../components/HomeNotifications';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { formatDateIST, formatDayMonthIST, formatLongDateIST, formatMonthIST, istPartOfDay, istStartOfDay } from '../../../lib/format/date';
import { formatINR, formatINRCompact } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { Bars, HBar, humanize } from '../_kit/kit';
import '../_kit/ceo.css';
import { useCommandCenter, type NearSide } from './useCommandCenter';

/**
 * CEO Command Center — design Main.dc.html (guide: "The CEO Command Center
 * (decided 9 Nov)"). The period picker changes every number; every number
 * links to the list behind it. All sums are done on the server.
 */
function periodLabel(period: Period, t: ReturnType<typeof useT>): string {
  if (period.preset === 'month') return formatMonthIST(istStartOfDay(period.from));
  if (period.preset === 'today') return t('period.today');
  return periodRangeLabel(period);
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part * 100) / whole);
}

function Stage({ to, label, value, foot, fill, warm, goal, loading }: { to: string; label: string; value: ReactNode; foot: ReactNode; fill: number; warm?: boolean; goal?: 'c' | 'g'; loading?: boolean }) {
  return (
    <Link to={to} className={`stage ceo-stage-link${goal ? ` goal-${goal}` : ''}`} aria-busy={loading || undefined}>
      <span className="ceo-stage-label">{label}</span>
      {loading ? <Skeleton width="50%" height={26} /> : <span className="num-l">{value}</span>}
      <div className="track">
        <div className={warm ? 'fill warm' : 'fill'} style={{ width: `${Math.max(0, Math.min(100, fill))}%` }} />
      </div>
      <span className="ceo-stage-foot">{foot}</span>
    </Link>
  );
}

function NearStage({ to, side, noun, windowDays, loading }: { to: string; side?: NearSide; noun: string; windowDays: number; loading?: boolean }) {
  return (
    <Link to={to} className="stage ceo-stage-link" style={{ borderColor: 'rgba(251,104,0,0.45)', background: 'rgba(251,104,0,0.05)' }} aria-busy={loading || undefined}>
      <span className="ceo-stage-label">Close to a refund · next {windowDays} days</span>
      {loading || !side ? (
        <Skeleton width="50%" height={26} />
      ) : (
        <span className="num-l" style={{ color: 'var(--critical)' }}>
          {side.count} <span className="ceo-sub">{noun}</span>
        </span>
      )}
      {side && (
        <>
          <span className="ceo-stage-foot">
            {formatINR(side.atStakePaise)} at stake · 0–5 days <b>{side.buckets['0-5']}</b> · 6–10 <b>{side.buckets['6-10']}</b> · 11–15 <b>{side.buckets['11-15']}</b>
          </span>
          <span className="ceo-stage-foot" style={{ color: 'var(--royal)', fontWeight: 600 }}>
            See who and act →
          </span>
        </>
      )}
    </Link>
  );
}

function Vertical({ to, name, icon, tile, value, unit, lines, loading }: { to: string; name: string; icon: Parameters<typeof NavIcon>[0]['name']; tile: string; value: ReactNode; unit: string; lines: [string, string][]; loading?: boolean }) {
  return (
    <Link to={to} className="vcard" aria-busy={loading || undefined}>
      <div className="ceo-vhead">
        <span className={`tile ${tile}`}>
          <NavIcon name={icon} />
        </span>
        <span className="ceo-vname">{name}</span>
        <span className="ceo-arrow" aria-hidden="true">
          →
        </span>
      </div>
      {loading ? (
        <Skeleton width="60%" height={24} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="num-l">{value}</span>
          <span className="ceo-sub">{unit}</span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!loading &&
          lines.map(([text, color]) => (
            <span className="ceo-vline" key={text}>
              <span className="dot" style={{ background: color }} />
              {text}
            </span>
          ))}
      </div>
    </Link>
  );
}

const ACTION_TEXT: Record<string, string> = {
  refund_rejected: 'rejected refund',
  refund_approved: 'approved refund',
  refund_priority_reminder_sent: 'sent a refund-priority reminder for',
  'pii.full_phone_viewed': 'viewed phone numbers',
};

function initials(name: string | null): string {
  if (!name) return '•';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return formatDayMonthIST(iso);
}

export default function CommandCenter() {
  const t = useT();
  const now = useNow(60_000);
  const { session } = useAuth();
  const to = useScreenPath();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const { money, pipeline, verticals, insights, guarantee, firstInterview, health } = useCommandCenter(period);
  const all = [money, pipeline, verticals, insights, guarantee, firstInterview, health];
  const refreshAll = () => all.forEach((q) => void q.refetch());
  const refreshing = all.some((q) => q.isFetching);

  const firstName = session?.staff.name.split(/\s+/)[0] ?? '';
  const label = periodLabel(period, t);
  const m = money.data;
  const p = pipeline.data;
  const v = verticals.data;
  const ins = insights.data;
  const g = guarantee.data?.range?.total;
  const reviewCount = v ? v.refunds.waiting + v.payments.failed + (p ? p.jobSeekers.closeToRefund.buckets['0-5'] + p.businesses.closeToRefund.buckets['0-5'] : 0) : null;
  const windowDays = p?.windowDays ?? 15;

  return (
    <div className="lb-page">
      <TopBar
        eyebrow={
          <span style={{ color: 'var(--royal)' }}>
            {formatLongDateIST(now)} · {t('cc.place')}
          </span>
        }
        title={t(`greeting.${istPartOfDay(now)}`, { name: firstName })}
        titleBadge={reviewCount ? <Link to={to('C-Refunds')} className="pill" style={{ background: 'var(--gold-raw)', color: 'var(--navy)' }}>{`${reviewCount} item${reviewCount === 1 ? '' : 's'} need your review`}</Link> : undefined}
        subtitle={t('cc.subtitle', { label: periodRangeLabel(period) })}
        period={period}
        onPeriodChange={setPeriod}
        actions={
          <Button variant="primary" onClick={refreshAll} loading={refreshing} icon={<UiIcon name="refresh" size={14} />}>
            {t('common.refresh')}
          </Button>
        }
      />
      <HomeNotifications />

      {/* Money ------------------------------------------------------------ */}
      <section className="lb-section" aria-labelledby="cc-money">
        <div className="eyebrow" id="cc-money">
          {t('cc.money', { label })}
        </div>
        <div className="money-grid">
          <Link to={to('C-Reports')} className="hero" aria-busy={money.isPending || undefined}>
            <div className="lb-row-between">
              <span className="lb-hero__label">{t('cc.netRevenue')}</span>
              {m && m.changePercent !== null && (
                <span className="pill" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff' }}>
                  {m.changePercent >= 0 ? '↑' : '↓'} {Math.abs(m.changePercent)}% vs the period before
                </span>
              )}
            </div>
            {money.isPending ? (
              <>
                <Skeleton width="60%" height={40} style={{ opacity: 0.35 }} />
                <Skeleton width="80%" style={{ opacity: 0.35 }} />
              </>
            ) : money.isError || !m ? (
              <span className="lb-hero__detail">{t('error.title')}</span>
            ) : (
              <>
                <div className="lb-hero__value" data-testid="cc-net">
                  {formatINR(m.netPaise)}
                </div>
                <div className="lb-hero__detail">{t('cc.netRevenueDetail', { gross: formatINR(m.grossPaise), refunds: formatINR(m.refundsPaidPaise) })}</div>
                {m.grossPaise > 0 ? (
                  <div className="lb-hero__split" aria-hidden="true">
                    <div style={{ width: `${percent(m.placementFeePaise, m.grossPaise)}%`, background: 'var(--cyan-raw)' }} />
                    <div style={{ width: `${percent(m.activationPaise, m.grossPaise)}%`, background: 'var(--gold-raw)' }} />
                  </div>
                ) : (
                  <div className="lb-hero__detail">{t('cc.noMoneyYet')}</div>
                )}
                <div className="lb-hero__legend">
                  <span>
                    <i style={{ background: 'var(--cyan-raw)' }} />
                    {t('cc.placementFees', { amount: formatINR(m.placementFeePaise), count: m.placementCount })}
                  </span>
                  <span>
                    <i style={{ background: 'var(--gold-raw)' }} />
                    {t('cc.activationFees', { amount: formatINR(m.activationPaise), count: m.activationCount })}
                  </span>
                </div>
              </>
            )}
            <div className="swoosh lb-hero__swoosh" />
          </Link>

          <Link to={to('C-Refunds')} className="panel lb-money-card" aria-busy={money.isPending || undefined}>
            <div className="lb-row-between">
              <span className="lb-money-card__title">
                <span className="tile t-red">
                  <NavIcon name="refundApprovals" />
                </span>
                {t('cc.refundExposure')}
              </span>
              {m && m.refundExposure.totalPaise > 0 && <span className="pill crit">{t('cc.act')}</span>}
            </div>
            {money.isError ? (
              <ErrorState error={money.error} onRetry={() => void money.refetch()} compact />
            ) : !m ? (
              <>
                <Skeleton width="55%" height={34} />
                <Skeleton width="85%" />
              </>
            ) : (
              <>
                <div className="num-xl" data-testid="cc-exposure">
                  {formatINR(m.refundExposure.totalPaise)}
                </div>
                <div className="lb-money-card__lines">
                  <span>
                    <b style={{ color: 'var(--critical)' }}>{formatINR(m.refundExposure.owedNowPaise)}</b> {t('cc.awaitingApproval')}
                  </span>
                  <span>
                    <b style={{ color: 'var(--amber)' }}>{formatINR(m.refundExposure.atRiskPaise)}</b> {t('cc.atRisk')}
                  </span>
                </div>
              </>
            )}
          </Link>

          <Link to={to('C-Payments-Out')} className="panel lb-money-card" aria-busy={money.isPending || undefined}>
            <div className="lb-row-between">
              <span className="lb-money-card__title">
                <span className="tile t-orange">
                  <NavIcon name="referrals" />
                </span>
                {t('cc.payoutsDue')}
              </span>
              {m && m.payouts.failedCount > 0 && <span className="pill danger">{t('cc.failed', { count: m.payouts.failedCount })}</span>}
            </div>
            {!m ? (
              <>
                <Skeleton width="45%" height={34} />
                <Skeleton width="80%" />
              </>
            ) : (
              <>
                <div className="num-xl" data-testid="cc-payouts">
                  {formatINR(m.payouts.duePaise)}
                </div>
                <div className="lb-money-card__lines">
                  <span>{t('cc.payoutsDetail', { count: m.payouts.dueCount })}</span>
                  <span>{t('cc.payoutsRule')}</span>
                </div>
              </>
            )}
          </Link>

          <Link to={to('C-Payments-GST')} className="panel lb-money-card" aria-busy={money.isPending || undefined}>
            <div className="lb-row-between">
              <span className="lb-money-card__title">
                <span className="tile t-gold">
                  <NavIcon name="vacancies" />
                </span>
                {t('cc.gst')}
              </span>
              <span className="pill info">{t('cc.toRemit')}</span>
            </div>
            {!m ? (
              <>
                <Skeleton width="50%" height={34} />
                <Skeleton width="75%" />
              </>
            ) : (
              <>
                <div className="num-xl" data-testid="cc-gst">
                  {formatINR(m.gstPaise)}
                </div>
                <div className="lb-money-card__lines">
                  <span>{t('cc.gstDetail', { count: m.placementCount })}</span>
                  <span>{t('cc.gstLedger')}</span>
                </div>
              </>
            )}
          </Link>
        </div>
        {/* N1: money still under guarantee (confirmed 11 Nov) */}
        <Link to={to('C-Reports')} className="panel" style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', padding: '12px 18px', textDecoration: 'none', color: 'var(--text)' }} aria-busy={guarantee.isPending || undefined}>
          <span className="ceo-stage-label" style={{ minWidth: 200 }}>
            Money still under guarantee · {label}
          </span>
          {guarantee.isError ? (
            <span className="ceo-sub">Could not load — refresh to try again.</span>
          ) : !g ? (
            <Skeleton width="40%" />
          ) : (
            <>
              <span>
                <b style={{ color: 'var(--amber)' }} data-testid="cc-under-guarantee">
                  {formatINR(g.couldGoBackPaise)}
                </b>{' '}
                could still go back
              </span>
              <span>
                <b style={{ color: 'var(--good)' }}>{formatINR(g.safelyEarnedPaise)}</b> safely earned
              </span>
              <span className="ceo-sub">of {formatINR(g.receivedPaise)} received (incl. GST) · ₹499s inside their 30 days, placement fees inside their 60 days</span>
            </>
          )}
        </Link>
      </section>

      {/* Business pipeline ---------------------------------------------- */}
      <Card title={`Business pipeline · ${label}`} aside="Click any number to see who · “close to a refund” is always right now">
        {pipeline.isError ? (
          <ErrorState error={pipeline.error} onRetry={() => void pipeline.refetch()} compact />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="eyebrow">Job seekers</div>
            <div className="ceo-stages">
              <Stage to={to('JobSeekers')} label="Registered" value={p?.jobSeekers.registered} foot="job seekers · OTP-verified" fill={100} loading={!p} />
              <Stage to={to('JobSeekers')} label="Stuck before paying" value={p?.jobSeekers.stuckBeforePaying} foot="link not finished · call them" fill={percent(p?.jobSeekers.stuckBeforePaying ?? 0, p?.jobSeekers.registered ?? 0)} loading={!p} />
              <Stage to={to('C-Payments')} label="Paid the ₹499 fee" value={p?.jobSeekers.paid} foot={`${p?.jobSeekers.paidPercent ?? 0}% of registered`} fill={p?.jobSeekers.paidPercent ?? 0} loading={!p} />
              <Stage to={to('C-Interviews')} label="Offered a job" value={p?.jobSeekers.offered} foot="job seekers with an offer" fill={percent(p?.jobSeekers.offered ?? 0, p?.jobSeekers.paid ?? 0)} loading={!p} />
              <Stage to={to('C-Placements')} label="Accepted the offer" value={p?.jobSeekers.accepted} foot={`${p?.jobSeekers.acceptedPercent ?? 0}% — ${p?.jobSeekers.declined ?? 0} declined`} fill={p?.jobSeekers.acceptedPercent ?? 0} loading={!p} />
              <Stage to={to('C-Placements')} label="Joined" value={p?.jobSeekers.joined} foot="started work" fill={p?.jobSeekers.joinedPercent ?? 0} goal="c" loading={!p} />
              <NearStage to={to('C-NearRefund')} side={p?.jobSeekers.closeToRefund} noun="job seekers" windowDays={windowDays} loading={!p} />
            </div>
            {firstInterview.data && (
              <Link to={to('JobSeekers')} className="rule" style={{ borderLeftColor: 'var(--gold-raw)', fontSize: 12.5, textDecoration: 'none', color: 'var(--text)' }} data-testid="cc-first-interview">
                <b>{firstInterview.data.waitingCount}</b> paid job seeker{firstInterview.data.waitingCount === 1 ? '' : 's'} with no interview {firstInterview.data.minDays}+ days after paying
                {firstInterview.data.oldestDays !== null ? ` · longest wait ${firstInterview.data.oldestDays} days` : ''} — the early warning before a refund.
              </Link>
            )}
            <div className="eyebrow">Businesses</div>
            <div className="ceo-stages">
              <Stage to={to('C-FieldOps')} label="Field visits" value={p?.businesses.fieldVisits} foot="photo + selfie + GPS" fill={100} warm loading={!p} />
              <Stage to={to('C-Businesses')} label="Businesses signed up" value={p?.businesses.signedUp} foot="owner confirmed by OTP" fill={percent(p?.businesses.signedUp ?? 0, p?.businesses.fieldVisits ?? 0)} warm loading={!p} />
              <Stage to={to('C-Vacancies')} label="Job openings added" value={p?.businesses.openingsAdded} foot={`${p?.businesses.vacanciesAdded ?? 0} vacancies from businesses`} fill={100} warm loading={!p} />
              <Stage to={to('C-Placements')} label="Openings filled" value={p?.businesses.filled} foot={`${p?.businesses.fillPercent ?? 0}% fill rate`} fill={p?.businesses.fillPercent ?? 0} warm goal="g" loading={!p} />
              <Stage to={to('C-Claims')} label="Workers who dropped out" value={p?.businesses.droppedOut} foot={`${p?.businesses.replacingNow ?? 0} being replaced now`} fill={percent(p?.businesses.droppedOut ?? 0, p?.businesses.filled ?? 0)} loading={!p} />
              <NearStage to={to('C-NearRefund')} side={p?.businesses.closeToRefund} noun="businesses" windowDays={windowDays} loading={!p} />
            </div>
          </div>
        )}
      </Card>

      {/* Every vertical -------------------------------------------------- */}
      <section className="lb-section">
        <div className="lb-row-between">
          <div className="eyebrow">Every vertical</div>
          <span className="ceo-sub">Click any card to open that vertical</span>
        </div>
        {verticals.isError ? (
          <ErrorState error={verticals.error} onRetry={() => void verticals.refetch()} />
        ) : (
          <div className="vgrid">
            <Vertical to={to('JobSeekers')} name="Job Seekers" icon="jobSeekers" tile="t-cyan" loading={!v} value={v?.jobSeekers.activeInPool} unit="active in pool" lines={v ? [[`${v.jobSeekers.nearRefund} near 30-day refund deadline`, 'var(--orange-raw)'], [`${v.jobSeekers.atTwoHits} at 2 of 3 hits`, 'var(--gold-raw)'], [`${v.jobSeekers.waitingOnKyc} waiting on KYC`, 'var(--royal)']] : []} />
            <Vertical to={to('C-Referrals')} name="Referrals" icon="referrals" tile="t-orange" loading={!v} value={v?.referrals.partners} unit="partners" lines={v ? [[`${v.referrals.referredJoined} referred candidates joined`, 'var(--good)'], [`${v.referrals.payoutsDueCount} payouts due · ${formatINR(v.referrals.payoutsDuePaise)}`, 'var(--gold-raw)'], [`${v.referrals.individual} individual · ${v.referrals.business} business`, 'var(--royal)']] : []} />
            <Vertical to={to('C-Businesses')} name="Businesses" icon="businesses" tile="t-royal" loading={!v} value={v?.businesses.active} unit="active clients" lines={v ? [[`${v.businesses.signedInRange} signed in ${label}`, 'var(--good)'], [`${v.businesses.geofenceFlagged} visit${v.businesses.geofenceFlagged === 1 ? '' : 's'} flagged by geofence`, 'var(--orange-raw)'], [`Top area: ${v.businesses.topArea ?? '—'}`, 'var(--royal)']] : []} />
            <Vertical to={to('C-Vacancies')} name="Vacancies" icon="vacancies" tile="t-gold" loading={!v} value={v?.vacancies.open} unit={`open · ${v?.vacancies.positions ?? 0} positions`} lines={v ? [[`${v.vacancies.over15Days} open more than 15 days`, 'var(--orange-raw)'], [`${v.vacancies.replacements} are replacements`, 'var(--gold-raw)'], [`Avg time to fill: ${v.vacancies.averageDaysToFill ?? '—'} days`, 'var(--royal)']] : []} />
            <Vertical to={to('C-Placements')} name="Placements" icon="placements" tile="t-navy" loading={!v} value={v?.placements.working} unit="working now" lines={v ? [[`${v.placements.replacing} in replacement window`, 'var(--orange-raw)'], [`${v.placements.paused} clock paused (rejections)`, 'var(--gold-raw)'], [`${v.placements.cleared} cleared the 60-day guarantee`, 'var(--good)']] : []} />
            <Vertical to={to('C-Payments')} name="Payments" icon="payments" tile="t-gold" loading={!v} value={v ? formatINRCompact(v.payments.receivedInclGstPaise) : ''} unit="received incl. GST" lines={v ? [[`${v.payments.failed} payouts failed`, 'var(--red-raw)'], [`${v.payments.processing} still processing`, 'var(--gold-raw)'], [`${v.payments.settled} settled`, 'var(--good)']] : []} />
            <Vertical to={to('C-Refunds')} name="Refund Approvals" icon="refundApprovals" tile="t-red" loading={!v} value={v?.refunds.waiting} unit={`waiting · ${v ? formatINR(v.refunds.waitingPaise) : ''}`} lines={v ? [[`${v.refunds.businessCount} business · ${formatINR(v.refunds.businessPaise)}`, 'var(--orange-raw)'], [`${v.refunds.jobSeekerCount} job-seeker · ${formatINR(v.refunds.jobSeekerPaise)}`, 'var(--gold-raw)'], [v.refunds.oldestDays !== null ? `Oldest waiting ${v.refunds.oldestDays} days` : 'Nothing waiting', 'var(--royal)']] : []} />
            <Vertical to={to('C-CallCenter')} name="Call Center" icon="callCenter" tile="t-cyan" loading={!v} value={v?.callCenter.callsToday} unit="calls today" lines={v ? [[`${v.callCenter.connectPercent}% connect rate`, 'var(--good)'], [`${v.callCenter.missedToReturn} missed calls to return`, 'var(--gold-raw)']] : []} />
            <Vertical to={to('C-FieldOps')} name="Field Ops" icon="fieldOps" tile="t-orange" loading={!v} value={v?.fieldOps.visitsToday} unit="visits today" lines={v ? [[`${v.fieldOps.vacanciesThisWeek} vacancies captured this week`, 'var(--good)'], [`${v.fieldOps.geofenceToday} geofence mismatch today`, 'var(--orange-raw)'], [`${v.fieldOps.agentsInField} agents in the field`, 'var(--royal)']] : []} />
            <Vertical to={to('C-Team')} name="Team & Access" icon="teamAndAccess" tile="t-royal" loading={!v} value={v?.team.accounts} unit="staff accounts" lines={v ? [[v.team.twoFactorOnAllManagement ? '2FA on every management account' : '2FA missing on a management account', v.team.twoFactorOnAllManagement ? 'var(--good)' : 'var(--red-raw)'], [`${v.team.invitesPending} invites not accepted`, 'var(--gold-raw)'], [`${v.team.signedInNow} signed in now`, 'var(--royal)']] : []} />
          </div>
        )}
      </section>

      {/* Live activity --------------------------------------------------- */}
      <Card title="Live activity" aside={<Link to={to('C-Audit')}>Full audit log →</Link>}>
        {insights.isPending ? (
          <Skeleton height={120} />
        ) : insights.isError ? (
          <ErrorState error={insights.error} onRetry={() => void insights.refetch()} compact />
        ) : ins && ins.activity.length ? (
          ins.activity.map((a) => (
            <div className="row" key={a.id} style={{ alignItems: 'center' }}>
              <div className="avatar" style={{ justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                {initials(a.actor)}
              </div>
              <div style={{ flex: 1, fontSize: 13 }}>
                {a.actor ?? 'System'} {ACTION_TEXT[a.action] ?? humanize(a.action).toLowerCase()} <b>{a.entityCode}</b>
              </div>
              <span className="ceo-sub">{ago(a.at, now)}</span>
            </div>
          ))
        ) : (
          <p className="ceo-sub">No activity yet.</p>
        )}
      </Card>

      {/* Charts ---------------------------------------------------------- */}
      {insights.isPending ? (
        <div className="three-col">
          <SkeletonCard height={200} />
          <SkeletonCard height={200} />
          <SkeletonCard height={200} />
        </div>
      ) : ins ? (
        <div className="three-col">
          <Card title="Revenue by week" aside="ex-GST, net of refunds">
            <Bars items={ins.revenueByWeek.map((w) => ({ label: formatDayMonthIST(istStartOfDay(w.week)), value: w.netPaise }))} format={(n) => formatINRCompact(n)} />
          </Card>
          <Card title="Candidates joined by week" aside="placements">
            <Bars warm items={ins.joinedByWeek.map((w) => ({ label: formatDayMonthIST(istStartOfDay(w.week)), value: w.count }))} format={(n) => String(n)} />
          </Card>
          <Card title="Supply vs demand by trade">
            <div className="ceo-sub" style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
              <span>
                <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--cyan-raw)', marginRight: 5 }} />
                Candidates in pool
              </span>
              <span>
                <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--orange-raw)', marginRight: 5 }} />
                Open positions
              </span>
            </div>
            {(() => {
              const max = Math.max(1, ...ins.supplyDemand.map((s) => Math.max(s.pool, s.open)));
              return ins.supplyDemand.map((s) => (
                <div className="hbar-row" key={s.trade} style={{ marginBottom: 6 }}>
                  <span style={{ fontWeight: ins.shortTrades.includes(s.trade) ? 700 : 400 }}>{s.trade}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div className="ceo-hbar" style={{ width: `${Math.round((s.pool / max) * 100)}%`, background: 'var(--cyan-raw)' }} />
                    <div className="ceo-hbar" style={{ width: `${Math.round((s.open / max) * 100)}%`, background: 'var(--orange-raw)' }} />
                  </div>
                  <span style={{ textAlign: 'right', color: ins.shortTrades.includes(s.trade) ? 'var(--critical)' : undefined }}>
                    {s.pool} / {s.open}
                  </span>
                </div>
              ));
            })()}
            {ins.supplyDemand.length === 0 && <p className="ceo-sub">No candidates or openings yet.</p>}
            {ins.shortTrades.length > 0 && (
              <p style={{ color: 'var(--critical)', fontSize: 12 }}>Short on {ins.shortTrades.slice(0, 3).join(', ').toLowerCase()} — recruit more before new vacancies land.</p>
            )}
          </Card>
        </div>
      ) : null}

      {ins && (
        <div className="two-col">
          <Card title="Team performance today" aside={<Link to={to('C-Team')}>All staff →</Link>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 18 }}>
              <div>
                <div className="eyebrow">Call agents · connects / calls</div>
                {ins.team.callAgents.map((a) => (
                  <div className="row" key={a.id} style={{ alignItems: 'center' }}>
                    <div className="avatar" style={{ justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                      {initials(a.name)}
                    </div>
                    <span style={{ flex: 1 }}>{a.name}</span>
                    <b>
                      {a.connects} / {a.calls}
                    </b>
                    <span className={`pill ${a.connectPercent >= 38 ? 'good' : 'warn'}`}>{a.connectPercent}%</span>
                  </div>
                ))}
                {ins.team.callAgents.length === 0 && <p className="ceo-sub">No calls yet today.</p>}
              </div>
              <div>
                <div className="eyebrow">Field agents · vacancies this week</div>
                {ins.team.fieldAgents.map((a) => (
                  <div className="row" key={a.id} style={{ alignItems: 'center' }}>
                    <div className="avatar" style={{ justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                      {initials(a.name)}
                    </div>
                    <span style={{ flex: 1 }}>{a.name}</span>
                    <b>{a.vacancies}</b>
                    <span className="ceo-sub">{a.topArea ?? ''}</span>
                  </div>
                ))}
                {ins.team.fieldAgents.length === 0 && <p className="ceo-sub">No vacancies captured this week.</p>}
              </div>
            </div>
          </Card>
          <Card title="Open vacancies by area" aside={`${ins.openVacanciesTotal} total`}>
            {(() => {
              const max = Math.max(1, ...ins.openVacanciesByArea.map((a) => a.count));
              return ins.openVacanciesByArea.map((a) => <HBar key={a.name} label={a.name} value={a.count} max={max} right={a.count} warm />);
            })()}
            {ins.openVacanciesByArea.length === 0 && <p className="ceo-sub">No open vacancies.</p>}
          </Card>
        </div>
      )}

      <div className="two-col">
        <Card title="Pricing & policy in force" aside={ins ? <Link to={to('C-Pricing')}>{`Changed ${formatDateIST(ins.pricing.effectiveFrom)} · only you can edit · Edit →`}</Link> : undefined}>
          {ins ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
              {[
                [formatINR(ins.pricing.activationFeePaise), `Activation · ${ins.pricing.guaranteeDays}-day guarantee`, 'var(--cyan-raw)'],
                [`${ins.pricing.placementFeePercent}% + ${ins.pricing.gstPercent}%`, 'Placement fee + GST', 'var(--royal)'],
                [`${ins.pricing.replacementWindowDays} / ${ins.pricing.replacementSearchDays} days`, 'Replacement / refund from', 'var(--gold-raw)'],
                [formatINR(ins.pricing.referralPayoutPaise), 'Referral payout on joining', 'var(--orange-raw)'],
              ].map(([value, text, color]) => (
                <div className="rule" key={text} style={{ borderLeftColor: color }}>
                  <div className="num-m">{value}</div>
                  <div className="ceo-sub">{text}</div>
                </div>
              ))}
            </div>
          ) : (
            <Skeleton height={60} />
          )}
        </Card>
        <Card
          title="System health"
          aside={health.data ? <span className={`pill ${health.data.status === 'healthy' ? 'good' : health.data.status === 'degraded' ? 'warn' : 'danger'}`}>{health.data.status === 'healthy' ? 'All running' : humanize(health.data.status)}</span> : undefined}
        >
          {health.isError ? (
            <ErrorState error={health.error} onRetry={() => void health.refetch()} compact />
          ) : health.data ? (
            <Link to={to('C-System')} className="ceo-health" style={{ textDecoration: 'none', color: 'var(--text)' }}>
              {health.data.components.map((c) => (
                <span key={c.name}>
                  <span className="dot" style={{ background: c.status === 'healthy' ? 'var(--good)' : c.status === 'degraded' ? 'var(--gold-raw)' : 'var(--red-raw)' }} />
                  {c.name}
                </span>
              ))}
            </Link>
          ) : (
            <Skeleton height={60} />
          )}
        </Card>
      </div>
    </div>
  );
}
