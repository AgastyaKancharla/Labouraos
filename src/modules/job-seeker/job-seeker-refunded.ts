import { Prisma } from '@prisma/client';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { REFUND_LEAVES_POOL_FROM } from './job-seeker.status';

/**
 * A job seeker whose ₹499 is refunded leaves the matching pool (guide check 12 Nov,
 * finding 5): an active or paused profile becomes "refunded". He comes back by
 * paying ₹499 again (reactivation), which resets his hits and starts a new 30-day
 * guarantee. A placed, closed or deactivated profile keeps its status (a CEO goodwill
 * refund never undoes a placement). Runs inside the refund's transaction.
 */
export async function markJobSeekerRefunded(
  tx: Prisma.TransactionClient,
  seeker: { id: string; status: string },
  actorId: string | null,
  at: Date,
): Promise<boolean> {
  if (!REFUND_LEAVES_POOL_FROM.includes(seeker.status)) return false;
  const moved = await tx.jobSeeker.updateMany({
    where: { id: seeker.id, status: { in: [...REFUND_LEAVES_POOL_FROM] } },
    data: { status: 'refunded' },
  });
  if (moved.count !== 1) return false;
  await recordStatusChange(tx, {
    subjectType: 'job_seeker',
    subjectId: seeker.id,
    fromStatus: seeker.status,
    toStatus: 'refunded',
    changedByStaffId: actorId,
    reason: 'refund_approved',
    changedAt: at,
  });
  return true;
}
