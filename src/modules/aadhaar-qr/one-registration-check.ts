import { ConflictException } from '@nestjs/common';
import { lockSubject } from '../../common/money/one-per-subject';
import type { PrismaService } from '../../common/prisma/prisma.service';

export const REGISTRATION_ALREADY_CHECKED = 'This registration is already checked. Nothing new was recorded.';

type CheckPrisma = Pick<PrismaService, '$transaction' | 'teamLeadCheck' | 'identityVerification' | 'referralIdentityVerification'>;

/**
 * One general registration check per person (Fable final re-check, L-8): the Team Lead's T-Verify and the
 * Manager's fallback both run their decision under this person's advisory lock, and look first. A person
 * already checked gets a new check only while another ID waits (that check decides it); otherwise 409.
 * Two taps, or a Team Lead and a Manager at the same moment, can't both record a check.
 *
 * The lock is held by the transaction's connection while `work` runs on the usual one; each write in
 * `work` is committed before the lock is let go, so the next caller's look sees it.
 */
export async function oneRegistrationCheck<T>(
  prisma: CheckPrisma,
  subjectType: 'job_seeker' | 'referral',
  subjectId: string,
  work: () => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockSubject(tx, `registration-check:${subjectType}:${subjectId}`);
      const checked = await prisma.teamLeadCheck.findFirst({ where: { subjectType, subjectId }, select: { id: true } });
      if (checked) {
        const where = { status: 'pending', vendor: 'team_lead_check' };
        const waiting =
          subjectType === 'job_seeker'
            ? await prisma.identityVerification.findFirst({ where: { jobSeekerId: subjectId, ...where }, select: { id: true } })
            : await prisma.referralIdentityVerification.findFirst({ where: { referralId: subjectId, ...where }, select: { id: true } });
        if (!waiting) throw new ConflictException(REGISTRATION_ALREADY_CHECKED);
      }
      return work();
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}
