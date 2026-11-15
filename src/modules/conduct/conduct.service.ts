import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { MessagingService } from '../message/messaging.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { CustomerNotificationService } from '../customer-notification/customer-notification.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { mobileLookupValues } from '../../common/phone/indian-mobile';
import { pauseClaimClocks, resumeClaimClocks } from '../placement/claim-clock';
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
  openBanReview,
  phoneHash,
  POSSIBLE_BAN_FLAG,
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
type Client = PrismaService | Prisma.TransactionClient;

/** One profile a ban covers, with what it was before the ban (restored on a lift). */
export interface CoveredProfile {
  subjectType: BanSubjectType;
  subjectId: string;
  code: string | null;
  before: Record<string, unknown>;
  /** H1: already blocked by this other live ban when this one was made (its "before" was copied from it). */
  alreadyBannedBy?: string;
}

/** H2 (rev 181): a profile that matches the banned person only on another ID — a Manager or the CEO decides. */
export interface PossibleProfile {
  subjectType: 'job_seeker' | 'referral';
  subjectId: string;
  code: string | null;
}

function coveredOf(ban: { coveredProfiles: Prisma.JsonValue; subjectType: string; subjectId: string; subjectCode: string | null }): CoveredProfile[] {
  const rows = Array.isArray(ban.coveredProfiles) ? (ban.coveredProfiles as unknown as CoveredProfile[]) : [];
  return rows.length ? rows : [{ subjectType: ban.subjectType as BanSubjectType, subjectId: ban.subjectId, code: ban.subjectCode, before: {} }];
}

/** H1: a lifted ban puts a job seeker back only to one of these; anything else is paused for review. */
const RESTORABLE_JOB_SEEKER_STATUSES: readonly string[] = ['active', 'paused', 'inactive'];

