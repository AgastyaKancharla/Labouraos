import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { teamLeadOf } from '../../common/rbac/own-team';
import { PricingService } from '../pricing/pricing.service';
import { NotificationService, NotificationDraft } from '../notification/notification.service';
import { notificationLink } from '../notification/notification.constants';
import { InboundCallRouter, tenDigits } from './inbound-call-router.service';
import { clockMinutes, fewestOpen, istDayStartUtc, istMinute, onShiftCallAgents, openItemCounts } from './call-agent-load';

/** Team Lead bell when a missed call waits longer than this for its first call back (21 Nov fixes). */
export const MISSED_CALL_TL_BELL_MINUTES = 15;
/** Then the Manager. */
export const MISSED_CALL_MANAGER_BELL_MINUTES = 60;
/** The target: the first call back within this many minutes of the missed call. */
export const MISSED_CALL_TARGET_MINUTES = 30;
const BATCH = 200;

export interface AssignResult {
  assigned: number;
  waiting: number;
  bells: number;
}

/**
 * Hands out missed calls (21 Nov fixes, Master Guide rev 202, "Missed calls
 * and unknown callers"). Runs every few minutes (call-work sweep) inside the
 * calling hours, so every missed call that came in while nobody was free —
 * or at night — is given out at shift start.
 *
 * Who gets it, oldest missed call first:
 * 1. the agent already holding an open missed call from the same number (one
 *    agent per caller: repeat calls are grouped);
 * 2. the person's own agent (assigned or registering agent, the business's
 *    account agent), if on shift;
 * 3. the call agent on shift with the fewest open items (ties: the one given
 *    work longest ago).
 * Unknown numbers are handed out the same way and stay on the agent's list as
 * a "New caller — register" row until handled.
 *
 * Bells: the holder's Team Lead (every Team Lead when nobody holds it) after
 * 15 minutes without a first call back; their Manager after an hour. The
 * clock starts at the missed call, or at the start of the calling hours for a
 * call that came in before them.
 */
@Injectable()
export class MissedCallAssigner {
  private readonly logger = new Logger(MissedCallAssigner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly router: InboundCallRouter,
    private readonly notifications: NotificationService,
  ) {}

  private async callingWindow(now: Date): Promise<{ inHours: boolean; startsAt: Date }> {
    const policy = await this.pricing.current();
    const start = clockMinutes(policy.callingHoursStart) ?? 9 * 60;
    const end = clockMinutes(policy.callingHoursEnd) ?? 21 * 60;
    const minute = istMinute(now);
    return { inHours: minute >= start && minute < end, startsAt: new Date(istDayStartUtc(now).getTime() + start * 60_000) };
  }

  async sweep(now: Date = new Date()): Promise<AssignResult> {
    const window = await this.callingWindow(now);
    if (!window.inHours) return { assigned: 0, waiting: 0, bells: 0 };
    const assigned = await this.assignWaiting(now);
    const { waiting, bells } = await this.ringBells(now, window.startsAt);
    return { assigned, waiting, bells };
  }

