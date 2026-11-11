import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import {
  DAY_MS,
  DateRange,
  PageRequest,
  RECEIVED_STATUSES,
  average,
  contains,
  countBy,
  dateFilter,
  daysSince,
  istStartOfMonth,
  percent,
  sumPaise,
} from './ceo-common';
import { phoneSearchDigits } from '../../common/phone/indian-mobile';

export interface ListQuery {
  range: Partial<DateRange>;
  page: PageRequest;
  search?: string;
  status?: string;
  agent?: string;
  area?: string;
  type?: string;
  trade?: string;
  age?: string;
  outcome?: string;
}

const LIVE_PLACEMENT = ['awaiting_payment', 'confirmed', 'active', 'dropped_out', 'replaced', 'completed', 'guarantee_ended'];

@Injectable()
export class CeoBusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  private staffNames(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!unique.length) return Promise.resolve(new Map<string, string>());
    return this.prisma.staff
      .findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
      .then((rows) => new Map(rows.map((r) => [r.id, r.name])));
  }

  // ---------------------------------------------------------------- businesses

  async listBusinesses(q: ListQuery, now: Date = new Date()) {
    const and: Prisma.BusinessWhereInput[] = [{ anonymisedAt: null }];
    const created = dateFilter(q.range);
    if (created) and.push({ createdAt: created });
    if (q.search) {
      const digits = phoneSearchDigits(q.search);
      and.push({
        OR: [
          { name: contains(q.search) },
          { legalName: contains(q.search) },
          { code: contains(q.search) },
          { gstNumber: contains(q.search) },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      });
    }
    if (q.status === 'verified') and.push({ verificationStatus: 'verified', pausedAt: null });
    if (q.status === 'tl_review') and.push({ verificationStatus: 'pending_tl_check' });
    if (q.status === 'lead') and.push({ verificationStatus: { in: ['lead', 'pending_visit'] } });
    if (q.status === 'no_documents') and.push({ documentsStatus: 'no_documents' });
    if (q.status === 'paused') and.push({ pausedAt: { not: null } });
    if (q.status === 'rejected') and.push({ verificationStatus: 'rejected' });
    if (q.agent) and.push({ accountAgentId: q.agent });
    if (q.area) and.push({ locality: { equals: q.area, mode: 'insensitive' } });
    if (q.type) and.push({ businessType: q.type });
    const where: Prisma.BusinessWhereInput = { AND: and };

    const [total, businesses] = await Promise.all([
      this.prisma.business.count({ where }),
      this.prisma.business.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: q.page.skip,
        take: q.page.pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
          businessType: true,
          locality: true,
          verificationStatus: true,
          documentsStatus: true,
          pausedAt: true,
          geofenceFlag: true,
          accountAgentId: true,
          createdAt: true,
          vacancies: { where: { status: 'open' }, select: { headcount: true } },
          placements: { where: { status: { in: LIVE_PLACEMENT } }, select: { id: true } },
          payments: { where: { type: 'placement_fee', status: { in: RECEIVED_STATUSES } }, select: { amount: true } },
          visits: { orderBy: { visitedAt: 'desc' }, take: 1, select: { visitedAt: true } },
        },
      }),
    ]);
    const ids = businesses.map((b) => b.id);
    const flags = ids.length
      ? await this.prisma.reviewFlag.findMany({ where: { subjectType: 'business', subjectId: { in: ids }, status: 'open' }, select: { subjectId: true, kind: true } })
      : [];
    const names = await this.staffNames(businesses.map((b) => b.accountAgentId));
    const rows = businesses.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      phone: b.phone,
      type: b.businessType,
      area: b.locality,
      status: b.pausedAt ? 'paused' : (b.verificationStatus ?? 'lead'),
      noDocuments: b.documentsStatus === 'no_documents',
      accountAgent: b.accountAgentId ? (names.get(b.accountAgentId) ?? null) : null,
      openVacancies: b.vacancies.length,
      openPositions: b.vacancies.reduce((s, v) => s + v.headcount, 0),
      placements: b.placements.length,
      feesPaidPaise: sumPaise(b.payments.map((p) => p.amount)),
      lastVisitAt: b.visits[0]?.visitedAt.toISOString() ?? null,
      flags: [...(b.geofenceFlag ? ['geofence'] : []), ...flags.filter((f) => f.subjectId === b.id).map((f) => f.kind)],
      createdAt: b.createdAt.toISOString(),
    }));

    // Tiles and side panels describe the whole book of businesses, not the filtered page.
    const all = await this.prisma.business.findMany({
      where: { anonymisedAt: null },
      select: {
        id: true,
        businessType: true,
        locality: true,
        verificationStatus: true,
        documentsStatus: true,
        pausedAt: true,
        accountAgentId: true,
        agreements: { select: { signedAt: true }, orderBy: { signedAt: 'asc' }, take: 1 },
        placements: { where: { status: { in: LIVE_PLACEMENT } }, select: { id: true } },
        visits: { orderBy: { visitedAt: 'desc' }, take: 1, select: { visitedAt: true } },
      },
    });
    const active = all.filter((b) => b.verificationStatus === 'verified' && !b.pausedAt);
    const monthStart = istStartOfMonth(now);
    const openFlags = await this.prisma.reviewFlag.count({ where: { subjectType: 'business', status: 'open' } });
    const repeat = all.filter((b) => b.placements.length > 1).length;
    const withPlacements = all.filter((b) => b.placements.length > 0).length;
    const revisitBefore = new Date(now.getTime() - 30 * DAY_MS + 7 * DAY_MS);
    const agentNames = await this.staffNames(all.map((b) => b.accountAgentId));
    return {
      rows,
      total,
      page: q.page.page,
      pageSize: q.page.pageSize,
      summary: {
        active: active.length,
        signedThisMonth: all.filter((b) => b.agreements[0] && b.agreements[0].signedAt >= monthStart).length,
        noDocuments: all.filter((b) => b.documentsStatus === 'no_documents').length,
        hiredMoreThanOnce: repeat,
        flags: openFlags,
        // Revisit every 30 days (guide: agent revisits); due this week = last visit 23+ days ago.
        revisitsDueThisWeek: active.filter((b) => !b.visits[0] || b.visits[0].visitedAt <= revisitBefore).length,
        repeatPercent: percent(repeat, withPlacements),
        withPlacements,
      },
      byType: countBy(all, (b) => b.businessType ?? 'other').slice(0, 6),
      byArea: countBy(all, (b) => b.locality).slice(0, 6),
      facets: {
        agents: [...agentNames.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        areas: countBy(all, (b) => b.locality).map((a) => a.name),
        types: countBy(all, (b) => b.businessType).map((a) => a.name),
      },
    };
  }

  async businessDetail(id: string, now: Date = new Date()) {
    const b = await this.prisma.business.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: {
        branches: true,
        agreements: { orderBy: { signedAt: 'desc' } },
        vacancies: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { interviews: true, candidateIntroductions: true } } } },
        placements: { orderBy: { createdAt: 'desc' }, include: { jobSeeker: { select: { id: true, code: true, name: true } } } },
        payments: { where: { type: 'placement_fee', status: { in: RECEIVED_STATUSES } }, select: { amount: true } },
        visits: { orderBy: { visitedAt: 'desc' }, take: 10, include: { staff: { select: { name: true } } } },
        candidateIntroductions: {
          orderBy: { shownAt: 'desc' },
          take: 50,
          include: { jobSeeker: { select: { id: true, code: true, name: true } }, shownBy: { select: { name: true } } },
        },
      },
    });
    if (!b) throw new NotFoundException(`Business '${id}' not found`);
    const policy = await this.pricing.current();
    const [interviews, history, consent, names] = await Promise.all([
      this.prisma.interview.findMany({ where: { businessId: b.id }, select: { id: true, jobSeekerId: true, status: true, result: true, slotStartsAt: true } }),
      this.prisma.statusHistory.findMany({
        where: { subjectType: 'business', subjectId: b.id },
        orderBy: { changedAt: 'desc' },
        take: 30,
        include: { changedByStaff: { select: { name: true } } },
      }),
      this.prisma.consent.findFirst({ where: { subjectType: 'business', subjectId: b.id, purpose: 'call_recording' }, orderBy: { createdAt: 'desc' } }),
      this.staffNames([b.accountAgentId, b.leadCreatedByStaffId, b.verifiedByStaffId, ...b.vacancies.map((v) => v.capturedByStaffId)]),
    ]);
    const introCount = await this.prisma.candidateIntroduction.count({
      where: { businessId: b.id, shownAt: { gte: new Date(now.getTime() - policy.noBypassMonths * 30 * DAY_MS) } },
    });
    const latestBySeeker = new Map<string, (typeof interviews)[number]>();
    for (const i of interviews) {
      const prev = latestBySeeker.get(i.jobSeekerId);
      if (!prev || prev.slotStartsAt < i.slotStartsAt) latestBySeeker.set(i.jobSeekerId, i);
    }
    const placedSeekers = new Map(b.placements.map((p) => [p.jobSeeker.id, p]));
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      legalName: b.legalName ?? b.gstLegalName,
      phone: b.phone,
      gstNumber: b.gstNumber,
      gstVerified: b.gstVerified,
      type: b.businessType,
      employeeCount: b.employeeCount,
      employeeCountBand: b.employeeCountBand,
      address: [b.shopNumber, b.street, b.landmark, b.locality, b.pincode].filter(Boolean).join(', ') || b.address,
      hasPin: b.latitude !== null && b.longitude !== null,
      contact: { name: b.ownerName, role: b.contactRole, phone: b.phone, verified: b.phoneVerified },
      branches: b.branches.map((br) => ({ id: br.id, name: br.name, locality: br.locality, contact: br.contactPersonName })),
      accountAgent: b.accountAgentId ? { id: b.accountAgentId, name: names.get(b.accountAgentId) ?? null, since: b.accountAgentAssignedAt?.toISOString() ?? null } : null,
      heardFrom: b.heardFrom,
      leadChannel: b.leadChannel,
      status: b.pausedAt ? 'paused' : (b.verificationStatus ?? 'lead'),
      pausedAt: b.pausedAt?.toISOString() ?? null,
      pauseReason: b.pauseReason,
      noDocuments: b.documentsStatus === 'no_documents',
      createdAt: b.createdAt.toISOString(),
      tiles: {
        openVacancies: b.vacancies.filter((v) => v.status === 'open').length,
        openPositions: b.vacancies.filter((v) => v.status === 'open').reduce((s, v) => s + v.headcount, 0),
        candidatesShown: introCount,
        noBypassMonths: policy.noBypassMonths,
        interviews: interviews.length,
        placements: b.placements.filter((p) => LIVE_PLACEMENT.includes(p.status)).length,
        feesPaidPaise: sumPaise(b.payments.map((p) => p.amount)),
        replacementsUsed: b.placements.filter((p) => p.replacementNumber > 0).length,
      },
      agreement: b.agreements[0]
        ? {
            signedAt: b.agreements[0].signedAt.toISOString(),
            signedName: b.agreements[0].signedName,
            signedRole: b.agreements[0].signedRole,
            version: b.agreements[0].version,
            feePercent: b.agreements[0].feePercent,
            gstPercent: b.agreements[0].gstPercent,
            noBypassMonths: b.agreements[0].noBypassMonths,
            noBypassPenaltyPercent: b.agreements[0].noBypassPenaltyPercent,
          }
        : null,
      callRecordingConsent: consent ? consent.granted && !consent.withdrawnAt : null,
      vacancies: b.vacancies.map((v) => ({
        id: v.id,
        code: v.code,
        role: v.roleTitle ?? v.tradeSkill,
        headcount: v.headcount,
        salaryMinPaise: v.salaryMinPaise,
        salaryMaxPaise: v.salaryMaxPaise,
        belowLegalMinimum: v.belowLegalMinimum,
        confirmed: Boolean(v.confirmedAt),
        confirmationMethod: v.confirmationMethod,
        openDays: daysSince(v.createdAt, now),
        status: v.status,
        interviews: v._count.interviews,
      })),
      introductions: b.candidateIntroductions.map((ci) => {
        const interview = latestBySeeker.get(ci.jobSeekerId);
        const placement = placedSeekers.get(ci.jobSeekerId);
        return {
          at: ci.shownAt.toISOString(),
          jobSeeker: ci.jobSeeker,
          shownBy: ci.shownBy.name,
          channel: ci.channel,
          outcome: placement ? `placed_${placement.status}` : interview ? (interview.result ?? interview.status) : 'shown',
        };
      }),
      visits: b.visits.map((v) => ({
        at: v.visitedAt.toISOString(),
        by: v.staff?.name ?? null,
        purpose: v.purpose,
        geofenceFlag: v.geofenceFlag,
        hasSelfie: Boolean(v.selfieUrl),
        photoLive: v.photoLive,
      })),
      history: history.map((h) => ({ at: h.changedAt.toISOString(), status: h.toStatus, by: h.changedByStaff?.name ?? null, reason: h.reason })),
    };
  }

  /** Leads to visit, agreements to sign and Team Lead reviews (C-Biz-Pending). */
  async waiting(now: Date = new Date()) {
    const businesses = await this.prisma.business.findMany({
      where: { anonymisedAt: null, verificationStatus: { in: ['lead', 'pending_visit', 'pending_tl_check'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        locality: true,
        verificationStatus: true,
        leadChannel: true,
        leadCreatedByStaffId: true,
        accountAgentId: true,
        inPersonOnboardedAt: true,
        createdAt: true,
        agreements: { select: { id: true }, take: 1 },
        visitAssignments: {
          where: { status: { in: ['pending', 'assigned'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, suggestedStaffId: true, assignedStaffId: true },
        },
        candidateIntroductions: { select: { id: true }, take: 1 },
      },
    });
    const names = await this.staffNames(
      businesses.flatMap((b) => [b.leadCreatedByStaffId, b.accountAgentId, b.visitAssignments[0]?.suggestedStaffId, b.visitAssignments[0]?.assignedStaffId]),
    );
    const rows = businesses.map((b) => {
      const assignment = b.visitAssignments[0] ?? null;
      let waitingFor: string;
      if (b.verificationStatus === 'pending_tl_check') waitingFor = 'tl_review';
      else if (!b.agreements.length && b.inPersonOnboardedAt === null && b.verificationStatus === 'pending_visit') waitingFor = 'agreement';
      else waitingFor = 'visit';
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        area: b.locality,
        cameFrom: b.inPersonOnboardedAt ? 'in_person' : (b.leadChannel ?? 'call_agent_lead'),
        cameBy: (b.inPersonOnboardedAt ? names.get(b.accountAgentId ?? '') : names.get(b.leadCreatedByStaffId ?? '')) ?? null,
        since: b.createdAt.toISOString(),
        waitingDays: daysSince(b.createdAt, now),
        waitingFor,
        agreementSigned: b.agreements.length > 0,
        candidatesShown: b.candidateIntroductions.length > 0,
        assignment: assignment
          ? {
              id: assignment.id,
              status: assignment.status,
              suggested: assignment.suggestedStaffId ? { id: assignment.suggestedStaffId, name: names.get(assignment.suggestedStaffId) ?? null } : null,
              assigned: assignment.assignedStaffId ? { id: assignment.assignedStaffId, name: names.get(assignment.assignedStaffId) ?? null } : null,
            }
          : null,
      };
    });
    const fieldAgents = await this.prisma.staff.findMany({ where: { role: 'field_agent', status: 'active' }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return { rows, fieldAgents };
  }

  /** Who was shown to which business, and when — never edited (C-Introductions). */
  async introductions(q: ListQuery) {
    const policy = await this.pricing.current();
    const and: Prisma.CandidateIntroductionWhereInput[] = [];
    const shown = dateFilter(q.range);
    if (shown) and.push({ shownAt: shown });
    if (q.search) {
      and.push({
        OR: [
          { business: { name: contains(q.search) } },
          { business: { code: contains(q.search) } },
          { jobSeeker: { name: contains(q.search) } },
          { jobSeeker: { code: contains(q.search) } },
        ],
      });
    }
    const where: Prisma.CandidateIntroductionWhereInput = and.length ? { AND: and } : {};
    const intros = await this.prisma.candidateIntroduction.findMany({
      where,
      orderBy: { shownAt: 'desc' },
      take: 5000,
      include: {
        business: { select: { id: true, code: true, name: true } },
        jobSeeker: { select: { id: true, code: true, name: true } },
        vacancy: { select: { code: true, tradeSkill: true } },
        shownBy: { select: { name: true } },
      },
    });
    const pairs = intros.map((i) => ({ businessId: i.businessId, jobSeekerId: i.jobSeekerId }));
    const [interviews, placements, bypass] = pairs.length
      ? await Promise.all([
          this.prisma.interview.findMany({
            where: { OR: pairs.slice(0, 2000) },
            select: { businessId: true, jobSeekerId: true, status: true, result: true, slotStartsAt: true },
          }),
          this.prisma.placement.findMany({ where: { OR: pairs.slice(0, 2000) }, select: { businessId: true, jobSeekerId: true, status: true } }),
          this.prisma.reviewFlag.findMany({
            where: { kind: { in: ['bypass_suspected', 'interview_result_mismatch'] }, status: 'open', subjectType: 'job_seeker', subjectId: { in: intros.map((i) => i.jobSeekerId) } },
            select: { subjectId: true },
          }),
        ])
      : [[], [], []];
    const key = (b: string, j: string) => `${b}:${j}`;
    const interviewMap = new Map<string, (typeof interviews)[number]>();
    for (const i of interviews) {
      const k = key(i.businessId, i.jobSeekerId);
      const prev = interviewMap.get(k);
      if (!prev || prev.slotStartsAt < i.slotStartsAt) interviewMap.set(k, i);
    }
    const placementMap = new Map(placements.map((p) => [key(p.businessId, p.jobSeekerId), p]));
    const bypassSet = new Set(bypass.map((b) => b.subjectId));
    let rows = intros.map((i) => {
      const k = key(i.businessId, i.jobSeekerId);
      const placement = placementMap.get(k);
      const interview = interviewMap.get(k);
      let outcome: string;
      if (bypassSet.has(i.jobSeekerId) && !placement) outcome = 'bypass_suspected';
      else if (placement) outcome = 'selected';
      else if (interview?.result === 'not_selected') outcome = 'not_selected';
      else if (interview?.result === 'no_show' || interview?.status === 'no_show') outcome = 'no_show';
      else if (interview) outcome = 'interview_booked';
      else outcome = 'shown';
      const until = new Date(i.shownAt);
      until.setUTCMonth(until.getUTCMonth() + policy.noBypassMonths);
      return {
        id: i.id,
        at: i.shownAt.toISOString(),
        business: i.business,
        jobSeeker: i.jobSeeker,
        trade: i.vacancy.tradeSkill,
        vacancyCode: i.vacancy.code,
        channel: i.channel,
        shownBy: i.shownBy.name,
        noBypassUntil: until.toISOString(),
        outcome,
      };
    });
    if (q.outcome) rows = rows.filter((r) => r.outcome === q.outcome);
    const total = rows.length;
    return {
      rows: rows.slice(q.page.skip, q.page.skip + q.page.pageSize),
      total,
      page: q.page.page,
      pageSize: q.page.pageSize,
      summary: {
        shown: total,
        selected: rows.filter((r) => r.outcome === 'selected').length,
        notSelected: rows.filter((r) => r.outcome === 'not_selected').length,
        bypassSuspected: rows.filter((r) => r.outcome === 'bypass_suspected').length,
        noBypassMonths: policy.noBypassMonths,
      },
    };
  }

  // ---------------------------------------------------------------- vacancies

  async listVacancies(q: ListQuery, now: Date = new Date()) {
    const and: Prisma.VacancyWhereInput[] = [];
    const created = dateFilter(q.range);
    if (created) and.push({ createdAt: created });
    if (q.search) {
      and.push({ OR: [{ code: contains(q.search) }, { tradeSkill: contains(q.search) }, { roleTitle: contains(q.search) }, { business: { name: contains(q.search) } }] });
    }
    const status = q.status ?? 'open';
    if (status === 'open') and.push({ status: 'open' });
    if (status === 'filled') and.push({ status: 'filled' });
    if (status === 'closed') and.push({ status: 'cancelled' });
    if (status === 'draft') and.push({ status: { notIn: ['open', 'filled', 'cancelled'] } });
    if (q.trade) and.push({ tradeSkill: { equals: q.trade, mode: 'insensitive' } });
    if (q.area) and.push({ OR: [{ locality: { equals: q.area, mode: 'insensitive' } }, { business: { locality: { equals: q.area, mode: 'insensitive' } } }] });
    if (q.age === 'over_15') and.push({ createdAt: { lte: new Date(now.getTime() - 15 * DAY_MS) } });
    const where: Prisma.VacancyWhereInput = and.length ? { AND: and } : {};
    const [total, vacancies] = await Promise.all([
      this.prisma.vacancy.count({ where }),
      this.prisma.vacancy.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: q.page.skip,
        take: q.page.pageSize,
        include: {
          business: { select: { id: true, name: true, locality: true } },
          _count: { select: { candidateIntroductions: true, interviews: true } },
        },
      }),
    ]);
    const pool = await this.poolByTrade();
    const rows = vacancies.map((v) => ({
      id: v.id,
      code: v.code,
      trade: v.tradeSkill,
      role: v.roleTitle ?? v.tradeSkill,
      headcount: v.headcount,
      business: v.business,
      area: v.locality ?? v.business.locality,
      salaryMinPaise: v.salaryMinPaise,
      salaryMaxPaise: v.salaryMaxPaise,
      salaryPeriod: v.salaryPeriod,
      belowLegalMinimum: v.belowLegalMinimum,
      replacement: Boolean(v.replacementForPlacementId),
      openDays: daysSince(v.createdAt, now),
      // Active, paid job seekers in the same trade (the matching page narrows by distance, salary and shift).
      matches: pool.get(v.tradeSkill.toLowerCase()) ?? 0,
      shown: v._count.candidateIntroductions,
      interviews: v._count.interviews,
      status: v.status,
      createdAt: v.createdAt.toISOString(),
    }));

    const [open, filledInMonth, closedInMonth, below] = await Promise.all([
      this.prisma.vacancy.findMany({
        where: { status: 'open' },
        select: { tradeSkill: true, headcount: true, createdAt: true, replacementForPlacementId: true, salaryMaxPaise: true, businessId: true, locality: true },
      }),
      this.prisma.placement.findMany({
        where: { selectedAt: { gte: istStartOfMonth(now) }, status: { in: LIVE_PLACEMENT } },
        select: { selectedAt: true, vacancy: { select: { createdAt: true, tradeSkill: true } } },
      }),
      this.prisma.vacancy.count({ where: { status: 'cancelled', updatedAt: { gte: istStartOfMonth(now) } } }),
      this.prisma.vacancy.count({ where: { status: 'open', belowLegalMinimum: true } }),
    ]);
    const fillDays = filledInMonth.map((p) => daysSince(p.vacancy.createdAt, p.selectedAt as Date));
    const byTrade = new Map<string, number[]>();
    for (const p of filledInMonth) {
      const list = byTrade.get(p.vacancy.tradeSkill) ?? [];
      list.push(daysSince(p.vacancy.createdAt, p.selectedAt as Date));
      byTrade.set(p.vacancy.tradeSkill, list);
    }
    const openTrades = countBy(open, (v) => v.tradeSkill);
    const shortTrades = openTrades.filter((t) => (pool.get(t.name.toLowerCase()) ?? 0) < t.count).map((t) => t.name);
    const overdueResults = await this.prisma.interview.findMany({
      where: { status: { in: ['confirmed', 'completed', 'no_result'] }, result: null, resultDueAt: { lt: now } },
      select: { business: { select: { name: true } } },
    });
    const slowOwners = countBy(overdueResults, (i) => i.business.name);
    return {
      rows,
      total,
      page: q.page.page,
      pageSize: q.page.pageSize,
      summary: {
        open: open.length,
        openPositions: open.reduce((s, v) => s + v.headcount, 0),
        openOver15Days: open.filter((v) => daysSince(v.createdAt, now) > 15).length,
        replacements: open.filter((v) => v.replacementForPlacementId).length,
        averageDaysToFill: average(fillDays),
        fillRatePercent: percent(filledInMonth.length, filledInMonth.length + closedInMonth),
        belowLegalMinimum: below,
      },
      whyOpen: { shortTrades: shortTrades.slice(0, 4), slowOwners: slowOwners.slice(0, 3).map((s) => s.name), slowOwnerCount: slowOwners.length },
      timeToFillByTrade: [...byTrade.entries()].map(([trade, days]) => ({ trade, days: average(days) ?? 0 })).sort((a, b) => a.days - b.days).slice(0, 8),
      facets: { trades: openTrades.map((t) => t.name), areas: countBy(open, (v) => v.locality).map((a) => a.name) },
    };
  }

  /** Active job seekers in the pool by trade (lower-cased), any of their trades. */
  async poolByTrade(): Promise<Map<string, number>> {
    const trades = await this.prisma.jobSeekerTrade.findMany({
      where: { jobSeeker: { status: 'active', anonymisedAt: null } },
      select: { trade: true },
    });
    const map = new Map<string, number>();
    for (const t of trades) map.set(t.trade.toLowerCase(), (map.get(t.trade.toLowerCase()) ?? 0) + 1);
    return map;
  }

  async vacancyDetail(id: string, now: Date = new Date()) {
    const v = await this.prisma.vacancy.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: {
        business: { select: { id: true, code: true, name: true, locality: true } },
        capturedBy: { select: { name: true, role: true } },
        candidateIntroductions: { orderBy: { shownAt: 'desc' }, include: { jobSeeker: { select: { id: true, code: true, name: true, dateOfBirth: true, locality: true } } } },
        interviews: {
          orderBy: { slotStartsAt: 'desc' },
          include: { jobSeeker: { select: { id: true, code: true, name: true } } },
        },
        placements: { select: { id: true, code: true, status: true, jobSeeker: { select: { name: true } } } },
      },
    });
    if (!v) throw new NotFoundException(`Vacancy '${id}' not found`);
    const pool = await this.poolByTrade();
    const history = await this.prisma.statusHistory.findMany({
      where: { subjectType: 'vacancy', subjectId: v.id },
      orderBy: { changedAt: 'desc' },
      take: 30,
      include: { changedByStaff: { select: { name: true } } },
    });
    const seen = new Set<string>();
    const candidates: { id: string; code: string; name: string; locality: string | null; age: number | null; status: string; at: string }[] = [];
    for (const i of v.interviews) {
      if (seen.has(i.jobSeeker.id)) continue;
      seen.add(i.jobSeeker.id);
      candidates.push({ id: i.jobSeeker.id, code: i.jobSeeker.code, name: i.jobSeeker.name, locality: null, age: null, status: i.result ?? i.status, at: i.slotStartsAt.toISOString() });
    }
    for (const ci of v.candidateIntroductions) {
      if (seen.has(ci.jobSeeker.id)) continue;
      seen.add(ci.jobSeeker.id);
      const dob = ci.jobSeeker.dateOfBirth;
      candidates.push({
        id: ci.jobSeeker.id,
        code: ci.jobSeeker.code,
        name: ci.jobSeeker.name,
        locality: ci.jobSeeker.locality,
        age: dob ? Math.floor((now.getTime() - dob.getTime()) / (365.25 * DAY_MS)) : null,
        status: 'shown',
        at: ci.shownAt.toISOString(),
      });
    }
    return {
      id: v.id,
      code: v.code,
      status: v.status,
      business: v.business,
      trade: v.tradeSkill,
      role: v.roleTitle ?? v.tradeSkill,
      description: v.description,
      headcount: v.headcount,
      salaryMinPaise: v.salaryMinPaise,
      salaryMaxPaise: v.salaryMaxPaise,
      salaryPeriod: v.salaryPeriod,
      belowLegalMinimum: v.belowLegalMinimum,
      ownerToldMinimumWage: v.ownerToldMinimumWage,
      legalMinimumPaise: v.legalMinimumPaise,
      shift: v.shift,
      workingHours: v.workingHours,
      weeklyOff: v.weeklyOff,
      extras: v.extras,
      locality: v.locality ?? v.business.locality,
      confirmedAt: v.confirmedAt?.toISOString() ?? null,
      confirmationMethod: v.confirmationMethod,
      confirmedByName: v.confirmedByName,
      capturedBy: v.capturedBy,
      replacementFor: v.replacementForPlacementId,
      openDays: daysSince(v.createdAt, now),
      createdAt: v.createdAt.toISOString(),
      tiles: {
        matching: pool.get(v.tradeSkill.toLowerCase()) ?? 0,
        shown: new Set(v.candidateIntroductions.map((c) => c.jobSeekerId)).size,
        interviews: v.interviews.length,
        openDays: daysSince(v.createdAt, now),
      },
      candidates,
      placements: v.placements.map((p) => ({ id: p.id, code: p.code, status: p.status, name: p.jobSeeker.name })),
      history: history.map((h) => ({ at: h.changedAt.toISOString(), status: h.toStatus, by: h.changedByStaff?.name ?? null, reason: h.reason })),
    };
  }

  // ---------------------------------------------------------------- interviews

  async interviews(range: DateRange, now: Date = new Date()) {
    const include = {
      jobSeeker: { select: { id: true, code: true, name: true } },
      business: { select: { id: true, code: true, name: true, ownerName: true } },
      vacancy: { select: { id: true, code: true, tradeSkill: true, interviewType: true } },
    } satisfies Prisma.InterviewInclude;
    const [inRange, resultsPending, mismatches, awaiting, noShowsWeek] = await Promise.all([
      this.prisma.interview.findMany({
        where: { slotStartsAt: { gte: range.from, lte: range.to }, status: { not: 'cancelled' } },
        orderBy: { slotStartsAt: 'asc' },
        take: 2000,
        include,
      }),
      this.prisma.interview.findMany({
        where: { result: null, status: { in: ['confirmed', 'completed', 'no_result'] }, slotEndsAt: { lte: now } },
        orderBy: { resultDueAt: 'asc' },
        take: 200,
        include,
      }),
      this.prisma.interview.findMany({
        where: { result: 'not_selected', candidateCheckAnswer: 'offered_yes' },
        orderBy: { candidateCheckAt: 'desc' },
        take: 200,
        include,
      }),
      this.prisma.interview.findMany({ where: { status: 'offered', replyDueAt: { gte: now } }, orderBy: { replyDueAt: 'asc' }, take: 200, include }),
      this.prisma.interview.count({ where: { status: 'no_show', slotStartsAt: { gte: new Date(now.getTime() - 7 * DAY_MS), lte: now } } }),
    ]);
    const agentIds = inRange.filter((i) => i.agentAttendanceRequired).map((i) => i.proposedByStaffId);
    const names = await this.staffNames(agentIds);
    const todayStart = new Date(now.getTime() - ((now.getTime() + 5.5 * 3600 * 1000) % DAY_MS));
    const todayEnd = new Date(todayStart.getTime() + DAY_MS - 1);
    const todays = await this.prisma.interview.count({ where: { slotStartsAt: { gte: todayStart, lte: todayEnd }, status: { not: 'cancelled' } } });
    const dueToday = resultsPending.filter((i) => i.resultDueAt >= now && i.resultDueAt <= todayEnd).length;
    const map = (i: (typeof inRange)[number]) => ({
      id: i.id,
      code: i.code,
      slotStartsAt: i.slotStartsAt.toISOString(),
      slotEndsAt: i.slotEndsAt.toISOString(),
      jobSeeker: i.jobSeeker,
      trade: i.vacancy.tradeSkill,
      vacancy: { id: i.vacancy.id, code: i.vacancy.code },
      business: { id: i.business.id, code: i.business.code, name: i.business.name },
      owner: i.business.ownerName,
      type: i.agentAttendanceRequired ? 'in_person' : (i.vacancy.interviewType ?? 'walk_in'),
      fieldAgent: i.agentAttendanceRequired ? (names.get(i.proposedByStaffId) ?? null) : null,
      status: i.status,
      result: i.result,
      resultDueAt: i.resultDueAt.toISOString(),
      overdue: !i.result && i.resultDueAt < now,
      offerSentAt: i.offerSentAt.toISOString(),
      replyDueAt: i.replyDueAt.toISOString(),
      candidateCheckAnswer: i.candidateCheckAnswer,
    });
    return {
      summary: {
        today: todays,
        inRange: inRange.length,
        resultsDueToday: dueToday,
        resultsOverdue: resultsPending.filter((i) => i.resultDueAt < now).length,
        mismatches: mismatches.length,
        awaitingReply: awaiting.length,
        noShowsThisWeek: noShowsWeek,
      },
      rows: inRange.map(map),
      resultsPending: resultsPending.map(map),
      mismatches: mismatches.map(map),
      awaitingReply: awaiting.map(map),
    };
  }
}