const dateOrNull = (value: unknown): Date | null => (typeof value === 'string' && value ? new Date(value) : null);

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
    @Optional() private readonly messaging?: MessagingService,
    @Optional() private readonly customerNotifications?: CustomerNotificationService,
    @Optional() private readonly flags?: ReviewFlagService,
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
    const banned = await this.liveBanFor(this.prisma, 'business', business.id);
    if (banned) throw new ConflictException('This business is permanently banned; it cannot be suspended for a time');
    const now = this.clock.now();
    const suspendedUntil = permanent ? null : new Date(now.getTime() + days * DAY_MS);
    const before = { suspendedAt: business.suspendedAt?.toISOString() ?? null, suspendedUntil: business.suspendedUntil?.toISOString() ?? null };
    let cancelledInterviews: { id: string; jobSeekerId: string }[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      // An earlier suspension that ended on its date: its pause stops at that date first.
      if (business.suspendedUntil && business.suspendedUntil.getTime() <= now.getTime()) await resumeClaimClocks(tx, business.id, business.suspendedUntil);
      const row = await tx.business.update({
        where: { id: business.id },
        data: { suspendedAt: now, suspendedUntil, suspendedByStaffId: actor.id, suspensionReason: reason },
      });
      // M10 (rev 178): the 15-day replacement clock of its open claims stands still while it is suspended.
      await pauseClaimClocks(tx, business.id, now);
      // A suspended business interviews no one: its upcoming interviews are cancelled.
      cancelledInterviews = await this.cancelUpcomingInterviews(tx, business.id, actor.id, now);
      return row;
    });
    await this.tellInterviewsCancelled(business.id, cancelledInterviews);
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
    const ban = await this.liveBanFor(this.prisma, 'business', business.id);
    if (ban) throw new ConflictException('This business is permanently banned; a ban is not lifted here');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id: business.id },
        data: { suspendedAt: null, suspendedUntil: null, suspendedByStaffId: null, suspensionReason: null },
      });
      // M10: the claims' replacement clocks continue from where they stopped.
      await resumeClaimClocks(tx, business.id, now);
      return row;
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

  /** Upcoming interviews (offered or confirmed, slot still ahead) of a business that may not interview: cancelled. */
  private async cancelUpcomingInterviews(tx: Prisma.TransactionClient, businessId: string, actorId: string, now: Date) {
    const upcoming = await tx.interview.findMany({
      where: { businessId, status: { in: ['offered', 'confirmed'] }, slotStartsAt: { gt: now } },
      select: { id: true, jobSeekerId: true, status: true },
    });
    for (const row of upcoming) {
      const changed = await tx.interview.updateMany({ where: { id: row.id, status: row.status }, data: { status: 'cancelled', cancelReason: 'business_suspended' } });
      if (changed.count === 1) {
        await recordStatusChange(tx, { subjectType: 'interview', subjectId: row.id, fromStatus: row.status, toStatus: 'cancelled', changedByStaffId: actorId, reason: 'business_suspended', changedAt: now });
      }
    }
    return upcoming.map((row) => ({ id: row.id, jobSeekerId: row.jobSeekerId }));
  }

  /** The job seeker (app + SMS) and the business (app) hear that the interview is off. */
  private async tellInterviewsCancelled(businessId: string, interviews: { id: string; jobSeekerId: string }[]) {
    for (const row of interviews) {
      await this.customerNotifications?.notify({ jobSeekerId: row.jobSeekerId }, 'interview_cancelled', {}, { dedupeKey: `interview_cancelled:${row.id}` }).catch(() => undefined);
      await this.messaging?.send({ channel: 'sms', template: 'interview_cancelled', subjectType: 'job_seeker', subjectId: row.jobSeekerId, relatedType: 'interview', relatedId: row.id, variables: {} }).catch(() => undefined);
    }
    if (interviews.length) {
      await this.customerNotifications?.notify({ businessId }, 'interview_cancelled', {}, { dedupeKey: `interview_cancelled:business:${businessId}:${interviews[0].id}` }).catch(() => undefined);
    }
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

  /** A live (not lifted) ban that covers this profile, as the banned profile or one of its other profiles (M9). */
  private liveBanFor(client: Client, subjectType: string, subjectId: string) {
    return client.permanentBan.findFirst({
      where: {
        liftedAt: null,
        OR: [{ subjectType, subjectId }, { coveredProfiles: { array_contains: [{ subjectType, subjectId }] } }],
      },
      orderBy: { bannedAt: 'desc' },
    });
  }

  /**
   * Every profile of the person (M9, rev 178): the banned one, and any job
   * seeker, business (as owner) or referral partner on the same phone number,
   * the same Aadhaar or the same GSTIN/PAN. A match only on another ID (voter ID,
   * driving licence, PAN: type + last 4 + name) is never covered by itself
   * (H2, rev 181): it is returned as `possible`, for a Manager or the CEO to decide.
   */
  private async personProfiles(client: Client, phone: string, fingerprints: string[], idLast4s: string[], first: CoveredProfile, possible: PossibleProfile[] = []): Promise<CoveredProfile[]> {
    const phones = mobileLookupValues(phone);
    const out = new Map<string, CoveredProfile>([[`${first.subjectType}:${first.subjectId}`, first]]);
    const add = (p: CoveredProfile) => {
      const key = `${p.subjectType}:${p.subjectId}`;
      if (!out.has(key)) out.set(key, p);
    };
    const ids = new Set(fingerprints);
    const verified = { where: { status: 'verified' }, select: { id: true, method: true, last4: true } } as const;
    const last4s = [...new Set(idLast4s.filter(Boolean))];
    const seekers = await client.jobSeeker.findMany({
      where: { OR: [{ phone: { in: phones } }, ...(last4s.length ? [{ identityVerifications: { some: { status: 'verified', last4: { in: last4s } } } }] : [])] },
      select: { id: true, code: true, name: true, phone: true, status: true, identityVerifications: verified },
    });
    for (const s of seekers) {
      const samePhone = phones.includes(s.phone);
      const sameAadhaar = !samePhone && (await this.idFingerprints(client, 'job_seeker', s.id, s.name, s.identityVerifications, 'aadhaar')).some((f) => ids.has(f));
      if (samePhone || sameAadhaar) add({ subjectType: 'job_seeker', subjectId: s.id, code: s.code, before: { status: s.status } });
      else if ((await this.idFingerprints(client, 'job_seeker', s.id, s.name, s.identityVerifications, 'other')).some((f) => ids.has(f))) possible.push({ subjectType: 'job_seeker', subjectId: s.id, code: s.code });
    }
    const partners = await client.referral.findMany({
      where: { OR: [{ phone: { in: phones } }, ...(last4s.length ? [{ identityVerifications: { some: { status: 'verified', last4: { in: last4s } } } }] : [])] },
      select: { id: true, code: true, name: true, phone: true, pausedAt: true, pausedByStaffId: true, pauseReason: true, identityVerifications: verified },
    });
    for (const p of partners) {
      const samePhone = phones.includes(p.phone);
      const sameAadhaar = !samePhone && (await this.idFingerprints(client, 'referral', p.id, p.name, p.identityVerifications, 'aadhaar')).some((f) => ids.has(f));
      if (!samePhone && !sameAadhaar) {
        if ((await this.idFingerprints(client, 'referral', p.id, p.name, p.identityVerifications, 'other')).some((f) => ids.has(f))) possible.push({ subjectType: 'referral', subjectId: p.id, code: p.code });
        continue;
      }
      add({ subjectType: 'referral', subjectId: p.id, code: p.code, before: { pausedAt: p.pausedAt?.toISOString() ?? null, pausedByStaffId: p.pausedByStaffId, pauseReason: p.pauseReason } });
    }
    const businesses = await client.business.findMany({
      where: { phone: { in: phones } },
      select: { id: true, code: true, suspendedAt: true, suspendedUntil: true, suspendedByStaffId: true, suspensionReason: true },
    });
    const businessFingerprints = await client.business.findMany({
      where: { OR: [{ gstNumber: { not: null } }, { pan: { not: null } }], NOT: { phone: { in: phones } } },
      select: { id: true, code: true, gstNumber: true, pan: true, suspendedAt: true, suspendedUntil: true, suspendedByStaffId: true, suspensionReason: true },
    }).then((rows) => rows.filter((b) => (b.gstNumber && ids.has(businessIdFingerprint('gstin', b.gstNumber))) || (b.pan && ids.has(businessIdFingerprint('pan', b.pan)))));
    for (const b of [...businesses, ...businessFingerprints]) {
      add({
        subjectType: 'business', subjectId: b.id, code: b.code,
        before: { suspendedAt: b.suspendedAt?.toISOString() ?? null, suspendedUntil: b.suspendedUntil?.toISOString() ?? null, suspendedByStaffId: b.suspendedByStaffId, suspensionReason: b.suspensionReason },
      });
    }
    return [...out.values()];
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

    if (await this.liveBanFor(this.prisma, subjectType, subjectId)) throw new ConflictException('Already permanently banned');

    let code: string | null = null;
    let phone = '';
    let city: string | undefined;
    const fingerprints: string[] = [];
    // The last 4 digits of the banned profile's verified IDs: other profiles with the same ID are found by them.
    let idLast4s: string[] = [];
    let first: CoveredProfile;
    if (subjectType === 'job_seeker') {
      const seeker = await this.prisma.jobSeeker.findUnique({
        where: { id: subjectId },
        select: { id: true, code: true, phone: true, name: true, status: true, city: true, identityVerifications: { where: { status: 'verified' }, select: { id: true, method: true, last4: true } } },
      });
      if (!seeker) throw new NotFoundException('Job seeker not found');
      code = seeker.code; phone = seeker.phone; city = seeker.city;
      fingerprints.push(...(await this.idFingerprints(this.prisma, 'job_seeker', seeker.id, seeker.name, seeker.identityVerifications)));
      idLast4s = seeker.identityVerifications.map((v) => v.last4 ?? '');
      first = { subjectType, subjectId: seeker.id, code: seeker.code, before: { status: seeker.status } };
    } else if (subjectType === 'referral') {
      const partner = await this.prisma.referral.findUnique({
        where: { id: subjectId },
        select: { id: true, code: true, phone: true, name: true, city: true, pausedAt: true, pausedByStaffId: true, pauseReason: true, identityVerifications: { where: { status: 'verified' }, select: { id: true, method: true, last4: true } } },
      });
      if (!partner) throw new NotFoundException('Referral partner not found');
      code = partner.code; phone = partner.phone; city = partner.city;
      fingerprints.push(...(await this.idFingerprints(this.prisma, 'referral', partner.id, partner.name, partner.identityVerifications)));
      idLast4s = partner.identityVerifications.map((v) => v.last4 ?? '');
      first = { subjectType, subjectId: partner.id, code: partner.code, before: { pausedAt: partner.pausedAt?.toISOString() ?? null, pausedByStaffId: partner.pausedByStaffId, pauseReason: partner.pauseReason } };
    } else {
      const business = await this.prisma.business.findUnique({
        where: { id: subjectId },
        select: { id: true, code: true, phone: true, gstNumber: true, pan: true, city: true, suspendedAt: true, suspendedUntil: true, suspendedByStaffId: true, suspensionReason: true },
      });
      if (!business) throw new NotFoundException('Business not found');
      code = business.code; phone = business.phone; city = business.city;
      if (business.gstNumber) fingerprints.push(businessIdFingerprint('gstin', business.gstNumber));
      if (business.pan) fingerprints.push(businessIdFingerprint('pan', business.pan));
      first = {
        subjectType, subjectId: business.id, code: business.code,
        before: { suspendedAt: business.suspendedAt?.toISOString() ?? null, suspendedUntil: business.suspendedUntil?.toISOString() ?? null, suspendedByStaffId: business.suspendedByStaffId, suspensionReason: business.suspensionReason },
      };
    }
    let covered: CoveredProfile[] = [];
    const possible: PossibleProfile[] = [];
    let banId = '';
    const cancelledByBusiness: { businessId: string; interviews: { id: string; jobSeekerId: string }[] }[] = [];
    await this.prisma.$transaction(async (tx) => {
      // H1: one ban at a time — the cover lookup and the insert see the same live bans.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('permanent-ban'))`);
      if (await this.liveBanFor(tx, subjectType, subjectId)) throw new ConflictException('Already permanently banned');
      covered = await this.personProfiles(tx, phone, fingerprints, idLast4s, first, possible);
      // A profile already under another live ban keeps that ban's "before" (what it really was) and is not
      // blocked again; whichever ban is lifted last restores it.
      for (const profile of covered) {
        const other = await this.liveBanFor(tx, profile.subjectType, profile.subjectId);
        if (!other) continue;
        profile.before = coveredOf(other).find((p) => p.subjectType === profile.subjectType && p.subjectId === profile.subjectId)?.before ?? {};
        profile.alreadyBannedBy = other.id;
      }
      const created = await tx.permanentBan.create({
        data: {
          subjectType, subjectId, subjectCode: code, category, reason, phoneHash: phoneHash(phone), idFingerprints: fingerprints,
          coveredProfiles: covered as unknown as Prisma.InputJsonValue, bannedByStaffId: actor.id, bannedAt: now,
        },
      });
      banId = created?.id ?? '';
      for (const profile of covered) {
        if (profile.alreadyBannedBy) continue;
        const cancelled = await this.applyBan(tx, profile, actor.id, category, reason, now);
        if (cancelled.length) cancelledByBusiness.push({ businessId: profile.subjectId, interviews: cancelled });
      }
    });
    for (const row of cancelledByBusiness) await this.tellInterviewsCancelled(row.businessId, row.interviews);
    // H2: profiles matching only on another ID go to a Manager or the CEO — never banned by the match alone.
    for (const p of possible) await this.raisePossibleMatch(p, banId, code, 'ban');
    await this.audit.log({
      actorId: actor.id,
      action: 'permanent_ban.created',
      entityType: subjectType,
      entityCode: code ?? subjectId,
      before: { banned: false },
      after: { banned: true, category, fingerprints: fingerprints.length, profiles: covered.map((p) => p.code ?? p.subjectId) },
      changedFields: ['permanentBan'],
      reason,
      city,
    });
    return { banned: true, subjectType, subjectCode: code, category, bannedAt: now, profiles: covered.map((p) => ({ subjectType: p.subjectType, code: p.code })) };
  }

  /** Blocks one profile now: a job seeker is banned (open ₹499 requests close), a partner paused, a business suspended for good. */
  private async applyBan(tx: Prisma.TransactionClient, profile: CoveredProfile, actorId: string, category: string, reason: string, now: Date): Promise<{ id: string; jobSeekerId: string }[]> {
    const note = `Permanent ban (${category}): ${reason}`;
    if (profile.subjectType === 'job_seeker') {
      await tx.jobSeeker.update({ where: { id: profile.subjectId }, data: { status: 'banned' } });
      await recordStatusChange(tx, { subjectType: 'job_seeker', subjectId: profile.subjectId, fromStatus: String(profile.before.status ?? ''), toStatus: 'banned', changedByStaffId: actorId, reason: `permanent_ban_${category}`, changedAt: now });
      // His open ₹499 requests close now: no payment can bring him back.
      const open = await tx.payment.findMany({ where: { jobSeekerId: profile.subjectId, type: 'activation', status: 'pending' }, select: { id: true } });
      if (open.length) {
        await tx.payment.updateMany({ where: { id: { in: open.map((p) => p.id) }, status: 'pending' }, data: { status: 'failed' } });
        for (const p of open) {
          await recordStatusChange(tx, { subjectType: 'payment', subjectId: p.id, fromStatus: 'pending', toStatus: 'failed', changedByStaffId: actorId, reason: 'closed_permanent_ban', changedAt: now });
        }
      }
    } else if (profile.subjectType === 'referral') {
      await tx.referral.update({ where: { id: profile.subjectId }, data: { pausedAt: now, pausedByStaffId: actorId, pauseReason: note } });
    } else {
      // An earlier suspension that ended on its date: its pause stops at that date first (as suspendBusiness).
      const endedUntil = dateOrNull(profile.before.suspendedUntil);
      if (endedUntil && endedUntil.getTime() <= now.getTime()) await resumeClaimClocks(tx, profile.subjectId, endedUntil);
      await tx.business.update({ where: { id: profile.subjectId }, data: { suspendedAt: now, suspendedUntil: null, suspendedByStaffId: actorId, suspensionReason: note } });
      // M10: a business suspended for good keeps its claims' replacement clocks paused and interviews no one.
      await pauseClaimClocks(tx, profile.subjectId, now);
      return this.cancelUpcomingInterviews(tx, profile.subjectId, actorId, now);
    }
    return [];
  }

  /**
   * M7 (rev 178): only the CEO lifts a ban, with a written reason. Every
   * profile it covered goes back to what it was before the ban (a job seeker
   * whose earlier status was not kept is paused for review). The ban row stays,
   * marked lifted with who, when and why.
   */
  async liftBan(subjectType: string, subjectId: string, actorId: string, body: { reason?: unknown }) {
    const actor = await this.actor(actorId);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO lifts a permanent ban');
    const reason = this.reasonOf(body.reason);
    const ban = await this.liveBanFor(this.prisma, subjectType, subjectId);
    if (!ban) throw new NotFoundException('No permanent ban to lift');
    const now = this.clock.now();
    const covered = coveredOf(ban);
    const restored: { code: string | null; to: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      const lifted = await tx.permanentBan.updateMany({ where: { id: ban.id, liftedAt: null }, data: { liftedAt: now, liftedByStaffId: actor.id, liftReason: reason } });
      if (lifted.count !== 1) throw new ConflictException('This ban was already lifted');
      for (const profile of covered) restored.push({ code: profile.code, to: await this.restoreProfile(tx, profile, actor.id, now) });
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'permanent_ban.lifted',
      entityType: ban.subjectType,
      entityCode: ban.subjectCode ?? ban.subjectId,
      before: { banned: true, category: ban.category },
      after: { banned: false, restored },
      changedFields: ['permanentBan'],
      reason,
    });
    return { lifted: true, liftedAt: now, restored };
  }

  private async restoreProfile(tx: Prisma.TransactionClient, profile: CoveredProfile, actorId: string, now: Date): Promise<string> {
    // H1: still covered by another live ban — it stays blocked until that one is lifted too.
    if (await this.liveBanFor(tx, profile.subjectType, profile.subjectId)) return 'still_banned';
    const before = profile.before ?? {};
    if (profile.subjectType === 'job_seeker') {
      const seeker = await tx.jobSeeker.findUnique({ where: { id: profile.subjectId }, select: { status: true } });
      if (!seeker || seeker.status !== 'banned') return seeker?.status ?? 'missing';
      // Back to active, paused or inactive only; anything else (placed, an unknown or unkept status) is paused
      // so a person reviews him before he is matched again.
      const kept = typeof before.status === 'string' ? before.status : null;
      const to = kept && RESTORABLE_JOB_SEEKER_STATUSES.includes(kept) ? kept : 'paused';
      await tx.jobSeeker.update({ where: { id: profile.subjectId }, data: { status: to } });
      await recordStatusChange(tx, { subjectType: 'job_seeker', subjectId: profile.subjectId, fromStatus: 'banned', toStatus: to, changedByStaffId: actorId, reason: to === kept ? 'permanent_ban_lifted' : 'permanent_ban_lifted_needs_review', changedAt: now });
      return to;
    }
    if (profile.subjectType === 'referral') {
      await tx.referral.update({
        where: { id: profile.subjectId },
        data: { pausedAt: dateOrNull(before.pausedAt), pausedByStaffId: (before.pausedByStaffId as string | null) ?? null, pauseReason: (before.pauseReason as string | null) ?? null },
      });
      return before.pausedAt ? 'paused' : 'active';
    }
    const suspendedAt = dateOrNull(before.suspendedAt);
    const suspendedUntil = dateOrNull(before.suspendedUntil);
    await tx.business.update({
      where: { id: profile.subjectId },
      data: { suspendedAt, suspendedUntil, suspendedByStaffId: (before.suspendedByStaffId as string | null) ?? null, suspensionReason: (before.suspensionReason as string | null) ?? null },
    });
    // M10: back to an earlier suspension still running — the clocks stay paused; otherwise they continue now.
    if (!isBusinessSuspended({ suspendedAt, suspendedUntil }, now)) await resumeClaimClocks(tx, profile.subjectId, now);
    return isBusinessSuspended({ suspendedAt, suspendedUntil }, now) ? 'suspended' : 'active';
  }

  /** H2: one open "possibly the same person as a banned person" item per profile (Manager / CEO). */
  private async raisePossibleMatch(p: PossibleProfile, banId: string, bannedCode: string | null, matchedAt: 'ban' | 'id_check') {
    if (!banId || (await openBanReview(this.prisma, p.subjectType, p.subjectId))) return;
    if (await this.liveBanFor(this.prisma, p.subjectType, p.subjectId)) return;
    await this.flags?.raise({
      kind: POSSIBLE_BAN_FLAG,
      subjectType: p.subjectType,
      subjectId: p.subjectId,
      owner: { role: 'manager' },
      details: { banId, bannedCode, subjectCode: p.code, matchedOn: 'other_id', matchedAt },
    });
  }

  private async openPossibleMatch(flagId: string) {
    const flag = await this.prisma.reviewFlag.findUnique({ where: { id: flagId } });
    if (!flag || flag.kind !== POSSIBLE_BAN_FLAG) throw new NotFoundException('No such review item');
    if (flag.status !== 'open') throw new ConflictException('This review item was already decided');
    const details = (flag.details ?? {}) as { banId?: string };
    return { flag, banId: details.banId ?? '', details: flag.details as Record<string, unknown> };
  }

  /**
   * H2 (rev 181) "Confirm — same person": a Manager or the CEO, with a reason, covers the profile under
   * the ban (blocked like the others, restored with them on a lift). Audited.
   */
  async confirmPossibleMatch(flagId: string, actorId: string, body: { reason?: unknown }) {
    const actor = await this.actor(actorId);
    if (actor.role !== 'manager' && actor.role !== 'ceo') throw new ForbiddenException('Only a Manager or the CEO decides this');
    const reason = this.reasonOf(body.reason);
    const { flag, banId, details } = await this.openPossibleMatch(flagId);
    const now = this.clock.now();
    const subjectType = flag.subjectType as 'job_seeker' | 'referral';
    const cancelled: { id: string; jobSeekerId: string }[] = [];
    let ban: { id: string; subjectType: string; subjectId: string; subjectCode: string | null; category: string; reason: string } | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('permanent-ban'))`);
      const live = await tx.permanentBan.findFirst({ where: { id: banId, liftedAt: null } });
      if (!live) throw new ConflictException('That ban was lifted meanwhile; close this item as not the same person');
      ban = live;
      const profile = await this.profileNow(tx, subjectType, flag.subjectId);
      const covered = coveredOf(live);
      const other = await this.liveBanFor(tx, subjectType, flag.subjectId);
      if (other) profile.alreadyBannedBy = other.id;
      await tx.permanentBan.update({ where: { id: live.id }, data: { coveredProfiles: [...covered, profile] as unknown as Prisma.InputJsonValue } });
      if (!other) cancelled.push(...(await this.applyBan(tx, profile, actor.id, live.category, live.reason, now)));
      await tx.reviewFlag.update({
        where: { id: flag.id },
        data: { status: 'resolved', resolvedAt: now, resolvedByStaffId: actor.id, resolution: reason, details: { ...details, decision: 'same_person' } as Prisma.InputJsonValue },
      });
    });
    await this.flags?.refreshBell(flag.id);
    const b = ban as unknown as { subjectType: string; subjectCode: string | null; subjectId: string };
    await this.audit.log({
      actorId: actor.id, action: 'permanent_ban.possible_match_confirmed', entityType: subjectType, entityCode: String(details.subjectCode ?? flag.subjectId),
      before: { covered: false }, after: { covered: true, banOf: b.subjectCode ?? b.subjectId }, changedFields: ['permanentBan'], reason,
    });
    return { decided: 'same_person' };
  }

  /** H2 "Not the same person": clears the item (audited); the same match is not raised again for this ban. */
  async rejectPossibleMatch(flagId: string, actorId: string, body: { reason?: unknown }) {
    const actor = await this.actor(actorId);
    if (actor.role !== 'manager' && actor.role !== 'ceo') throw new ForbiddenException('Only a Manager or the CEO decides this');
    const reason = this.reasonOf(body.reason);
    const { flag, details } = await this.openPossibleMatch(flagId);
    const now = this.clock.now();
    const changed = await this.prisma.reviewFlag.updateMany({
      where: { id: flag.id, status: 'open' },
      data: { status: 'dismissed', resolvedAt: now, resolvedByStaffId: actor.id, resolution: reason, details: { ...details, decision: 'not_same' } as Prisma.InputJsonValue },
    });
    if (changed.count !== 1) throw new ConflictException('This review item was already decided');
    await this.flags?.refreshBell(flag.id);
    await this.audit.log({
      actorId: actor.id, action: 'permanent_ban.possible_match_rejected', entityType: flag.subjectType, entityCode: String(details.subjectCode ?? flag.subjectId),
      before: { reviewOpen: true }, after: { reviewOpen: false, sameAsBanned: false }, changedFields: ['reviewFlag'], reason,
    });
    return { decided: 'not_same' };
  }

  /** What a profile is right now, for covering it under a ban (and restoring it on a lift). */
  private async profileNow(client: Client, subjectType: 'job_seeker' | 'referral', subjectId: string): Promise<CoveredProfile> {
    if (subjectType === 'job_seeker') {
      const s = await client.jobSeeker.findUnique({ where: { id: subjectId }, select: { id: true, code: true, status: true } });
      if (!s) throw new NotFoundException('Job seeker not found');
      return { subjectType, subjectId: s.id, code: s.code, before: { status: s.status } };
    }
    const p = await client.referral.findUnique({ where: { id: subjectId }, select: { id: true, code: true, pausedAt: true, pausedByStaffId: true, pauseReason: true } });
    if (!p) throw new NotFoundException('Referral partner not found');
    return { subjectType, subjectId: p.id, code: p.code, before: { pausedAt: p.pausedAt?.toISOString() ?? null, pausedByStaffId: p.pausedByStaffId, pauseReason: p.pauseReason } };
  }

  async banOf(subjectType: string, subjectId: string) {
    const ban = await this.liveBanFor(this.prisma, subjectType, subjectId);
    if (!ban) return { banned: false };
    return {
      banned: true,
      category: ban.category,
      reason: ban.reason,
      bannedAt: ban.bannedAt,
      bannedByStaffId: ban.bannedByStaffId,
      /** Banned through another profile of the same person (same phone or ID). */
      viaProfile: ban.subjectType === subjectType && ban.subjectId === subjectId ? null : { subjectType: ban.subjectType, code: ban.subjectCode },
      profiles: coveredOf(ban).map((p) => ({ subjectType: p.subjectType, code: p.code })),
    };
  }

  private async idFingerprints(
    client: Client, subjectType: 'job_seeker' | 'referral', subjectId: string, name: string, verifications: { id: string; method: string; last4: string | null }[],
    only: 'aadhaar' | 'other' | 'all' = 'all',
  ): Promise<string[]> {
    const details = await client.idCheckDetail.findMany({
      where: { subjectType, subjectId, kind: 'aadhaar_qr' },
      select: { verificationId: true, dateOfBirth: true, nameOnId: true },
    });
    const out: string[] = [];
    for (const v of verifications) {
      if (!v.last4) continue;
      if (v.method === 'aadhaar_qr') {
        if (only === 'other') continue;
        const d = details.find((x) => x.verificationId === v.id);
        if (d?.dateOfBirth && d.nameOnId) out.push(aadhaarFingerprint(v.last4, d.dateOfBirth, d.nameOnId));
      } else if (only !== 'aadhaar') {
        out.push(otherIdFingerprint(v.method, v.last4, name));
      }
    }
    return [...new Set(out)];
  }
}