  /** Gives every unassigned missed call to an agent on shift. Returns how many were given out. */
  async assignWaiting(now: Date): Promise<number> {
    const unassigned = await this.prisma.callbackTask.findMany({
      where: { status: 'pending', assignedToStaffId: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    if (unassigned.length === 0) return 0;
    const onShift = await onShiftCallAgents(this.prisma, now);
    if (onShift.length === 0) return 0;
    const counts = await openItemCounts(this.prisma, onShift, now);
    const last = await this.prisma.callbackTask.groupBy({
      by: ['assignedToStaffId'],
      where: { assignedToStaffId: { in: onShift }, assignedAt: { not: null } },
      _max: { assignedAt: true },
    });
    const lastGiven = new Map(last.map((l) => [l.assignedToStaffId!, l._max.assignedAt]));
    let given = 0;
    for (const task of unassigned) {
      const caller = await this.router.identify(task.phone);
      let pick: { staffId: string; reason: string } | null = null;
      const digits = tenDigits(task.phone);
      if (digits.length === 10) {
        const sibling = await this.prisma.callbackTask.findFirst({
          where: { id: { not: task.id }, status: 'assigned', assignedToStaffId: { in: onShift }, phone: { endsWith: digits } },
          orderBy: { createdAt: 'asc' },
          select: { assignedToStaffId: true },
        });
        if (sibling?.assignedToStaffId) pick = { staffId: sibling.assignedToStaffId, reason: 'same_caller' };
      }
      if (!pick && caller?.ownerStaffId && onShift.includes(caller.ownerStaffId)) {
        pick = { staffId: caller.ownerStaffId, reason: 'own_agent' };
      }
      if (!pick) {
        const staffId = fewestOpen(onShift, counts, lastGiven);
        if (staffId) pick = { staffId, reason: 'fewest_open' };
      }
      if (!pick) continue;
      const moved = await this.prisma.callbackTask.updateMany({
        where: { id: task.id, status: 'pending', assignedToStaffId: null },
        data: {
          assignedToStaffId: pick.staffId,
          status: 'assigned',
          assignedAt: now,
          assignmentReason: pick.reason,
          jobSeekerId: caller?.type === 'job_seeker' && !task.jobSeekerId ? caller.id : undefined,
          callerName: caller?.type === 'job_seeker' && !task.jobSeekerId ? caller.name : undefined,
        },
      });
      if (moved.count !== 1) continue;
      given += 1;
      counts.set(pick.staffId, (counts.get(pick.staffId) ?? 0) + 1);
      lastGiven.set(pick.staffId, now);
    }
    if (given) this.logger.log(`Missed calls handed out: ${given}`);
    return given;
  }

  /**
   * Bells for missed calls with no first call back yet: the holder's Team
   * Lead after 15 minutes, their Manager after an hour; every open bell whose
   * missed call has been called back (or closed) clears by itself.
   */
  async ringBells(now: Date, callingStartsAt: Date): Promise<{ waiting: number; bells: number }> {
    const open = await this.prisma.callbackTask.findMany({
      where: { status: { in: ['pending', 'assigned'] }, firstAttemptAt: null },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, phone: true, createdAt: true, assignedToStaffId: true, callerName: true },
    });
    const drafts: NotificationDraft[] = [];
    const leadsCache = new Map<string, { teamLeadId: string | null; managerId: string | null }>();
    let allLeads: string[] | null = null;
    let allManagers: string[] | null = null;
    let waiting = 0;
    for (const task of open) {
      const since = task.createdAt.getTime() > callingStartsAt.getTime() ? task.createdAt : callingStartsAt;
      const minutes = Math.floor((now.getTime() - since.getTime()) / 60_000);
      if (minutes < MISSED_CALL_TL_BELL_MINUTES) continue;
      waiting += 1;
      const line = task.assignedToStaffId ? await this.lineOf(task.assignedToStaffId, leadsCache) : null;
      let leads: string[];
      if (line?.teamLeadId) leads = [line.teamLeadId];
      else {
        allLeads ??= (await this.prisma.staff.findMany({ where: { role: 'team_lead', status: 'active' }, select: { id: true } })).map((s) => s.id);
        leads = allLeads;
      }
      const recipients: Array<{ id: string; role: string }> = leads.map((id) => ({ id, role: 'team_lead' }));
      if (minutes >= MISSED_CALL_MANAGER_BELL_MINUTES) {
        if (line?.managerId) recipients.push({ id: line.managerId, role: 'manager' });
        else if (!line?.teamLeadId) {
          allManagers ??= (await this.prisma.staff.findMany({ where: { role: 'manager', status: 'active' }, select: { id: true } })).map((s) => s.id);
          recipients.push(...allManagers.map((id) => ({ id, role: 'manager' })));
        }
      }
      for (const r of recipients) {
        drafts.push({
          recipientStaffId: r.id,
          kind: 'missed_call_waiting',
          title: `Missed call waiting ${minutes} min (…${tenDigits(task.phone).slice(-4)})`,
          body: task.assignedToStaffId ? 'Not called back yet by the agent who holds it.' : 'Nobody holds it yet: give it to an agent.',
          link: notificationLink(r.role, 'missed_call_waiting'),
          subjectType: 'callback_task',
          subjectId: task.id,
        });
      }
    }
    const { opened } = await this.notifications.reconcileKind('missed_call_waiting', drafts, () => ({ reason: 'Called back or closed' }), now);
    return { waiting, bells: opened };
  }

  private async lineOf(staffId: string, cache: Map<string, { teamLeadId: string | null; managerId: string | null }>) {
    const hit = cache.get(staffId);
    if (hit) return hit;
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { role: true, teamLeadId: true, reportsToId: true, reportsTo: { select: { role: true } } },
    });
    const teamLeadId = staff ? teamLeadOf(staff) : null;
    let managerId: string | null = null;
    if (teamLeadId) {
      const lead = await this.prisma.staff.findUnique({ where: { id: teamLeadId }, select: { reportsToId: true, reportsTo: { select: { role: true } } } });
      if (lead?.reportsTo?.role === 'manager') managerId = lead.reportsToId;
    }
    const line = { teamLeadId, managerId };
    cache.set(staffId, line);
    return line;
  }
}
