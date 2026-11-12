import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { REFUND_FORFEITING_HIT_REASONS } from '../job-seeker/job-seeker-refund-guards';
import {
  DAY_MS,
  Paged,
  PageRequest,
  DateRange,
  RECEIVED_STATUSES,
  RefundBucket,
  contains,
  dateFilter,
  daysLeft,
  istStartOfMonth,
  refundBucket,
  sumPaise,
} from './ceo-common';
import { phoneSearchDigits } from '../../common/phone/indian-mobile';

/** Statuses of a job seeker who registered but has not paid yet. */
export const NOT_PAID_STATUSES = ['lead', 'consented', 'pending_activation'];
/** Statuses that end the job seeker's journey (no more matching). */
export const ENDED_STATUSES = ['placed', 'deactivated', 'closed'];
/** An interview row that counts as an offer made to him (anything but a cancelled booking). */
export const OFFER_STATUSES = ['offered', 'confirmed', 'declined', 'no_reply', 'completed', 'no_show', 'no_result'];

export interface JobSeekerListQuery {
  range: Partial<DateRange>;
  page: PageRequest;
  search?: string;
  status?: string;
  trade?: string;
  kyc?: string;
  sort?: string;
}

export interface JobSeekerRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  trade: string | null;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  salaryPeriod: string | null;
  status: string;
  hits: number;
  maxHits: number;
  kyc: 'verified' | 'pending' | 'failed' | 'none';
  paidAt: string | null;
  guaranteeDaysLeft: number | null;
  registeredAt: string;
  registeredBy: string | null;
  locality: string | null;
}

export interface JobSeekerListSummary {
  activeInPool: number;
  registeredNotPaid: number;
  waitingOnKyc: number;
  withinFiveDaysOfRefund: number;
  atTwoOfThreeHits: number;
  deactivatedThisMonth: number;
}

export interface NearRefundRow {
  kind: 'job_seeker' | 'business';
  id: string;
  code: string;
  name: string;
  phone: string | null;
  trade: string | null;
  daysLeft: number;
  bucket: RefundBucket;
  standing: { offers: number; declined: number; interviewsUpcoming: number; replacementsOffered: number; replacementsRejected: number };
  agent: { id: string; name: string } | null;
  atStakePaise: number;
  /** Open the record: job seeker id, or the placement for a business refund. */
  recordId: string;
  businessName: string | null;
}

