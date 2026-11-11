import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { NavIcon, UiIcon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { formatLongDateIST, formatMonthIST, istPartOfDay, istStartOfDay } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { periodFor, periodRangeLabel, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { useCommandCenterMoney } from './useCommandCenter';

/**
 * CEO Command Center — design Main.dc.html. This is the reference screen for
 * screen agents: TopBar with the period presets, data through one hook per
 * screen (useCommandCenter.ts), pure money maths in money.ts with its own
 * tests, and a loading / error / empty state for every card.
 *
 * Built so far: the header and the Money row. The pipeline, verticals,
 * attention list and charts below it are the next screen agent's job.
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

export default function CommandCenter() {
  const t = useT();
  const now = useNow(60_000);
  const { session } = useAuth();
  const to = useScreenPath();
  const [period, setPeriod] = useState<Period>(() => periodFor('month', now));
  const { payments, payouts, refundsDue, moneyAtRisk } = useCommandCenterMoney(period);

  const firstName = session?.staff.name.split(/\s+/)[0] ?? '';
  const label = periodLabel(period, t);
  const refreshAll = () => {
    void payments.refetch();
    void payouts.refetch();
    void refundsDue.refetch();
    void moneyAtRisk.refetch();
  };
  const refreshing = payments.isFetching || payouts.isFetching || refundsDue.isFetching || moneyAtRisk.isFetching;

  const money = payments.data;
  const owedNowPaise = refundsDue.data?.reduce((sum, r) => sum + r.amount, 0);
  const atRiskPaise = moneyAtRisk.data?.totalAtRiskPaise;
  const exposurePaise = owedNowPaise !== undefined && atRiskPaise !== undefined ? owedNowPaise + atRiskPaise : undefined;
  const exposureError = refundsDue.error ?? moneyAtRisk.error;

  return (
    <div className="lb-page">
      <TopBar
        eyebrow={
          <span style={{ color: 'var(--royal)' }}>
            {formatLongDateIST(now)} · {t('cc.place')}
          </span>
        }
        title={t(`greeting.${istPartOfDay(now)}`, { name: firstName })}
        subtitle={t('cc.subtitle', { label: periodRangeLabel(period) })}
        period={period}
        onPeriodChange={setPeriod}
        actions={
          <Button variant="primary" onClick={refreshAll} loading={refreshing} icon={<UiIcon name="refresh" size={14} />}>
            {t('common.refresh')}
          </Button>
        }
      />

      <section className="lb-section" aria-labelledby="cc-money">
        <div className="eyebrow" id="cc-money">
          {t('cc.money', { label })}
        </div>
        <div className="money-grid">
          {/* Net revenue */}
          <Link to={to('C-Reports')} className="hero" aria-busy={payments.isPending || undefined}>
            <div className="lb-row-between">
              <span className="lb-hero__label">{t('cc.netRevenue')}</span>
            </div>
            {payments.isPending ? (
              <>
                <Skeleton width="60%" height={40} style={{ opacity: 0.35 }} />
                <Skeleton width="80%" style={{ opacity: 0.35 }} />
              </>
            ) : payments.isError ? (
              <span className="lb-hero__detail">{t('error.title')}</span>
            ) : money ? (
              <>
                <div className="lb-hero__value" data-testid="cc-net">
                  {formatINR(money.netPaise)}
                </div>
                <div className="lb-hero__detail">
                  {t('cc.netRevenueDetail', { gross: formatINR(money.grossPaise), refunds: formatINR(money.refundsPaidPaise) })}
                </div>
                {money.grossPaise > 0 ? (
                  <div className="lb-hero__split" aria-hidden="true">
                    <div style={{ width: `${percent(money.placementFeePaise, money.grossPaise)}%`, background: 'var(--cyan-raw)' }} />
                    <div style={{ width: `${percent(money.activationPaise, money.grossPaise)}%`, background: 'var(--gold-raw)' }} />
                  </div>
                ) : (
                  <div className="lb-hero__detail">{t('cc.noMoneyYet')}</div>
                )}
                <div className="lb-hero__legend">
                  <span>
                    <i style={{ background: 'var(--cyan-raw)' }} />
                    {t('cc.placementFees', { amount: formatINR(money.placementFeePaise), count: money.placementCount })}
                  </span>
                  <span>
                    <i style={{ background: 'var(--gold-raw)' }} />
                    {t('cc.activationFees', { amount: formatINR(money.activationPaise), count: money.activationCount })}
                  </span>
                </div>
              </>
            ) : null}
            <div className="swoosh lb-hero__swoosh" />
          </Link>

          {/* Refund exposure */}
          <Link to={to('C-Refunds')} className="panel lb-money-card" aria-busy={exposurePaise === undefined && !exposureError ? true : undefined}>
            <div className="lb-row-between">
              <span className="lb-money-card__title">
                <span className="tile t-red">
                  <NavIcon name="refundApprovals" />
                </span>
                {t('cc.refundExposure')}
              </span>
              {exposurePaise !== undefined && exposurePaise > 0 && <span className="pill crit">{t('cc.act')}</span>}
            </div>
            {exposureError ? (
              <ErrorState error={exposureError} compact />
            ) : exposurePaise === undefined ? (
              <>
                <Skeleton width="55%" height={34} />
                <Skeleton width="85%" />
              </>
            ) : (
              <>
                <div className="num-xl" data-testid="cc-exposure">
                  {formatINR(exposurePaise)}
                </div>
                <div className="lb-money-card__lines">
                  <span>
                    <b style={{ color: 'var(--critical)' }}>{formatINR(owedNowPaise ?? 0)}</b> {t('cc.awaitingApproval')}
                  </span>
                  <span>
                    <b style={{ color: 'var(--amber)' }}>{formatINR(atRiskPaise ?? 0)}</b> {t('cc.atRisk')}
                  </span>
                </div>
              </>
            )}
          </Link>

          {/* Payouts due */}
          <Link to={to('C-Payments-Out')} className="panel lb-money-card" aria-busy={payouts.isPending || undefined}>
            <div className="lb-row-between">
              <span className="lb-money-card__title">
                <span className="tile t-orange">
                  <NavIcon name="referrals" />
                </span>
                {t('cc.payoutsDue')}
              </span>
              {payouts.data && payouts.data.failedCount > 0 && (
                <span className="pill danger">{t('cc.failed', { count: payouts.data.failedCount })}</span>
              )}
            </div>
            {payouts.isError ? (
              <ErrorState error={payouts.error} onRetry={() => void payouts.refetch()} compact />
            ) : payouts.isPending ? (
              <>
                <Skeleton width="45%" height={34} />
                <Skeleton width="80%" />
              </>
            ) : (
              <>
                <div className="num-xl" data-testid="cc-payouts">
                  {formatINR(payouts.data.duePaise)}
                </div>
                <div className="lb-money-card__lines">
                  <span>{t('cc.payoutsDetail', { count: payouts.data.dueCount })}</span>
                  <span>{t('cc.payoutsRule')}</span>
                </div>
              </>
            )}
          </Link>

          {/* GST collected */}
          <Link to={to('C-Payments-GST')} className="panel lb-money-card" aria-busy={payments.isPending || undefined}>
            <div className="lb-row-between">
              <span className="lb-money-card__title">
                <span className="tile t-gold">
                  <NavIcon name="vacancies" />
                </span>
                {t('cc.gst')}
              </span>
              <span className="pill info">{t('cc.toRemit')}</span>
            </div>
            {payments.isError ? (
              <ErrorState error={payments.error} onRetry={() => void payments.refetch()} compact />
            ) : payments.isPending ? (
              <>
                <Skeleton width="50%" height={34} />
                <Skeleton width="75%" />
              </>
            ) : (
              <>
                <div className="num-xl" data-testid="cc-gst">
                  {formatINR(payments.data.gstPaise)}
                </div>
                <div className="lb-money-card__lines">
                  <span>{t('cc.gstDetail', { count: payments.data.placementCount })}</span>
                  <span>{t('cc.gstLedger')}</span>
                </div>
              </>
            )}
          </Link>
        </div>
      </section>
    </div>
  );
}
