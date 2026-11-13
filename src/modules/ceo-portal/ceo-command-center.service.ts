import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { RefundService } from '../refund/refund.service';
import { MoneyAtRiskService } from '../target/money-at-risk.service';
import { CeoMoneyService, MONEY_IN_TYPES, summariseReceived, withBypassCharges } from './ceo-money.service';
import { CeoJobSeekersService, ENDED_STATUSES, NOT_PAID_STATUSES, OFFER_STATUSES } from './ceo-job-seekers.service';
import { CeoBusinessesService } from './ceo-businesses.service';
import {
  DAY_MS,
  DateRange,
  RECEIVED_STATUSES,
  average,
  changePercent,
  countBy,
  daysSince,
  istDayKey,
  istStartOfDay,
  monthBuckets,
  percent,
  previousRange,
  sumPaise,
  weekBuckets,
} from './ceo-common';

const LIVE_PLACEMENT = ['awaiting_payment', 'confirmed', 'active', 'dropped_out', 'replaced', 'completed', 'guarantee_ended'];

/**
 * The CEO Command Center (guide: "The CEO Command Center (decided 9 Nov)").
 * Every number is computed on the server for the chosen date range, so the
 * browser never downloads whole lists to add them up.
 */
@Injectable()
export class CeoCommandCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly money: CeoMoneyService,
    private readonly seekers: CeoJobSeekersService,
    private readonly businesses: CeoBusinessesService,
    private readonly refunds: RefundService,
    private readonly moneyAtRisk: MoneyAtRiskService,
  ) {}

  async moneyRow(actorId: string, range: DateRange, now: Date = new Date()) {
    const [totals, before, payouts, due, atRisk] = await Promise.all([
      this.money.totals(range),
      this.money.totals(previousRange(range)),
      this.money.payouts(),
      this.refunds.getRefundsDue(actorId, now),
      this.moneyAtRisk.getMoneyAtRisk(undefined, undefined, now),
    ]);
    const owedNowPaise = sumPaise(due.map((r) => r.amount));
    return {
      ...totals,
      previousNetPaise: before.netPaise,
      changePercent: changePercent(totals.netPaise, before.netPaise),
      // Asked without an actor (the system), so the answer carries rupees.
      refundExposure: { owedNowPaise, owedNowCount: due.length, atRiskPaise: atRisk.totalAtRiskPaise ?? 0, totalPaise: owedNowPaise + (atRisk.totalAtRiskPaise ?? 0) },
      payouts,
    };
  }

  async pipeline(range: DateRange, now: Date = new Date()) {
    const r = { gte: range.from, lte: range.to };
    const [registered, stuck, paid, offers, accepted, declined, joined, visits, signed, vacancies, filled, dropped, replacing, near] = await Promise.all([
      this.prisma.jobSeeker.count({ where: { createdAt: r, phoneVerified: true } }),
      this.prisma.jobSeeker.count({ where: { createdAt: r, status: { in: NOT_PAID_STATUSES } } }),
      this.prisma.jobSeeker.count({ where: { paymentReceivedAt: r } }),
      this.prisma.interview.findMany({ where: { offerSentAt: r, status: { in: OFFER_STATUSES } }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } }),
      this.prisma.interview.findMany({ where: { offerSentAt: r, status: { in: ['confirmed', 'completed', 'no_show', 'no_result'] } }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } }),
      this.prisma.interview.count({ where: { offerSentAt: r, status: { in: ['declined', 'no_reply'] } } }),
      this.prisma.placement.count({ where: { joinedDate: r } }),
      this.prisma.businessVisit.count({ where: { visitedAt: r } }),
      this.prisma.businessAgreement.findMany({ where: { signedAt: r }, distinct: ['businessId'], select: { businessId: true } }),
      this.prisma.vacancy.aggregate({ where: { createdAt: r }, _count: { _all: true }, _sum: { headcount: true } }),
      this.prisma.placement.count({ where: { selectedAt: r, status: { in: LIVE_PLACEMENT } } }),
      this.prisma.replacementClaim.count({ where: { reportedAt: r } }),
      this.prisma.placement.count({ where: { status: 'dropped_out', guaranteeEndedReason: null } }),
      this.seekers.nearRefund(now),
    ]);
    const nearSummary = CeoJobSeekersService.summariseNearRefund(near.rows);
    const openingsAdded = vacancies._sum.headcount ?? 0;
    return {
      jobSeekers: {
        registered,
        stuckBeforePaying: stuck,
        paid,
        paidPercent: percent(paid, registered),
        offered: offers.length,
        accepted: accepted.length,
        declined,
        acceptedPercent: percent(accepted.length, offers.length),
        joined,
        joinedPercent: percent(joined, accepted.length),
        closeToRefund: nearSummary.jobSeekers,
      },
      businesses: {
        fieldVisits: visits,
        signedUp: signed.length,
        vacanciesAdded: vacancies._count._all,
        openingsAdded,
        filled,
        fillPercent: percent(filled, openingsAdded),
        droppedOut: dropped,
        replacingNow: replacing,
        closeToRefund: nearSummary.businesses,
      },
      windowDays: near.windowDays,
    };
  }

  async verticals(range: DateRange, now: Date = new Date()) {
    const policy = await this.pricing.current();
    const today = { gte: istStartOfDay(istDayKey(now)), lte: now };
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const seekerSummary = await this.seekers.summary(now, policy.jobSeekerGuaranteeDays, policy.maxHits);
    const [
      partners,
      referredJoined,
      payouts,
      activeBiz,
      signedMonth,
      geofenceVisits,
      areas,
      openVac,
      filledRecently,
      working,
      replacing,
      paused,
      cleared,
      received,
      processing,
      settled,
      withCeo,
      callsToday,
      callbacks,
      visitsToday,
      vacanciesWeek,
      geofenceToday,
      fieldAgentsToday,
      staff,
      liveSessions,
    ] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['type'], where: { anonymisedAt: null }, _count: { _all: true } }),
      this.prisma.placement.count({ where: { joinedDate: { not: null }, jobSeeker: { referredById: { not: null } } } }),
      this.money.payouts(),
      this.prisma.business.count({ where: { verificationStatus: 'verified', pausedAt: null, anonymisedAt: null } }),
      this.prisma.businessAgreement.findMany({ where: { signedAt: { gte: range.from, lte: range.to } }, distinct: ['businessId'], select: { businessId: true } }),
      this.prisma.businessVisit.count({ where: { geofenceFlag: true, visitedAt: { gte: range.from, lte: range.to } } }),
      this.prisma.business.groupBy({ by: ['locality'], where: { verificationStatus: 'verified', locality: { not: null } }, _count: { _all: true }, orderBy: { _count: { locality: 'desc' } }, take: 1 }),
      this.prisma.vacancy.findMany({ where: { status: 'open' }, select: { headcount: true, createdAt: true, replacementForPlacementId: true } }),
      this.prisma.placement.findMany({ where: { selectedAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } }, select: { selectedAt: true, vacancy: { select: { createdAt: true } } } }),
      this.prisma.placement.count({ where: { status: { in: ['confirmed', 'active'] }, joinedDate: { not: null } } }),
      this.prisma.placement.count({ where: { status: 'dropped_out', guaranteeEndedReason: null } }),
      this.prisma.placement.count({ where: { guaranteeEndedReason: 'two_rejections', status: 'dropped_out' } }),
      this.prisma.placement.count({ where: { status: 'completed' } }),
      this.money.totals(range),
      this.prisma.payment.count({ where: { status: 'processing' } }),
      this.prisma.payment.count({ where: { status: { in: RECEIVED_STATUSES }, OR: [{ confirmedAt: { gte: range.from, lte: range.to } }, { paidAt: { gte: range.from, lte: range.to } }] } }),
      this.prisma.payment.findMany({ where: { type: 'refund', status: 'pending', ceoApprovalReason: { not: null } }, select: { amount: true, placementId: true, sentToCeoAt: true, createdAt: true } }),
      this.prisma.callRecord.findMany({ where: { createdAt: today }, select: { answered: true } }),
      this.prisma.callbackTask.count({ where: { status: { in: ['pending', 'assigned'] } } }),
      this.prisma.businessVisit.count({ where: { visitedAt: today } }),
      this.prisma.vacancy.count({ where: { createdAt: { gte: weekAgo, lte: now }, capturedBy: { role: 'field_agent' } } }),
      this.prisma.businessVisit.count({ where: { visitedAt: today, geofenceFlag: true } }),
      this.prisma.fieldCheckIn.findMany({ where: { checkedInAt: today }, distinct: ['staffId'], select: { staffId: true } }),
      this.prisma.staff.findMany({ where: { status: { not: 'deactivated' } }, select: { status: true, role: true, totpEnabled: true } }),
      this.prisma.staffSession.findMany({ where: { revokedAt: null, endedReason: null, expiresAt: { gt: now } }, distinct: ['staffId'], select: { staffId: true } }),
    ]);
    const management = staff.filter((s) => ['ceo', 'manager', 'finance'].includes(s.role) && s.status === 'active');
    const business = withCeo.filter((w) => w.placementId);
    return {
      jobSeekers: { activeInPool: seekerSummary.activeInPool, nearRefund: seekerSummary.withinFiveDaysOfRefund, atTwoHits: seekerSummary.atTwoOfThreeHits, waitingOnKyc: seekerSummary.waitingOnKyc },
      referrals: {
        partners: partners.reduce((s, p) => s + p._count._all, 0),
        individual: partners.find((p) => p.type === 'individual')?._count._all ?? 0,
        business: partners.find((p) => p.type === 'business')?._count._all ?? 0,
        referredJoined,
        payoutsDueCount: payouts.referralDueCount,
        payoutsDuePaise: payouts.referralDuePaise,
      },
      businesses: { active: activeBiz, signedInRange: signedMonth.length, geofenceFlagged: geofenceVisits, topArea: areas[0]?.locality ?? null },
      vacancies: {
        open: openVac.length,
        positions: openVac.reduce((s, v) => s + v.headcount, 0),
        over15Days: openVac.filter((v) => daysSince(v.createdAt, now) > 15).length,
        replacements: openVac.filter((v) => v.replacementForPlacementId).length,
        averageDaysToFill: average(filledRecently.map((p) => daysSince(p.vacancy.createdAt, p.selectedAt as Date))),
      },
      placements: { working, replacing, paused, cleared },
      payments: { receivedInclGstPaise: received.receivedInclGstPaise, failed: payouts.failedCount, processing, settled },
      refunds: {
        waiting: withCeo.length,
        waitingPaise: sumPaise(withCeo.map((w) => w.amount)),
        businessCount: business.length,
        businessPaise: sumPaise(business.map((w) => w.amount)),
        jobSeekerCount: withCeo.length - business.length,
        jobSeekerPaise: sumPaise(withCeo.filter((w) => !w.placementId).map((w) => w.amount)),
        oldestDays: withCeo.length ? Math.max(...withCeo.map((w) => daysSince(w.sentToCeoAt ?? w.createdAt, now))) : null,
      },
      callCenter: {
        callsToday: callsToday.length,
        connectPercent: percent(callsToday.filter((c) => c.answered).length, callsToday.length),
        missedToReturn: callbacks,
      },
      fieldOps: { visitsToday, vacanciesThisWeek: vacanciesWeek, geofenceToday, agentsInField: fieldAgentsToday.length },
      team: {
        accounts: staff.length,
        twoFactorOnAllManagement: management.every((s) => s.totpEnabled),
        invitesPending: staff.filter((s) => s.status === 'pending_invite').length,
        signedInNow: liveSessions.length,
      },
    };
  }

  async insights(range: DateRange, now: Date = new Date()) {
    const weeks = weekBuckets(range.to, 6);
    const policy = await this.pricing.current();
    const today = { gte: istStartOfDay(istDayKey(now)), lte: now };
    const sixWeeksAgo = weeks[0].from;
    const [receivedRows, refunds, joined, poolTrades, openVac, calls, fieldVacancies, activity] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: { in: RECEIVED_STATUSES }, type: { in: MONEY_IN_TYPES }, OR: [{ confirmedAt: { gte: sixWeeksAgo, lte: range.to } }, { confirmedAt: null, paidAt: { gte: sixWeeksAgo, lte: range.to } }] },
        select: { id: true, type: true, amount: true, confirmedAt: true, paidAt: true, placement: { select: { placementFee: true, gstAmount: true } } },
      }),
      this.prisma.payment.findMany({ where: { type: 'refund', status: { in: RECEIVED_STATUSES }, paidAt: { gte: sixWeeksAgo, lte: range.to } }, select: { amount: true, paidAt: true } }),
      this.prisma.placement.findMany({ where: { joinedDate: { gte: sixWeeksAgo, lte: range.to } }, select: { joinedDate: true } }),
      this.businesses.poolByTrade(),
      this.prisma.vacancy.findMany({ where: { status: 'open' }, select: { tradeSkill: true, headcount: true, locality: true, business: { select: { locality: true } } } }),
      this.prisma.callRecord.findMany({ where: { createdAt: today, staff: { role: 'call_agent' } }, select: { answered: true, staffId: true, staff: { select: { name: true } } } }),
      this.prisma.vacancy.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS), lte: now }, capturedBy: { role: 'field_agent' } },
        select: { capturedByStaffId: true, capturedBy: { select: { name: true } }, locality: true },
      }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, entityType: true, entityCode: true, createdAt: true, actor: { select: { name: true } } } }),
    ]);
    const received = await withBypassCharges(this.prisma, receivedRows);
    const revenueByWeek = weeks.map((w) => {
      const inWeek = received.filter((p) => {
        const at = p.confirmedAt ?? p.paidAt;
        return at && at >= w.from && at <= w.to;
      });
      const refundsInWeek = refunds.filter((p) => p.paidAt && p.paidAt >= w.from && p.paidAt <= w.to);
      return { week: w.start, netPaise: summariseReceived(inWeek, refundsInWeek).netPaise };
    });
    const joinedByWeek = weeks.map((w) => ({ week: w.start, count: joined.filter((p) => p.joinedDate && p.joinedDate >= w.from && p.joinedDate <= w.to).length }));

    const openByTrade = new Map<string, { trade: string; open: number }>();
    for (const v of openVac) {
      const key = v.tradeSkill.toLowerCase();
      const entry = openByTrade.get(key) ?? { trade: v.tradeSkill, open: 0 };
      entry.open += v.headcount;
      openByTrade.set(key, entry);
    }
    const tradeKeys = new Set([...poolTrades.keys(), ...openByTrade.keys()]);
    const supplyDemand = [...tradeKeys]
      .map((k) => ({ trade: openByTrade.get(k)?.trade ?? k.replace(/\b\w/g, (c) => c.toUpperCase()), pool: poolTrades.get(k) ?? 0, open: openByTrade.get(k)?.open ?? 0 }))
      .sort((a, b) => b.pool + b.open - (a.pool + a.open))
      .slice(0, 6);
    const short = supplyDemand.filter((t) => t.open > 0 && t.pool < t.open * 2).map((t) => t.trade);

    const byAgent = new Map<string, { name: string; calls: number; connects: number }>();
    for (const c of calls) {
      if (!c.staffId) continue;
      const entry = byAgent.get(c.staffId) ?? { name: c.staff?.name ?? '', calls: 0, connects: 0 };
      entry.calls += 1;
      if (c.answered) entry.connects += 1;
      byAgent.set(c.staffId, entry);
    }
    const callAgents = [...byAgent.entries()]
      .map(([id, v]) => ({ id, ...v, connectPercent: percent(v.connects, v.calls) }))
      .sort((a, b) => b.connects - a.connects)
      .slice(0, 5);
    const fieldMap = new Map<string, { id: string; name: string; vacancies: number; areas: string[] }>();
    for (const v of fieldVacancies) {
      if (!v.capturedByStaffId) continue;
      const entry = fieldMap.get(v.capturedByStaffId) ?? { id: v.capturedByStaffId, name: v.capturedBy?.name ?? '', vacancies: 0, areas: [] };
      entry.vacancies += 1;
      if (v.locality) entry.areas.push(v.locality);
      fieldMap.set(v.capturedByStaffId, entry);
    }
    const fieldAgents = [...fieldMap.values()]
      .map((f) => ({ id: f.id, name: f.name, vacancies: f.vacancies, topArea: countBy(f.areas, (a) => a)[0]?.name ?? null }))
      .sort((a, b) => b.vacancies - a.vacancies)
      .slice(0, 5);

    return {
      revenueByWeek,
      joinedByWeek,
      supplyDemand,
      shortTrades: short,
      team: { callAgents, fieldAgents },
      openVacanciesByArea: countBy(openVac, (v) => v.locality ?? v.business.locality).slice(0, 6),
      openVacanciesTotal: openVac.length,
      activity: activity.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), actor: a.actor?.name ?? null, action: a.action, entityType: a.entityType, entityCode: a.entityCode })),
      pricing: {
        activationFeePaise: policy.activationFeePaise,
        guaranteeDays: policy.jobSeekerGuaranteeDays,
        placementFeePercent: policy.placementFeePercent,
        gstPercent: policy.gstPercent,
        replacementWindowDays: policy.replacementWindowDays,
        replacementSearchDays: policy.replacementSearchDays,
        referralPayoutPaise: policy.referralPayoutPaise,
        effectiveFrom: policy.effectiveFrom.toISOString(),
      },
    };
  }

  /** Reports (C-Reports): growth, funnel, sources, areas, trades and a cohort. */
  async reports(range: DateRange, now: Date = new Date()) {
    const policy = await this.pricing.current();
    const r = { gte: range.from, lte: range.to };
    const months = monthBuckets(range.to, 5);
    const [totals, before, staffCount, filledInRange, closedInRange, registered, paid, offers, accepted, joined, reached60, still60, monthly, sources, placementsInRange, poolTrades, openVac] =
      await Promise.all([
        this.money.totals(range),
        this.money.totals(previousRange(range)),
        this.prisma.staff.count({ where: { role: { in: ['call_agent', 'field_agent'] }, status: 'active' } }),
        this.prisma.placement.findMany({ where: { selectedAt: r, status: { in: LIVE_PLACEMENT } }, select: { selectedAt: true, vacancy: { select: { createdAt: true } } } }),
        this.prisma.vacancy.count({ where: { status: 'cancelled', updatedAt: r } }),
        this.prisma.jobSeeker.count({ where: { createdAt: r } }),
        this.prisma.jobSeeker.count({ where: { createdAt: r, paymentReceivedAt: { not: null } } }),
        this.prisma.interview.findMany({ where: { offerSentAt: r, status: { in: OFFER_STATUSES } }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } }),
        this.prisma.interview.findMany({ where: { offerSentAt: r, status: { in: ['confirmed', 'completed', 'no_show', 'no_result'] } }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } }),
        this.prisma.placement.count({ where: { joinedDate: r } }),
        this.prisma.placement.count({ where: { replacementNumber: 0, joinedDate: { lte: new Date(now.getTime() - policy.replacementWindowDays * DAY_MS) } } }),
        this.prisma.placement.count({ where: { replacementNumber: 0, status: 'completed' } }),
        Promise.all(months.map((m) => this.money.totals({ from: m.from, to: m.to }).then((t) => ({ month: m.month, netPaise: t.netPaise })))),
        this.prisma.jobSeeker.findMany({ where: { createdAt: r }, select: { heardFrom: true, paymentReceivedAt: true, placements: { select: { placementFee: true, paidAt: true } } } }),
        this.prisma.placement.findMany({ where: { paidAt: r }, select: { placementFee: true, business: { select: { locality: true } } } }),
        this.businesses.poolByTrade(),
        this.prisma.vacancy.findMany({ where: { status: 'open' }, select: { tradeSkill: true, headcount: true } }),
      ]);
    const sourceMap = new Map<string, { source: string; registered: number; paid: number; placed: number; revenuePaise: number }>();
    for (const s of sources) {
      const key = s.heardFrom ?? 'unknown';
      const entry = sourceMap.get(key) ?? { source: key, registered: 0, paid: 0, placed: 0, revenuePaise: 0 };
      entry.registered += 1;
      if (s.paymentReceivedAt) entry.paid += 1;
      const paidPlacements = s.placements.filter((p) => p.paidAt);
      if (paidPlacements.length) entry.placed += 1;
      entry.revenuePaise += sumPaise(paidPlacements.map((p) => p.placementFee));
      sourceMap.set(key, entry);
    }
    const areaMap = new Map<string, { area: string; revenuePaise: number; placements: number }>();
    for (const p of placementsInRange) {
      const area = p.business.locality ?? 'unknown';
      const entry = areaMap.get(area) ?? { area, revenuePaise: 0, placements: 0 };
      entry.revenuePaise += p.placementFee;
      entry.placements += 1;
      areaMap.set(area, entry);
    }
    const openByTrade = new Map<string, number>();
    for (const v of openVac) openByTrade.set(v.tradeSkill, (openByTrade.get(v.tradeSkill) ?? 0) + v.headcount);
    const tradesToRecruit = [...openByTrade.entries()]
      .map(([trade, open]) => ({ trade, open, pool: poolTrades.get(trade.toLowerCase()) ?? 0 }))
      .sort((a, b) => b.open - b.pool - (a.open - a.pool))
      .slice(0, 5);

    // Cohort: job seekers who paid in the month before the period's month — their 30 days are over.
    const cohortMonth = monthBuckets(range.to, 2)[0];
    const cohort = await this.prisma.jobSeeker.findMany({
      where: { paymentReceivedAt: { gte: cohortMonth.from, lte: cohortMonth.to } },
      select: { status: true, paymentReceivedAt: true, placements: { select: { selectedAt: true } }, payments: { where: { type: 'refund', status: { notIn: ['failed', 'rejected', 'reversed'] } }, select: { id: true } } },
    });
    const placedWithin = cohort.filter((c) => c.placements.some((p) => p.selectedAt && c.paymentReceivedAt && p.selectedAt.getTime() - c.paymentReceivedAt.getTime() <= policy.jobSeekerGuaranteeDays * DAY_MS)).length;
    const refunded = cohort.filter((c) => c.payments.length > 0).length;
    const deactivated = cohort.filter((c) => c.status === 'deactivated').length;
    const placementCount = totals.placementCount;
    return {
      kpis: {
        netPaise: totals.netPaise,
        changePercent: changePercent(totals.netPaise, before.netPaise),
        averageFeePaise: placementCount ? Math.round(totals.placementFeePaise / placementCount) : null,
        revenuePerAgentPaise: staffCount ? Math.round(totals.netPaise / staffCount) : null,
        fillRatePercent: percent(filledInRange.length, filledInRange.length + closedInRange),
        averageDaysToFill: average(filledInRange.map((p) => daysSince(p.vacancy.createdAt, p.selectedAt as Date))),
        refundsPercentOfRevenue: percent(totals.refundsPaidPaise, totals.grossPaise),
      },
      totals,
      monthly,
      funnel: {
        registered,
        paid,
        offered: offers.length,
        accepted: accepted.length,
        joined,
        paidPercent: percent(paid, registered),
        offeredPercent: percent(offers.length, paid),
        acceptedPercent: percent(accepted.length, offers.length),
        joinedPercent: percent(joined, accepted.length),
        stillWorkingDay60Percent: percent(still60, reached60),
      },
      sources: [...sourceMap.values()].sort((a, b) => b.registered - a.registered),
      bestAreas: [...areaMap.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 5),
      tradesToRecruit,
      cohort: {
        month: cohortMonth.month,
        size: cohort.length,
        placedWithinGuaranteePercent: percent(placedWithin, cohort.length),
        refundedPercent: percent(refunded, cohort.length),
        deactivatedPercent: percent(deactivated, cohort.length),
        stillLookingPercent: percent(cohort.filter((c) => !ENDED_STATUSES.includes(c.status) && c.payments.length === 0).length, cohort.length),
      },
    };
  }
}
