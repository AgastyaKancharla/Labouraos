import { BadRequestException } from '@nestjs/common';
import { UNDER_18_STOP_MESSAGE } from '../aadhaar-qr/under18-stop.service';
import { calculateAge } from './job-seeker.validator';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';

/** The ID check is waiting for the Team Lead (shown on the ID step; no longer stops the payment, rev 211). */
export const ID_WAITING_FOR_TEAM_LEAD = 'The Team Lead is checking the photo of your ID card. Open this link again once it is checked.';
export const UNDER_18_BY_DATE_OF_BIRTH = 'Registration stops before payment: the job seeker is under 18';

type GatePrisma = Pick<PrismaService, 'identityVerification'>;

/**
 * One gate before any ₹499 activation request (Fable final re-check, L-5): the first payment,
 * the terms page, a reactivation, a re-sent link and the payment-only link all ask the same thing.
 *
 * Master Guide rev 211 (25 Nov): the order is Consent → Selfie → Payment → ID check, so the ₹499 no
 * longer waits for a verified ID. What still stops it before any money:
 * - Under 18 by his typed date of birth (stops at consent, before payment).
 * - A standing under-18 stop from a signed Aadhaar QR (sticky, rev 154, until a Manager or the CEO
 *   lifts it) — an ID check done before payment (a field agent scanning in person) still counts.
 * An ID that waits for the Team Lead, or no ID check yet, no longer stops the payment: he pays and
 * is "Paid, waiting for ID" until it passes (guarantee-start.ts).
 */
export async function assertIdReadyForPayment(
  prisma: GatePrisma,
  jobSeeker: { id: string; dateOfBirth: Date | null },
  adultMinimumAge: number | null,
  now: Date,
): Promise<void> {
  if (adultMinimumAge !== null && jobSeeker.dateOfBirth && calculateAge(jobSeeker.dateOfBirth, now) < adultMinimumAge) {
    throw new BadRequestException(UNDER_18_BY_DATE_OF_BIRTH);
  }
  const stop = await prisma.identityVerification.findFirst({
    where: { jobSeekerId: jobSeeker.id, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', isAdult: false, under18LiftedAt: null },
    select: { id: true },
  });
  if (stop) throw new BadRequestException(UNDER_18_STOP_MESSAGE);
}

/** What the public payment page says when a ₹499 can no longer go ahead (owner rule: under 18 stops before payment). */
export const PAYMENT_STOPPED_MESSAGE = "This payment can't go ahead. Please contact Laboura.";
/** The status-history reason on a ₹499 request the ID gate closed. */
export const PAYMENT_STOPPED_REASON = 'id_gate_stopped';

type StopPrisma = Pick<PrismaService, 'identityVerification' | 'jobSeeker' | 'payment' | '$transaction'>;

/**
 * The public payment page, the card start and the UPI reference hint ask the gate again before a
 * pending ₹499 activation goes any further. If he now has an under-18 stop, the
 * request is closed (status failed, reason id_gate_stopped) so it can't be paid later, and the
 * caller shows PAYMENT_STOPPED_MESSAGE. Anything else (placement fees, paid or closed requests) is
 * left alone. A ₹499 that already arrived is never reversed here (see PaymentService).
 */
export async function stopActivationIfIdGateFails(
  prisma: StopPrisma,
  payment: { id: string; type: string; status: string; jobSeekerId: string | null },
  adultMinimumAge: number | null,
  now: Date,
): Promise<{ stopped: boolean; reason: string | null }> {
  if (payment.type !== 'activation' || !payment.jobSeekerId || payment.status !== 'pending') return { stopped: false, reason: null };
  const seeker = await prisma.jobSeeker.findUnique({ where: { id: payment.jobSeekerId }, select: { id: true, dateOfBirth: true } });
  if (!seeker) return { stopped: false, reason: null };
  try {
    await assertIdReadyForPayment(prisma, seeker, adultMinimumAge, now);
    return { stopped: false, reason: null };
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    await prisma.$transaction(async (tx) => {
      const closed = await tx.payment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: 'failed' } });
      if (closed.count === 1) {
        await recordStatusChange(tx, {
          subjectType: 'payment', subjectId: payment.id, fromStatus: 'pending', toStatus: 'failed',
          changedByStaffId: null, reason: PAYMENT_STOPPED_REASON, changedAt: now,
        });
      }
    });
    return { stopped: true, reason: error.message };
  }
}
