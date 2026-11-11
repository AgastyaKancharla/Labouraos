import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AttendanceDay, AttendanceSegment, PricingPolicy } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { AttendanceClock } from './attendance-clock';
import {
  AFTER_CALL_NOTES_MS,
  BREAK_STATUSES,
  IDLE_PROMPT_MINUTES,
  IDLE_STATUS,
  PRODUCTION_STATUSES,
  isStaffPickedStatus,
} from './attendance.constants';
import { classifyDay } from './day-rules';
import { WorkingDaysService } from './working-days.service';

const AGENT_ROLES = ['call_agent', 'field_agent'];

export interface TodayView {
  date: string;
  status: string | null;
  loginAt: string | null;
  logoutAt: string | null;
  lateMinutes: number;
  productionSeconds: number;
  breakSeconds: number;
  idleSeconds: number;
  shortfallSeconds: number;
  clocks: { shiftStart: string; shiftEnd: string; now: string };
  flagged: boolean;
  closedReason: string | null;
  dayType: string;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly reviewFlags: ReviewFlagService,
    private readonly clock: AttendanceClock,
    private readonly workingDays: WorkingDaysService,
    @Optional() private readonly bells?: NotificationSourcesService,
  ) {}

  /** A bell never blocks attendance: failures are logged, not thrown. */
  private async bell(label: string, run: (bells: NotificationSourcesService) => Promise<unknown>) {
    if (!this.bells) return;
    try {
      await run(this.bells);
    } catch (error) {
      this.logger.warn(`Bell "${label}" failed: ${(error as Error).message}`);
    }
  }

  /**
   * Applies the automatic statuses (back from after-call notes, idle, break
   * overrun alerts) for everyone whose day is open now. The notification
   * sweep calls it, because an idle agent's own screen sends nothing.
   */
  async refreshOpenDays(): Promise<{ refreshed: number }> {
    const now = this.clock.now();
    const open = await this.prisma.attendanceDay.findMany({
      where: { date: this.istDate(now), logoutAt: null, dayType: 'open', loginAt: { not: null } },
      select: { staffId: true },
    });
    for (const day of open) {
      await this.applyAutomatic(day.staffId, now);
    }
    return { refreshed: open.length };
  }

  async login(
    staffId: string,
    body: { latitude?: number; longitude?: number; loginAt?: string },
  ): Promise<TodayView> {
    const now = this.clock.now();
    const staff = await this.requireStaff(staffId);
    const policy = await this.pricing.current();
    const date = this.istDate(now);
    const existing = await this.prisma.attendanceDay.findUnique({
      where: { staffId_date: { staffId, date } },
    });
    if (existing?.logoutAt) {
      throw new BadRequestException('This day is already closed');
    }
    if (existing?.loginAt) {
      return this.today(staffId);
    }
    let loginLat: number | null = null;
    let loginLng: number | null = null;
    if (staff.role === 'field_agent') {
      if (!this.validCoordinate(body.latitude, body.longitude)) {
        throw new BadRequestException('Field agents save their location at login');
      }
      loginLat = body.latitude as number;
      loginLng = body.longitude as number;
    }
    const lateMinutes = this.lateMinutes(now, policy);
    if (existing) {
      // A day marked absent or leave before the person logged in becomes a
      // working day. The leave fields stay so the leave flow can see them.
      await this.prisma.attendanceDay.update({
        where: { id: existing.id },
        data: {
          loginAt: now,
          loginLat,
          loginLng,
          lateMinutes,
          lastHeartbeatAt: now,
          dayType: 'open',
          closedReason: null,
          segments: {
            create: { staffId, status: 'available', startedAt: now, source: 'staff' },
          },
        },
      });
      return this.today(staffId);
    }
    await this.prisma.attendanceDay.create({
      data: {
        staffId,
        date,
        loginAt: now,
        loginLat,
        loginLng,
        lateMinutes,
        lastHeartbeatAt: now,
        dayType: 'open',
        segments: {
          create: {
            staffId,
            status: 'available',
            startedAt: now,
            source: 'staff',
          },
        },
      },
    });
    return this.today(staffId);
  }

  async logout(staffId: string): Promise<TodayView> {
    const now = this.clock.now();
    const day = await this.openDay(staffId, now);
    await this.finishDay(day.id, now, 'logout', false);
    return this.today(staffId);
  }

  async setStatus(staffId: string, status: string): Promise<TodayView> {
    if (!isStaffPickedStatus(status)) {
      throw new BadRequestException(
        'On call, after-call notes, on visit, travelling and idle cannot be set by hand',
      );
    }
    const now = this.clock.now();
    await this.applyAutomatic(staffId, now);
    const day = await this.openDay(staffId, now);
    await this.switchStatus(day.id, staffId, status, 'staff', now);
    return this.today(staffId);
  }

  async heartbeat(staffId: string): Promise<TodayView> {
    const now = this.clock.now();
    await this.applyAutomatic(staffId, now);
    const day = await this.openDay(staffId, now);
    const current = await this.openSegment(day.id);
    if (current?.status === IDLE_STATUS) {
      await this.switchStatus(day.id, staffId, 'available', 'staff', now);
    }
    await this.prisma.attendanceDay.update({
      where: { id: day.id },
      data: { lastHeartbeatAt: now },
    });
    return this.today(staffId);
  }

  async today(staffId: string): Promise<TodayView> {
    const now = this.clock.now();
    await this.applyAutomatic(staffId, now);
    const policy = await this.pricing.current();
    const day = await this.prisma.attendanceDay.findUnique({
      where: { staffId_date: { staffId, date: this.istDate(now) } },
      include: { segments: { orderBy: { startedAt: 'asc' } } },
    });
    if (!day || !day.loginAt) {
      return { ...this.emptyToday(now, policy), dayType: day?.dayType ?? 'open' };
    }
    const totals = this.totals(day.segments, now);
    if (!day.logoutAt) {
      await this.prisma.attendanceDay.update({
        where: { id: day.id },
        data: totals,
      });
    }
    const fullSeconds = Math.round(policy.productionHoursFullDay * 3600);
    const current = [...day.segments].reverse().find((segment) => !segment.endedAt);
    return {
      date: this.dateLabel(day.date),
      status: current?.status ?? null,
      loginAt: day.loginAt.toISOString(),
      logoutAt: day.logoutAt?.toISOString() ?? null,
      lateMinutes: day.lateMinutes,
      productionSeconds: day.logoutAt ? day.productionSeconds : totals.productionSeconds,
      breakSeconds: day.logoutAt ? day.breakSeconds : totals.breakSeconds,
      idleSeconds: day.logoutAt ? day.idleSeconds : totals.idleSeconds,
      shortfallSeconds: day.logoutAt
        ? day.shortfallSeconds
        : Math.max(0, fullSeconds - totals.productionSeconds),
      clocks: {
        shiftStart: policy.shiftStart,
        shiftEnd: policy.shiftEnd,
        now: now.toISOString(),
      },
      flagged: day.flagged,
      closedReason: day.closedReason,
      dayType: day.dayType,
    };
  }

  async approveSystemProblem(segmentId: string, actorId: string): Promise<{ approved: true }> {
    const segment = await this.prisma.attendanceSegment.findUnique({
      where: { id: segmentId },
    });
    if (!segment || segment.status !== 'system_problem') {
      throw new NotFoundException('System problem segment not found');
    }
    if (segment.staffId === actorId) {
      throw new ForbiddenException('You cannot approve your own system problem');
    }
    const person = await this.requireStaff(segment.staffId);
    const actor = await this.requireStaff(actorId);
    const leadId = person.reportsToId ?? person.teamLeadId;
    const allowed =
      actor.role === 'ceo' ||
      actorId === leadId ||
      (actor.role === 'manager' && (await this.managerCovers(actorId, person.id)));
    if (!allowed) {
      throw new ForbiddenException('A Team Lead approves a system problem');
    }
    if (!segment.approvedAt) {
      await this.prisma.attendanceSegment.update({
        where: { id: segment.id },
        data: { approvedAt: this.clock.now(), approvedByStaffId: actorId },
      });
    }
    await this.bell('system problem approved', (bells) =>
      bells.syncSystemProblem(segment.id, this.clock.now()),
    );
    return { approved: true };
  }

  /** Field agent arrived at a business. Sets On visit. */
  async noteBusinessCheckIn(staffId: string): Promise<void> {
    const now = this.clock.now();
    const day = await this.findOpenDay(staffId, now);
    if (!day) return;
    await this.switchStatus(day.id, staffId, 'on_visit', 'check_in', now);
  }

  /** Field agent left a business. Sets Travelling. */
  async noteBusinessCheckOut(staffId: string): Promise<void> {
    const now = this.clock.now();
    const day = await this.openDay(staffId, now);
    await this.switchStatus(day.id, staffId, 'travelling', 'check_in', now);
  }

  async onCallAnswered(staffId: string | null): Promise<void> {
    if (!staffId) return;
    const now = this.clock.now();
    const day = await this.findOpenDay(staffId, now);
    if (!day) return;
    const current = await this.openSegment(day.id);
    if (current?.status === 'on_call') return;
    await this.switchStatus(day.id, staffId, 'on_call', 'phone_system', now);
  }

  async onCallEnded(staffId: string | null): Promise<void> {
    if (!staffId) return;
    const now = this.clock.now();
    const day = await this.findOpenDay(staffId, now);
    if (!day) return;
    const current = await this.openSegment(day.id);
    if (current?.status === 'after_call_notes') return;
    await this.switchStatus(day.id, staffId, 'after_call_notes', 'phone_system', now);
  }

  async isAvailable(staffId: string): Promise<boolean> {
    const now = this.clock.now();
    await this.applyAutomatic(staffId, now);
    const day = await this.findOpenDay(staffId, now);
    if (!day) return false;
    const current = await this.openSegment(day.id);
    return current?.status === 'available';
  }

  /** Next call or field agent who is Available, skipping anyone who is not. */
  async nextAvailableAgent(skipStaffId?: string): Promise<string | null> {
    const agents = await this.prisma.staff.findMany({
      where: { role: { in: AGENT_ROLES }, status: 'active' },
      select: { id: true },
      orderBy: { code: 'asc' },
    });
    for (const agent of agents) {
      if (agent.id === skipStaffId) continue;
      if (await this.isAvailable(agent.id)) return agent.id;
    }
    return null;
  }

  async closeForgottenDays(staffId?: string): Promise<{ closed: number }> {
    const open = await this.prisma.attendanceDay.findMany({
      where: { logoutAt: null, dayType: 'open', ...(staffId ? { staffId } : {}) },
      include: { segments: true },
    });
    let closed = 0;
    for (const day of open) {
      const last = this.lastActivity(day);
      await this.finishDay(day.id, last, 'auto_closed_no_logout', true);
      closed += 1;
    }
    return { closed };
  }

  private async finishDay(
    dayId: string,
    at: Date,
    closedReason: 'logout' | 'auto_closed_no_logout',
    flagged: boolean,
  ): Promise<void> {
    const day = await this.prisma.attendanceDay.findUniqueOrThrow({
      where: { id: dayId },
      include: { segments: true },
    });
    const open = day.segments.find((segment) => !segment.endedAt);
    if (open) {
      await this.endSegment(open, at);
    }
    const segments = await this.prisma.attendanceSegment.findMany({
      where: { dayId },
    });
    const totals = this.totals(segments, at);
    const policy = await this.pricing.current();
    const result = classifyDay(
      totals.productionSeconds,
      policy,
      await this.workingDays.isNonWorking(day.date),
    );
    await this.prisma.attendanceDay.update({
      where: { id: dayId },
      data: {
        ...totals,
        ...result,
        logoutAt: at,
        closedReason,
        flagged,
      },
    });
  }

  /**
   * Adds the clocks up again from the segments, after a correction. A closed
   * day gets its day type again from the new production, unless a Team Lead
   * or Manager changed it; then the change stays.
   */
  async recalculateDay(dayId: string): Promise<void> {
    const day = await this.prisma.attendanceDay.findUniqueOrThrow({
      where: { id: dayId },
      include: { segments: true },
    });
    const end = day.logoutAt ?? this.clock.now();
    const totals = this.totals(day.segments, end);
    if (!day.logoutAt) {
      await this.prisma.attendanceDay.update({ where: { id: dayId }, data: totals });
      return;
    }
    const policy = await this.pricing.current();
    const result = classifyDay(
      totals.productionSeconds,
      policy,
      await this.workingDays.isNonWorking(day.date),
    );
    const changed = Boolean(day.dayTypeChangedAt);
    await this.prisma.attendanceDay.update({
      where: { id: dayId },
      data: {
        ...totals,
        dayType: changed ? day.dayType : result.dayType,
        shortfallSeconds: changed ? 0 : result.shortfallSeconds,
        makeUpSeconds: changed && day.dayType === 'half' ? 0 : result.makeUpSeconds,
      },
    });
  }

  private async applyAutomatic(staffId: string, now: Date): Promise<void> {
    const day = await this.findOpenDay(staffId, now);
    if (!day) return;
    const current = await this.openSegment(day.id);
    if (!current) return;
    if (current.status === 'after_call_notes') {
      const backAt = new Date(current.startedAt.getTime() + AFTER_CALL_NOTES_MS);
      if (now.getTime() >= backAt.getTime()) {
        await this.switchStatus(day.id, staffId, 'available', 'phone_system', backAt);
      }
      return;
    }
    if ((BREAK_STATUSES as readonly string[]).includes(current.status)) {
      await this.raiseBreakOverrun(current, now);
      return;
    }
    if (current.status !== 'available') return;
    const policy = await this.pricing.current();
    const idleAfterMs = (policy.idleAfterMinutes + IDLE_PROMPT_MINUTES) * 60 * 1000;
    const sinceMs = Math.max(
      (day.lastHeartbeatAt ?? current.startedAt).getTime(),
      current.startedAt.getTime(),
    );
    const idleAt = new Date(sinceMs + idleAfterMs);
    if (now.getTime() >= idleAt.getTime()) {
      await this.switchStatus(day.id, staffId, IDLE_STATUS, 'idle_detector', idleAt);
    }
  }

  private async switchStatus(
    dayId: string,
    staffId: string,
    status: string,
    source: string,
    now: Date,
  ): Promise<void> {
    const current = await this.openSegment(dayId);
    if (current?.status === status && !current.endedAt) return;
    if (current) await this.endSegment(current, now);
    const created = await this.prisma.attendanceSegment.create({
      data: { staffId, dayId, status, startedAt: now, source },
    });
    if (status === 'system_problem') {
      await this.bell('system problem', (bells) => bells.syncSystemProblem(created.id, now));
    }
  }

  private async endSegment(segment: AttendanceSegment, at: Date): Promise<void> {
    const endedAt = at.getTime() < segment.startedAt.getTime() ? segment.startedAt : at;
    await this.prisma.attendanceSegment.update({
      where: { id: segment.id },
      data: { endedAt },
    });
    if ((BREAK_STATUSES as readonly string[]).includes(segment.status)) {
      await this.raiseBreakOverrun({ ...segment, endedAt }, endedAt);
      await this.bell('break ended', (bells) => bells.closeBreak(segment.id, segment.staffId, endedAt));
    }
    if (segment.status === IDLE_STATUS) {
      await this.bell('idle ended', (bells) => bells.closeIdle(segment.id, segment.staffId, endedAt));
    }
  }

  private async raiseBreakOverrun(segment: AttendanceSegment, endedAt: Date): Promise<void> {
    const policy = await this.pricing.current();
    const allowanceMinutes =
      segment.status === 'lunch' ? policy.lunchMinutes : policy.shortBreakMinutes;
    const minutes = Math.floor((endedAt.getTime() - segment.startedAt.getTime()) / 60000);
    if (minutes <= allowanceMinutes) return;
    const existing = await this.prisma.reviewFlag.findFirst({
      where: { kind: 'break_overrun', subjectType: 'attendance_segment', subjectId: segment.id },
    });
    if (existing) return;
    const person = await this.requireStaff(segment.staffId);
    const leadId = person.reportsToId ?? person.teamLeadId;
    if (!leadId) return;
    await this.reviewFlags.raise({
      kind: 'break_overrun',
      subjectType: 'attendance_segment',
      subjectId: segment.id,
      raisedForStaffId: leadId,
      details: { status: segment.status, minutes, allowanceMinutes },
    });
    await this.bell('break overrun', (bells) =>
      bells.openBreakOverrun(segment, minutes, allowanceMinutes, endedAt),
    );
  }

  private totals(segments: AttendanceSegment[], now: Date): {
    productionSeconds: number;
    breakSeconds: number;
    idleSeconds: number;
  } {
    let productionSeconds = 0;
    let breakSeconds = 0;
    let idleSeconds = 0;
    for (const segment of segments) {
      const end = segment.endedAt ?? now;
      const seconds = Math.max(0, Math.floor((end.getTime() - segment.startedAt.getTime()) / 1000));
      if (segment.status === IDLE_STATUS) {
        idleSeconds += seconds;
      } else if ((BREAK_STATUSES as readonly string[]).includes(segment.status)) {
        breakSeconds += seconds;
      } else if ((PRODUCTION_STATUSES as readonly string[]).includes(segment.status)) {
        if (segment.status === 'system_problem' && !segment.approvedAt) continue;
        productionSeconds += seconds;
      }
    }
    return { productionSeconds, breakSeconds, idleSeconds };
  }

  private lastActivity(day: AttendanceDay & { segments: AttendanceSegment[] }): Date {
    let latest = (day.loginAt ?? day.createdAt).getTime();
    if (day.lastHeartbeatAt) latest = Math.max(latest, day.lastHeartbeatAt.getTime());
    for (const segment of day.segments) {
      latest = Math.max(latest, segment.startedAt.getTime());
      if (segment.endedAt) latest = Math.max(latest, segment.endedAt.getTime());
    }
    return new Date(latest);
  }

  lateMinutes(loginAt: Date, policy: PricingPolicy): number {
    const parts = getCalendarPartsInTimezone(loginAt);
    const [startHour, startMinute] = policy.shiftStart.split(':').map((part) => Number(part));
    const loginMinutes = parts.hour * 60 + parts.minute;
    const startMinutes = startHour * 60 + startMinute;
    const lateBy = loginMinutes - startMinutes;
    if (lateBy <= policy.lateGraceMinutes) return 0;
    return lateBy;
  }

  istDate(now: Date): Date {
    const parts = getCalendarPartsInTimezone(now);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  private dateLabel(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private emptyToday(now: Date, policy: PricingPolicy): TodayView {
    const fullSeconds = Math.round(policy.productionHoursFullDay * 3600);
    return {
      date: this.dateLabel(this.istDate(now)),
      status: null,
      loginAt: null,
      logoutAt: null,
      lateMinutes: 0,
      productionSeconds: 0,
      breakSeconds: 0,
      idleSeconds: 0,
      shortfallSeconds: fullSeconds,
      clocks: { shiftStart: policy.shiftStart, shiftEnd: policy.shiftEnd, now: now.toISOString() },
      flagged: false,
      closedReason: null,
      dayType: 'open',
    };
  }

  private async openDay(staffId: string, now: Date): Promise<AttendanceDay> {
    const day = await this.findOpenDay(staffId, now);
    if (!day) throw new BadRequestException('Log in before changing status');
    return day;
  }

  private findOpenDay(staffId: string, now: Date): Promise<AttendanceDay | null> {
    return this.prisma.attendanceDay.findFirst({
      where: { staffId, date: this.istDate(now), logoutAt: null, dayType: 'open' },
    });
  }

  private openSegment(dayId: string): Promise<AttendanceSegment | null> {
    return this.prisma.attendanceSegment.findFirst({
      where: { dayId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  private async requireStaff(id: string): Promise<{
    id: string;
    role: string;
    reportsToId: string | null;
    teamLeadId: string | null;
  }> {
    const staff = await this.prisma.staff.findUnique({
      where: { id },
      select: { id: true, role: true, reportsToId: true, teamLeadId: true },
    });
    if (!staff) throw new NotFoundException('Staff account not found');
    return staff;
  }

  private async managerCovers(managerId: string, staffId: string): Promise<boolean> {
    const rows = await this.prisma.staff.findMany({
      select: { id: true, reportsToId: true, teamLeadId: true, role: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const seen = new Set<string>();
    let current = byId.get(staffId);
    for (let hop = 0; current && hop < 8; hop += 1) {
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      const nextId =
        current.reportsToId ??
        (AGENT_ROLES.includes(current.role) ? current.teamLeadId : null);
      if (!nextId) return false;
      if (nextId === managerId) return true;
      current = byId.get(nextId);
    }
    return false;
  }

  private validCoordinate(latitude?: number, longitude?: number): boolean {
    return (
      typeof latitude === 'number' &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      typeof longitude === 'number' &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    );
  }
}
