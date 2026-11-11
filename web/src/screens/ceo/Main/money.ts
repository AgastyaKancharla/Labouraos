import { sumPaise } from '../../../lib/format/money';
import { istEndOfDay, istStartOfDay } from '../../../lib/format/date';
import type { Period } from '../../../lib/period';

/**
 * Pure money arithmetic for the Command Center's top row, in integer paise.
 * Built only on what the API returns today (GET /payments, /refunds/due,
 * /targets/money-at-risk). When a server-side summary endpoint exists, the
 * hook should switch to it and this file can go.
 *
 * Rules used (from the payment model, not invented):
 * - A payment counts as received when its status is succeeded or completed;
 *   the day it counts on is confirmedAt (bank/gateway confirmation), else
 *   paidAt, else updatedAt.
 * - Placement fees are shown without GST: the fee and the GST come from the
 *   placement (placementFee, gstAmount). ₹499 activation fees carry no GST.
 * - Refunds paid are outgoing `refund` payments that succeeded in the period.
 * - Payouts due are referral payouts and joining rewards that are pending or
 *   approved but not yet paid; failed ones are counted separately.
 */
export interface PaymentRow {
  id: string;
  type: string;
  status: string;
  amount: number;
  createdAt: string;
  updatedAt?: string;
  confirmedAt?: string | null;
  paidAt?: string | null;
  placement?: { placementFee?: number | null; gstAmount?: number | null } | null;
}

export interface MoneySummary {
  activationPaise: number;
  activationCount: number;
  placementFeePaise: number;
  placementCount: number;
  gstPaise: number;
  grossPaise: number;
  refundsPaidPaise: number;
  netPaise: number;
}

const RECEIVED = new Set(['succeeded', 'completed']);

function inPeriod(iso: string | null | undefined, period: Period): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= istStartOfDay(period.from).getTime() && t <= istEndOfDay(period.to).getTime();
}

function receivedAt(p: PaymentRow): string | undefined {
  return p.confirmedAt ?? p.paidAt ?? p.updatedAt ?? p.createdAt;
}

export function summariseMoney(payments: readonly PaymentRow[], period: Period): MoneySummary {
  const received = payments.filter((p) => RECEIVED.has(p.status) && inPeriod(receivedAt(p), period));
  const activation = received.filter((p) => p.type === 'activation');
  const placement = received.filter((p) => p.type === 'placement_fee');
  const refunds = received.filter((p) => p.type === 'refund');

  const activationPaise = sumPaise(activation.map((p) => p.amount));
  const placementFeePaise = sumPaise(placement.map((p) => p.placement?.placementFee ?? p.amount - (p.placement?.gstAmount ?? 0)));
  const gstPaise = sumPaise(placement.map((p) => p.placement?.gstAmount ?? 0));
  const refundsPaidPaise = sumPaise(refunds.map((p) => p.amount));
  const grossPaise = activationPaise + placementFeePaise;
  return {
    activationPaise,
    activationCount: activation.length,
    placementFeePaise,
    placementCount: placement.length,
    gstPaise,
    grossPaise,
    refundsPaidPaise,
    netPaise: grossPaise - refundsPaidPaise,
  };
}

export interface PayoutSummary {
  duePaise: number;
  dueCount: number;
  failedCount: number;
}

const PAYOUT_TYPES = new Set(['referral_payout', 'joining_reward']);

export function summarisePayouts(payments: readonly PaymentRow[]): PayoutSummary {
  const payouts = payments.filter((p) => PAYOUT_TYPES.has(p.type));
  const due = payouts.filter((p) => p.status === 'pending' || p.status === 'approved');
  return {
    duePaise: sumPaise(due.map((p) => p.amount)),
    dueCount: due.length,
    failedCount: payouts.filter((p) => p.status === 'failed').length,
  };
}

/** How far back to fetch so a payment created before the period but confirmed inside it is counted. */
export const RECEIPT_LOOKBACK_DAYS = 60;
