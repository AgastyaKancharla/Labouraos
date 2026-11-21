import { BadRequestException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { codedError } from '../../common/http/coded-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { REVISIT_OUTCOMES } from './field-visit.constants';
import { DAY_MS, FieldVisitClock, istDateKey, istDayStart } from './field-visit-clock';

/** The pieces of a field agent's open work that move on leave (21 Nov). */
export const HANDOVER_KINDS = ['visit_assignment', 'interview', 'revisit', 'joining'] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];

/** Where the work goes: one teammate, or spread across the team (fewest open items first). */
export type HandoverTarget = string | 'spread';

export interface HandoverOptions {
  reason: string;
  /** Who decided (the Team Lead approving the leave, or the system for a no-show); null = the system. */
  actorId?: string | null;
  leaveRequestId?: string | null;
  /** The last IST day the agent is away (leave end): revisits and joinings due by then move. Null = all open ones. */
  until?: Date | null;
}

export interface HandoverResult {
  fromStaffId: string;
  moved: Array<{ kind: HandoverKind; recordId: string; toStaffId: string }>;
  /** Pieces nobody could take (no teammate on shift): they stay with the agent. */
  left: Array<{ kind: HandoverKind; recordId: string }>;
  /** The picked teammate is on approved leave himself (a warning, not a refusal). */
  toOnLeave: string[];
}

type Db = Pick<PrismaService, 'fieldHandover' | 'leaveRequest'>;

/** Live handover rows of one kind that reached this agent. */
export async function handedTo(prisma: Db, staffId: string, kind: HandoverKind): Promise<Array<{ recordId: string; fromStaffId: string; businessId: string | null }>> {
  return prisma.fieldHandover.findMany({
    where: { toStaffId: staffId, kind, endedAt: null },
    select: { recordId: true, fromStaffId: true, businessId: true },
  });
}

/** Record ids of one kind this agent handed away (live rows): they leave his lists. */
export async function handedAwayIds(prisma: Db, staffId: string, kind: HandoverKind): Promise<Set<string>> {
  const rows = await prisma.fieldHandover.findMany({
    where: { fromStaffId: staffId, kind, endedAt: null },
    select: { recordId: true },
  });
  return new Set(rows.map((row) => row.recordId));
}

/** True when this agent covers some open work of the business (a live handover row for it). */
export async function coversBusiness(prisma: Db, staffId: string, businessId: string): Promise<boolean> {
  const row = await prisma.fieldHandover.findFirst({
    where: { toStaffId: staffId, businessId, endedAt: null },
    select: { id: true },
  });
  return Boolean(row);
}

/** Staff on approved leave on this IST day (a whole or half day). */
export async function onApprovedLeave(prisma: Db, staffIds: string[], dateKey: string): Promise<Set<string>> {
  if (!staffIds.length) return new Set();
  const day = new Date(`${dateKey}T00:00:00.000Z`);
  const rows = await prisma.leaveRequest.findMany({
    where: { staffId: { in: staffIds }, status: 'approved', overturnedAt: null, fromDate: { lte: day }, toDate: { gte: day } },
    select: { staffId: true },
  });
  return new Set(rows.map((row) => row.staffId));
}

/**
 * Leave handover for Laboura Field (Master Guide rev 202, "Assign and leave",
 * 21 Nov): on approved leave (or a no-show) a field agent's open visits,
 * interviews to attend, revisits and joinings move to the teammate the Team
 * Lead picks, or are spread across the team (the active field agent of the
 * same team with the fewest open items, nobody on leave). Builder B's leave
 * approval calls handOver(); a Team Lead can also run it by hand.
 *
 * The original records keep who did the work (visits, bookings and placements
 * count for whoever did them); a FieldHandover row says who covers each piece
 * now. Visit assignments are reassigned outright. Every move is audited.
 */
