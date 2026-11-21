import { BadRequestException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { codedError } from '../../common/http/coded-error';
import { OwnTeam, teamLeadOf } from '../../common/rbac/own-team';
import { ReportingScopeService } from '../staff/reporting-scope.service';
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

type Db = Pick<PrismaService, 'fieldHandover' | 'leaveRequest' | 'visitAssignment' | 'interview' | 'businessVisit' | 'placement'>;

type HandoverRow = { id: string; kind: string; recordId: string; fromStaffId: string; toStaffId: string; businessId: string | null; until: Date | null };

/** Is the handed-over piece finished (so the cover's row ends)? */
async function pieceDone(prisma: Db, row: HandoverRow): Promise<boolean> {
  switch (row.kind) {
    case 'visit_assignment': {
      const a = await prisma.visitAssignment.findUnique({ where: { id: row.recordId }, select: { status: true, assignedStaffId: true } });
      return !a || a.status !== 'assigned' || a.assignedStaffId !== row.toStaffId;
    }
    case 'interview': {
      const i = await prisma.interview.findUnique({ where: { id: row.recordId }, select: { status: true, candidateArrivedAt: true, resultRecordedAt: true } });
      return !i || Boolean(i.candidateArrivedAt) || Boolean(i.resultRecordedAt) || !['offered', 'confirmed'].includes(i.status);
    }
    case 'revisit': {
      const v = await prisma.businessVisit.findUnique({ where: { id: row.recordId }, select: { id: true, businessId: true, visitedAt: true } });
      if (!v) return true;
      const later = v.businessId
        ? await prisma.businessVisit.findFirst({ where: { businessId: v.businessId, visitedAt: { gt: v.visitedAt } }, select: { id: true } })
        : await prisma.businessVisit.findFirst({ where: { revisitOfVisitId: v.id }, select: { id: true } });
      return Boolean(later);
    }
    case 'joining': {
      const p = await prisma.placement.findUnique({ where: { id: row.recordId }, select: { joinedDate: true, status: true } });
      return !p || Boolean(p.joinedDate) || !['confirmed', 'active'].includes(p.status);
    }
    default:
      return true;
  }
}

/**
 * Live handover rows matching `where` (21 Nov review): a row ends when its `until` (the day after
 * the leave's last day) has passed, or when the piece is finished — those rows are closed here
 * (endedAt) and left out.
 */
export async function liveHandovers(
  prisma: Db,
  where: { toStaffId?: string; fromStaffId?: string; kind?: HandoverKind | { in: HandoverKind[] }; recordId?: string; businessId?: string },
  now: Date,
): Promise<HandoverRow[]> {
  const rows = await prisma.fieldHandover.findMany({
    where: { ...where, endedAt: null },
    select: { id: true, kind: true, recordId: true, fromStaffId: true, toStaffId: true, businessId: true, until: true },
    take: 500,
  });
  const live: HandoverRow[] = [];
  const ended: string[] = [];
  for (const row of rows) {
    if ((row.until && row.until.getTime() <= now.getTime()) || (await pieceDone(prisma, row))) ended.push(row.id);
    else live.push(row);
  }
  if (ended.length) await prisma.fieldHandover.updateMany({ where: { id: { in: ended }, endedAt: null }, data: { endedAt: now } });
  return live;
}

/** Live handover rows of one kind that reached this agent. */
export async function handedTo(prisma: Db, staffId: string, kind: HandoverKind, now: Date): Promise<Array<{ recordId: string; fromStaffId: string; businessId: string | null }>> {
  return liveHandovers(prisma, { toStaffId: staffId, kind }, now);
}

/** Record ids of one kind this agent handed away (live rows): they leave his lists. */
export async function handedAwayIds(prisma: Db, staffId: string, kind: HandoverKind, now: Date): Promise<Set<string>> {
  const rows = await liveHandovers(prisma, { fromStaffId: staffId, kind }, now);
  return new Set(rows.map((row) => row.recordId));
}

/** True when this agent covers this one handed-over piece (21 Nov review: only that piece's actions). */
export async function coversPiece(prisma: Db, staffId: string, kind: HandoverKind, recordId: string, now: Date): Promise<boolean> {
  return (await liveHandovers(prisma, { toStaffId: staffId, kind, recordId }, now)).length > 0;
}

/** True when this agent covers a handed-over piece of these kinds at the business (calling its owner, a revisit there). */
export async function coversPieceAt(prisma: Db, staffId: string, businessId: string, kinds: HandoverKind[], now: Date): Promise<boolean> {
  return (await liveHandovers(prisma, { toStaffId: staffId, businessId, kind: { in: kinds } }, now)).length > 0;
}

/** The instant a handover ends: the start of the IST day after `lastDay` ("YYYY-MM-DD" or a date in it). */
export function handoverEnd(lastDay: Date): Date {
  return new Date(istDayStart(lastDay).getTime() + DAY_MS);
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
    private readonly reporting: ReportingScopeService,
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
    // 21 Nov review: the cover ends with the leave (default: the end of today); nothing due after it moves.
    const until = options.until ?? now;
    const untilAt = handoverEnd(until);
    const pieces = await this.openPieces(fromStaffId, now, until);
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
      await this.movePiece(piece, fromStaffId, target, reason, options, now, untilAt);
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
        until: untilAt.toISOString(),
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
      null,
    );
    return {
      assignmentId: assignment.id,
      assignedStaffId,
      onLeave: leave.has(assignedStaffId),
    };
  }

  /**
   * A Team Lead, Manager or CEO runs the handover by hand: `until` is the last day the agent is
   * away ("YYYY-MM-DD", today up to 90 days ahead); nothing due after it moves and the cover ends then.
   */
  async handOverByHand(actor: { id: string; role: string }, body: { fromStaffId?: unknown; toStaffId?: unknown; reason?: unknown; until?: unknown }) {
    const fromStaffId = typeof body?.fromStaffId === 'string' ? body.fromStaffId : '';
    const toRaw = typeof body?.toStaffId === 'string' && body.toStaffId ? body.toStaffId : 'spread';
    if (!fromStaffId) throw new BadRequestException('fromStaffId is required');
    const now = this.clock.now();
    const untilKey = typeof body?.until === 'string' ? body.until.trim() : '';
    const todayKey = istDateKey(now);
    const maxKey = istDateKey(new Date(now.getTime() + 90 * DAY_MS));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(untilKey) || untilKey < todayKey || untilKey > maxKey) {
      throw new BadRequestException('Pick the last day the field agent is away (today or later, at most 90 days ahead)');
    }
    await this.assertMayMove(actor, toRaw === 'spread' ? [fromStaffId] : [fromStaffId, toRaw]);
    // Noon IST of the last day: its IST day is the one picked.
    const until = new Date(`${untilKey}T06:30:00.000Z`);
    return this.handOver(fromStaffId, toRaw, { reason: typeof body?.reason === 'string' ? body.reason : '', actorId: actor.id, until });
  }

  /**
   * The agent is back (21 Nov review): every live cover of his work ends. Visits still open go
   * back to him; interview attendance the cover was given for him is cancelled; his revisits and
   * joinings are his again.
   */
  async handBack(actor: { id: string; role: string } | null, fromStaffId: string, reason = 'Back at work'): Promise<{ ended: number }> {
    if (actor) await this.assertMayMove(actor, [fromStaffId]);
    const now = this.clock.now();
    const rows = await liveHandovers(this.prisma, { fromStaffId }, now);
    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        await tx.fieldHandover.updateMany({ where: { id: row.id, endedAt: null }, data: { endedAt: now } });
        if (row.kind === 'visit_assignment') {
          await tx.visitAssignment.updateMany({
            where: { id: row.recordId, status: 'assigned', assignedStaffId: row.toStaffId },
            data: { assignedStaffId: fromStaffId, assignedByStaffId: actor?.id ?? null },
          });
        }
        if (row.kind === 'interview') {
          await tx.visitAssignment.updateMany({
            where: { relatedType: 'interview', relatedId: row.recordId, assignedStaffId: row.toStaffId, status: 'assigned', purpose: 'interview_attendance' },
            data: { status: 'cancelled' },
          });
        }
      });
    }
    const from = await this.prisma.staff.findUnique({ where: { id: fromStaffId }, select: { code: true, city: true } });
    if (rows.length) {
      await this.audit.log({
        actorId: actor?.id ?? fromStaffId,
        action: 'field_agent.work_handed_back',
        entityType: 'staff',
        entityCode: from?.code ?? fromStaffId,
        after: { ended: rows.length },
        changedFields: ['handover'],
        reason,
        city: from?.city,
      });
    }
    return { ended: rows.length };
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
    let ids: string[] = [];
    if (actor.role === 'team_lead') ids = await new OwnTeam(this.prisma).memberIds(actor.id);
    else if (actor.role === 'manager') ids = await this.reporting.peopleUnder(actor.id);
    if (!ids.length) return [];
    const rows = await this.prisma.staff.findMany({ where: { id: { in: ids }, role: 'field_agent' }, select: { id: true } });
    return rows.map((row) => row.id);
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
  private async pickPool(from: { id: string; role: string; teamLeadId: string | null; reportsToId: string | null; city: string }, to: HandoverTarget, todayKey: string) {
    if (to !== 'spread') {
      if (to === from.id) throw new BadRequestException('Pick another field agent');
      const agent = await this.prisma.staff.findUnique({ where: { id: to }, select: { id: true, role: true, status: true, city: true } });
      if (!agent || agent.role !== 'field_agent' || agent.status !== 'active') throw new BadRequestException('Pick an active field agent');
      if (agent.city !== from.city) throw new BadRequestException('The field agent must work in the same city');
      const leave = await onApprovedLeave(this.prisma, [agent.id], todayKey);
      return { ids: [agent.id], onLeave: leave.has(agent.id) ? [agent.id] : [] };
    }
    const lead = teamLeadOf(from);
    if (!lead) return { ids: [] as string[], onLeave: [] as string[] };
    const members = await new OwnTeam(this.prisma).memberIds(lead);
    const team = await this.prisma.staff.findMany({
      where: {
        id: { in: members.filter((id) => id !== from.id) },
        role: 'field_agent', status: 'active', city: from.city, lockedByStaffId: null,
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
      liveHandovers(this.prisma, { toStaffId: staffId, kind: { in: ['revisit', 'joining', 'interview'] } }, this.clock.now()).then((rows) => rows.length),
    ]);
    return visits + covered;
  }

  /** Everything open on the agent that moves, oldest first. */
  private async openPieces(staffId: string, now: Date, until: Date): Promise<Array<{ kind: HandoverKind; recordId: string; businessId: string | null }>> {
    const pieces: Array<{ kind: HandoverKind; recordId: string; businessId: string | null }> = [];
    const dayStart = istDayStart(now);
    const lastDay = istDateKey(until);
    // Calendar dates (revisitOn, joiningDate) are stored at UTC midnight; instants end with the IST day.
    const byEnd = new Date(new Date(`${lastDay}T00:00:00.000Z`).getTime() + DAY_MS);
    const untilAt = handoverEnd(until);

    const assignments = await this.prisma.visitAssignment.findMany({
      where: { assignedStaffId: staffId, status: 'assigned', OR: [{ requestedFor: null }, { requestedFor: { lt: untilAt } }] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, businessId: true },
    });
    for (const a of assignments) pieces.push({ kind: 'visit_assignment', recordId: a.id, businessId: a.businessId });

    const away = await handedAwayIds(this.prisma, staffId, 'interview', now);
    const interviews = await this.prisma.interview.findMany({
      where: {
        proposedByStaffId: staffId, agentWillAttend: true, status: { in: ['offered', 'confirmed'] },
        candidateArrivedAt: null, resultRecordedAt: null,
        slotStartsAt: { gte: dayStart, lt: untilAt },
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

    const revisitsAway = await handedAwayIds(this.prisma, staffId, 'revisit', now);
    const revisits = await this.prisma.businessVisit.findMany({
      where: {
        staffId, outcome: { in: [...REVISIT_OUTCOMES] }, revisitOn: { not: null, lte: new Date(`${lastDay}T00:00:00.000Z`) },
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

    const joiningsAway = await handedAwayIds(this.prisma, staffId, 'joining', now);
    const joinings = await this.prisma.placement.findMany({
      where: {
        joinedDate: null, joiningDate: { not: null, lt: byEnd }, status: { in: ['confirmed', 'active'] },
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
    untilAt: Date | null,
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
          until: untilAt,
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
