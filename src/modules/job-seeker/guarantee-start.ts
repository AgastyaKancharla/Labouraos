import { Prisma } from '@prisma/client';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { PAID_WAITING_ID } from './job-seeker.status';

/**
 * When a job seeker's 30 days start (Master Guide rev 211, "Decided 25 Nov"):
 *
 * Consent → Selfie → Payment ₹499 → ID check. The 30 days start when he is BOTH paid and
 * ID-verified: the later of the ₹499 confirmation and the ID check passing (Aadhaar QR verified, or
 * another ID approved by a Team Lead, Manager or the CEO). Until then he is "Paid, waiting for ID"
 * (status paid_waiting_id): no matching, no offers, no hits, no clock.
 *
 * - Pay first, then ID: the start is the moment the ID passes.
 * - ID first (a field agent scanned it in person), then pay: the start is the payment.
 * - Paying ₹499 again after deactivation / a refund with an ID already verified: the start is
 *   that payment (hits and supersededAt reset as before, at the payment).
 *
 * Everything that measures the 30 days reads JobSeeker.guaranteeStartsAt; paymentReceivedAt only
 * says whether (and when) he paid.
 */

type Db = Pick<Prisma.TransactionClient, 'identityVerification'>;

/** A passed ID check: verified, name matches, 18+ (the same rule as the journey and the old payment gate). */
export const PASSED_ID_WHERE = { status: 'verified', nameMatches: true, isAdult: true } as const;

/**
 * When his ID first passed, or null when none has (or a standing under-18 stop from a signed
 * Aadhaar QR says he is under 18 — sticky until a Manager or the CEO lifts it, rev 154).
 */
export async function idPassedAt(db: Db, jobSeekerId: string): Promise<Date | null> {
  const stop = await db.identityVerification.findFirst({
    where: { jobSeekerId, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', isAdult: false, under18LiftedAt: null },
    select: { id: true },
  });
  if (stop) return null;
  const passed = await db.identityVerification.findFirst({
    where: { jobSeekerId, ...PASSED_ID_WHERE },
    orderBy: [{ verifiedAt: 'asc' }, { createdAt: 'asc' }],
    select: { verifiedAt: true, createdAt: true },
  });
  if (!passed) return null;
  return passed.verifiedAt ?? passed.createdAt;
}

/** The later of the two moments: the 30 days never start before the money or before the ID. */
export function guaranteeStartFor(paidAt: Date, idAt: Date): Date {
  return paidAt.getTime() >= idAt.getTime() ? paidAt : idAt;
}

/** The status a ₹499 that just arrived gives him, and his start (null while waiting for the ID). */
export async function statusAfterPayment(
  db: Db,
  jobSeekerId: string,
  confirmedAt: Date,
): Promise<{ status: 'active' | typeof PAID_WAITING_ID; guaranteeStartsAt: Date | null }> {
  const idAt = await idPassedAt(db, jobSeekerId);
  if (!idAt) return { status: PAID_WAITING_ID, guaranteeStartsAt: null };
  return { status: 'active', guaranteeStartsAt: guaranteeStartFor(confirmedAt, idAt) };
}

export const GUARANTEE_STARTED_REASON = 'guarantee_started_id_passed';
export const PAID_WAITING_ID_REASON = 'paid_waiting_for_id';

type StartDb = Pick<Prisma.TransactionClient, 'identityVerification' | 'jobSeeker'> & Partial<Pick<Prisma.TransactionClient, '$queryRaw' | 'statusHistory'>>;

export interface GuaranteeStartResult {
  started: boolean;
  guaranteeStartsAt: Date | null;
  jobSeeker: { id: string; code: string; name: string; city: string; status: string } | null;
}

/**
 * The ID check has just passed: a job seeker who is paid and waiting for it becomes active and
 * his 30 days start (the later of the payment and the ID pass). Anyone else is left as he is
 * (not paid yet: the payment will start it; already active: nothing to do). Run inside a
 * transaction; the row is locked first so a payment and an ID pass at the same moment cannot
 * both win. Writes the status history; the caller audits and sends "your 30 days have started".
 */
export async function startGuaranteeIfReady(
  tx: StartDb,
  jobSeekerId: string,
  actorId: string | null,
  now: Date,
): Promise<GuaranteeStartResult> {
  if (tx.$queryRaw) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "JobSeeker" WHERE "id" = ${jobSeekerId} FOR UPDATE`);
  }
  const seeker = await tx.jobSeeker.findUnique({
    where: { id: jobSeekerId },
    select: { id: true, code: true, name: true, city: true, status: true, paymentReceivedAt: true, guaranteeStartsAt: true },
  });
  if (!seeker || seeker.status !== PAID_WAITING_ID || !seeker.paymentReceivedAt || seeker.guaranteeStartsAt) {
    return { started: false, guaranteeStartsAt: seeker?.guaranteeStartsAt ?? null, jobSeeker: seeker };
  }
  const idAt = await idPassedAt(tx, jobSeekerId);
  if (!idAt) return { started: false, guaranteeStartsAt: null, jobSeeker: seeker };
  const startsAt = guaranteeStartFor(seeker.paymentReceivedAt, idAt);
  const changed = await tx.jobSeeker.updateMany({
    where: { id: jobSeekerId, status: PAID_WAITING_ID, guaranteeStartsAt: null },
    data: { status: 'active', guaranteeStartsAt: startsAt },
  });
  if (changed.count !== 1) return { started: false, guaranteeStartsAt: null, jobSeeker: seeker };
  await recordStatusChange(tx as Prisma.TransactionClient, {
    subjectType: 'job_seeker',
    subjectId: jobSeekerId,
    fromStatus: PAID_WAITING_ID,
    toStatus: 'active',
    changedByStaffId: actorId,
    reason: GUARANTEE_STARTED_REASON,
    changedAt: now,
  });
  return { started: true, guaranteeStartsAt: startsAt, jobSeeker: { ...seeker, status: 'active' } };
}