@Injectable()
export class FieldHandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: FieldVisitClock,
  ) {}

  async handOver(fromStaffId: string, to: HandoverTarget, options: HandoverOptions): Promise<HandoverResult> {
    const reason = typeof options.reason === 'string' ? options.reason.trim() : '';
    if (!reason) throw new BadRequestException('A reason is required for the handover');
    const now = this.clock.now();
    const from = await this.prisma.staff.findUnique({ where: { id: fromStaffId }, select: { id: true, code: true, role: true, city: true, teamLeadId: true, reportsToId: true } });
    if (!from) throw new NotFoundException('Field agent not found');
    if (from.role !== 'field_agent') return { fromStaffId, moved: [], left: [], toOnLeave: [] };

    const todayKey = istDateKey(now);
    const pool = await this.pickPool(from, to, todayKey);
    const pieces = await this.openPieces(fromStaffId, now, options.until ?? null);
    const result: HandoverResult = { fromStaffId, moved: [], left: [], toOnLeave: pool.onLeave };
    const load = new Map(pool.ids.map((id) => [id, 0]));
    for (const id of pool.ids) load.set(id, await this.openItemCount(id));

    for (const piece of pieces) {
      const target = pool.ids.length
        ? [...load.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0][0]
        : null;
      if (!target) {
        result.left.push({ kind: piece.kind, recordId: piece.recordId });
        continue;
      }
      await this.movePiece(piece, fromStaffId, target, reason, options, now);
      load.set(target, (load.get(target) ?? 0) + 1);
      result.moved.push({ kind: piece.kind, recordId: piece.recordId, toStaffId: target });
    }

    await this.audit.log({
      actorId: options.actorId ?? fromStaffId,
      action: 'field_agent.work_handed_over',
      entityType: 'staff',
      entityCode: from.code,
      after: {
        to: to === 'spread' ? 'spread' : to,
        moved: result.moved.length,
        left: result.left.length,
        leaveRequestId: options.leaveRequestId ?? null,
        toOnLeave: result.toOnLeave,
      },
      changedFields: ['handover'],
      reason,
      city: from.city,
    });
    return result;
  }

  /**
   * One visit assignment moved to another field agent (Team Lead, Manager or
   * CEO, 21 Nov "a visit can be reassigned"). Assigning to someone on approved
   * leave today needs confirmLeave (the warning), else 409 AGENT_ON_LEAVE.
   */
  async reassign(
    assignmentId: string,
    actor: { id: string; role: string },
    body: { assignedStaffId?: unknown; reason?: unknown; confirmLeave?: unknown },
  ) {
    const assignedStaffId = typeof body?.assignedStaffId === 'string' ? body.assignedStaffId : '';
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!assignedStaffId) throw new BadRequestException('assignedStaffId is required');
    if (!reason) throw new BadRequestException('Say why the visit moves');
    const assignment = await this.prisma.visitAssignment.findUnique({ where: { id: assignmentId }, include: { business: { select: { id: true, code: true, name: true, city: true } } } });
    if (!assignment) throw new NotFoundException('Visit assignment not found');
    if (assignment.status !== 'assigned' || !assignment.assignedStaffId) {
      throw new BadRequestException('Only an assigned visit that is not done can be reassigned');
    }
    if (assignment.assignedStaffId === assignedStaffId) throw new BadRequestException('The visit is already with this field agent');
    const agent = await this.prisma.staff.findUnique({ where: { id: assignedStaffId }, select: { id: true, code: true, role: true, status: true, city: true, lockedByStaffId: true, lockedUntil: true } });
    if (!agent || agent.role !== 'field_agent' || agent.status !== 'active') throw new BadRequestException('Pick an active field agent');
    if (agent.lockedByStaffId || (agent.lockedUntil && agent.lockedUntil > this.clock.now())) throw new BadRequestException('This field agent is locked');
    if (agent.city !== assignment.business.city) throw new BadRequestException('The field agent must work in the business city');
    await this.assertMayMove(actor, [assignment.assignedStaffId, assignedStaffId]);
    const leave = await onApprovedLeave(this.prisma, [assignedStaffId], istDateKey(this.clock.now()));
    if (leave.has(assignedStaffId) && body?.confirmLeave !== true) {
      // 409 AGENT_ON_LEAVE: the warning; send confirmLeave: true to go ahead.
      throw codedError(HttpStatus.CONFLICT, 'AGENT_ON_LEAVE', 'This field agent is on approved leave today. Assign anyway?');
    }
    const now = this.clock.now();
    await this.movePiece(
      { kind: 'visit_assignment', recordId: assignment.id, businessId: assignment.businessId },
      assignment.assignedStaffId,
      assignedStaffId,
      reason,
      { reason, actorId: actor.id },
      now,
    );
    return {
      assignmentId: assignment.id,
      assignedStaffId,
      onLeave: leave.has(assignedStaffId),
    };
  }

  /** A Team Lead, Manager or CEO runs the handover by hand (also used where no leave request exists). */
  async handOverByHand(actor: { id: string; role: string }, body: { fromStaffId?: unknown; toStaffId?: unknown; reason?: unknown }) {
    const fromStaffId = typeof body?.fromStaffId === 'string' ? body.fromStaffId : '';
    const toRaw = typeof body?.toStaffId === 'string' && body.toStaffId ? body.toStaffId : 'spread';
    if (!fromStaffId) throw new BadRequestException('fromStaffId is required');
    await this.assertMayMove(actor, toRaw === 'spread' ? [fromStaffId] : [fromStaffId, toRaw]);
    return this.handOver(fromStaffId, toRaw, { reason: typeof body?.reason === 'string' ? body.reason : '', actorId: actor.id });
  }

  /** Open assigned visits a Team Lead (own team), Manager (own line) or the CEO can move, with who is on leave today. */
  async openAssignments(actor: { id: string; role: string }) {
    const now = this.clock.now();
    const staffIds = await this.visibleFieldAgents(actor);
    const rows = await this.prisma.visitAssignment.findMany({
      where: { status: 'assigned', ...(staffIds ? { assignedStaffId: { in: staffIds } } : { assignedStaffId: { not: null } }) },
      orderBy: { createdAt: 'asc' },
      take: 300,
      include: {
        business: { select: { id: true, code: true, name: true, locality: true } },
        assignedStaff: { select: { id: true, code: true, name: true } },
      },
    });
    const agents = await this.prisma.staff.findMany({
      where: { role: 'field_agent', status: 'active', ...(staffIds ? { id: { in: staffIds } } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    const leave = await onApprovedLeave(this.prisma, agents.map((a) => a.id), istDateKey(now));
    return {
      assignments: rows.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        createdAt: row.createdAt.toISOString(),
        requestedFor: row.requestedFor?.toISOString() ?? null,
        business: row.business,
        assignedStaff: row.assignedStaff,
        assignedStaffOnLeave: row.assignedStaffId ? leave.has(row.assignedStaffId) : false,
      })),
      agents: agents.map((a) => ({ ...a, onLeaveToday: leave.has(a.id) })),
    };
  }

  // ------------------------------------------------------------------ helpers

  private async visibleFieldAgents(actor: { id: string; role: string }): Promise<string[] | null> {
    if (actor.role === 'ceo') return null;
    if (actor.role === 'team_lead') {
      const rows = await this.prisma.staff.findMany({
        where: { role: 'field_agent', OR: [{ teamLeadId: actor.id }, { reportsToId: actor.id }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    }
    if (actor.role === 'manager') {
      const leads = await this.prisma.staff.findMany({
        where: { role: 'team_lead', OR: [{ reportsToId: actor.id }, { teamLeadId: actor.id }] },
        select: { id: true },
      });
      const leadIds = leads.map((l) => l.id);
      const rows = await this.prisma.staff.findMany({
        where: { role: 'field_agent', OR: [{ reportsToId: actor.id }, { teamLeadId: { in: leadIds } }, { reportsToId: { in: leadIds } }] },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    }
    return [];
  }

  private async assertMayMove(actor: { id: string; role: string }, staffIds: string[]): Promise<void> {
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) throw new ForbiddenException('Only a Team Lead, Manager or the CEO can move field work');
    const visible = await this.visibleFieldAgents(actor);
    if (visible === null) return;
    for (const id of staffIds) {
      if (!visible.includes(id)) {
        throw new ForbiddenException(actor.role === 'team_lead' ? 'Team Leads move work only between their own field agents' : 'This field agent is outside your reporting line');
      }
    }
  }

  /** Teammates who can take the work: the named one, or the same team's active field agents not on leave today. */
  private async pickPool(from: { id: string; teamLeadId: string | null; reportsToId: string | null; city: string }, to: HandoverTarget, todayKey: string) {
    if (to !== 'spread') {
      if (to === from.id) throw new BadRequestException('Pick another field agent');
      const agent = await this.prisma.staff.findUnique({ where: { id: to }, select: { id: true, role: true, status: true, city: true } });
      if (!agent || agent.role !== 'field_agent' || agent.status !== 'active') throw new BadRequestException('Pick an active field agent');
      if (agent.city !== from.city) throw new BadRequestException('The field agent must work in the same city');
      const leave = await onApprovedLeave(this.prisma, [agent.id], todayKey);
      return { ids: [agent.id], onLeave: leave.has(agent.id) ? [agent.id] : [] };
    }
    const lead = from.reportsToId ?? from.teamLeadId;
    if (!lead) return { ids: [] as string[], onLeave: [] as string[] };
    const team = await this.prisma.staff.findMany({
      where: {
        role: 'field_agent', status: 'active', city: from.city, id: { not: from.id },
        lockedByStaffId: null,
        OR: [{ teamLeadId: lead }, { reportsToId: lead }],
      },
      select: { id: true, lockedUntil: true },
    });
    const now = this.clock.now();
    const free = team.filter((t) => !t.lockedUntil || t.lockedUntil <= now).map((t) => t.id);
    const leave = await onApprovedLeave(this.prisma, free, todayKey);
    return { ids: free.filter((id) => !leave.has(id)), onLeave: [] as string[] };
  }

  /** Open visits and live handover rows on this agent: the "fewest open items" count. */
  private async openItemCount(staffId: string): Promise<number> {
    const [visits, covered] = await Promise.all([
      this.prisma.visitAssignment.count({ where: { assignedStaffId: staffId, status: 'assigned' } }),
      this.prisma.fieldHandover.count({ where: { toStaffId: staffId, endedAt: null, kind: { in: ['revisit', 'joining', 'interview'] } } }),
    ]);
    return visits + covered;
  }

  /** Everything open on the agent that moves, oldest first. */
  private async openPieces(staffId: string, now: Date, until: Date | null): Promise<Array<{ kind: HandoverKind; recordId: string; businessId: string | null }>> {
    const pieces: Array<{ kind: HandoverKind; recordId: string; businessId: string | null }> = [];
    const dayStart = istDayStart(now);
    const lastDay = until ? istDateKey(until) : null;
    const byEnd = lastDay ? new Date(new Date(`${lastDay}T00:00:00.000Z`).getTime() + DAY_MS) : null;

    const assignments = await this.prisma.visitAssignment.findMany({
      where: { assignedStaffId: staffId, status: 'assigned' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, businessId: true },
    });
    for (const a of assignments) pieces.push({ kind: 'visit_assignment', recordId: a.id, businessId: a.businessId });

    const away = await handedAwayIds(this.prisma, staffId, 'interview');
    const interviews = await this.prisma.interview.findMany({
      where: {
        proposedByStaffId: staffId, agentWillAttend: true, status: { in: ['offered', 'confirmed'] },
        candidateArrivedAt: null, resultRecordedAt: null,
        slotStartsAt: { gte: dayStart, ...(byEnd ? { lt: byEnd } : {}) },
      },
      orderBy: { slotStartsAt: 'asc' },
      select: { id: true, businessId: true },
    });
    const attended = new Set(
      (await this.prisma.visitAssignment.findMany({
        where: { relatedType: 'interview', relatedId: { in: interviews.map((i) => i.id) }, status: 'assigned' },
        select: { relatedId: true },
      })).map((a) => a.relatedId),
    );
    for (const i of interviews) {
      if (away.has(i.id) || attended.has(i.id)) continue;
      pieces.push({ kind: 'interview', recordId: i.id, businessId: i.businessId });
    }

    const revisitsAway = await handedAwayIds(this.prisma, staffId, 'revisit');
    const revisits = await this.prisma.businessVisit.findMany({
      where: {
        staffId, outcome: { in: [...REVISIT_OUTCOMES] }, revisitOn: { not: null, ...(lastDay ? { lte: new Date(`${lastDay}T00:00:00.000Z`) } : {}) },
      },
      orderBy: { visitedAt: 'desc' },
      take: 200,
      select: { id: true, businessId: true, visitedAt: true, assignmentId: true },
    });
    const seen = new Set<string>();
    for (const v of revisits) {
      const shopKey = v.businessId ?? v.id;
      if (seen.has(shopKey)) continue;
      seen.add(shopKey);
      if (revisitsAway.has(v.id)) continue;
      // A verification visit still open moves as its assignment.
      if (v.assignmentId && assignments.some((a) => a.id === v.assignmentId)) continue;
      const later = v.businessId
        ? await this.prisma.businessVisit.findFirst({ where: { businessId: v.businessId, visitedAt: { gt: v.visitedAt } }, select: { id: true } })
        : await this.prisma.businessVisit.findFirst({ where: { revisitOfVisitId: v.id }, select: { id: true } });
      if (later) continue;
      pieces.push({ kind: 'revisit', recordId: v.id, businessId: v.businessId });
    }

    const joiningsAway = await handedAwayIds(this.prisma, staffId, 'joining');
    const joinings = await this.prisma.placement.findMany({
      where: {
        joinedDate: null, joiningDate: { not: null, ...(byEnd ? { lt: byEnd } : {}) }, status: { in: ['confirmed', 'active'] },
        OR: [{ createdByStaffId: staffId }, { business: { accountAgentId: staffId } }],
      },
      orderBy: { joiningDate: 'asc' },
      take: 200,
      select: { id: true, businessId: true },
    });
    for (const p of joinings) if (!joiningsAway.has(p.id)) pieces.push({ kind: 'joining', recordId: p.id, businessId: p.businessId });
    return pieces;
  }

  private async movePiece(
    piece: { kind: HandoverKind; recordId: string; businessId: string | null },
    fromStaffId: string,
    toStaffId: string,
    reason: string,
    options: HandoverOptions,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.fieldHandover.updateMany({ where: { kind: piece.kind, recordId: piece.recordId, endedAt: null }, data: { endedAt: now } });
      if (piece.kind === 'visit_assignment') {
        const moved = await tx.visitAssignment.updateMany({
          where: { id: piece.recordId, status: 'assigned', assignedStaffId: fromStaffId },
          data: { assignedStaffId: toStaffId, assignedByStaffId: options.actorId ?? null },
        });
        if (moved.count !== 1) throw new BadRequestException('The visit changed meanwhile: open the list again');
      }
      if (piece.kind === 'interview') {
        // The covering agent attends: an attendance visit of his own (the interview keeps who booked it).
        await tx.visitAssignment.create({
          data: {
            businessId: piece.businessId!,
            purpose: 'interview_attendance',
            relatedType: 'interview',
            relatedId: piece.recordId,
            assignedStaffId: toStaffId,
            assignedByStaffId: options.actorId ?? null,
            status: 'assigned',
          },
        });
      }
      await tx.fieldHandover.create({
        data: {
          kind: piece.kind,
          recordId: piece.recordId,
          businessId: piece.businessId,
          fromStaffId,
          toStaffId,
          reason,
          leaveRequestId: options.leaveRequestId ?? null,
          createdByStaffId: options.actorId ?? null,
        },
      });
    });
    await this.audit.log({
      actorId: options.actorId ?? fromStaffId,
      action: piece.kind === 'visit_assignment' ? 'business.visit_assignment_reassigned' : 'field_agent.work_piece_handed_over',
      entityType: piece.kind === 'visit_assignment' ? 'visit_assignment' : piece.kind,
      entityCode: piece.recordId,
      before: { staffId: fromStaffId },
      after: { staffId: toStaffId, leaveRequestId: options.leaveRequestId ?? null },
      changedFields: piece.kind === 'visit_assignment' ? ['assignedStaffId', 'assignedByStaffId'] : ['coveredByStaffId'],
      reason,
    });
  }
}
