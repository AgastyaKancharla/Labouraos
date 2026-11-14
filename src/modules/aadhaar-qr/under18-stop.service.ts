import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdCheckAccessService } from './id-check-access.service';

export type StopSubjectType = 'job_seeker' | 'referral';

export const UNDER_18_STOP_MESSAGE =
  'Registration stops here: a signed Aadhaar QR shows this person is under 18. Only a Manager or the CEO can lift this stop.';

/** Lifting the stop needs a real reason, not a tick. */
export const UNDER_18_LIFT_REASON_MIN = 10;

const SIGNED_UNDER_18 = { method: 'aadhaar_qr', vendor: 'uidai_secure_qr', isAdult: false, under18LiftedAt: null } as const;

/**
 * "Under 18, registration stops before payment" (guide) — and it stays
 * stopped: once a QR that passed UIDAI's signature shows under 18, no other
 * ID, no new scan, no staff action and no payment or terms step can go past
 * it. Only a Manager or the CEO can lift it, with a written reason (audited),
 * e.g. when the date on the card was wrong and the person shows proof.
 */
@Injectable()
export class Under18StopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: IdCheckAccessService,
  ) {}

  async isStopped(subjectType: StopSubjectType, subjectId: string): Promise<boolean> {
    const row =
      subjectType === 'job_seeker'
        ? await this.prisma.identityVerification.findFirst({ where: { jobSeekerId: subjectId, ...SIGNED_UNDER_18 }, select: { id: true } })
        : await this.prisma.referralIdentityVerification.findFirst({ where: { referralId: subjectId, ...SIGNED_UNDER_18 }, select: { id: true } });
    return Boolean(row);
  }

  async assertNotStopped(subjectType: StopSubjectType, subjectId: string): Promise<void> {
    if (await this.isStopped(subjectType, subjectId)) throw new BadRequestException(UNDER_18_STOP_MESSAGE);
  }

  /** Manager (people under them) or CEO only; reason required; every lifted row and the reason are audited. */
  async lift(actor: { id: string; role: string }, subjectType: StopSubjectType, subjectId: string, reasonText: unknown) {
    if (actor.role !== 'manager' && actor.role !== 'ceo') throw new ForbiddenException('Only a Manager or the CEO can lift an under-18 stop');
    const reason = typeof reasonText === 'string' ? reasonText.trim() : '';
    if (reason.length < UNDER_18_LIFT_REASON_MIN) throw new BadRequestException(`Write why the stop is lifted (at least ${UNDER_18_LIFT_REASON_MIN} characters)`);
    const subject =
      subjectType === 'job_seeker'
        ? await this.prisma.jobSeeker.findUnique({ where: { id: subjectId }, select: { code: true, city: true, registeredByStaffId: true } })
        : await this.prisma.referral.findUnique({ where: { id: subjectId }, select: { code: true, city: true, registeredByStaffId: true } });
    if (!subject) throw new NotFoundException('Not found');
    await this.access.assertCanView(actor, subject.registeredByStaffId);
    const now = new Date();
    const data = { under18LiftedAt: now, under18LiftedByStaffId: actor.id, under18LiftReason: reason };
    const changed =
      subjectType === 'job_seeker'
        ? await this.prisma.identityVerification.updateMany({ where: { jobSeekerId: subjectId, ...SIGNED_UNDER_18 }, data })
        : await this.prisma.referralIdentityVerification.updateMany({ where: { referralId: subjectId, ...SIGNED_UNDER_18 }, data });
    if (changed.count === 0) throw new BadRequestException('There is no under-18 stop to lift');
    await this.audit.log({
      actorId: actor.id,
      action: 'identity.under18_stop_lifted',
      entityType: subjectType,
      entityCode: subject.code,
      before: { under18Stop: true },
      after: { under18Stop: false, rows: changed.count },
      changedFields: ['under18Stop'],
      reason,
      city: subject.city,
    });
    return { lifted: changed.count };
  }
}
