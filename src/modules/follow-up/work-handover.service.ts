import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OwnTeam, teamLeadOf } from '../../common/rbac/own-team';
import { PricingService } from '../pricing/pricing.service';
import { CALL_TASK_KIND_SIGNUP_HELP } from '../../common/customer-auth/customer-app.constants';
import { SEEKER_ENDED_STATUSES } from '../refund-priority/refund-priority.rules';
import {
  clockMinutes,
  fewestOpen,
  istDateValue,
  istDayStartUtc,
  istMinute,
  openItemCounts,
  shiftOf,
} from '../telephony/call-agent-load';
import { FollowUpHandoverService, HandoverChoice } from './follow-up-handover.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Registration started, not paid: the stuck registrations an agent chases. */
const STUCK_STATUSES = ['lead', 'consented', 'pending_activation'];
/** No-show: not logged in this long after the shift start (21 Nov fixes). */
export const NO_SHOW_AFTER_MINUTES = 60;

/**
 * Field items (visits, interviews to attend, revisits, joinings) are Builder C's
 * (Laboura Field). Their service is found under this token when it is provided
 * (`{ provide: FIELD_HANDOVER, useExisting: FieldHandoverService }`, exported by
 * its module); until then field items stay where they are and the answer says so.
 */
export const FIELD_HANDOVER = 'FIELD_HANDOVER';
export interface FieldHandoverPort {
  handOver(
    fromStaffId: string,
    to: string | 'spread',
    context?: { reason: 'leave' | 'no_show'; leaveRequestId?: string | null; actorId?: string | null; from?: Date; to?: Date },
  ): Promise<unknown>;
}

export interface WorkMoved {
  callTasks: number;
  missedCalls: number;
  people: number;
  signups: number;
  followUps: number;
  field: 'moved' | 'not_connected' | 'failed' | 'none';
}

interface MoveParams {
  fromStaffId: string;
  reason: 'leave' | 'no_show';
  mode: 'teammate' | 'share';
  takers: string[];
  leaveRequestId: string | null;
  actorId: string | null;
  now: Date;
  /** Items due before this instant move (the end of the leave, or the end of today). */
  dueBefore: Date;
  /** Also the people they look after (stuck registrations, close to a refund) and their app sign-ups. */
  includePeople: boolean;
  /** Follow-up tasks too (the no-show path; leave keeps FollowUpHandoverService for them). */
  includeFollowUps: boolean;
  returnAfter: Date | null;
}

/**
 * Leave and no-show handover of ALL open call items (21 Nov fixes, Master
 * Guide rev 202, "Assign and leave"):
 * - on an approved full-day leave, everything open — call tasks (callbacks,
 *   retries, sign-up help), missed calls, follow-ups (FollowUpHandoverService),
 *   the people the agent looks after (stuck registrations, close to a refund)
 *   and their app sign-ups — goes to the teammate the Team Lead picked, or is
 *   spread across the team, each item to whoever has the fewest open items;
 *   people and sign-ups go back after the leave if still with the teammate;
 * - an agent not logged in an hour after their shift start: today's open
 *   items are spread across the teammates on shift the same way (once a day,
 *   repeat runs only move what is still theirs).
 * Field items go through Builder C's FieldHandoverService in the same step.
 * Every move is recorded (WorkHandover) and audited.
 */
