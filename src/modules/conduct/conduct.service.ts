import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { ConsentClock } from '../consent/consent-clock';
import { isBusinessSuspended } from '../business/business-candidate-access';
import {
  aadhaarFingerprint,
  getBanHashKey,
  BAN_CATEGORIES,
  BanCategory,
  businessIdFingerprint,
  otherIdFingerprint,
  phoneHash,
} from './permanent-ban.check';

/** D6: a suspension lasts 30 to 90 days, or is permanent (Business Hiring Agreement 6.4). */
export const SUSPENSION_MIN_DAYS = 30;
export const SUSPENSION_MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Actor {
  id: string;
  role: string;
}

export type BanSubjectType = 'job_seeker' | 'business' | 'referral';

/**
 * Conduct actions decided by the owner (Master Guide rev 176):
 * - D6: the CEO suspends a business for 30–90 days or permanently, with a
 *   reason. While suspended: no new vacancies, no candidates shown, no
 *   bookings (business-candidate-access.ts); placements already made, their
 *   guarantees and payments carry on.
 * - D11: a Manager or the CEO bans a job seeker, business or partner for good
 *   (forged ID, fraud, theft, violence), with a reason. The same phone or ID
 *   cannot register again (permanent-ban.check.ts).
 * D4 and D5 (reschedules, attending within 30–45 minutes) are conduct rules in
 * the agreement only; nothing enforces them.
 */
