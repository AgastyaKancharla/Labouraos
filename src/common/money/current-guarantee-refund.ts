import { Prisma } from '@prisma/client';
import { LIVE_PAYOUT_STATUSES } from './one-per-subject';

/**
 * Which ₹499 refund belongs to a job seeker's current guarantee. Paying ₹499 again
 * after a refund starts a new guarantee (Master Guide), so an older refund must not
 * count. The link decides: a refund names the ₹499 it gives back
 * (Payment.refundsPaymentId), and it is current when that is his latest paid ₹499.
 * Timestamps are used only for older refunds made before the link existed
 * (refundsPaymentId null): those count when made on or after his last payment.
 * Bank dates and booking dates can differ from creation times (a re-pay the same
 * day as the refund), so a linked refund never falls back to them.
 */

/** Refund statuses that still count (not turned down, not cancelled). The one shared list. */
export const LIVE_REFUND_STATUSES = LIVE_PAYOUT_STATUSES;

/** A ₹499 that is in the bank. */
export const PAID_ACTIVATION_STATUSES = ['completed', 'succeeded'] as const;
export const ACTIVATION_TYPES = ['activation', 'reactivation'] as const;

export interface GuaranteeCycle {
  /** His latest paid ₹499 (activation or re-registration payment). */
  latestPaidActivationId: string | null;
  /** When that ₹499 was received (starts the 30 days). */
  paymentReceivedAt: Date | null;
}

export function isCurrentGuaranteeRefund(
  refund: { refundsPaymentId?: string | null; createdAt?: Date | null },
  cycle: GuaranteeCycle,
): boolean {
  if (refund.refundsPaymentId) return refund.refundsPaymentId === cycle.latestPaidActivationId;
  if (!cycle.paymentReceivedAt || !refund.createdAt) return true;
  return refund.createdAt.getTime() >= cycle.paymentReceivedAt.getTime();
}

/** The same rule as a database filter for one job seeker's live refunds. */
export function currentGuaranteeRefundWhere(jobSeekerId: string, cycle: GuaranteeCycle): Prisma.PaymentWhereInput {
  const legacy: Prisma.PaymentWhereInput = {
    refundsPaymentId: null,
    ...(cycle.paymentReceivedAt ? { createdAt: { gte: cycle.paymentReceivedAt } } : {}),
  };
  return {
    jobSeekerId,
    type: 'refund',
    status: { in: [...LIVE_REFUND_STATUSES] },
    OR: cycle.latestPaidActivationId ? [{ refundsPaymentId: cycle.latestPaidActivationId }, legacy] : [legacy],
  };
}

type PaymentReader = {
  payment: {
    findMany(args: {
      where: Prisma.PaymentWhereInput;
      orderBy: Prisma.PaymentOrderByWithRelationInput[];
      select: { id: true; jobSeekerId: true; amount: true };
    }): Promise<Array<{ id: string; jobSeekerId: string | null; amount: number }>>;
  };
};

/** Each job seeker's latest paid ₹499 (id and stored amount). */
export async function latestPaidActivations(db: PaymentReader, jobSeekerIds: string[]): Promise<Map<string, { id: string; amount: number }>> {
  const out = new Map<string, { id: string; amount: number }>();
  if (!jobSeekerIds.length) return out;
  const rows = await db.payment.findMany({
    where: { jobSeekerId: { in: jobSeekerIds }, type: { in: [...ACTIVATION_TYPES] }, status: { in: [...PAID_ACTIVATION_STATUSES] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, jobSeekerId: true, amount: true },
  });
  for (const row of rows) {
    if (row.jobSeekerId && !out.has(row.jobSeekerId)) out.set(row.jobSeekerId, { id: row.id, amount: row.amount });
  }
  return out;
}