@Injectable()
export class WorkHandoverService {
  private readonly logger = new Logger(WorkHandoverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly followUps: FollowUpHandoverService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private fieldHandover(): FieldHandoverPort | null {
    if (!this.moduleRef) return null;
    try {
      return this.moduleRef.get<FieldHandoverPort>(FIELD_HANDOVER, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }

  /** Counts for T-Req-Sneha: what is open for the person in the leave days. */
  async openWork(staffId: string, start: Date, end: Date) {
    const [callTasks, missedCalls, people, signups] = await Promise.all([
      this.prisma.callTask.count({ where: { staffId, status: 'open', dueAt: { lt: end } } }),
      this.prisma.callbackTask.count({ where: { assignedToStaffId: staffId, status: { in: ['pending', 'assigned'] } } }),
      this.peopleOf(staffId, start).then((p) => p.length),
      this.prisma.signupTracker.count({ where: { assignedStaffId: staffId, outcome: 'open' } }),
    ]);
    return { callTasks, missedCalls, people, signups };
  }

  /**
   * After an approved leave (requests leave-approval hook): every open call
   * item moves as the Team Lead chose (teammate or share). "keep" moves nothing.
   */
  async onLeaveApproved(actorId: string, leaveId: string, choice: HandoverChoice | undefined, now: Date): Promise<WorkMoved | null> {
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!leave || leave.status !== 'approved') return null;
    if (!(await this.followUps.isFullDayLeave(leave))) return null;
    const mode = (choice?.mode ?? 'keep') as string;
    if (mode !== 'share' && mode !== 'teammate') return null;
    const from = (leave.approvedFromDate ?? leave.fromDate).toISOString().slice(0, 10);
    const to = (leave.approvedToDate ?? leave.toDate).toISOString().slice(0, 10);
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS);
    const mates = await this.followUps.teammates(leave.staffId, from, to);
    const takers = mode === 'teammate' ? mates.filter((m) => m.id === choice?.staffId).map((m) => m.id) : mates.map((m) => m.id);
    if (takers.length === 0) return null;
    const moved = await this.move({
      fromStaffId: leave.staffId,
      reason: 'leave',
      mode,
      takers,
      leaveRequestId: leave.id,
      actorId,
      now,
      dueBefore: end,
      includePeople: true,
      includeFollowUps: false,
      returnAfter: end,
    });
    moved.field = await this.moveField(leave.staffId, mode === 'teammate' ? takers[0] : 'spread', {
      reason: 'leave',
      leaveRequestId: leave.id,
      actorId,
      from: start,
      to: end,
    });
    return moved;
  }

  private async moveField(fromStaffId: string, to: string | 'spread', context: Parameters<FieldHandoverPort['handOver']>[2]): Promise<WorkMoved['field']> {
    const field = this.fieldHandover();
    if (!field) return 'not_connected';
    try {
      await field.handOver(fromStaffId, to, context);
      return 'moved';
    } catch (err) {
      this.logger.error(`Field handover for ${fromStaffId} failed: ${(err as Error).message}`);
      return 'failed';
    }
  }

  /** The people an agent looks after now: stuck registrations and people close to a refund (assigned to them, else registered by them). */
  private async peopleOf(staffId: string, now: Date): Promise<string[]> {
    const policy = await this.pricing.current();
    const mine: Prisma.JobSeekerWhereInput = {
      OR: [{ assignedStaffId: staffId }, { assignedStaffId: null, registeredByStaffId: staffId }],
      anonymisedAt: null,
    };
    const [stuck, nearRefund] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { ...mine, paymentReceivedAt: null, status: { in: STUCK_STATUSES } }, select: { id: true }, take: 500 }),
      this.prisma.jobSeeker.findMany({
        where: {
          ...mine,
          status: { notIn: SEEKER_ENDED_STATUSES },
          paymentReceivedAt: {
            not: null,
            gt: new Date(now.getTime() - policy.jobSeekerGuaranteeDays * DAY_MS),
            lte: new Date(now.getTime() - (policy.jobSeekerGuaranteeDays - policy.refundPriorityWindowDays) * DAY_MS),
          },
        },
        select: { id: true },
        take: 500,
      }),
    ]);
    return [...new Set([...stuck, ...nearRefund].map((s) => s.id))];
  }

  private async move(p: MoveParams): Promise<WorkMoved> {
    const result: WorkMoved = { callTasks: 0, missedCalls: 0, people: 0, signups: 0, followUps: 0, field: 'none' };
    const counts = await openItemCounts(this.prisma, p.takers, p.now);
    const pick = () => {
      const id = p.mode === 'teammate' ? p.takers[0] : fewestOpen(p.takers, counts)!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      return id;
    };
    const record = (recordType: string, recordId: string, toStaffId: string, returnAfter: Date | null) =>
      this.prisma.workHandover.create({
        data: {
          reason: p.reason,
          leaveRequestId: p.leaveRequestId,
          recordType,
          recordId,
          fromStaffId: p.fromStaffId,
          toStaffId,
          mode: p.mode,
          movedAt: p.now,
          movedByStaffId: p.actorId,
          returnAfter,
        },
      });
    const log: Array<{ type: string; id: string; to: string }> = [];

    const tasks = await this.prisma.callTask.findMany({
      where: { staffId: p.fromStaffId, status: 'open', dueAt: { lt: p.dueBefore } },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { id: true, kind: true, signupTrackerId: true },
    });
    for (const task of tasks) {
      // A sign-up help task moves with its sign-up below.
      if (p.includePeople && task.kind === CALL_TASK_KIND_SIGNUP_HELP && task.signupTrackerId) continue;
      const to = pick();
      const claimed = await this.prisma.callTask.updateMany({ where: { id: task.id, staffId: p.fromStaffId, status: 'open' }, data: { staffId: to } });
      if (!claimed.count) continue;
      await record('call_task', task.id, to, null);
      result.callTasks += 1;
      log.push({ type: 'call_task', id: task.id, to });
    }

    const missed = await this.prisma.callbackTask.findMany({
      where: { assignedToStaffId: p.fromStaffId, status: { in: ['pending', 'assigned'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, phone: true },
    });
    const byCaller = new Map<string, string>();
    for (const task of missed) {
      const key = task.phone.replace(/\D/g, '').slice(-10);
      const to = byCaller.get(key) ?? pick();
      byCaller.set(key, to);
      const claimed = await this.prisma.callbackTask.updateMany({
        where: { id: task.id, assignedToStaffId: p.fromStaffId, status: { in: ['pending', 'assigned'] } },
        data: { assignedToStaffId: to, status: 'assigned', assignedAt: p.now, assignmentReason: p.reason === 'leave' ? 'handover' : 'no_show' },
      });
      if (!claimed.count) continue;
      await record('callback_task', task.id, to, null);
      result.missedCalls += 1;
      log.push({ type: 'callback_task', id: task.id, to });
    }

    if (p.includeFollowUps) {
      const followUps = await this.prisma.followUpTask.findMany({
        where: { assignedStaffId: p.fromStaffId, status: 'pending', dueAt: { lt: p.dueBefore } },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      for (const task of followUps) {
        const to = pick();
        const claimed = await this.prisma.followUpTask.updateMany({ where: { id: task.id, assignedStaffId: p.fromStaffId, status: 'pending' }, data: { assignedStaffId: to } });
        if (!claimed.count) continue;
        await record('follow_up_task', task.id, to, null);
        result.followUps += 1;
        log.push({ type: 'follow_up_task', id: task.id, to });
      }
    }

    if (p.includePeople) {
      for (const seekerId of await this.peopleOf(p.fromStaffId, p.now)) {
        const to = pick();
        const claimed = await this.prisma.jobSeeker.updateMany({
          where: { id: seekerId, OR: [{ assignedStaffId: p.fromStaffId }, { assignedStaffId: null, registeredByStaffId: p.fromStaffId }] },
          data: { assignedStaffId: to },
        });
        if (!claimed.count) continue;
        await record('job_seeker', seekerId, to, p.returnAfter);
        result.people += 1;
        log.push({ type: 'job_seeker', id: seekerId, to });
      }
      const signups = await this.prisma.signupTracker.findMany({ where: { assignedStaffId: p.fromStaffId, outcome: 'open' }, select: { id: true } });
      for (const tracker of signups) {
        const to = pick();
        const claimed = await this.prisma.signupTracker.updateMany({
          where: { id: tracker.id, assignedStaffId: p.fromStaffId, outcome: 'open' },
          data: { assignedStaffId: to, assignedAt: p.now, assignmentReason: 'handover' },
        });
        if (!claimed.count) continue;
        await this.prisma.callTask.updateMany({
          where: { signupTrackerId: tracker.id, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open', staffId: p.fromStaffId },
          data: { staffId: to },
        });
        await this.prisma.signupTrackerEvent.create({
          data: { trackerId: tracker.id, kind: 'reassigned', staffId: to, byStaffId: p.actorId, note: p.reason === 'leave' ? 'handover: leave' : 'handover: not logged in' },
        });
        await record('signup_tracker', tracker.id, to, p.returnAfter);
        result.signups += 1;
        log.push({ type: 'signup_tracker', id: tracker.id, to });
      }
    }

    if (log.length) {
      const person = await this.prisma.staff.findUnique({ where: { id: p.fromStaffId }, select: { code: true } });
      await this.audit.log({
        actorId: p.actorId ?? 'system',
        action: 'call_work.handed_over',
        entityType: 'staff',
        entityCode: person?.code ?? p.fromStaffId,
        after: { reason: p.reason, mode: p.mode, leaveRequestId: p.leaveRequestId, counts: { ...result, field: undefined }, items: log.slice(0, 200) },
        reason: p.reason === 'leave' ? 'Leave approved: open call work goes to teammates' : 'Not logged in an hour after the shift start: today\'s call work is spread across the team',
      });
    }
    return result;
  }

  /**
   * No-shows (every few minutes, inside the calling hours on a working day):
   * an agent with no login today an hour after their shift start, not on
   * leave, has today's open call items spread across the teammates on shift.
   */
  async sweepNoShows(now: Date): Promise<{ agents: number; moved: number }> {
    const policy = await this.pricing.current();
    const date = istDateValue(now);
    if (policy.weeklyOffDays.includes(date.getUTCDay())) return { agents: 0, moved: 0 };
    const holiday = await this.prisma.holiday.findFirst({ where: { date }, select: { id: true } });
    if (holiday) return { agents: 0, moved: 0 };
    const minute = istMinute(now);
    const agents = await this.prisma.staff.findMany({
      where: { role: { in: ['call_agent', 'field_agent'] }, status: 'active' },
      select: { id: true, role: true, teamLeadId: true, reportsToId: true, reportsTo: { select: { role: true } } },
    });
    if (agents.length === 0) return { agents: 0, moved: 0 };
    const ids = agents.map((a) => a.id);
    const [days, leaves] = await Promise.all([
      this.prisma.attendanceDay.findMany({ where: { staffId: { in: ids }, date }, select: { staffId: true, loginAt: true, logoutAt: true, dayType: true } }),
      this.prisma.leaveRequest.findMany({
        where: { staffId: { in: ids }, status: 'approved', overturnedAt: null, fromDate: { lte: date }, toDate: { gte: date } },
        select: { staffId: true },
      }),
    ]);
    const dayOf = new Map(days.map((d) => [d.staffId, d]));
    const away = new Set(leaves.map((l) => l.staffId));
    const working = new Set(days.filter((d) => d.loginAt && !d.logoutAt && d.dayType !== 'leave').map((d) => d.staffId));
    let agentsMoved = 0;
    let moved = 0;
    for (const agent of agents) {
      if (away.has(agent.id)) continue;
      const day = dayOf.get(agent.id);
      if (day?.loginAt || day?.dayType === 'leave') continue;
      const shift = shiftOf(policy);
      const start = clockMinutes(shift.start) ?? 9 * 60 + 30;
      const end = clockMinutes(shift.end) ?? 18 * 60 + 30;
      if (minute < start + NO_SHOW_AFTER_MINUTES || minute >= end) continue;
      const lead = teamLeadOf(agent);
      if (!lead) continue;
      const team = await new OwnTeam(this.prisma).memberIds(lead);
      const takers = agents.filter((a) => a.id !== agent.id && a.role === agent.role && team.includes(a.id) && working.has(a.id)).map((a) => a.id);
      if (takers.length === 0) continue;
      const result = await this.move({
        fromStaffId: agent.id,
        reason: 'no_show',
        mode: 'share',
        takers,
        leaveRequestId: null,
        actorId: null,
        now,
        dueBefore: new Date(istDayStartUtc(now).getTime() + DAY_MS),
        includePeople: false,
        includeFollowUps: true,
        returnAfter: null,
      });
      const count = result.callTasks + result.missedCalls + result.followUps;
      const already = await this.prisma.workHandover.findFirst({
        where: { fromStaffId: agent.id, reason: 'no_show', recordType: 'field', movedAt: { gte: istDayStartUtc(now) } },
        select: { id: true },
      });
      if (!already) {
        const field = await this.moveField(agent.id, 'spread', { reason: 'no_show', actorId: null, from: istDayStartUtc(now), to: new Date(istDayStartUtc(now).getTime() + DAY_MS) });
        if (field !== 'not_connected') {
          await this.prisma.workHandover.create({
            data: { reason: 'no_show', recordType: 'field', recordId: field, fromStaffId: agent.id, toStaffId: 'spread', mode: 'share', movedAt: now },
          });
        }
      }
      if (count) {
        agentsMoved += 1;
        moved += count;
      }
    }
    return { agents: agentsMoved, moved };
  }

  /**
   * After the leave: people and sign-ups still with the teammate they went to
   * go back (the owner still active); anything moved on since stays. Safe to repeat.
   */
  async returnAfterLeave(now: Date): Promise<{ returned: number }> {
    const due = await this.prisma.workHandover.findMany({
      where: { returnedAt: null, returnAfter: { lte: now }, recordType: { in: ['job_seeker', 'signup_tracker'] } },
      orderBy: { movedAt: 'asc' },
      take: 1000,
    });
    if (due.length === 0) return { returned: 0 };
    const owners = await this.prisma.staff.findMany({ where: { id: { in: [...new Set(due.map((d) => d.fromStaffId))] } }, select: { id: true, status: true } });
    const active = new Set(owners.filter((o) => o.status === 'active').map((o) => o.id));
    let returned = 0;
    for (const row of due) {
      let outcome = 'already_moved';
      if (!active.has(row.fromStaffId)) outcome = 'kept_owner_inactive';
      else if (row.recordType === 'job_seeker') {
        const back = await this.prisma.jobSeeker.updateMany({ where: { id: row.recordId, assignedStaffId: row.toStaffId }, data: { assignedStaffId: row.fromStaffId } });
        if (back.count) outcome = 'returned';
      } else {
        const back = await this.prisma.signupTracker.updateMany({
          where: { id: row.recordId, assignedStaffId: row.toStaffId, outcome: 'open' },
          data: { assignedStaffId: row.fromStaffId, assignedAt: now, assignmentReason: 'handover' },
        });
        if (back.count) {
          outcome = 'returned';
          await this.prisma.callTask.updateMany({
            where: { signupTrackerId: row.recordId, kind: CALL_TASK_KIND_SIGNUP_HELP, status: 'open', staffId: row.toStaffId },
            data: { staffId: row.fromStaffId },
          });
        }
      }
      const marked = await this.prisma.workHandover.updateMany({ where: { id: row.id, returnedAt: null }, data: { returnedAt: now, returnOutcome: outcome } });
      if (marked.count && outcome === 'returned') returned += 1;
    }
    return { returned };
  }
}