@Injectable()
export class ConductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ConsentClock,
  ) {
    // Fail closed on start: ban hashes need their key (PERMANENT_BAN_HASH_KEY).
    getBanHashKey();
  }

  private async actor(actorId: string): Promise<Actor> {
    const staff = await this.prisma.staff.findUnique({ where: { id: actorId }, select: { id: true, role: true } });
    if (!staff) throw new NotFoundException('Staff not found');
    return staff;
  }

  private reasonOf(reason: unknown): string {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length < 5) throw new BadRequestException('Write the reason (at least 5 characters)');
    return text.slice(0, 500);
  }

  async suspendBusiness(businessId: string, actorId: string, body: { days?: unknown; permanent?: unknown; reason?: unknown }) {
    const actor = await this.actor(actorId);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO suspends a business');
    const reason = this.reasonOf(body.reason);
    const permanent = body.permanent === true;
    const days = Number(body.days);
    if (!permanent && (!Number.isInteger(days) || days < SUSPENSION_MIN_DAYS || days > SUSPENSION_MAX_DAYS)) {
      throw new BadRequestException(`A suspension is ${SUSPENSION_MIN_DAYS} to ${SUSPENSION_MAX_DAYS} days, or permanent`);
    }
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');
    // A permanently banned business stays suspended for good: a time-limited suspension would end the ban.
    const banned = await this.prisma.permanentBan.findUnique({ where: { subjectType_subjectId: { subjectType: 'business', subjectId: business.id } } });
    if (banned) throw new ConflictException('This business is permanently banned; it cannot be suspended for a time');
    const now = this.clock.now();
    const suspendedUntil = permanent ? null : new Date(now.getTime() + days * DAY_MS);
    const before = { suspendedAt: business.suspendedAt?.toISOString() ?? null, suspendedUntil: business.suspendedUntil?.toISOString() ?? null };
    const updated = await this.prisma.business.update({
      where: { id: business.id },
      data: { suspendedAt: now, suspendedUntil, suspendedByStaffId: actor.id, suspensionReason: reason },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'business.suspended',
      entityType: 'business',
      entityCode: business.code,
      before,
      after: { suspendedAt: now.toISOString(), suspendedUntil: suspendedUntil?.toISOString() ?? null, permanent },
      changedFields: ['suspendedAt', 'suspendedUntil', 'suspendedByStaffId', 'suspensionReason'],
      reason,
      city: business.city,
    });
    return this.suspensionOf(updated, now);
  }

  async liftSuspension(businessId: string, actorId: string, body: { reason?: unknown }) {
    const actor = await this.actor(actorId);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO lifts a suspension');
    const reason = this.reasonOf(body.reason);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');
    const now = this.clock.now();
    if (!isBusinessSuspended(business, now)) throw new BadRequestException('This business is not suspended');
    const ban = await this.prisma.permanentBan.findUnique({ where: { subjectType_subjectId: { subjectType: 'business', subjectId: business.id } } });
    if (ban) throw new ConflictException('This business is permanently banned; a ban is not lifted here');
    const updated = await this.prisma.business.update({
      where: { id: business.id },
      data: { suspendedAt: null, suspendedUntil: null, suspendedByStaffId: null, suspensionReason: null },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'business.suspension_lifted',
      entityType: 'business',
      entityCode: business.code,
      before: { suspendedAt: business.suspendedAt?.toISOString() ?? null, suspendedUntil: business.suspendedUntil?.toISOString() ?? null },
      after: { suspendedAt: null, suspendedUntil: null },
      changedFields: ['suspendedAt', 'suspendedUntil', 'suspendedByStaffId', 'suspensionReason'],
      reason,
      city: business.city,
    });
    return this.suspensionOf(updated, now);
  }

  /** For screens: whether the business is suspended now, until when, and why. */
  suspensionOf(business: { suspendedAt: Date | null; suspendedUntil: Date | null; suspensionReason: string | null }, now: Date = this.clock.now()) {
    const active = isBusinessSuspended(business, now);
    return {
      suspended: active,
      permanent: active && !business.suspendedUntil,
      suspendedAt: active ? business.suspendedAt : null,
      suspendedUntil: active ? business.suspendedUntil : null,
      reason: active ? business.suspensionReason : null,
    };
  }

  async ban(actorId: string, body: { subjectType?: unknown; subjectId?: unknown; category?: unknown; reason?: unknown }) {
    const actor = await this.actor(actorId);
    if (actor.role !== 'manager' && actor.role !== 'ceo') throw new ForbiddenException('Only a Manager or the CEO bans permanently');
    const subjectType = body.subjectType as BanSubjectType;
    if (!['job_seeker', 'business', 'referral'].includes(subjectType)) throw new BadRequestException('subjectType must be job_seeker, business or referral');
    const category = body.category as BanCategory;
    if (!(BAN_CATEGORIES as readonly string[]).includes(category)) throw new BadRequestException('category must be forged_id, fraud, theft or violence');
    const reason = this.reasonOf(body.reason);
    const subjectId = typeof body.subjectId === 'string' ? body.subjectId : '';
    const now = this.clock.now();

    const existing = await this.prisma.permanentBan.findUnique({ where: { subjectType_subjectId: { subjectType, subjectId } } });
    if (existing) throw new ConflictException('Already permanently banned');

    let code: string | null = null;
    let phone = '';
    let city: string | undefined;
    const fingerprints: string[] = [];
    if (subjectType === 'job_seeker') {
      const seeker = await this.prisma.jobSeeker.findUnique({
        where: { id: subjectId },
        select: { id: true, code: true, phone: true, name: true, status: true, city: true, identityVerifications: { where: { status: 'verified' }, select: { id: true, method: true, last4: true } } },
      });
      if (!seeker) throw new NotFoundException('Job seeker not found');
      code = seeker.code; phone = seeker.phone; city = seeker.city;
      fingerprints.push(...(await this.idFingerprints('job_seeker', seeker.id, seeker.name, seeker.identityVerifications)));
    } else if (subjectType === 'referral') {
      const partner = await this.prisma.referral.findUnique({
        where: { id: subjectId },
        select: { id: true, code: true, phone: true, name: true, city: true, identityVerifications: { where: { status: 'verified' }, select: { id: true, method: true, last4: true } } },
      });
      if (!partner) throw new NotFoundException('Referral partner not found');
      code = partner.code; phone = partner.phone; city = partner.city;
      fingerprints.push(...(await this.idFingerprints('referral', partner.id, partner.name, partner.identityVerifications)));
    } else {
      const business = await this.prisma.business.findUnique({ where: { id: subjectId }, select: { id: true, code: true, phone: true, gstNumber: true, pan: true, city: true } });
      if (!business) throw new NotFoundException('Business not found');
      code = business.code; phone = business.phone; city = business.city;
      if (business.gstNumber) fingerprints.push(businessIdFingerprint('gstin', business.gstNumber));
      if (business.pan) fingerprints.push(businessIdFingerprint('pan', business.pan));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.permanentBan.create({
        data: { subjectType, subjectId, subjectCode: code, category, reason, phoneHash: phoneHash(phone), idFingerprints: fingerprints, bannedByStaffId: actor.id, bannedAt: now },
      });
      if (subjectType === 'job_seeker') {
        const seeker = await tx.jobSeeker.findUniqueOrThrow({ where: { id: subjectId }, select: { status: true } });
        await tx.jobSeeker.update({ where: { id: subjectId }, data: { status: 'banned' } });
        await recordStatusChange(tx, { subjectType: 'job_seeker', subjectId, fromStatus: seeker.status, toStatus: 'banned', changedByStaffId: actor.id, reason: `permanent_ban_${category}`, changedAt: now });
        // His open ₹499 requests close now: no payment can bring him back.
        const open = await tx.payment.findMany({ where: { jobSeekerId: subjectId, type: 'activation', status: 'pending' }, select: { id: true } });
        if (open.length) {
          await tx.payment.updateMany({ where: { id: { in: open.map((p) => p.id) }, status: 'pending' }, data: { status: 'failed' } });
          for (const p of open) {
            await recordStatusChange(tx, { subjectType: 'payment', subjectId: p.id, fromStatus: 'pending', toStatus: 'failed', changedByStaffId: actor.id, reason: 'closed_permanent_ban', changedAt: now });
          }
        }
      } else if (subjectType === 'referral') {
        await tx.referral.update({ where: { id: subjectId }, data: { pausedAt: now, pausedByStaffId: actor.id, pauseReason: `Permanent ban (${category}): ${reason}` } });
      } else {
        await tx.business.update({ where: { id: subjectId }, data: { suspendedAt: now, suspendedUntil: null, suspendedByStaffId: actor.id, suspensionReason: `Permanent ban (${category}): ${reason}` } });
      }
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'permanent_ban.created',
      entityType: subjectType,
      entityCode: code ?? subjectId,
      before: { banned: false },
      after: { banned: true, category, fingerprints: fingerprints.length },
      changedFields: ['permanentBan'],
      reason,
      city,
    });
    return { banned: true, subjectType, subjectCode: code, category, bannedAt: now };
  }

  async banOf(subjectType: string, subjectId: string) {
    const ban = await this.prisma.permanentBan.findUnique({
      where: { subjectType_subjectId: { subjectType, subjectId } },
      select: { category: true, reason: true, bannedAt: true, bannedByStaffId: true },
    });
    return { banned: Boolean(ban), ...(ban ?? {}) };
  }

  private async idFingerprints(subjectType: 'job_seeker' | 'referral', subjectId: string, name: string, verifications: { id: string; method: string; last4: string | null }[]): Promise<string[]> {
    const details = await this.prisma.idCheckDetail.findMany({
      where: { subjectType, subjectId, kind: 'aadhaar_qr' },
      select: { verificationId: true, dateOfBirth: true, nameOnId: true },
    });
    const out: string[] = [];
    for (const v of verifications) {
      if (!v.last4) continue;
      if (v.method === 'aadhaar_qr') {
        const d = details.find((x) => x.verificationId === v.id);
        if (d?.dateOfBirth && d.nameOnId) out.push(aadhaarFingerprint(v.last4, d.dateOfBirth, d.nameOnId));
      } else {
        out.push(otherIdFingerprint(v.method, v.last4, name));
      }
    }
    return [...new Set(out)];
  }
}
