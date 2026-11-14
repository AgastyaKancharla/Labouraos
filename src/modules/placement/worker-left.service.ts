import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ACCEPT_CLAIM_REASONS, REJECT_CLAIM_REASONS } from './claim-reasons';
import { addDays, istDayOf, istDayStart } from './claim-dates';
import { refileRule, rejectionCodeOf } from './claim-refile';
import { PlacementService } from './placement.service';

/** Who may report that a placed worker left (same list as PlacementService.reportClaim). */
export const WORKER_LEFT_ROLES = ['field_agent', 'call_agent', 'team_lead', 'manager', 'ceo'] as const;

/**
 * "Accepted but never joined" is not offered here: this form is reached only
 * after joining was recorded (a worker who did not come is FA11's "He didn't
 * come"). The server still accepts the reason.
 */
const FORM_COVERED_REASONS = ACCEPT_CLAIM_REASONS.filter((r) => r !== 'never_joined');

export type WorkerLeftBlocked = 'not_active' | 'not_joined' | 'open_claim' | 'not_again';

interface Actor {
  id: string;
  role: string;
}

/**
 * "Report worker left" (the replacement claim) for the new screens: the CEO
 * placement page, the Manager and Team Lead request screens, the call agent
 * console's search and Laboura Field's joining screen. This only reads what
 * the form needs; the claim itself is still POST /placements/:id/claims
 * (PlacementService.reportClaim), which keeps every rule: active placement,
 * worker left inside the guarantee window and not in the future, an answered
 * call with the owner, a reason from the closed list, auto-rejection when
 * late, unpaid or not covered.
 *
 * Never returns a phone number or any money (Managers never see money).
 */
