import { Prisma } from '@prisma/client';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { isBusinessSuspended } from '../business/business-candidate-access';
import { pauseClaimClocks } from './claim-clock';

/** What closing an unpaid replacement needs to know about it (and tells afterwards). */
export interface UpgradeToCancel {
  id: string;
  code: string;
  city: string | null;
  vacancyId: string;
  interviewId: string | null;
  jobSeekerId: string;
  businessId: string;
  countsAsReplacement: boolean;
  business: { name: string; suspendedAt: Date | null; suspendedUntil: Date | null } | null;
}

export const UPGRADE_TO_CANCEL_SELECT = {
  id: true, code: true, city: true, vacancyId: true, interviewId: true, jobSeekerId: true, businessId: true, countsAsReplacement: true,
  business: { select: { name: true, suspendedAt: true, suspendedUntil: true } },
} as const;

/**
 * Closes a replacement still waiting for its salary difference (D3), inside the caller's transaction.
 * One path for every close (M2 rev 178: not paid in time / "Cancel now"; M6 / Fable final check M-C:
 * the guarantee ended by a refund):
 * - the placement row is locked first (then its payment — the order PaymentService.onPaymentSucceeded
 *   uses) and only a row still awaiting payment changes; nothing else is written otherwise;
 * - its open payment request closes (a late payment is flagged, never taken);
 * - the candidate is no longer "accepted";
 * - the job seeker goes back to available unless another placement of his is confirmed or running (H3);
 * - `reopenSearch`: the vacancy reopens and, if the business is suspended now, the reopened search's
 *   15-day clock is paused at once (M10).
 * True when this call cancelled it. The caller tells people and audits after the commit
 * (`announceUpgradeCancelled`).
 */
export async function cancelUpgradeInTx(
  tx: Prisma.TransactionClient,
  placement: UpgradeToCancel,
  opts: { actorId: string | null; now: Date; statusReason: string; reopenSearch: boolean },
): Promise<boolean> {
  const { actorId, now, statusReason } = opts;
  if (tx.$queryRaw) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Placement" WHERE "id" = ${placement.id} FOR UPDATE`);
  const changed = await tx.placement.updateMany({
    where: { id: placement.id, status: 'awaiting_payment' },
    data: { status: 'cancelled', countsAsReplacement: false, paymentDueAt: null },
  });
  if (changed.count !== 1) return false;
  await recordStatusChange(tx, { subjectType: 'placement', subjectId: placement.id, fromStatus: 'awaiting_payment', toStatus: 'cancelled', changedByStaffId: actorId, reason: statusReason, changedAt: now });
  const open = await tx.payment.findMany({ where: { placementId: placement.id, type: 'replacement_upgrade', status: 'pending' }, select: { id: true } });
  if (open.length) {
    await tx.payment.updateMany({ where: { id: { in: open.map((p) => p.id) }, status: 'pending' }, data: { status: 'failed' } });
    for (const p of open) await recordStatusChange(tx, { subjectType: 'payment', subjectId: p.id, fromStatus: 'pending', toStatus: 'failed', changedByStaffId: actorId, reason: 'replacement_upgrade_cancelled', changedAt: now });
  }
  if (placement.interviewId) {
    await tx.replacementCandidate.updateMany({ where: { interviewId: placement.interviewId, status: 'accepted' }, data: { status: 'cancelled' } });
  }
  if (opts.reopenSearch) {
    await tx.vacancy.updateMany({ where: { id: placement.vacancyId, status: 'filled' }, data: { status: 'open' } });
    if (placement.business && isBusinessSuspended(placement.business, now)) await pauseClaimClocks(tx, placement.businessId, now);
  }
  const seeker = await tx.jobSeeker.findUnique({ where: { id: placement.jobSeekerId }, select: { status: true } });
  if (seeker?.status === 'placed') {
    const elsewhere = await tx.placement.count({ where: { jobSeekerId: placement.jobSeekerId, id: { not: placement.id }, status: { in: ['confirmed', 'active'] } } });
    if (elsewhere === 0) {
      await tx.jobSeeker.update({ where: { id: placement.jobSeekerId }, data: { status: 'active' } });
      await recordStatusChange(tx, { subjectType: 'job_seeker', subjectId: placement.jobSeekerId, fromStatus: 'placed', toStatus: 'active', changedByStaffId: actorId, reason: 'replacement_upgrade_cancelled', changedAt: now });
    }
  }
  return true;
}

interface Announcer {
  audit: { log: (entry: Record<string, unknown>) => Promise<unknown> };
  notify?: (to: { businessId: string } | { jobSeekerId: string }, kind: string, dedupeKey: string) => Promise<unknown>;
  sms?: (input: { template: string; subjectType: 'business' | 'job_seeker'; subjectId: string; relatedId: string; variables: Record<string, string> }) => Promise<unknown>;
}

/** After the commit: audited, and the business and the selected job seeker hear it in the app and by SMS. */
export async function announceUpgradeCancelled(
  deps: Announcer,
  placement: UpgradeToCancel,
  input: { auditActorId: string | null; automatic: boolean; reason: string },
): Promise<void> {
  if (input.auditActorId) {
    await deps.audit.log({
      actorId: input.auditActorId,
      action: 'placement.replacement_upgrade_cancelled',
      entityType: 'Placement',
      entityCode: placement.code,
      city: placement.city,
      before: { status: 'awaiting_payment', countsAsReplacement: placement.countsAsReplacement },
      after: { status: 'cancelled', countsAsReplacement: false, automatic: input.automatic },
      reason: input.reason,
    });
  }
  await deps.notify?.({ businessId: placement.businessId }, 'replacement_cancelled', `replacement_cancelled:${placement.id}`).catch(() => undefined);
  await deps.notify?.({ jobSeekerId: placement.jobSeekerId }, 'selection_cancelled', `selection_cancelled:${placement.id}`).catch(() => undefined);
  await deps.sms?.({ template: 'replacement_upgrade_cancelled', subjectType: 'business', subjectId: placement.businessId, relatedId: placement.id, variables: { businessName: placement.business?.name ?? '' } }).catch(() => undefined);
  await deps.sms?.({ template: 'selection_cancelled', subjectType: 'job_seeker', subjectId: placement.jobSeekerId, relatedId: placement.id, variables: {} }).catch(() => undefined);
}
