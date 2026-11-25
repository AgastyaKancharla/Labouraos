import { Injectable, Logger, Optional } from '@nestjs/common';
import { PAID_WAITING_ID } from '../job-seeker/job-seeker.status';
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
import { FieldHandoverService } from '../field-visit/field-handover.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Registration started, not paid: the stuck registrations an agent chases. */
const STUCK_STATUSES = ['lead', 'consented', 'pending_activation'];
/** No-show: not logged in this long after the shift start (21 Nov fixes). */
export const NO_SHOW_AFTER_MINUTES = 60;

/**
 * Field items (visits, interviews to attend, revisits, joinings) are Builder C's
 * (Laboura Field): `FieldHandoverService.handOver(agentId, pickedTeammateId | 'spread',
 * { reason, actorId, leaveRequestId, until })`, exported by FieldVisitModule
 * (src/modules/field-visit/field-handover.service.ts), injected directly; the
 * FIELD_HANDOVER token is only for hand-built test doubles. `until` is an
 * instant on the last approved leave day: FieldHandoverService works out the
 * end itself (handoverEnd = the start of the next IST day).
 */
export const FIELD_HANDOVER = 'FIELD_HANDOVER';
export interface FieldHandoverPort {
  handOver(
    fromStaffId: string,
    to: string | 'spread',
    options: { reason: string; actorId?: string | null; leaveRequestId?: string | null; until?: Date | null },
  ): Promise<unknown>;
}

export const WHATSAPP_HANDOVER = 'WHATSAPP_HANDOVER';
export interface WhatsAppHandoverPort {
  handOver(fromStaffId: string, toStaffId: string | null): Promise<unknown>;
}

/** The WhatsAppInboxService class (Builder D), when its file is in this build. */
function whatsAppInboxClass(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../whatsapp-inbox/whatsapp-inbox.service') as { WhatsAppInboxService?: unknown }).WhatsAppInboxService ?? null;
  } catch {
    return null;
  }
}

