import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/** A date as people read it in India, for example 12 Nov 2026. */
function formatDateIST(at: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(at);
}

/** The advisory-lock keys every refund decision for a subject takes (the same as the approve paths). */
export const refundLockKey = {
  jobSeeker: (jobSeekerId: string) => `refund:job_seeker:${jobSeekerId}`,
  placement: (rootPlacementId: string) => `refund:placement:${rootPlacementId}`,
};

/**
 * Whether a refund is one the rules make due (R3, 12 Nov). Only those leave a
 * RefundRejection that keeps the refund off the due list: a duplicate ₹499
 * refund or a goodwill refund (outside the rules) turned down does not.
 */
export function isRuleBasedRefund(payment: { type: string; outsideRules: boolean } | null): boolean {
  return !payment || (payment.type === 'refund' && !payment.outsideRules);
}

export interface RefundRejectionInput {
  kind: 'job_seeker' | 'business';
  jobSeekerId: string | null;
  guaranteeStartedAt: Date | null;
  placementId: string | null;
  paymentId: string | null;
  amountPaise: number;
  reason: string;
  actorId: string;
  actorRole: string;
  at: Date;
}

/** The rejection already recorded for this guarantee (job seeker) or placement chain (business), if any. */
export function findRefundRejection(db: Db, key: { jobSeekerId: string; guaranteeStartedAt: Date } | { placementId: string }) {
  return db.refundRejection.findFirst({
    where: 'placementId' in key ? { kind: 'business', placementId: key.placementId } : { kind: 'job_seeker', jobSeekerId: key.jobSeekerId, guaranteeStartedAt: key.guaranteeStartedAt },
    orderBy: { rejectedAt: 'desc' },
  });
}

/**
 * Records that a rule-based refund was decided not owed (one row per guarantee
 * or placement chain; unique indexes back this up). Returns the row, new or
 * already there. Call inside the refund lock.
 */
export async function recordRefundRejection(db: Db, input: RefundRejectionInput) {
  if (input.kind === 'job_seeker' && (!input.jobSeekerId || !input.guaranteeStartedAt)) return null;
  if (input.kind === 'business' && !input.placementId) return null;
  const existing = await findRefundRejection(
    db,
    input.kind === 'business' ? { placementId: input.placementId! } : { jobSeekerId: input.jobSeekerId!, guaranteeStartedAt: input.guaranteeStartedAt! },
  );
  if (existing) return existing;
  return db.refundRejection.create({
    data: {
      kind: input.kind,
      jobSeekerId: input.kind === 'job_seeker' ? input.jobSeekerId : null,
      guaranteeStartedAt: input.kind === 'job_seeker' ? input.guaranteeStartedAt : null,
      placementId: input.kind === 'business' ? input.placementId : null,
      paymentId: input.paymentId,
      amountPaise: input.amountPaise,
      reason: input.reason,
      rejectedByStaffId: input.actorId,
      rejectedByRole: input.actorRole,
      rejectedAt: input.at,
    },
  });
}

/**
 * R4: a refund that was rejected for this guarantee or placement cannot be
 * raised again, except by the CEO with overrideRejection and a written reason.
 */
export function assertRejectionOverride(
  rejection: { rejectedAt: Date; rejectedByRole: string } | null,
  actor: { role: string },
  override: { overrideRejection?: unknown; reason?: string | null },
): void {
  if (!rejection) return;
  const when = formatDateIST(rejection.rejectedAt);
  if (actor.role !== 'ceo') {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: 'refund_rejected',
      message: `This refund was rejected on ${when}. Only the CEO can raise it again, with a reason.`,
    });
  }
  if (override.overrideRejection !== true || !override.reason?.trim()) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'refund_rejected',
      message: `This refund was rejected on ${when}. To raise it anyway, override the rejection with a reason.`,
    });
  }
}

/**
 * R2: when the CEO cancels an approved refund, what the approval changed goes
 * back, with status history, inside the caller's transaction: the job seeker
 * leaves "refunded" for the status he had; a rule-based business refund's
 * placements leave "guarantee ended (refunded)" for the status they had.
 * Uses the status history the approval wrote; returns what was restored.
 */
export async function restoreAfterCancelledRefund(
  db: Db,
  payment: { jobSeekerId: string | null; placementId: string | null; outsideRules: boolean },
  rootPlacementId: string | null,
  actorId: string,
  at: Date,
): Promise<Array<{ subject: string; from: string; to: string }>> {
  const restored: Array<{ subject: string; from: string; to: string }> = [];
  const previous = (subjectType: string, subjectId: string, toStatus: string, reason: string) =>
    db.statusHistory.findFirst({ where: { subjectType, subjectId, toStatus, reason }, orderBy: { changedAt: 'desc' }, select: { fromStatus: true } });

  if (payment.jobSeekerId) {
    const before = await previous('job_seeker', payment.jobSeekerId, 'refunded', 'refund_approved');
    if (before?.fromStatus) {
      const moved = await db.jobSeeker.updateMany({ where: { id: payment.jobSeekerId, status: 'refunded' }, data: { status: before.fromStatus } });
      if (moved.count) {
        await db.statusHistory.create({ data: { subjectType: 'job_seeker', subjectId: payment.jobSeekerId, fromStatus: 'refunded', toStatus: before.fromStatus, changedByStaffId: actorId, reason: 'refund_cancelled_by_ceo', changedAt: at } });
        restored.push({ subject: 'job_seeker', from: 'refunded', to: before.fromStatus });
      }
    }
    return restored;
  }

  if (payment.outsideRules || !rootPlacementId) return restored; // a goodwill refund never changed the placement
  const ids = [...new Set([rootPlacementId, payment.placementId].filter((x): x is string => Boolean(x)))];
  const rootBefore = await previous('placement', rootPlacementId, 'guarantee_ended', 'refunded');
  for (const id of ids) {
    const before = id === rootPlacementId ? rootBefore : ((await previous('placement', id, 'guarantee_ended', 'refunded')) ?? rootBefore);
    if (!before?.fromStatus) continue;
    const moved = await db.placement.updateMany({
      where: { id, status: 'guarantee_ended', guaranteeEndedReason: 'refunded' },
      data: { status: before.fromStatus, guaranteeEndedReason: null },
    });
    if (moved.count) {
      await db.statusHistory.create({ data: { subjectType: 'placement', subjectId: id, fromStatus: 'guarantee_ended', toStatus: before.fromStatus, changedByStaffId: actorId, reason: 'refund_cancelled_by_ceo', changedAt: at } });
      restored.push({ subject: id === rootPlacementId ? 'placement' : 'replacement_placement', from: 'guarantee_ended', to: before.fromStatus });
    }
  }
  return restored;
}
