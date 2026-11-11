import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { DAY_MS, DateRange, PageRequest, contains, countBy, dateFilter, daysLeft, daysSince, istStartOfMonth, percent, sumPaise } from './ceo-common';

export interface PlacementListQuery {
  range: Partial<DateRange>;
  page: PageRequest;
  search?: string;
  stage?: string;
  trade?: string;
}

/** Placement stages as the CEO list names them. */
export function placementStage(p: { status: string; paidAt: Date | null; joinedDate: Date | null; guaranteeEndedReason: string | null }): string {
  if (p.guaranteeEndedReason === 'refunded') return 'refunded';
  if (p.status === 'cancelled') return 'cancelled';
  if (p.status === 'awaiting_payment') return 'awaiting_payment';
  if (p.status === 'dropped_out') return 'replacement';
  if (p.status === 'completed') return 'cleared';
  if (p.status === 'guarantee_ended') return 'guarantee_ended';
  if (p.status === 'replaced') return 'replaced';
  if (p.paidAt && !p.joinedDate) return 'paid_not_joined';
  return 'working';
}

const STAGE_WHERE: Record<string, Prisma.PlacementWhereInput> = {
  awaiting_payment: { status: 'awaiting_payment' },
  paid_not_joined: { status: { in: ['confirmed', 'active'] }, joinedDate: null },
  working: { status: { in: ['confirmed', 'active'] }, joinedDate: { not: null } },
  replacement: { status: 'dropped_out' },
  cleared: { status: 'completed' },
  refunded: { guaranteeEndedReason: 'refunded' },
  ended: { status: { in: ['guarantee_ended', 'replaced', 'cancelled'] } },
};