/** Leave rows that cover `date` on their APPROVED dates (part approval: only those days). */
export function approvedOn(date: Date): Prisma.LeaveRequestWhereInput {
  return {
    OR: [
      { approvedFromDate: null, approvedToDate: null, fromDate: { lte: date }, toDate: { gte: date } },
      { approvedFromDate: { lte: date }, approvedToDate: { gte: date } },
    ],
  };
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
 * - on an approved full-day leave the Team Lead's choice is recorded at
 *   approval (WorkHandoverPlan); from the first approved leave day (the
 *   approved dates) everything open — call tasks (callbacks, retries, sign-up
 *   help), missed calls, follow-ups, the people the agent looks after (stuck
 *   registrations, close to a refund) and their app sign-ups — goes to the
 *   teammate picked, or is spread across the team, each item to whoever has
 *   the fewest open items; "keep" moves nothing; people and sign-ups go back
 *   after the leave if still with the teammate;
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
    // Builder C's field handover (FieldVisitModule): visits, interviews, revisits, joinings.
    @Optional() private readonly fieldService?: FieldHandoverService,
  ) {}

  private lookUp<T>(...tokens: unknown[]): T | null {
    if (!this.moduleRef) return null;
    for (const token of tokens) {
      if (!token) continue;
      try {
        const found = this.moduleRef.get<T>(token as string, { strict: false });
        if (found) return found;
      } catch {
        // Not provided in this build: try the next way, else not connected.
      }
    }
    return null;
  }

  private fieldHandover(): FieldHandoverPort | null {
    return this.fieldService ?? this.lookUp<FieldHandoverPort>(FIELD_HANDOVER);
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
   * After an approved leave (requests leave-approval hook): records the Team
   * Lead's choice (teammate, share, keep). Nothing moves now: the call-work
   * sweep moves the work when the first approved leave day starts
   * (sweepLeaves), so a leave approved a week ahead leaves today's list alone.
   */
  async onLeaveApproved(actorId: string, leaveId: string, choice: HandoverChoice | undefined): Promise<{ planned: string } | null> {
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!leave || leave.status !== 'approved') return null;
    if (!(await this.followUps.isFullDayLeave(leave))) return null;
    const mode = choice?.mode === 'share' || choice?.mode === 'teammate' ? choice.mode : 'keep';
    const toStaffId = mode === 'teammate' ? (choice?.staffId ?? null) : null;
    await this.prisma.workHandoverPlan.upsert({
      where: { leaveRequestId: leave.id },
      create: { leaveRequestId: leave.id, staffId: leave.staffId, mode, toStaffId, decidedByStaffId: actorId },
      update: { mode, toStaffId, decidedByStaffId: actorId },
    });
    return { planned: mode };
  }

  /**
   * Agents on a full day of approved leave today (the approved dates, not the
   * asked ones): their open work moves as the Team Lead planned — to the picked
   * teammate (when working today, else spread), spread across the teammates
   * by fewest open items, or nothing for "keep". Runs from midnight of each
   * leave day, so it is done before the teammates' shift starts, and keeps
   * moving anything new during the leave. A leave approved without a choice is
   * spread. People and app sign-ups come back after the leave.
   */
  async sweepLeaves(now: Date): Promise<{ agents: number; moved: number }> {
    const today = istDateValue(now);
    const todayKey = today.toISOString().slice(0, 10);
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { status: 'approved', ...approvedOn(today) },
      select: { id: true, staffId: true, half: true, fromDate: true, toDate: true, approvedFromDate: true, approvedToDate: true },
    });
    let agents = 0;
    let moved = 0;
    for (const leave of leaves) {
      if (!(await this.followUps.isFullDayLeave(leave))) continue;
      const staff = await this.prisma.staff.findUnique({ where: { id: leave.staffId }, select: { status: true, role: true } });
      if (!staff || staff.status !== 'active' || !['call_agent', 'field_agent'].includes(staff.role)) continue;
      const plan = await this.prisma.workHandoverPlan.findUnique({ where: { leaveRequestId: leave.id } });
      if (plan?.mode === 'keep') continue;
      const mates = (await this.followUps.teammates(leave.staffId, todayKey, todayKey)).map((m) => m.id);
      if (mates.length === 0) continue;
      const teammate = plan?.mode === 'teammate' && plan.toStaffId && mates.includes(plan.toStaffId) ? plan.toStaffId : null;
      const lastDay = (leave.approvedToDate ?? leave.toDate).toISOString().slice(0, 10);
      const end = new Date(new Date(`${lastDay}T00:00:00+05:30`).getTime() + DAY_MS);
      const result = await this.move({
        fromStaffId: leave.staffId,
        reason: 'leave',
        mode: teammate ? 'teammate' : 'share',
        takers: teammate ? [teammate] : mates,
        leaveRequestId: leave.id,
        actorId: plan?.decidedByStaffId ?? null,
        now,
        dueBefore: end,
        includePeople: true,
        includeFollowUps: true,
        returnAfter: end,
      });
      // Field items (Builder C) once per leave; WhatsApp conversations (Builder D) every run.
      const fieldDone = await this.prisma.workHandover.findFirst({ where: { leaveRequestId: leave.id, recordType: 'field' }, select: { id: true } });
      if (!fieldDone) {
        const field = await this.moveField(leave.staffId, teammate ?? 'spread', {
          reason: 'leave',
          leaveRequestId: leave.id,
          actorId: plan?.decidedByStaffId ?? null,
          // Any instant on the last leave day: FieldHandoverService reads its IST date.
          until: new Date(`${lastDay}T12:00:00+05:30`),
        });
        if (field !== 'not_connected') {
          await this.prisma.workHandover.create({
            data: { reason: 'leave', leaveRequestId: leave.id, recordType: 'field', recordId: field, fromStaffId: leave.staffId, toStaffId: teammate ?? 'spread', mode: teammate ? 'teammate' : 'share', movedAt: now },
          });
        }
      }
      await this.moveWhatsApp(leave.staffId, teammate);
      const count = result.callTasks + result.missedCalls + result.followUps + result.people + result.signups;
      if (count) {
        agents += 1;
        moved += count;
      }
    }
    return { agents, moved };
  }

  /**
   * Builder D's WhatsApp inbox (PR #168): `WhatsAppInboxService.handOver(from, to | null)` moves the
   * agent's open conversations (null = back to the software's own assignment). Looked up at run time;
   * until it is in the build nothing happens here.
   */
  private async moveWhatsApp(fromStaffId: string, toStaffId: string | null): Promise<'moved' | 'not_connected' | 'failed'> {
    const inbox = this.lookUp<WhatsAppHandoverPort>(whatsAppInboxClass(), WHATSAPP_HANDOVER);
    if (!inbox) return 'not_connected';
    try {
      await inbox.handOver(fromStaffId, toStaffId);
      return 'moved';
    } catch (err) {
      this.logger.error(`WhatsApp handover for ${fromStaffId} failed: ${(err as Error).message}`);
      return 'failed';
    }
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
      // Rev 211: paid but waiting for the ID check is stuck work too.
      this.prisma.jobSeeker.findMany({ where: { AND: [mine, { OR: [{ paymentReceivedAt: null, status: { in: STUCK_STATUSES } }, { status: PAID_WAITING_ID }] }] }, select: { id: true }, take: 500 }),
      this.prisma.jobSeeker.findMany({
        where: {
          ...mine,
          status: { notIn: SEEKER_ENDED_STATUSES },
          // Close to a refund: counted from the start of his 30 days (paid and ID passed).
          guaranteeStartsAt: {
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
   * an agent with no login today an hour after their shift start has today's
   * open call items spread across the teammates on shift. An agent on a full
   * day of approved leave today has whatever reached them since the approval
   * spread the same way (from the shift start).
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
      select: { id: true, role: true, teamLeadId: true, reportsToId: true, reportsTo: { select: { role: true } }, shiftStart: true, shiftEnd: true },
    });
    if (agents.length === 0) return { agents: 0, moved: 0 };
    const ids = agents.map((a) => a.id);
    const [days, leaves] = await Promise.all([
      this.prisma.attendanceDay.findMany({ where: { staffId: { in: ids }, date }, select: { staffId: true, loginAt: true, logoutAt: true, dayType: true } }),
      this.prisma.leaveRequest.findMany({
        where: { staffId: { in: ids }, status: 'approved', ...approvedOn(date) },
        select: { staffId: true, half: true },
      }),
    ]);
    const dayOf = new Map(days.map((d) => [d.staffId, d]));
    // A half day of leave still works the other half: only a full day away counts.
    const halves = new Map<string, number>();
    for (const l of leaves) if (l.half) halves.set(l.staffId, (halves.get(l.staffId) ?? 0) + 1);
    const away = new Set(leaves.filter((l) => !l.half || (halves.get(l.staffId) ?? 0) >= 2).map((l) => l.staffId));
    const halfDay = new Set(leaves.filter((l) => l.half && !away.has(l.staffId)).map((l) => l.staffId));
    const working = new Set(days.filter((d) => d.loginAt && !d.logoutAt && d.dayType !== 'leave').map((d) => d.staffId));
    let agentsMoved = 0;
    let moved = 0;
    for (const agent of agents) {
      // On leave today: sweepLeaves moves their work as the Team Lead planned (keep = nothing).
      if (halfDay.has(agent.id) || away.has(agent.id)) continue;
      const day = dayOf.get(agent.id);
      if (day?.loginAt || day?.dayType === 'leave') continue;
      // Their own shift (an agent on a later shift is never a no-show at the company shift's time).
      const shift = shiftOf(policy, agent);
      const start = clockMinutes(shift.start);
      const end = clockMinutes(shift.end);
      if (start === null || end === null) continue;
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
        const field = await this.moveField(agent.id, 'spread', { reason: 'no_show', actorId: null, leaveRequestId: null, until: now });
        await this.moveWhatsApp(agent.id, null);
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
    // A leave no longer approved (a Manager overturned it mid-leave) gives its people back now,
    // not at the original leave end. The leave's current status is what counts.
    const pending = await this.prisma.workHandover.findMany({
      where: { returnedAt: null, leaveRequestId: { not: null }, recordType: { in: ['job_seeker', 'signup_tracker'] } },
      distinct: ['leaveRequestId'],
      select: { leaveRequestId: true },
    });
    const leaveIds = pending.map((p) => p.leaveRequestId!).filter(Boolean);
    const stillApproved = leaveIds.length
      ? new Set((await this.prisma.leaveRequest.findMany({ where: { id: { in: leaveIds }, status: 'approved' }, select: { id: true } })).map((l) => l.id))
      : new Set<string>();
    const gone = leaveIds.filter((id) => !stillApproved.has(id));
    const due = await this.prisma.workHandover.findMany({
      where: {
        returnedAt: null,
        recordType: { in: ['job_seeker', 'signup_tracker'] },
        OR: [{ returnAfter: { lte: now } }, ...(gone.length ? [{ leaveRequestId: { in: gone } }] : [])],
      },
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