@Injectable()
export class WorkerLeftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly placements: PlacementService,
  ) {}

  private async actor(actorId: string): Promise<Actor> {
    const staff = await this.prisma.staff.findUnique({ where: { id: actorId }, select: { id: true, role: true } });
    if (!staff) throw new NotFoundException(`Staff '${actorId}' not found`);
    if (!(WORKER_LEFT_ROLES as readonly string[]).includes(staff.role)) {
      throw new ForbiddenException(`Role '${staff.role}' cannot report replacement claims`);
    }
    return staff;
  }

  /**
   * Active placements to report on, for the Manager / Team Lead / call agent
   * finder: by placement code, worker name or business name, within what the
   * person may see (the same scope as GET /placements). Field agents report
   * from the placement itself in Laboura Field.
   */
  async search(actorId: string, q: string | undefined) {
    const actor = await this.actor(actorId);
    if (actor.role === 'field_agent') throw new ForbiddenException('Field agents report a worker who left from the placement in Laboura Field');
    const text = (q ?? '').trim();
    if (text.length < 2) throw new BadRequestException('Type at least 2 letters of the placement ID, worker or business');
    const scope = await this.placements.placementListScope(actor);
    const match: Prisma.PlacementWhereInput = {
      OR: [
        { code: { contains: text, mode: 'insensitive' } },
        { jobSeeker: { name: { contains: text, mode: 'insensitive' } } },
        { business: { name: { contains: text, mode: 'insensitive' } } },
      ],
    };
    const rows = await this.prisma.placement.findMany({
      where: { AND: [scope, match, { status: 'active' }] },
      select: {
        id: true,
        code: true,
        joinedDate: true,
        jobSeeker: { select: { name: true } },
        business: { select: { name: true } },
      },
      orderBy: { joinedDate: 'desc' },
      take: 20,
    });
    return rows.map((p) => ({ id: p.id, code: p.code, workerName: p.jobSeeker?.name ?? null, businessName: p.business?.name ?? null, joinedDate: p.joinedDate }));
  }

  /** What the "Report worker left" form needs for one placement. */
  async form(placementIdOrCode: string, actorId: string, now = new Date()) {
    const actor = await this.actor(actorId);
    const placement = await this.prisma.placement.findFirst({
      where: { OR: [{ id: placementIdOrCode }, { code: placementIdOrCode }] },
      select: {
        id: true,
        code: true,
        status: true,
        joinedDate: true,
        rootPlacementId: true,
        businessId: true,
        jobSeeker: { select: { name: true } },
        business: { select: { id: true, name: true, accountAgentId: true } },
        replacementClaims: {
          select: {
            code: true,
            reportedAt: true,
            decisionDueAt: true,
            workerLeftOn: true,
            reason: true,
            decision: true,
            decisionReason: true,
            rejectionCode: true,
            decidedByStaffId: true,
            overruledByStaffId: true,
            decidedAt: true,
            decidedByStaff: { select: { name: true, role: true } },
            overruledByStaff: { select: { name: true, role: true } },
          },
          orderBy: { reportedAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!placement) throw new NotFoundException(`Placement '${placementIdOrCode}' not found`);
    if (actor.role === 'field_agent' && placement.business?.accountAgentId !== actor.id) {
      throw new ForbiddenException('Field agents may only report claims for their account businesses');
    }
    await this.placements.assertClaimScope(actor, placement);

    // The guarantee counts from the first worker's joining day; this worker
    // cannot have left before his own joining day (a replacement joined later).
    const root = placement.rootPlacementId
      ? await this.prisma.placement.findUnique({ where: { id: placement.rootPlacementId }, select: { joinedDate: true } })
      : placement;
    const rootJoined = root?.joinedDate ?? null;
    const ownJoined = placement.joinedDate ?? rootJoined;
    const policy = await this.pricing.current();
    const lastDay = rootJoined ? addDays(istDayOf(rootJoined)!, policy.replacementWindowDays) : null;
    const guaranteeEndsAt = lastDay ? istDayStart(addDays(lastDay, 1)) : null;
    const today = istDayOf(now)!;
    const waiting = placement.replacementClaims.find((c) => c.decision === null) ?? null;
    const openClaim = waiting ? { code: waiting.code, reportedAt: waiting.reportedAt, decisionDueAt: waiting.decisionDueAt } : null;
    // Earlier claims and whether this person may report again (claim-refile.ts).
    const refile = refileRule(placement.replacementClaims, actor.role, today, policy.claimReportDays);

    let blocked: WorkerLeftBlocked | null = null;
    if (placement.status !== 'active') blocked = 'not_active';
    else if (!rootJoined) blocked = 'not_joined';
    else if (openClaim) blocked = 'open_claim';
    else if (!refile.allowed) blocked = 'not_again';

    // Calls the claim may rest on: answered calls with this business since this
    // worker joined, made by someone whose calls this person may use, not
    // already another claim's evidence. The form keeps only those made on or
    // after the leaving date the person picks.
    const staffIds = await this.placements.claimCallStaffIds(actor);
    const calls = await this.prisma.callRecord.findMany({
      where: {
        subjectType: 'business',
        subjectId: placement.businessId,
        answered: true,
        callRecordClaims: { none: {} },
        createdAt: { ...(ownJoined ? { gte: istDayStart(istDayOf(ownJoined)!) } : {}), lte: now },
        ...(staffIds ? { staffId: { in: staffIds } } : {}),
      },
      select: { id: true, code: true, answeredAt: true, startedAt: true, createdAt: true, durationSec: true, staff: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      placement: {
        id: placement.id,
        code: placement.code,
        status: placement.status,
        workerName: placement.jobSeeker?.name ?? null,
        businessId: placement.businessId,
        businessName: placement.business?.name ?? null,
        joinedDate: ownJoined,
      },
      guarantee: {
        windowDays: policy.replacementWindowDays,
        endsAt: guaranteeEndsAt,
        reportWithinDays: policy.claimReportDays,
        decisionHours: policy.claimDecisionHours,
      },
      /** Indian days the worker may be said to have left on: from his own joining day to today or the guarantee's last day. */
      leftOnEarliest: ownJoined ? istDayOf(ownJoined) : null,
      leftOnLatest: lastDay && lastDay < today ? lastDay : today,
      canReport: blocked === null,
      blocked,
      openClaim,
      /** Why reporting again is or isn't allowed after a rejection (null when nothing was rejected). */
      reportAgain: refile.message ? { allowed: refile.allowed, who: refile.who, message: refile.message, until: refile.windowEndsOn } : null,
      previousClaims: placement.replacementClaims
        .filter((c) => c.decision !== null)
        .map((c) => ({
          code: c.code,
          reportedAt: c.reportedAt,
          workerLeftOn: c.workerLeftOn,
          reason: c.reason,
          decision: c.decision,
          decisionReason: c.decisionReason,
          rejectionCode: rejectionCodeOf(c),
          decidedBy: (c.overruledByStaff ?? c.decidedByStaff)?.name ?? null,
          decidedAt: c.decidedAt,
        })),
      ownerCalls: calls.map((c) => ({ id: c.id, code: c.code, at: c.answeredAt ?? c.startedAt ?? c.createdAt, durationSec: c.durationSec, by: c.staff?.name ?? null })),
      reasons: { covered: [...FORM_COVERED_REASONS], notCovered: [...REJECT_CLAIM_REASONS] },
    };
  }
}
