import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { RBAC_MATRIX, Role } from '../../common/rbac/rbac.types';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PricingService } from '../pricing/pricing.service';
import { ConsentClock } from '../consent/consent-clock';
import { tradeNameKey } from '../trade/trade.service';
import { JOB_SEEKER_CONSENT_PURPOSES, JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from '../consent/consent.constants';
import { BENGALURU_AREAS } from './bengaluru-areas';

/**
 * Read endpoints for the call agent console's registration screens
 * (designs CA08–CA15). Every answer passes through PiiMaskingInterceptor
 * in the controller: phone numbers keep only the last 4 digits for every
 * role except the CEO, and a Manager never receives a money figure.
 */
export type StepState = 'done' | 'in_progress' | 'stuck' | 'not_started';

export interface ScreenActor {
  id: string;
  role: string;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Whole years between an IST birthday and an instant, as people count age. */
export function ageInYears(dateOfBirth: Date, now: Date): number {
  const today = new Date(now.getTime() + IST_OFFSET_MS);
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}

function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return [...new Set([raw.trim(), ten, `91${ten}`, `+91${ten}`])];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function relationFrom(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const relation = (metadata as Record<string, unknown>).relation;
  return typeof relation === 'string' ? relation : null;
}

@Injectable()
export class ScreensCallRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSeekers: JobSeekerService,
    private readonly pricing: PricingService,
    private readonly clock: ConsentClock,
  ) {}

  /** Areas list for every registration form; the pincode fills the city. */
  options() {
    return { city: 'Bengaluru', areas: BENGALURU_AREAS };
  }

  private async findSeeker(ref: string) {
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: isUuid(ref) ? { id: ref } : { code: ref },
      include: { trades: { orderBy: { isPrimary: 'desc' } } },
    });
    if (!seeker) throw new NotFoundException(`Job seeker '${ref}' not found`);
    return seeker;
  }

  /** CA08b / CA08c / CA08f: the saved summary and the live step panel. */
  async jobSeeker(ref: string) {
    const seeker = await this.findSeeker(ref);
    const now = this.clock.now();
    const [registration, payment, paymentLinks, consents, listedTrades, policy] = await Promise.all([
      this.jobSeekers.getRegistrationStatus(seeker.id),
      this.prisma.payment.findFirst({
        where: { jobSeekerId: seeker.id, type: 'activation' },
        orderBy: { createdAt: 'desc' },
        select: { status: true, payerUtrHint: true, confirmedAt: true },
      }),
      this.prisma.publicLink.findMany({
        where: { purpose: 'payment_only', subjectType: 'job_seeker', subjectId: seeker.id },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { phone: true, metadata: true, usedAt: true, revokedAt: true, expiresAt: true, createdAt: true },
      }),
      this.prisma.consent.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, granted: true, withdrawnAt: null },
        select: { purpose: true },
      }),
      this.prisma.trade.findMany({ where: { active: true }, select: { nameKey: true } }),
      this.pricing.current(),
    ]);
    const listed = new Set(listedTrades.map((trade) => trade.nameKey));
    const given = new Set(consents.map((consent) => consent.purpose));
    const paymentStep = registration.steps.payment;
    const paymentState =
      paymentStep.state !== 'done' && payment?.status === 'pending' && payment.payerUtrHint ? 'confirming' : paymentStep.state;
    const otherPayerLink = paymentLinks[0] ?? null;
    const paid = Boolean(seeker.paymentReceivedAt);
    const steps = registration.steps;
    const stage = paid && steps.payment.state === 'done'
      ? 'active'
      : registration.registrationLinkExpiresAt || [steps.consent, steps.selfie, steps.idCheck].some((s) => s.state !== 'not_started')
        ? 'in_progress'
        : 'registered';
    const nextStep = steps.consent.state !== 'done'
      ? 'consent'
      : steps.selfie.state !== 'done'
        ? 'selfie'
        : steps.idCheck.state !== 'done'
          ? 'id_check'
          : steps.payment.state !== 'done'
            ? 'payment'
            : 'complete';
    return {
      id: seeker.id,
      code: seeker.code,
      name: seeker.name,
      age: seeker.dateOfBirth ? ageInYears(seeker.dateOfBirth, now) : null,
      gender: seeker.gender,
      phone: seeker.phone,
      phoneVerifiedAt: seeker.phoneVerified ? seeker.createdAt : null,
      messageLanguage: seeker.messageLanguage,
      locality: seeker.locality,
      travelDistanceKm: seeker.travelDistanceKm,
      shiftPreference: seeker.shiftPreference,
      salaryPeriod: seeker.salaryPeriod,
      minSalary: seeker.minSalary,
      maxSalary: seeker.maxSalary,
      trades: seeker.trades.map((trade) => ({
        trade: trade.trade,
        yearsExperience: trade.yearsExperience,
        isPrimary: trade.isPrimary,
        listed: listed.has(tradeNameKey(trade.trade)),
      })),
      status: seeker.status,
      stage,
      nextStep,
      steps: { ...steps, payment: { ...paymentStep, state: paymentState } },
      consent: {
        requiredGiven: JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.filter((purpose) => given.has(purpose)).length,
        requiredTotal: JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.length,
        promotions: given.has('promotions'),
      },
      registrationLinkExpiresAt: registration.registrationLinkExpiresAt,
      paymentOnlyLink: otherPayerLink
        ? {
            payerPhone: otherPayerLink.phone,
            relation: relationFrom(otherPayerLink.metadata),
            sentAt: otherPayerLink.createdAt,
            expiresAt: otherPayerLink.expiresAt,
            live: !otherPayerLink.usedAt && !otherPayerLink.revokedAt && otherPayerLink.expiresAt > now,
            used: Boolean(otherPayerLink.usedAt),
          }
        : null,
      paymentConfirmedAt: payment?.confirmedAt ?? null,
      paymentReceivedAt: seeker.paymentReceivedAt,
      guaranteeEndsAt: seeker.paymentReceivedAt
        ? refundGuaranteeDeadline(seeker.paymentReceivedAt, policy.jobSeekerGuaranteeDays)
        : null,
    };
  }

  /** CA08d: a read-only copy of what the job seeker agreed to. */
  async signedConsent(ref: string) {
    const seeker = await this.findSeeker(ref);
    const records = await this.prisma.consent.findMany({
      where: { subjectType: 'job_seeker', subjectId: seeker.id },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, (typeof records)[number]>();
    for (const record of records) if (!latest.has(record.purpose)) latest.set(record.purpose, record);
    const granted = [...latest.values()].filter((record) => record.granted && record.grantedAt);
    const base = { jobSeekerId: seeker.id, code: seeker.code, name: seeker.name };
    if (granted.length === 0) return { ...base, signed: false as const };

    const newest = granted.reduce((a, b) => ((a.grantedAt as Date) > (b.grantedAt as Date) ? a : b));
    const givenAt = newest.grantedAt as Date;
    const [otp, call] = await Promise.all([
      newest.otpRequestId
        ? this.prisma.otpSession.findUnique({
            where: { requestId: newest.otpRequestId },
            select: { verified: true, usedAt: true, updatedAt: true },
          })
        : null,
      this.prisma.callRecord.findFirst({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, answered: true, startedAt: { lte: givenAt } },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, recordingStoragePath: true, staff: { select: { name: true } } },
      }),
    ]);
    return {
      ...base,
      signed: true as const,
      purposes: JOB_SEEKER_CONSENT_PURPOSES.map((purpose) => {
        const record = latest.get(purpose);
        return {
          purpose,
          required: (JOB_SEEKER_REQUIRED_CONSENT_PURPOSES as readonly string[]).includes(purpose),
          given: Boolean(record?.granted && !record.withdrawnAt),
          grantedAt: record?.granted ? record.grantedAt : null,
          withdrawnAt: record?.withdrawnAt ?? null,
        };
      }),
      givenAt,
      otpPhone: seeker.phone,
      otpVerifiedAt: otp?.verified ? (otp.usedAt ?? otp.updatedAt) : null,
      language: newest.language,
      noticeVersion: newest.noticeVersion,
      method: newest.method,
      explainedOnCall: call
        ? { staffName: call.staff?.name ?? null, at: call.startedAt, recorded: Boolean(call.recordingStoragePath) }
        : null,
    };
  }

  /**
   * CA08x / CA13 / CA15: the record behind "Already registered — open it".
   * The OTP send answers only the type and code; this adds the name, when
   * it was registered and by whom, for a record the caller may read.
   */
  async record(code: string, actor: ScreenActor) {
    const upper = code.trim().toUpperCase();
    if (upper.startsWith('JS-')) {
      const seeker = await this.prisma.jobSeeker.findUnique({
        where: { code: upper },
        select: { id: true, code: true, name: true, createdAt: true, registeredByStaffId: true, registeredBy: { select: { name: true } } },
      });
      if (!seeker) throw new NotFoundException(`Record '${code}' not found`);
      await this.assertCanRead('job_seeker', [seeker.registeredByStaffId], actor);
      return { type: 'job_seeker', id: seeker.id, code: seeker.code, name: seeker.name, registeredAt: seeker.createdAt, registeredBy: seeker.registeredBy?.name ?? null };
    }
    if (upper.startsWith('BZ-')) {
      const business = await this.prisma.business.findUnique({
        where: { code: upper },
        select: { id: true, code: true, name: true, createdAt: true, accountAgentId: true, leadCreatedByStaffId: true },
      });
      if (!business) throw new NotFoundException(`Record '${code}' not found`);
      await this.assertCanRead('business', [business.accountAgentId, business.leadCreatedByStaffId], actor);
      const creator = business.leadCreatedByStaffId
        ? await this.prisma.staff.findUnique({ where: { id: business.leadCreatedByStaffId }, select: { name: true } })
        : null;
      return { type: 'business', id: business.id, code: business.code, name: business.name, registeredAt: business.createdAt, registeredBy: creator?.name ?? null };
    }
    if (upper.startsWith('RF-')) {
      const referral = await this.prisma.referral.findUnique({
        where: { code: upper },
        select: { id: true, code: true, name: true, createdAt: true },
      });
      if (!referral) throw new NotFoundException(`Record '${code}' not found`);
      await this.assertCanRead('referral', [], actor);
      return { type: 'referral', id: referral.id, code: referral.code, name: referral.name, registeredAt: referral.createdAt, registeredBy: null };
    }
    throw new NotFoundException(`Record '${code}' not found`);
  }

  private async assertCanRead(resource: 'job_seeker' | 'business' | 'referral', owners: Array<string | null>, actor: ScreenActor) {
    const rule = RBAC_MATRIX[actor.role as Role]?.[resource]?.read;
    if (!rule?.allowed) throw new ForbiddenException('You cannot open this record');
    if (rule.scope === 'all') return;
    const ownerIds = owners.filter((owner): owner is string => Boolean(owner));
    if (ownerIds.includes(actor.id)) return;
    if (rule.scope === 'own_team' && actor.role === 'team_lead' && ownerIds.length > 0) {
      const inTeam = await this.prisma.staff.findFirst({ where: { id: { in: ownerIds }, teamLeadId: actor.id }, select: { id: true } });
      if (inTeam) return;
    }
    throw new ForbiddenException('You cannot open this record');
  }

  /** "Referred by": a partner found by RF- ID or by their mobile number. */
  async findReferralPartner(query: string) {
    const q = (query ?? '').trim();
    if (!q) return null;
    const where = /^rf-/i.test(q)
      ? { code: q.toUpperCase() }
      : /^\+?\d[\d\s-]{9,}$/.test(q)
        ? { phone: { in: phoneVariants(q) } }
        : null;
    if (!where) return null;
    const partner = await this.prisma.referral.findFirst({ where, select: { id: true, code: true, name: true, phone: true } });
    return partner ?? null;
  }

  /** CA09: pick the business by name, BZ- ID or the last digits of its number. */
  async searchBusinesses(query: string, actor?: ScreenActor) {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, '');
    // A Team Lead reads only their own team's businesses (People and roles).
    const teamScope = actor?.role === 'team_lead'
      ? await this.teamScope(actor.id)
      : null;
    const rows = await this.prisma.business.findMany({
      where: {
        ...(teamScope ? { AND: [teamScope] } : {}),
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { equals: q.toUpperCase() } },
          ...(digits.length >= 4 && digits.length === q.replace(/\s/g, '').length ? [{ phone: { endsWith: digits } }] : []),
        ],
      },
      orderBy: { name: 'asc' },
      take: 10,
      select: {
        id: true, code: true, name: true, locality: true, verificationStatus: true, inPersonOnboardedAt: true,
        pausedAt: true, additionalContactName: true, contactRole: true,
        branches: { select: { id: true, name: true, locality: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      locality: row.locality,
      verificationStatus: row.verificationStatus,
      canShowCandidates: (row.verificationStatus === 'verified' || Boolean(row.inPersonOnboardedAt)) && !row.pausedAt,
      contactName: row.additionalContactName,
      contactRole: row.contactRole,
      branches: row.branches,
    }));
  }

  private async teamScope(teamLeadId: string) {
    const team = await this.prisma.staff.findMany({ where: { teamLeadId }, select: { id: true } });
    const ids = [teamLeadId, ...team.map((member) => member.id)];
    return { OR: [{ accountAgentId: { in: ids } }, { leadCreatedByStaffId: { in: ids } }] };
  }

  /** CA13b: what is left before candidates can be shown, and the draft vacancies. */
  async business(ref: string) {
    const business = await this.prisma.business.findFirst({
      where: isUuid(ref) ? { id: ref } : { code: ref },
      include: {
        agreements: { orderBy: { signedAt: 'desc' }, take: 1, select: { signedAt: true, signedName: true, signedRole: true } },
        visits: { orderBy: { visitedAt: 'desc' }, take: 1, select: { visitedAt: true } },
        visitAssignments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, createdAt: true, suggestedStaff: { select: { name: true } }, assignedStaff: { select: { name: true } } },
        },
        vacancies: {
          where: { status: { in: ['draft', 'awaiting_confirmation'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, code: true, tradeSkill: true, headcount: true, salaryMinPaise: true, salaryMaxPaise: true, salaryPeriod: true, startDate: true, status: true },
        },
      },
    });
    if (!business) throw new NotFoundException(`Business '${ref}' not found`);
    const now = this.clock.now();
    const link = await this.prisma.publicLink.findFirst({
      where: { purpose: 'business_agreement', subjectType: 'business', subjectId: business.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, expiresAt: true, usedAt: true, revokedAt: true },
    });
    const agreement = business.agreements[0];
    const visit = business.visits[0];
    const assignment = business.visitAssignments[0];
    const status = business.verificationStatus ?? 'lead';
    const linkLive = Boolean(link && !link.usedAt && !link.revokedAt && link.expiresAt > now);
    const verified = status === 'verified' || Boolean(business.inPersonOnboardedAt);
    const step = (state: StepState, extra: Record<string, unknown> = {}) => ({ state, ...extra });
    return {
      id: business.id,
      code: business.code,
      name: business.name,
      contactName: business.additionalContactName ?? business.ownerName,
      contactRole: business.contactRole,
      contactLanguage: business.contactLanguage,
      phone: business.phone,
      verificationStatus: status,
      paused: Boolean(business.pausedAt),
      steps: {
        phone: step(business.phoneVerified ? 'done' : 'not_started', { time: business.phoneVerified ? business.createdAt : null }),
        agreement: agreement
          ? step('done', { time: agreement.signedAt, signedName: agreement.signedName, signedRole: agreement.signedRole })
          : linkLive
            ? step('in_progress', { time: link?.createdAt ?? null, expiresAt: link?.expiresAt ?? null })
            : step(link ? 'stuck' : 'not_started', { time: link?.createdAt ?? null, reason: link ? 'link_expired' : null }),
        visit: visit
          ? step('done', { time: visit.visitedAt })
          : assignment
            ? step('in_progress', {
                time: assignment.createdAt,
                suggestedStaffName: assignment.suggestedStaff?.name ?? null,
                assignedStaffName: assignment.assignedStaff?.name ?? null,
              })
            : step('not_started'),
        teamLeadApproval: status === 'verified'
          ? step('done', { time: business.verifiedAt })
          : status === 'rejected'
            ? step('stuck', { reason: 'rejected' })
            : status === 'pending_tl_check'
              ? step('in_progress')
              : step('not_started'),
        verified: step(verified ? 'done' : 'not_started', { time: business.verifiedAt ?? business.inPersonOnboardedAt }),
      },
      draftVacancies: business.vacancies.map((vacancy) => ({
        id: vacancy.id,
        code: vacancy.code,
        trade: vacancy.tradeSkill,
        headcount: vacancy.headcount,
        salaryMinPaise: vacancy.salaryMinPaise,
        salaryMaxPaise: vacancy.salaryMaxPaise,
        salaryPeriod: vacancy.salaryPeriod,
        startDate: vacancy.startDate,
        status: vacancy.status,
      })),
    };
  }

  /** CA15b: the partner's header; the steps come from /referrals/:id/registration-status. */
  async referral(ref: string) {
    const referral = await this.prisma.referral.findFirst({
      where: isUuid(ref) ? { id: ref } : { code: ref },
      select: { id: true, code: true, name: true, phone: true, phoneVerified: true, createdAt: true, type: true, language: true },
    });
    if (!referral) throw new NotFoundException(`Referral partner '${ref}' not found`);
    const now = this.clock.now();
    const link = await this.prisma.publicLink.findFirst({
      where: { purpose: 'referral_registration', subjectType: 'referral', subjectId: referral.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, expiresAt: true, usedAt: true, revokedAt: true },
    });
    return {
      ...referral,
      phoneVerifiedAt: referral.phoneVerified ? referral.createdAt : null,
      registrationLink: link
        ? { sentAt: link.createdAt, expiresAt: link.expiresAt, live: !link.usedAt && !link.revokedAt && link.expiresAt > now }
        : null,
    };
  }
}