@Injectable()
export class CeoJobSeekersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
  ) {}

  private kycOf(verifications: { status: string }[]): JobSeekerRow['kyc'] {
    if (verifications.some((v) => v.status === 'verified')) return 'verified';
    const latest = verifications[0];
    if (!latest) return 'none';
    return latest.status === 'failed' ? 'failed' : 'pending';
  }

  private listWhere(query: JobSeekerListQuery): Prisma.JobSeekerWhereInput {
    const and: Prisma.JobSeekerWhereInput[] = [{ anonymisedAt: null }];
    const created = dateFilter(query.range);
    if (created) and.push({ createdAt: created });
    if (query.search) {
      const s = query.search;
      const digits = phoneSearchDigits(s);
      and.push({
        OR: [
          { name: contains(s) },
          { code: contains(s) },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      });
    }
    switch (query.status) {
      case 'active':
        and.push({ status: 'active' });
        break;
      case 'not_paid':
        and.push({ status: { in: NOT_PAID_STATUSES } });
        break;
      case 'placed':
        and.push({ status: 'placed' });
        break;
      case 'deactivated':
        and.push({ status: 'deactivated' });
        break;
      case 'paused':
        and.push({ status: 'paused' });
        break;
      case 'closed':
        and.push({ status: 'closed' });
        break;
      case 'refunded':
        and.push({ status: 'refunded' });
        break;
      default:
        break;
    }
    if (query.trade) and.push({ trades: { some: { trade: { equals: query.trade, mode: 'insensitive' } } } });
    if (query.kyc === 'verified') and.push({ identityVerifications: { some: { status: 'verified' } } });
    if (query.kyc === 'pending') and.push({ identityVerifications: { none: { status: 'verified' } } });
    return { AND: and };
  }

  async list(query: JobSeekerListQuery, now: Date = new Date()): Promise<Paged<JobSeekerRow, JobSeekerListSummary> & { trades: string[] }> {
    const policy = await this.pricing.current();
    const where = this.listWhere(query);
    const orderBy: Prisma.JobSeekerOrderByWithRelationInput[] =
      query.sort === 'latest'
        ? [{ paymentReceivedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]
        : query.sort === 'newest'
          ? [{ createdAt: 'desc' }]
          : [{ paymentReceivedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];

    const [total, seekers, summary, trades] = await Promise.all([
      this.prisma.jobSeeker.count({ where }),
      this.prisma.jobSeeker.findMany({
        where,
        orderBy,
        skip: query.page.skip,
        take: query.page.pageSize,
        include: {
          trades: { select: { trade: true, isPrimary: true } },
          identityVerifications: { select: { status: true }, orderBy: { createdAt: 'desc' } },
          registeredBy: { select: { name: true } },
        },
      }),
      this.summary(now, policy.jobSeekerGuaranteeDays, policy.maxHits),
      this.prisma.trade.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true } }),
    ]);

    const rows: JobSeekerRow[] = seekers.map((s) => {
      const counting = s.paymentReceivedAt && !ENDED_STATUSES.includes(s.status);
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        phone: s.phone,
        trade: s.trades.find((t) => t.isPrimary)?.trade ?? s.trades[0]?.trade ?? null,
        salaryMinPaise: s.minSalary,
        salaryMaxPaise: s.maxSalary,
        salaryPeriod: s.salaryPeriod,
        status: s.status,
        hits: s.hitCount,
        maxHits: policy.maxHits,
        kyc: this.kycOf(s.identityVerifications),
        paidAt: s.paymentReceivedAt?.toISOString() ?? null,
        guaranteeDaysLeft: counting ? daysLeft(s.paymentReceivedAt as Date, policy.jobSeekerGuaranteeDays, now) : null,
        registeredAt: s.createdAt.toISOString(),
        registeredBy: s.registeredBy?.name ?? null,
        locality: s.locality,
      };
    });
    return { rows, total, page: query.page.page, pageSize: query.page.pageSize, summary, trades: trades.map((t) => t.name) };
  }

  /** The six tiles on the Job Seekers list ("right now", not filtered). */
  async summary(now: Date, guaranteeDays: number, maxHits: number): Promise<JobSeekerListSummary> {
    const base: Prisma.JobSeekerWhereInput = { anonymisedAt: null };
    const fiveDayStart = new Date(now.getTime() - (guaranteeDays - 5) * DAY_MS);
    const guaranteeStart = new Date(now.getTime() - guaranteeDays * DAY_MS);
    const [activeInPool, registeredNotPaid, waitingOnKyc, withinFiveDaysOfRefund, atTwoOfThreeHits, deactivatedThisMonth] =
      await Promise.all([
        this.prisma.jobSeeker.count({ where: { ...base, status: 'active' } }),
        this.prisma.jobSeeker.count({ where: { ...base, status: { in: NOT_PAID_STATUSES } } }),
        this.prisma.jobSeeker.count({
          where: {
            ...base,
            status: { notIn: [...ENDED_STATUSES, 'lead'] },
            identityVerifications: { none: { status: 'verified' } },
          },
        }),
        this.prisma.jobSeeker.count({
          where: {
            ...base,
            status: { notIn: ENDED_STATUSES },
            paymentReceivedAt: { gt: guaranteeStart, lte: fiveDayStart },
          },
        }),
        this.prisma.jobSeeker.count({ where: { ...base, status: { notIn: ENDED_STATUSES }, hitCount: Math.max(0, maxHits - 1) } }),
        this.prisma.statusHistory.count({
          where: { subjectType: 'job_seeker', toStatus: 'deactivated', changedAt: { gte: istStartOfMonth(now), lte: now } },
        }),
      ]);
    return { activeInPool, registeredNotPaid, waitingOnKyc, withinFiveDaysOfRefund, atTwoOfThreeHits, deactivatedThisMonth };
  }

  /** Everything the CEO's job seeker page shows, with its history. */
  async detail(id: string, now: Date = new Date()) {
    const policy = await this.pricing.current();
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: {
        trades: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        languages: true,
        identityVerifications: { orderBy: { createdAt: 'desc' } },
        referredBy: { select: { id: true, code: true, name: true } },
        registeredBy: { select: { id: true, name: true, code: true } },
        hits: { orderBy: { recordedAt: 'desc' }, include: { reversedByStaff: { select: { name: true } } } },
        payments: { orderBy: { createdAt: 'desc' } },
        interviews: {
          orderBy: { offerSentAt: 'desc' },
          include: { business: { select: { id: true, code: true, name: true, locality: true } }, vacancy: true },
        },
        placements: { orderBy: { createdAt: 'desc' }, include: { business: { select: { id: true, name: true, code: true } } } },
      },
    });
    if (!seeker) throw new NotFoundException(`Job seeker '${id}' not found`);

    const [consents, calls, messages, history] = await Promise.all([
      this.prisma.consent.findMany({ where: { subjectType: 'job_seeker', subjectId: seeker.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.callRecord.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { staff: { select: { name: true } } },
      }),
      this.prisma.messageLog.findMany({ where: { subjectType: 'job_seeker', subjectId: seeker.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.statusHistory.findMany({
        where: { subjectType: 'job_seeker', subjectId: seeker.id },
        orderBy: { changedAt: 'desc' },
        take: 50,
        include: { changedByStaff: { select: { name: true } } },
      }),
    ]);

    const activation = seeker.payments.find((p) => (p.type === 'activation' || p.type === 'reactivation') && RECEIVED_STATUSES.includes(p.status));
    const refunds = seeker.payments.filter((p) => p.type === 'refund' && !['failed', 'rejected', 'reversed'].includes(p.status));
    const counting = seeker.paymentReceivedAt && !ENDED_STATUSES.includes(seeker.status);
    const sinceGuarantee = seeker.paymentReceivedAt ?? new Date(0);
    const offers = seeker.interviews.filter((i) => OFFER_STATUSES.includes(i.status) && i.offerSentAt >= sinceGuarantee);
    const activeHits = seeker.hits.filter((h) => !h.reversedAt && !h.supersededAt);
    const grantedPurposes = new Set(consents.filter((c) => c.granted && !c.withdrawnAt).map((c) => c.purpose));
    const askedPurposes = new Set(consents.map((c) => c.purpose));
    const consentAt = consents.filter((c) => c.grantedAt).map((c) => c.grantedAt as Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const verified = seeker.identityVerifications.find((v) => v.status === 'verified') ?? null;

    type Event = { at: string; kind: string; text: string; by: string | null; detail?: string | null };
    const events: Event[] = [];
    events.push({ at: seeker.createdAt.toISOString(), kind: 'registered', text: 'registered', by: seeker.registeredBy?.name ?? null, detail: seeker.heardFrom });
    for (const c of calls) {
      events.push({
        at: (c.startedAt ?? c.createdAt).toISOString(),
        kind: c.answered ? 'call_answered' : 'call_missed',
        text: c.purpose ?? 'general',
        by: c.staff?.name ?? null,
        detail: c.durationSec ? `${Math.max(1, Math.round(c.durationSec / 60))} min` : c.agentOutcome,
      });
    }
    for (const m of messages) {
      events.push({ at: (m.sentAt ?? m.createdAt).toISOString(), kind: `message_${m.channel}`, text: m.template, by: null, detail: m.status });
    }
    for (const h of seeker.hits) {
      events.push({ at: h.recordedAt.toISOString(), kind: 'hit', text: h.reason, by: null, detail: h.note });
      if (h.reversedAt) events.push({ at: h.reversedAt.toISOString(), kind: 'hit_reversed', text: h.reason, by: h.reversedByStaff?.name ?? null, detail: h.reversalReason });
    }
    for (const p of seeker.payments) {
      events.push({ at: (p.confirmedAt ?? p.paidAt ?? p.createdAt).toISOString(), kind: `payment_${p.type}`, text: p.status, by: null, detail: p.code });
    }
    for (const i of seeker.interviews) {
      events.push({ at: i.offerSentAt.toISOString(), kind: 'offer', text: i.status, by: null, detail: i.business.name });
    }
    for (const s of history) {
      events.push({ at: s.changedAt.toISOString(), kind: 'status', text: s.toStatus, by: s.changedByStaff?.name ?? null, detail: s.reason });
    }
    events.sort((a, b) => b.at.localeCompare(a.at));

    const hitInterviewIds = new Map(seeker.hits.filter((h) => h.interviewId).map((h) => [h.interviewId as string, h]));
    type Activity = { at: string; business: string | null; businessId: string | null; what: string; status: string; hit: boolean; hitId: string | null };
    const activity: Activity[] = [
      ...seeker.interviews.map((i) => {
        const hit = hitInterviewIds.get(i.id);
        return {
          at: i.offerSentAt.toISOString(),
          business: [i.business.name, i.business.locality].filter(Boolean).join(' · '),
          businessId: i.business.id,
          what: i.vacancy.tradeSkill,
          status: i.status,
          hit: Boolean(hit && !hit.reversedAt && !hit.supersededAt),
          hitId: hit?.id ?? null,
        };
      }),
      ...seeker.hits
        .filter((h) => !h.interviewId)
        .map((h) => ({ at: h.recordedAt.toISOString(), business: null, businessId: null, what: h.reason, status: h.reversedAt ? 'reversed' : 'hit', hit: !h.reversedAt && !h.supersededAt, hitId: h.id })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return {
      id: seeker.id,
      code: seeker.code,
      name: seeker.name,
      phone: seeker.phone,
      whatsappPhone: seeker.whatsappPhone,
      status: seeker.status,
      createdAt: seeker.createdAt.toISOString(),
      guarantee: {
        days: policy.jobSeekerGuaranteeDays,
        paidAt: seeker.paymentReceivedAt?.toISOString() ?? null,
        daysLeft: counting ? daysLeft(seeker.paymentReceivedAt as Date, policy.jobSeekerGuaranteeDays, now) : null,
        floorPaise: seeker.guaranteeFloorPaise,
      },
      hits: { count: activeHits.length, max: policy.maxHits },
      offersMade: offers.length,
      interviews: seeker.interviews.filter((i) => ['confirmed', 'completed', 'no_show', 'no_result'].includes(i.status)).length,
      activation: activation
        ? { amountPaise: activation.amount, at: (activation.confirmedAt ?? activation.paidAt ?? activation.createdAt).toISOString(), utr: activation.bankUtr ?? activation.upiReference ?? null, confirmedBy: activation.confirmedBy }
        : null,
      refunds: refunds.map((r) => ({ id: r.id, code: r.code, amountPaise: r.amount, status: r.status, at: r.createdAt.toISOString() })),
      profile: {
        trades: seeker.trades.map((t) => ({ trade: t.trade, years: t.yearsExperience, primary: t.isPrimary })),
        locality: seeker.locality,
        pincode: seeker.pincode,
        travelDistanceKm: seeker.travelDistanceKm,
        salaryMinPaise: seeker.minSalary,
        salaryMaxPaise: seeker.maxSalary,
        salaryPeriod: seeker.salaryPeriod,
        shiftPreference: seeker.shiftPreference,
        jobType: seeker.jobType,
        languages: seeker.languages.filter((l) => l.speaks).map((l) => l.language),
        qualification: seeker.qualification ?? seeker.educationLevel,
        referredBy: seeker.referredBy,
        registeredBy: seeker.registeredBy,
        heardFrom: seeker.heardFrom,
        dateOfBirth: seeker.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      },
      registration: {
        phoneVerified: seeker.phoneVerified,
        consentsGranted: grantedPurposes.size,
        consentsAsked: askedPurposes.size,
        consentAt: consentAt?.toISOString() ?? null,
        selfieAt: seeker.photoTakenAt?.toISOString() ?? null,
        idCheck: verified
          ? { method: verified.method, last4: verified.last4, adult: verified.isAdult, nameMatches: verified.nameMatches, at: verified.verifiedAt?.toISOString() ?? null }
          : seeker.identityVerifications[0]
            ? { method: seeker.identityVerifications[0].method, status: seeker.identityVerifications[0].status, failureReason: seeker.identityVerifications[0].failureReason }
            : null,
        paymentAt: seeker.paymentReceivedAt?.toISOString() ?? null,
      },
      hitList: seeker.hits.map((h) => ({
        id: h.id,
        reason: h.reason,
        at: h.recordedAt.toISOString(),
        reversed: Boolean(h.reversedAt),
        superseded: Boolean(h.supersededAt),
        note: h.note,
      })),
      activity,
      placements: seeker.placements.map((p) => ({ id: p.id, code: p.code, status: p.status, business: p.business.name, joinedDate: p.joinedDate?.toISOString() ?? null })),
      history: events.slice(0, 80),
    };
  }

  /**
   * Close to a refund (guide, CEO home — decided 9 Nov): job seekers whose
   * 30-day guarantee runs out within the window (Settings, 15 days) with no
   * suitable offer yet, and businesses whose placement refund falls due
   * within the window because no replacement has been found.
   */
  async nearRefund(now: Date = new Date()): Promise<{ windowDays: number; rows: NearRefundRow[] }> {
    const policy = await this.pricing.current();
    const windowDays = policy.refundPriorityWindowDays;
    const guaranteeDays = policy.jobSeekerGuaranteeDays;
    const searchDays = policy.replacementSearchDays;

    // Job seekers: paid within (guaranteeDays - windowDays .. guaranteeDays] days ago.
    const oldest = new Date(now.getTime() - guaranteeDays * DAY_MS);
    const newest = new Date(now.getTime() - (guaranteeDays - windowDays) * DAY_MS);
    const seekers = await this.prisma.jobSeeker.findMany({
      where: {
        anonymisedAt: null,
        status: { notIn: ENDED_STATUSES },
        paymentReceivedAt: { gt: oldest, lte: newest },
      },
      include: {
        trades: { select: { trade: true, isPrimary: true } },
        registeredBy: { select: { id: true, name: true } },
        interviews: { select: { status: true, offerSentAt: true, slotStartsAt: true } },
        hits: { where: { reversedAt: null, supersededAt: null, reason: { in: [...REFUND_FORFEITING_HIT_REASONS] } }, select: { id: true } },
        payments: { where: { type: { in: ['activation', 'reactivation', 'refund'] } }, select: { type: true, status: true, amount: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    const rows: NearRefundRow[] = [];
    for (const s of seekers) {
      if (s.hits.length > 0) continue; // the refund already ended (declined, no reply or no-show)
      const paidAt = s.paymentReceivedAt as Date;
      if (s.payments.some((p) => p.type === 'refund' && p.createdAt >= paidAt && !['failed', 'rejected', 'reversed'].includes(p.status))) continue;
      const sinceGuarantee = s.interviews.filter((i) => i.offerSentAt >= paidAt);
      const suitableOffered = sinceGuarantee.some((i) => OFFER_STATUSES.includes(i.status));
      if (suitableOffered) continue;
      const left = daysLeft(paidAt, guaranteeDays, now);
      const bucket = refundBucket(left, windowDays);
      if (!bucket) continue;
      const activation = s.payments.find((p) => (p.type === 'activation' || p.type === 'reactivation') && RECEIVED_STATUSES.includes(p.status));
      rows.push({
        kind: 'job_seeker',
        id: s.id,
        code: s.code,
        name: s.name,
        phone: s.phone,
        trade: s.trades.find((t) => t.isPrimary)?.trade ?? s.trades[0]?.trade ?? null,
        daysLeft: left,
        bucket,
        standing: {
          offers: sinceGuarantee.length,
          declined: sinceGuarantee.filter((i) => i.status === 'declined').length,
          interviewsUpcoming: sinceGuarantee.filter((i) => i.status === 'confirmed' && i.slotStartsAt > now).length,
          replacementsOffered: 0,
          replacementsRejected: 0,
        },
        agent: s.registeredBy,
        atStakePaise: activation?.amount ?? policy.activationFeePaise,
        recordId: s.id,
        businessName: null,
      });
    }

    // Businesses: placements in a replacement search whose refund falls due within the window.
    const searchStartFloor = new Date(now.getTime() - searchDays * DAY_MS);
    const searchStartCeil = new Date(now.getTime() - (searchDays - windowDays) * DAY_MS);
    const placements = await this.prisma.placement.findMany({
      where: {
        status: 'dropped_out',
        guaranteeEndedReason: null,
        dropoutReportedAt: { gt: searchStartFloor, lte: searchStartCeil },
      },
      include: {
        business: { select: { id: true, code: true, name: true, phone: true, accountAgentId: true } },
        vacancy: { select: { tradeSkill: true } },
        replacementCandidates: { select: { status: true } },
        payments: { where: { type: 'refund' }, select: { status: true } },
      },
    });
    const agentIds = [...new Set(placements.map((p) => p.business.accountAgentId).filter((x): x is string => Boolean(x)))];
    const agents = agentIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
      : [];
    const agentById = new Map(agents.map((a) => [a.id, a]));
    for (const p of placements) {
      if (p.replacementCandidates.some((r) => r.status === 'accepted')) continue;
      if (p.payments.some((r) => !['failed', 'rejected', 'reversed'].includes(r.status))) continue;
      const left = daysLeft(p.dropoutReportedAt as Date, searchDays, now);
      const bucket = refundBucket(left, windowDays);
      if (!bucket) continue;
      rows.push({
        kind: 'business',
        id: p.business.id,
        code: p.code,
        name: p.business.name,
        phone: p.business.phone,
        trade: p.vacancy.tradeSkill,
        daysLeft: left,
        bucket,
        standing: {
          offers: 0,
          declined: 0,
          interviewsUpcoming: 0,
          replacementsOffered: p.replacementCandidates.length,
          replacementsRejected: p.replacementCandidates.filter((r) => r.status === 'rejected').length,
        },
        agent: p.business.accountAgentId ? (agentById.get(p.business.accountAgentId) ?? null) : null,
        atStakePaise: p.placementFee,
        recordId: p.id,
        businessName: p.business.name,
      });
    }

    rows.sort((a, b) => a.daysLeft - b.daysLeft || b.atStakePaise - a.atStakePaise);
    return { windowDays, rows };
  }

  /** Totals for the close-to-a-refund row on the Command Center. */
  static summariseNearRefund(rows: readonly NearRefundRow[]) {
    const side = (kind: NearRefundRow['kind']) => {
      const list = rows.filter((r) => r.kind === kind);
      return {
        count: list.length,
        atStakePaise: sumPaise(list.map((r) => r.atStakePaise)),
        buckets: {
          '0-5': list.filter((r) => r.bucket === '0-5').length,
          '6-10': list.filter((r) => r.bucket === '6-10').length,
          '11-15': list.filter((r) => r.bucket === '11-15').length,
        },
        urgentAtStakePaise: sumPaise(list.filter((r) => r.bucket === '0-5').map((r) => r.atStakePaise)),
      };
    };
    return { jobSeekers: side('job_seeker'), businesses: side('business') };
  }

  /**
   * "Remind the agent": puts a call task on the agent's follow-up list for
   * this person (job seeker: who registered him; business: its account agent).
   * One open reminder per person; asking again returns the open one.
   */
  async remindAgent(actorId: string, body: { kind?: string; id?: string }, now: Date = new Date()) {
    const kind = body?.kind;
    const id = body?.id;
    if ((kind !== 'job_seeker' && kind !== 'placement') || !id) {
      throw new BadRequestException('kind (job_seeker or placement) and id are required');
    }
    let subjectType: 'job_seeker' | 'business';
    let subjectId: string;
    let subjectCode: string;
    let agentId: string | null;
    let relatedId: string | null = null;
    if (kind === 'job_seeker') {
      const seeker = await this.prisma.jobSeeker.findUnique({ where: { id }, select: { id: true, code: true, registeredByStaffId: true } });
      if (!seeker) throw new NotFoundException(`Job seeker '${id}' not found`);
      subjectType = 'job_seeker';
      subjectId = seeker.id;
      subjectCode = seeker.code;
      agentId = seeker.registeredByStaffId;
    } else {
      const placement = await this.prisma.placement.findUnique({
        where: { id },
        select: { id: true, code: true, business: { select: { id: true, accountAgentId: true } } },
      });
      if (!placement) throw new NotFoundException(`Placement '${id}' not found`);
      subjectType = 'business';
      subjectId = placement.business.id;
      subjectCode = placement.code;
      agentId = placement.business.accountAgentId;
      relatedId = placement.id;
    }
    if (!agentId) throw new BadRequestException('Nobody is assigned to this record yet, so there is no agent to remind');

    const existing = await this.prisma.followUpTask.findFirst({
      where: { kind: 'refund_priority_call', subjectType, subjectId, status: 'pending' },
    });
    if (existing) return { task: existing, created: false };

    const code = await this.ids.generateCode('follow_up_task');
    const task = await this.prisma.followUpTask.create({
      data: {
        code,
        kind: 'refund_priority_call',
        subjectType,
        subjectId,
        relatedType: relatedId ? 'placement' : null,
        relatedId,
        dueAt: now,
        assignedStaffId: agentId,
      },
    });
    await this.audit.log({
      actorId,
      action: 'refund_priority_reminder_sent',
      entityType: subjectType,
      entityCode: subjectCode,
      after: { followUpTaskCode: code, assignedStaffId: agentId },
      changedFields: ['followUpTask'],
    });
    return { task, created: true };
  }
}
