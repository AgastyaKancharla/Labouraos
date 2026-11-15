import { BadRequestException } from '@nestjs/common';
import { UNDER_18_STOP_MESSAGE } from '../aadhaar-qr/under18-stop.service';
import { calculateAge } from './job-seeker.validator';
import type { PrismaService } from '../../common/prisma/prisma.service';

export const ID_WAITING_FOR_TEAM_LEAD = 'The Team Lead is checking the photo of your ID card. Open this link again once it is checked.';
export const ID_CHECK_FIRST = 'Finish the ID check first';
export const UNDER_18_BY_DATE_OF_BIRTH = 'Registration stops before payment: the job seeker is under 18';

type GatePrisma = Pick<PrismaService, 'identityVerification'>;

/**
 * One ID gate before any ₹499 activation request (Fable final re-check, L-5): the first payment,
 * the terms page, a reactivation, a re-sent link and the payment-only link all ask the same thing.
 *
 * - Under 18 by his date of birth, or a standing under-18 stop from a signed Aadhaar QR (sticky,
 *   rev 154, until a Manager or the CEO lifts it): refused.
 * - Any verified ID check (name matches and 18+) lets him pay — even when a later check failed or
 *   waits. A later name mismatch alone doesn't un-verify him; the QR check raises a name check for
 *   his Team Lead instead.
 * - Otherwise an ID that waits for the Team Lead, or no ID check yet: refused with the reason.
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
  const verified = await prisma.identityVerification.findFirst({
    where: { jobSeekerId: jobSeeker.id, status: 'verified', nameMatches: true, isAdult: true },
    select: { id: true },
  });
  if (verified) return;
  const pending = await prisma.identityVerification.findFirst({
    where: { jobSeekerId: jobSeeker.id, status: 'pending' },
    select: { id: true },
  });
  if (pending) throw new BadRequestException(ID_WAITING_FOR_TEAM_LEAD);
  throw new BadRequestException(ID_CHECK_FIRST);
}
