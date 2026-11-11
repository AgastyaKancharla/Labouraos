import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';
import { addDaysToKey } from '../../../lib/format/date';
import { customPeriod, periodToUtcRange, type Period } from '../../../lib/period';
import { RECEIPT_LOOKBACK_DAYS, summariseMoney, summarisePayouts, type PaymentRow } from './money';

/**
 * Data for the Command Center top section. Query keys start with the
 * resource name so other screens' mutations can invalidate them
 * (e.g. approving a refund invalidates ['refunds-due']).
 */
export const commandCenterKeys = {
  payments: (period: Period) => ['payments', 'received', period.from, period.to] as const,
  payouts: ['payments', 'payouts-open'] as const,
  refundsDue: ['refunds-due'] as const,
  moneyAtRisk: ['money-at-risk', 'city'] as const,
};

interface MoneyAtRiskResponse {
  totalAtRiskPaise: number;
  candidatesCount: number;
  placementsCount: number;
}

interface RefundDueRow {
  id: string;
  amount: number;
}

export function useCommandCenterMoney(period: Period) {
  const payments = useQuery({
    queryKey: commandCenterKeys.payments(period),
    queryFn: async () => {
      const lookback = customPeriod(addDaysToKey(period.from, -RECEIPT_LOOKBACK_DAYS), period.to);
      const rows = await api.get<PaymentRow[]>('/payments', { query: periodToUtcRange(lookback) });
      return summariseMoney(rows, period);
    },
  });
  const payouts = useQuery({
    queryKey: commandCenterKeys.payouts,
    queryFn: async () => {
      const [referral, reward] = await Promise.all([
        api.get<PaymentRow[]>('/payments', { query: { type: 'referral_payout' } }),
        api.get<PaymentRow[]>('/payments', { query: { type: 'joining_reward' } }),
      ]);
      return summarisePayouts([...referral, ...reward]);
    },
  });
  const refundsDue = useQuery({
    queryKey: commandCenterKeys.refundsDue,
    queryFn: () => api.get<RefundDueRow[]>('/refunds/due'),
  });
  const moneyAtRisk = useQuery({
    queryKey: commandCenterKeys.moneyAtRisk,
    queryFn: () => api.get<MoneyAtRiskResponse>('/targets/money-at-risk'),
  });
  return { payments, payouts, refundsDue, moneyAtRisk };
}