@Injectable()
export class CeoPlacementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async list(q: PlacementListQuery, now: Date = new Date()) {
    const policy = await this.pricing.current();
    const and: Prisma.PlacementWhereInput[] = [];
    const joined = dateFilter(q.range);
    if (joined) and.push({ OR: [{ joinedDate: joined }, { joinedDate: null, createdAt: joined }] });
    if (q.search) {
      and.push({ OR: [{ code: contains(q.search) }, { jobSeeker: { name: contains(q.search) } }, { jobSeeker: { code: contains(q.search) } }, { business: { name: contains(q.search) } }] });
    }
    if (q.stage && STAGE_WHERE[q.stage]) and.push(STAGE_WHERE[q.stage]);
    if (q.trade) and.push({ vacancy: { tradeSkill: { equals: q.trade, mode: 'insensitive' } } });
    const where: Prisma.PlacementWhereInput = and.length ? { AND: and } : {};
    const [total, placements] = await Promise.all([
      this.prisma.placement.count({ where }),
      this.prisma.placement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: q.page.skip,
        take: q.page.pageSize,
        include: {
          jobSeeker: { select: { id: true, code: true, name: true } },
          business: { select: { id: true, code: true, name: true } },
          vacancy: { select: { tradeSkill: true } },
        },
      }),
    ]);
    const rows = placements.map((p) => {
      const stage = placementStage(p);
      return {
        id: p.id,
        code: p.code,
        jobSeeker: p.jobSeeker,
        business: p.business,
        trade: p.vacancy.tradeSkill,
        salaryPaise: p.agreedSalary,
        feePaise: p.placementFee,
        gstPaise: p.gstAmount,
        joinedDate: p.joinedDate?.toISOString() ?? null,
        guaranteeDay: p.joinedDate ? Math.min(policy.replacementWindowDays, daysSince(p.joinedDate, now) + 1) : null,
        guaranteeDays: policy.replacementWindowDays,
        replacementNumber: p.replacementNumber,
        status: p.status,
        stage,
      };
    });

    const monthStart = istStartOfMonth(now);
    const windowStart = new Date(now.getTime() - policy.replacementWindowDays * DAY_MS);
    const [working, joinedThisMonth, inSearch, paused, cleared, reachedDay60, stillWorking60, claimsMonth, freeReplacements, refundsAfterSearch] = await Promise.all([
      this.prisma.placement.count({ where: STAGE_WHERE.working }),
      this.prisma.placement.count({ where: { joinedDate: { gte: monthStart, lte: now } } }),
      this.prisma.placement.findMany({ where: { status: 'dropped_out', guaranteeEndedReason: null }, select: { placementFee: true, dropoutReportedAt: true } }),
      this.prisma.placement.count({ where: { status: 'dropped_out', guaranteeEndedReason: 'two_rejections' } }),
      this.prisma.placement.count({ where: { status: 'completed' } }),
      this.prisma.placement.count({ where: { replacementNumber: 0, joinedDate: { lte: windowStart } } }),
      this.prisma.placement.count({ where: { replacementNumber: 0, joinedDate: { lte: windowStart }, status: 'completed' } }),
      this.prisma.replacementClaim.findMany({ where: { reportedAt: { gte: monthStart, lte: now } }, select: { reason: true } }),
      this.prisma.placement.count({ where: { replacementNumber: { gt: 0 }, createdAt: { gte: monthStart, lte: now } } }),
      this.prisma.payment.count({ where: { type: 'refund', placementId: { not: null }, createdAt: { gte: monthStart, lte: now }, status: { notIn: ['failed', 'rejected', 'reversed'] } } }),
    ]);
    const searchWithin3 = inSearch.filter((p) => p.dropoutReportedAt && daysLeft(p.dropoutReportedAt, policy.replacementSearchDays, now) <= 3).length;
    const trades = await this.prisma.vacancy.findMany({ where: { placements: { some: {} } }, distinct: ['tradeSkill'], select: { tradeSkill: true } });
    return {
      rows,
      total,
      page: q.page.page,
      pageSize: q.page.pageSize,
      summary: {
        working,
        joinedThisMonth,
        inReplacementSearch: inSearch.length,
        pausedAfterRejections: paused,
        cleared,
        stillWorkingAtDay60Percent: percent(stillWorking60, reachedDay60),
        feePercent: policy.placementFeePercent,
        gstPercent: policy.gstPercent,
      },
      whyLeft: countBy(claimsMonth, (c) => c.reason).slice(0, 6),
      replacements: {
        freeThisMonth: freeReplacements,
        refundsAfterSearchThisMonth: refundsAfterSearch,
        refundableFromSearchPaise: sumPaise(inSearch.map((p) => p.placementFee)),
        reachDeadlineIn3Days: searchWithin3,
        searchDays: policy.replacementSearchDays,
      },
      facets: { trades: trades.map((t) => t.tradeSkill).sort() },
    };
  }

  async detail(id: string, now: Date = new Date()) {
    const policy = await this.pricing.current();
    const p = await this.prisma.placement.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: {
        jobSeeker: { select: { id: true, code: true, name: true, referredBy: { select: { id: true, code: true, name: true } } } },
        business: { select: { id: true, code: true, name: true } },
        vacancy: { select: { id: true, code: true, tradeSkill: true, roleTitle: true } },
        replacementCandidates: { orderBy: { offeredAt: 'asc' }, include: { jobSeeker: { select: { code: true, name: true } } } },
        replacementClaims: { orderBy: { reportedAt: 'desc' }, include: { decidedByStaff: { select: { name: true } } } },
        payments: { orderBy: { createdAt: 'asc' } },
        createdBy: { select: { name: true } },
      },
    });
    if (!p) throw new NotFoundException(`Placement '${id}' not found`);
    const rootId = p.rootPlacementId ?? p.id;
    const [chain, history, followUps] = await Promise.all([
      this.prisma.placement.findMany({ where: { OR: [{ id: rootId }, { rootPlacementId: rootId }] }, orderBy: { replacementNumber: 'asc' }, select: { id: true, code: true, replacementNumber: true, status: true, joinedDate: true, jobSeeker: { select: { name: true } } } }),
      this.prisma.statusHistory.findMany({
        where: { subjectType: 'placement', subjectId: p.id },
        orderBy: { changedAt: 'asc' },
        include: { changedByStaff: { select: { name: true } } },
      }),
      this.prisma.followUpTask.findMany({ where: { relatedType: 'placement', relatedId: p.id }, orderBy: { dueAt: 'asc' }, select: { kind: true, status: true, dueAt: true, completedAt: true, answer: true } }),
    ]);
    const fee = p.payments.find((x) => x.type === 'placement_fee');
    const referral = p.payments.find((x) => x.type === 'referral_payout');
    const reward = p.payments.find((x) => x.type === 'joining_reward');
    const refund = [...p.payments].reverse().find((x) => x.type === 'refund');
    const claim = p.replacementClaims[0] ?? null;
    const root = chain.find((c) => c.id === rootId);
    const searchDaysLeft = p.status === 'dropped_out' && p.dropoutReportedAt ? daysLeft(p.dropoutReportedAt, policy.replacementSearchDays, now) : null;

    type Event = { at: string; text: string; by: string | null; detail?: string | null };
    const timeline: Event[] = [];
    if (p.selectedAt) timeline.push({ at: p.selectedAt.toISOString(), text: 'selected', by: null });
    if (p.paidAt) timeline.push({ at: p.paidAt.toISOString(), text: 'fee_paid', by: null, detail: p.invoiceCode });
    if (p.joinedDate) timeline.push({ at: p.joinedDate.toISOString(), text: 'joined', by: null });
    for (const f of followUps) if (f.completedAt) timeline.push({ at: f.completedAt.toISOString(), text: f.kind, by: null, detail: f.answer });
    for (const c of p.replacementClaims) {
      timeline.push({ at: c.reportedAt.toISOString(), text: 'dropout_reported', by: null, detail: c.reason });
      if (c.decidedAt) timeline.push({ at: c.decidedAt.toISOString(), text: `claim_${c.decision}`, by: c.decidedByStaff?.name ?? null, detail: c.decisionReason });
    }
    for (const r of p.replacementCandidates) {
      timeline.push({ at: r.offeredAt.toISOString(), text: 'replacement_offered', by: null, detail: `${r.jobSeeker.code} · ${r.jobSeeker.name}` });
      if (r.rejectedAt) timeline.push({ at: r.rejectedAt.toISOString(), text: 'replacement_rejected', by: null, detail: r.rejectionReason });
    }
    for (const h of history) timeline.push({ at: h.changedAt.toISOString(), text: `status_${h.toStatus}`, by: h.changedByStaff?.name ?? null, detail: h.reason });
    if (refund) timeline.push({ at: refund.createdAt.toISOString(), text: `refund_${refund.status}`, by: null, detail: refund.code });
    timeline.sort((a, b) => a.at.localeCompare(b.at));

    return {
      id: p.id,
      code: p.code,
      status: p.status,
      stage: placementStage(p),
      jobSeeker: { id: p.jobSeeker.id, code: p.jobSeeker.code, name: p.jobSeeker.name },
      business: p.business,
      vacancy: p.vacancy,
      salaryPaise: p.agreedSalary,
      feePaise: p.placementFee,
      gstPaise: p.gstAmount,
      paidAt: p.paidAt?.toISOString() ?? null,
      invoiceCode: p.invoiceCode,
      feePayment: fee ? { code: fee.code, status: fee.status, amountPaise: fee.amount } : null,
      joinedDate: p.joinedDate?.toISOString() ?? null,
      joiningCallsAnswered: Boolean(p.joiningWorkerCallId && p.joiningBusinessCallId),
      referral: p.jobSeeker.referredBy ? { partner: p.jobSeeker.referredBy, payment: referral ? { code: referral.code, status: referral.status, amountPaise: referral.amount } : null } : null,
      joiningReward: reward ? { code: reward.code, status: reward.status, amountPaise: reward.amount } : null,
      guarantee: {
        windowDays: policy.replacementWindowDays,
        searchDays: policy.replacementSearchDays,
        day: root?.joinedDate ? daysSince(root.joinedDate, now) + 1 : null,
        endedReason: p.guaranteeEndedReason,
        dropoutReportedAt: p.dropoutReportedAt?.toISOString() ?? null,
        searchDaysLeft,
        maxReplacements: policy.maxFreeReplacements,
        maxRejections: policy.maxReplacementRejections,
        replacementsOffered: p.replacementCandidates.length,
        replacementsRejected: p.replacementCandidates.filter((r) => r.status === 'rejected').length,
      },
      claim: claim
        ? {
            id: claim.id,
            code: claim.code,
            reason: claim.reason,
            workerLeftOn: claim.workerLeftOn.toISOString(),
            reportedAt: claim.reportedAt.toISOString(),
            reportedWithinDeadline: claim.reportedWithinDeadline,
            feePaidInFull: claim.feePaidInFull,
            decision: claim.decision,
            decidedBy: claim.decidedByStaff?.name ?? null,
            decisionReason: claim.decisionReason,
          }
        : null,
      refund: refund ? { id: refund.id, code: refund.code, status: refund.status, amountPaise: refund.amount, withCeo: Boolean(refund.ceoApprovalReason) && refund.status === 'pending', ceoApprovalReason: refund.ceoApprovalReason } : null,
      chain: chain.map((c) => ({ id: c.id, code: c.code, number: c.replacementNumber, status: c.status, name: c.jobSeeker.name, joinedDate: c.joinedDate?.toISOString() ?? null })),
      replacementCandidates: p.replacementCandidates.map((r) => ({ code: r.jobSeeker.code, name: r.jobSeeker.name, status: r.status, reason: r.rejectionReason, at: r.offeredAt.toISOString() })),
      createdBy: p.createdBy?.name ?? null,
      timeline,
    };
  }

  /** Every replacement claim, with the search progress (C-Claims). */
  async claims(range: Partial<DateRange>, page: PageRequest, now: Date = new Date()) {
    const policy = await this.pricing.current();
    const reported = dateFilter(range);
    const where: Prisma.ReplacementClaimWhereInput = reported ? { reportedAt: reported } : {};
    const [total, claims] = await Promise.all([
      this.prisma.replacementClaim.count({ where }),
      this.prisma.replacementClaim.findMany({
        where,
        orderBy: { reportedAt: 'desc' },
        skip: page.skip,
        take: page.pageSize,
        include: {
          placement: {
            select: {
              id: true,
              code: true,
              status: true,
              joinedDate: true,
              dropoutReportedAt: true,
              guaranteeEndedReason: true,
              placementFee: true,
              business: { select: { id: true, name: true } },
              replacementCandidates: { select: { status: true } },
            },
          },
          decidedByStaff: { select: { name: true, role: true } },
        },
      }),
    ]);
    const rows = claims.map((c) => {
      const p = c.placement;
      const rejected = p.replacementCandidates.filter((r) => r.status === 'rejected').length;
      const accepted = p.replacementCandidates.some((r) => r.status === 'accepted');
      let search: { state: string; day?: number; of?: number };
      if (c.decision !== 'accepted') search = { state: 'none' };
      else if (p.guaranteeEndedReason) search = { state: 'ended', day: rejected };
      else if (accepted) search = { state: 'replaced' };
      else if (p.dropoutReportedAt) search = { state: 'running', day: Math.min(policy.replacementSearchDays, daysSince(p.dropoutReportedAt, now) + 1), of: policy.replacementSearchDays };
      else search = { state: 'running' };
      return {
        id: c.id,
        code: c.code,
        placement: { id: p.id, code: p.code },
        business: p.business,
        reason: c.reason,
        leftOnDay: p.joinedDate ? daysSince(p.joinedDate, c.workerLeftOn) + 1 : null,
        reportedDaysAfterLeaving: daysSince(c.workerLeftOn, c.reportedAt),
        reportedWithinDeadline: c.reportedWithinDeadline,
        feePaidInFull: c.feePaidInFull,
        decision: c.decision,
        decidedBy: c.decidedByStaff ? { name: c.decidedByStaff.name, role: c.decidedByStaff.role } : null,
        decisionDueAt: c.decisionDueAt.toISOString(),
        overdue: !c.decision && c.decisionDueAt < now,
        rejectedReplacements: rejected,
        search,
        feePaise: p.placementFee,
      };
    });
    const monthStart = istStartOfMonth(now);
    const [thisMonth, waiting, running] = await Promise.all([
      this.prisma.replacementClaim.count({ where: { reportedAt: { gte: monthStart, lte: now } } }),
      this.prisma.replacementClaim.count({ where: { decision: null } }),
      this.prisma.placement.findMany({ where: { status: 'dropped_out', guaranteeEndedReason: null }, select: { placementFee: true } }),
    ]);
    return {
      rows,
      total,
      page: page.page,
      pageSize: page.pageSize,
      summary: {
        thisMonth,
        waitingForDecision: waiting,
        searchesRunning: running.length,
        refundableFromSearchPaise: sumPaise(running.map((r) => r.placementFee)),
        searchDays: policy.replacementSearchDays,
      },
    };
  }
}
