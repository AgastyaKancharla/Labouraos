import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnTeam } from '../../common/rbac/own-team';
import { DateRange, PAYOUT_DUE_STATUSES, RECEIVED_STATUSES } from '../ceo-portal/ceo-common';
import { NOT_PAID_STATUSES, OFFER_STATUSES } from '../ceo-portal/ceo-job-seekers.service';
import { RefundPriorityService } from '../refund-priority/refund-priority.service';
import { SectionScope, sectionScope } from '../screens-manager/record-sections.service';
import { Actor, TeamLeadScreensService } from './team-lead-screens.service';

/** Placements that count as filled (as on the CEO's pipeline). */
const LIVE_PLACEMENT = ['awaiting_payment', 'confirmed', 'active', 'dropped_out', 'replaced', 'completed', 'guarantee_ended'];

/**
 * The Team Lead's sections (Master Guide rev 194, "Team Lead portal, decided
 * 17 Nov"), his business numbers on T-Home and his "Close to a refund" list
 * (rev 196). "My team" is the Team Lead and every agent of his team
 * (OwnTeam.memberIds); "Not assigned" is records with no owner in his city —
 * Staff.city, the same field a business's account agent is checked against
 * (BusinessVerificationService). An assignment goes to himself or an active
 * call or field agent of his team.
 */
@Injectable()
export class TeamLeadRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly screens: TeamLeadScreensService,
    private readonly priority: RefundPriorityService,
  ) {}

  async scope(actor: Actor): Promise<SectionScope> {
    const members = await this.screens.members(actor); // refuses anyone but a Team Lead
    const [staffIds, me, active] = await Promise.all([
      new OwnTeam(this.prisma).memberIds(actor.id),
      this.prisma.staff.findUnique({ where: { id: actor.id }, select: { city: true } }),
      this.prisma.staff.findMany({ where: { id: { in: members.map((m) => m.id) }, status: 'active' }, select: { id: true } }),
    ]);
    return sectionScope(actor, staffIds, [me?.city ?? 'Bengaluru'], [actor.id, ...active.map((a) => a.id)]);
  }

  /**
   * T-Home "Close to a refund": the team's rows of the shared close-to-refund
   * list (RefundPriorityService, as MG-Pipeline uses it) — names, days left and
   * the agent, counts per bucket; never a rupee figure (the list gives none to
   * a Team Lead). "Remind the agent" uses the Team Lead's own remind endpoint.
   */
  async closeToRefund(actor: Actor) {
    await this.screens.members(actor);
    const near = await this.priority.list(actor, {});
    return {
      windowDays: near.windowDays,
      total: near.totals.count,
      jobSeekers: near.totals.jobSeekers,
      businesses: near.totals.businesses,
      buckets: near.buckets.map((b) => ({ bucket: b.bucket, count: b.count })),
      rows: near.rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        code: r.code,
        name: r.name,
        trade: r.trade,
        daysLeft: r.daysLeft,
        bucket: r.bucket,
        businessName: r.businessName,
        agent: r.agent ? { id: r.agent.id, name: r.agent.name } : null,
      })),
    };
  }

  /**
   * GET /team-lead/pipeline: the team's numbers for a period, as counts only
   * (never rupees). Counted like the CEO's command-center pipeline, limited to
   * the team's records ("My team" filters): the Team Lead and his agents.
   */
  async pipeline(actor: Actor, range: DateRange) {
    const { staffIds, team: w } = await this.scope(actor);
    const r = { gte: range.from, lte: range.to };
    const [
      registered,
      stuck,
      paid,
      registeredPaid,
      interviewed,
      offers,
      accepted,
      joined,
      visits,
      signed,
      vacancies,
      filled,
      dropped,
      partners,
      introduced,
      introducedPaid,
      partnersPaid,
      partnersNotPaid,
    ] = await Promise.all([
      this.prisma.jobSeeker.count({ where: { AND: [w.seeker, { createdAt: r, phoneVerified: true }] } }),
      this.prisma.jobSeeker.count({ where: { AND: [w.seeker, { createdAt: r, status: { in: NOT_PAID_STATUSES } }] } }),
      this.prisma.jobSeeker.count({ where: { AND: [w.seeker, { paymentReceivedAt: r }] } }),
      this.prisma.jobSeeker.count({ where: { AND: [w.seeker, { createdAt: r, phoneVerified: true, paymentReceivedAt: { not: null } }] } }),
      this.prisma.interview.findMany({ where: { AND: [w.interview, { slotStartsAt: r, status: { in: ['completed', 'no_result'] } }] }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } }),
      this.prisma.interview.findMany({ where: { AND: [w.interview, { offerSentAt: r, status: { in: OFFER_STATUSES } }] }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } }),
      this.prisma.interview.findMany({ where: { AND: [w.interview, { offerSentAt: r, status: { in: ['confirmed', 'completed', 'no_show', 'no_result'] } }] }, distinct: ['jobSeekerId'], select: { jobSeekerId: true } }),
      this.prisma.placement.count({ where: { AND: [w.placement, { joinedDate: r }] } }),
      this.prisma.businessVisit.count({ where: { staffId: { in: staffIds }, visitedAt: r } }),
      this.prisma.businessAgreement.findMany({ where: { signedAt: r, business: w.business }, distinct: ['businessId'], select: { businessId: true } }),
      this.prisma.vacancy.aggregate({ where: { AND: [w.vacancy, { createdAt: r }] }, _count: { _all: true }, _sum: { headcount: true } }),
      this.prisma.placement.count({ where: { AND: [w.placement, { selectedAt: r, status: { in: LIVE_PLACEMENT } }] } }),
      this.prisma.replacementClaim.count({ where: { reportedAt: r, placement: w.placement } }),
      this.prisma.referral.count({ where: { AND: [w.referral, { createdAt: r, anonymisedAt: null }] } }),
      this.prisma.jobSeeker.count({ where: { createdAt: r, referredBy: w.referral } }),
      this.prisma.jobSeeker.count({ where: { createdAt: r, referredBy: w.referral, paymentReceivedAt: { not: null } } }),
      this.prisma.referral.count({
        where: { AND: [w.referral, { payments: { some: { type: 'referral_payout', status: { in: RECEIVED_STATUSES }, OR: [{ confirmedAt: r }, { paidAt: r }] } } }] },
      }),
      this.prisma.referral.count({
        where: { AND: [w.referral, { payments: { some: { type: 'referral_payout', status: { in: [...PAYOUT_DUE_STATUSES, 'failed'] } } } }] },
      }),
    ]);
    return {
      period: { fromDate: range.from.toISOString(), toDate: range.to.toISOString() },
      jobSeekers: {
        registered,
        stuckBeforePaying: stuck,
        paid,
        notPaid: Math.max(0, registered - registeredPaid),
        interviewed: interviewed.length,
        offered: offers.length,
        accepted: accepted.length,
        joined,
      },
      businesses: {
        fieldVisits: visits,
        signedUp: signed.length,
        vacanciesAdded: vacancies._count._all,
        openings: vacancies._sum.headcount ?? 0,
        filled,
        droppedOut: dropped,
      },
      referralPartners: {
        registered: partners,
        introduced,
        introducedPaid,
        partnersPaid,
        /** Right now, not for the period: partners with a reward due or failed. */
        partnersNotPaid,
      },
    };
  }
}
