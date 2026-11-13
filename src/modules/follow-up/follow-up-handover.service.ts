import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

const DAY_MS = 24 * 3600 * 1000;

export type HandoverMode = 'share' | 'teammate' | 'keep';
export interface HandoverChoice {
  mode?: string;
  staffId?: string;
}

export interface HandoverTeammate {
  id: string;
  code: string;
  name: string;
}

/** yyyy-mm-dd of a @db.Date value (stored as UTC midnight of that day). */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** IST midnight that starts a yyyy-mm-dd day, as a UTC instant. */
function istStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

/**
 * T-Req-Sneha "Her follow-ups that day go to…" (guide, Team Lead portal:
 * leave and "where her work goes while she is away"). When a leave is
 * approved, the person's pending follow-up tasks due on the leave days move
 * to one teammate, or are shared between the teammates, or stay for her
 * return. Every move is recorded (FollowUpHandover) and audited; after the
 * leave the tasks still pending with the teammate move back to her.
 */
@Injectable()
export class FollowUpHandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The leave days that count: the approved part when only part was approved. */
  private window(leave: { fromDate: Date; toDate: Date; approvedFromDate?: Date | null; approvedToDate?: Date | null }) {
    const from = ymd(leave.approvedFromDate ?? leave.fromDate);
    const to = ymd(leave.approvedToDate ?? leave.toDate);
    const start = istStart(from);
    const end = new Date(istStart(to).getTime() + DAY_MS);
    return { from, to, start, end };
  }

  /** Same-role teammates under the same Team Lead, active, not off on any of those days. */
  async teammates(staffId: string, fromDay: string, toDay: string): Promise<HandoverTeammate[]> {
    const person = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { role: true, teamLeadId: true } });
    if (!person?.teamLeadId) return [];
    const candidates = await this.prisma.staff.findMany({
      where: { teamLeadId: person.teamLeadId, role: person.role, status: 'active', id: { not: staffId } },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (!candidates.length) return [];
    const off = await this.prisma.leaveRequest.findMany({
      where: {
        staffId: { in: candidates.map((c) => c.id) },
        status: 'approved',
        overturnedAt: null,
        fromDate: { lte: new Date(`${toDay}T00:00:00.000Z`) },
        toDate: { gte: new Date(`${fromDay}T00:00:00.000Z`) },
      },
      select: { staffId: true, half: true, fromDate: true },
    });
    // A teammate on a half day of leave still works the other half; both halves of a date is off.
    const away = new Set<string>();
    const halves = new Map<string, number>();
    for (const o of off) {
      if (!o.half) away.add(o.staffId);
      else {
        const key = `${o.staffId}|${o.fromDate.toISOString()}`;
        halves.set(key, (halves.get(key) ?? 0) + 1);
        if ((halves.get(key) ?? 0) >= 2) away.add(o.staffId);
      }
    }
    return candidates.filter((c) => !away.has(c.id));
  }

  /** "Calls planned for her that day": her pending follow-ups due on the leave days, and who can take them. */
  async plan(leaveId: string) {
    const leave = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
    const w = this.window(leave);
    const [planned, teammates, handedOver] = await Promise.all([
      this.prisma.followUpTask.count({ where: { assignedStaffId: leave.staffId, status: 'pending', dueAt: { gte: w.start, lt: w.end } } }),
      this.teammates(leave.staffId, w.from, w.to),
      this.prisma.followUpHandover.findMany({ where: { leaveRequestId: leaveId }, select: { toStaffId: true, returnedAt: true } }),
    ]);
    const names = handedOver.length
      ? await this.prisma.staff.findMany({ where: { id: { in: [...new Set(handedOver.map((h) => h.toStaffId))] } }, select: { id: true, code: true, name: true } })
      : [];
    return {
      planned,
      // A half day keeps its follow-ups (the other half is worked) unless it joins the other half.
      handoverNeeded: leave.status === 'approved' ? await this.isFullDayLeave(leave) : await this.willBeFullDayLeave(leave),
      teammates,
      handedOver: {
        count: handedOver.length,
        returned: handedOver.filter((h) => h.returnedAt).length,
        to: names,
      },
    };
  }

  /** Full days, or a half day whose date is joined with the other half into a full leave day. */
  async isFullDayLeave(leave: { id: string; half: string | null }): Promise<boolean> {
    if (!leave.half) return true;
    const joined = await this.prisma.attendanceDay.count({
      where: { otherLeaveRequestId: { not: null }, OR: [{ leaveRequestId: leave.id }, { otherLeaveRequestId: leave.id }] },
    });
    return joined > 0;
  }

  /**
   * Before approval: whether approving this request makes a full leave day — full days, or a half
   * day whose other half is already a half day of leave of the same kind (they will join).
   */
  async willBeFullDayLeave(leave: { staffId: string; half: string | null; kind: string; fromDate: Date }): Promise<boolean> {
    if (!leave.half) return true;
    const day = await this.prisma.attendanceDay.findUnique({ where: { staffId_date: { staffId: leave.staffId, date: leave.fromDate } } });
    return Boolean(day?.leaveKind === leave.kind && day.leaveHalf && day.leaveHalf !== leave.half);
  }

  /** Checks the choice before a leave is approved, so a bad choice changes nothing. */
  async validate(staffId: string, leave: { fromDate: Date; toDate: Date }, choice: HandoverChoice | undefined): Promise<HandoverMode> {
    const mode = (choice?.mode ?? 'keep') as HandoverMode;
    if (!['share', 'teammate', 'keep'].includes(mode)) throw new BadRequestException("followUps.mode is share, teammate or keep");
    if (mode === 'keep') return mode;
    const w = this.window(leave);
    const mates = await this.teammates(staffId, w.from, w.to);
    if (mode === 'teammate') {
      if (!choice?.staffId) throw new BadRequestException('Pick the teammate who takes her follow-ups');
      if (!mates.some((m) => m.id === choice.staffId)) {
        throw new BadRequestException('That person is not a teammate who is working on those days');
      }
    } else if (!mates.length) {
      throw new BadRequestException('Nobody in the team is working on those days to share the follow-ups');
    }
    return mode;
  }

  /**
   * Moves the person's pending follow-ups on the (approved) leave days. Runs
   * after the approval is saved. Returns how many moved and to whom.
   */
  async handOver(actorId: string, leaveId: string, choice: HandoverChoice | undefined, now: Date) {
    const leave = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
    if (leave.status !== 'approved') return { moved: 0, to: [] as HandoverTeammate[] };
    // A half day of leave keeps its follow-ups (the other half is worked); only a full leave day
    // hands them over, including two half days of one date joined into a full leave day.
    if (!(await this.isFullDayLeave(leave))) return { moved: 0, to: [] as HandoverTeammate[] };
    const mode = await this.validate(leave.staffId, leave, choice);
    if (mode === 'keep') return { moved: 0, to: [] as HandoverTeammate[] };
    const w = this.window(leave);
    const mates = await this.teammates(leave.staffId, w.from, w.to);
    const takers = mode === 'teammate' ? mates.filter((m) => m.id === choice?.staffId) : mates;
    const tasks = await this.prisma.followUpTask.findMany({
      where: { assignedStaffId: leave.staffId, status: 'pending', dueAt: { gte: w.start, lt: w.end } },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true },
    });
    const moved: Array<{ code: string; to: string }> = [];
    for (const [i, task] of tasks.entries()) {
      const taker = takers[i % takers.length];
      // Only if it is still hers and still pending: a concurrent change wins.
      const claimed = await this.prisma.followUpTask.updateMany({
        where: { id: task.id, assignedStaffId: leave.staffId, status: 'pending' },
        data: { assignedStaffId: taker.id },
      });
      if (claimed.count === 0) continue;
      await this.prisma.followUpHandover.create({
        data: {
          leaveRequestId: leave.id,
          followUpTaskId: task.id,
          fromStaffId: leave.staffId,
          toStaffId: taker.id,
          mode,
          movedAt: now,
          movedByStaffId: actorId,
          returnAfter: w.end,
        },
      });
      moved.push({ code: task.code, to: taker.code });
    }
    if (moved.length) {
      const person = await this.prisma.staff.findUnique({ where: { id: leave.staffId }, select: { code: true } });
      await this.audit.log({
        actorId,
        action: 'follow_up.handed_over',
        entityType: 'leave_request',
        entityCode: person?.code ?? leave.id,
        after: { leaveRequestId: leave.id, mode, from: w.from, to: w.to, tasks: moved },
        reason: 'Leave approved: her follow-ups on those days go to teammates',
      });
    }
    const usedIds = new Set(moved.map((m) => m.to));
    return { moved: moved.length, to: takers.filter((t) => usedIds.has(t.code)) };
  }

  /**
   * After the leave (or at once when the leave was overturned or cancelled),
   * every task still pending with the teammate it went to moves back to her.
   * H1: only rows whose return day has come (returnAfter <= now) or whose
   * leave no longer stands are read. If she is off again (a new approved
   * leave today) the row waits for a later run; if she is no longer active
   * the task stays with the teammate (outcome kept_owner_inactive). Daily,
   * with the follow-up sweep; safe to repeat.
   */
  async returnAfterLeave(now: Date): Promise<{ returned: number; waiting: number; kept: number }> {
    const openLeaves = await this.prisma.followUpHandover.findMany({ where: { returnedAt: null }, distinct: ['leaveRequestId'], select: { leaveRequestId: true } });
    if (!openLeaves.length) return { returned: 0, waiting: 0, kept: 0 };
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { id: { in: openLeaves.map((l) => l.leaveRequestId) } },
      select: { id: true, status: true, overturnedAt: true, staffId: true },
    });
    const leaveById = new Map(leaves.map((l) => [l.id, l]));
    const gone = openLeaves.map((l) => l.leaveRequestId).filter((id) => {
      const leave = leaveById.get(id);
      return !leave || leave.status !== 'approved' || leave.overturnedAt !== null;
    });
    const due = await this.prisma.followUpHandover.findMany({
      where: { returnedAt: null, OR: [{ returnAfter: { lte: now } }, ...(gone.length ? [{ leaveRequestId: { in: gone } }] : [])] },
      orderBy: { movedAt: 'asc' },
      take: 2000,
    });
    if (!due.length) return { returned: 0, waiting: 0, kept: 0 };

    // The owners: still active, and not off again today.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
    const ownerIds = [...new Set(due.map((d) => d.fromStaffId))];
    const [owners, offAgain] = await Promise.all([
      this.prisma.staff.findMany({ where: { id: { in: ownerIds } }, select: { id: true, status: true } }),
      this.prisma.leaveRequest.findMany({
        where: { staffId: { in: ownerIds }, status: 'approved', overturnedAt: null, fromDate: { lte: new Date(`${today}T00:00:00.000Z`) }, toDate: { gte: new Date(`${today}T00:00:00.000Z`) } },
        select: { staffId: true },
      }),
    ]);
    const active = new Set(owners.filter((o) => o.status === 'active').map((o) => o.id));
    const away = new Set(offAgain.map((o) => o.staffId));

    let returned = 0;
    let waiting = 0;
    let kept = 0;
    const byLeave = new Map<string, Array<{ code: string; outcome: string }>>();
    for (const row of due) {
      if (active.has(row.fromStaffId) && away.has(row.fromStaffId)) {
        waiting += 1; // She is off again: try on a later run.
        continue;
      }
      const task = await this.prisma.followUpTask.findUnique({ where: { id: row.followUpTaskId }, select: { code: true, status: true, assignedStaffId: true } });
      let outcome = 'already_moved';
      if (task && task.status !== 'pending') outcome = 'done_by_teammate';
      else if (!active.has(row.fromStaffId)) {
        outcome = 'kept_owner_inactive';
        kept += 1;
      } else if (task && task.assignedStaffId === row.toStaffId) {
        const back = await this.prisma.followUpTask.updateMany({
          where: { id: row.followUpTaskId, assignedStaffId: row.toStaffId, status: 'pending' },
          data: { assignedStaffId: row.fromStaffId },
        });
        if (back.count) {
          outcome = 'returned';
          returned += 1;
        }
      }
      const marked = await this.prisma.followUpHandover.updateMany({ where: { id: row.id, returnedAt: null }, data: { returnedAt: now, returnOutcome: outcome } });
      if (marked.count && task) {
        const list = byLeave.get(row.leaveRequestId) ?? [];
        list.push({ code: task.code, outcome });
        byLeave.set(row.leaveRequestId, list);
      }
    }
    for (const [leaveId, tasks] of byLeave) {
      const leave = leaveById.get(leaveId);
      const person = leave ? await this.prisma.staff.findUnique({ where: { id: leave.staffId }, select: { code: true } }) : null;
      await this.audit.log({
        actorId: 'system',
        action: 'follow_up.handed_back',
        entityType: 'leave_request',
        entityCode: person?.code ?? leaveId,
        after: { leaveRequestId: leaveId, tasks },
        reason: tasks.some((t) => t.outcome === 'kept_owner_inactive')
          ? 'Leave over: she is no longer active, so her open follow-ups stay with the teammate'
          : 'Leave over: follow-ups still open go back to her',
      });
    }
    return { returned, waiting, kept };
  }
}
