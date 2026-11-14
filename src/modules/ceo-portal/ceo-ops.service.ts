import { dayTally, leaveHalvesOf } from '../attendance/leave-units';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ATTENDANCE_ROLES, AttendanceDaysService, DayRow } from '../attendance/attendance-days.service';
import { AttendanceReportsService } from '../attendance/attendance-reports.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { DateRange, DAY_MS, istDayKey, istStartOfMonth, percent, average } from './ceo-common';
import { teamLabel } from './ceo-team.service';
import { calculateHaversineDistanceMeters } from '../../common/geo/geo.util';
import { NOT_OWNER_ACCOUNT } from '../staff/owner-account';

/** IST calendar day of an instant, as the Date value an @db.Date column holds. */
function dbDate(instant: Date): Date {
  return new Date(`${istDayKey(instant)}T00:00:00.000Z`);
}

/** Follow-up kinds grouped the way the Call center card shows them. */
export const FOLLOW_UP_GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: 'day7', label: 'Day 7 after "not selected"', kinds: ['not_selected_day_7'] },
  { key: 'day30', label: 'Day 30', kinds: ['not_selected_day_30'] },
  { key: 'day90', label: 'Day 90', kinds: ['not_selected_day_90'] },
  { key: 'refund', label: 'Refund check', kinds: ['refund_check'] },
  { key: 'checkins', label: 'Joining day 7 / 30 check-ins', kinds: ['placement_check_in_day_7', 'placement_check_in_day_30'] },
];

/** What a person's day "counts as" on the Attendance screen. */
export function countsAs(row: Pick<DayRow, 'dayType' | 'leaveKind' | 'leaveUnpaid' | 'shortfallSeconds' | 'lateMinutes' | 'change'> & { leaveHalf?: string | null }): string {
  const late = row.lateMinutes > 0 ? 'Late · ' : '';
  if (row.leaveHalf && row.leaveKind) {
    // A half day of leave (owner decision 12 Nov): half leave, half a working day.
    const leave = `${row.leaveHalf === 'first' ? 'First' : 'Second'} half ${row.leaveKind} leave${row.leaveUnpaid ? ' (unpaid)' : ''}`;
    if (row.dayType === 'full') return row.shortfallSeconds > 0 ? `${leave} · ${late}${Math.round(row.shortfallSeconds / 60)}m short` : `${leave} · ${late}worked half`;
    if (row.dayType === 'half') return `${leave} · working half not worked`;
    if (row.dayType === 'leave' || row.dayType === 'absent') return `${leave} · not logged in`;
    return `${leave} · working`;
  }
  switch (row.dayType) {
    case 'full':
      if (row.change) return 'Changed to full day';
      if (row.shortfallSeconds > 0) return `${late}${Math.round(row.shortfallSeconds / 60)}m short`;
      return row.lateMinutes > 0 ? 'Late · full day' : 'Full day';
    case 'half':
      return row.change ? 'Changed to half day' : 'Half day';
    case 'absent':
      return 'Absent · no leave';
    case 'leave':
      return `${row.leaveKind ? row.leaveKind.charAt(0).toUpperCase() + row.leaveKind.slice(1) : 'Paid'} leave${row.leaveUnpaid ? ' (unpaid)' : ''}`;
    case 'holiday':
      return 'Holiday';
    case 'weekly_off':
      return 'Weekly off';
    default:
      return 'Working';
  }
}

/**
 * Operations reads for the CEO portal: Attendance today/period (C-Team-Attendance),
 * Call center (C-CallCenter), Field ops (C-FieldOps) and Joining & check-ins
 * (C-Checkins). Counts come from the calling system, the attendance clock and
 * the field app — never typed by an agent.
 */
@Injectable()
export class CeoOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly days: AttendanceDaysService,
    private readonly reports: AttendanceReportsService,
    private readonly seekers: JobSeekerService,
  ) {}

  /**
   * Sidebar counts (C-Interviews and C-CallCenter badges): interviews whose
   * slot starts today in IST (not cancelled), and missed calls still waiting
   * to be returned (the same "pending" count as "Missed calls to return").
   */
  async navCounts(now: Date): Promise<{ interviewsToday: number; callbacksWaiting: number }> {
    const dayMs = 24 * 3600 * 1000;
    const todayStart = new Date(now.getTime() - ((now.getTime() + 5.5 * 3600 * 1000) % dayMs));
    const todayEnd = new Date(todayStart.getTime() + dayMs - 1);
    const [interviewsToday, callbacksWaiting] = await Promise.all([
      this.prisma.interview.count({ where: { slotStartsAt: { gte: todayStart, lte: todayEnd }, status: { not: 'cancelled' } } }),
      this.prisma.callbackTask.count({ where: { status: 'pending' } }),
    ]);
    return { interviewsToday, callbacksWaiting };
  }

  /** Everyone who works a shift. `attendanceOnly` leaves owner accounts out: they have no attendance (owner decision 14 Nov). */
  private async people(attendanceOnly = false) {
    const staff = await this.prisma.staff.findMany({
      where: { role: { in: ATTENDANCE_ROLES }, status: 'active', ...(attendanceOnly ? NOT_OWNER_ACCOUNT : {}) },
      select: { id: true, code: true, name: true, role: true, teamLeadId: true, reportsToId: true, teamName: true },
      orderBy: { name: 'asc' },
    });
    const leads = new Map(staff.filter((s) => s.role === 'team_lead').map((s) => [s.id, s]));
    return staff.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      role: s.role,
      team: s.role === 'team_lead' ? teamLabel(s) : teamLabel(leads.get(s.teamLeadId ?? s.reportsToId ?? '') ?? null),
    }));
  }

  /** C-Team-Attendance: everyone's day (one day) or totals (a longer period), with the tiles. */
  async attendance(range: DateRange, now: Date) {
    const policy = await this.pricing.current();
    const people = await this.people(true);
    const from = dbDate(range.from);
    const to = dbDate(range.to);
    const singleDay = from.getTime() === to.getTime();
    const today = dbDate(now);
    const monthFrom = dbDate(istStartOfMonth(now));
    const fullSeconds = Math.round(policy.productionHoursFullDay * 3600);
    const rows = [];
    let loggedInToday = 0;
    let makeUpOwedSeconds = 0;
    let productionSeconds = 0;
    let workedDays = 0;
    for (const person of people) {
      const days = await this.days.rowsBetween(person.id, from, to);
      const month = await this.days.rowsBetween(person.id, monthFrom, today);
      for (const d of month) makeUpOwedSeconds += Math.max(0, d.shortfallSeconds - d.makeUpSeconds);
      if (month.some((d) => d.date === istDayKey(now) && d.loginAt)) loggedInToday += 1;
      const worked = days.filter((d) => d.loginAt);
      // A day with a half day of leave is half an expected day (owner decision 12 Nov).
      workedDays += worked.reduce((sum, d) => sum + (d.leaveHalf && d.leaveKind ? 0.5 : 1), 0);
      const totals = {
        productionSeconds: days.reduce((s, d) => s + d.productionSeconds, 0),
        breakSeconds: days.reduce((s, d) => s + d.breakSeconds, 0),
        lateMinutes: days.reduce((s, d) => s + d.lateMinutes, 0),
        lateDays: days.filter((d) => d.lateMinutes > 0).length,
        // Whole and half days (a half day of leave is half leave, half a working day).
        fullDays: days.reduce((s, d) => s + dayTally(d).fullHalves / 2, 0),
        halfDays: days.reduce((s, d) => s + dayTally(d).halfDays, 0),
        absentDays: days.reduce((s, d) => s + dayTally(d, d.date < istDayKey(now)).absentHalves / 2, 0),
        leaveDays: days.reduce((s, d) => s + leaveHalvesOf(d).total / 2, 0),
        shortfallSeconds: days.reduce((s, d) => s + Math.max(0, d.shortfallSeconds - d.makeUpSeconds), 0),
      };
      productionSeconds += totals.productionSeconds;
      const day = singleDay ? (days[0] ?? null) : null;
      rows.push({
        staff: person,
        loginAt: day?.loginAt ?? null,
        logoutAt: day?.logoutAt ?? null,
        dayType: day?.dayType ?? null,
        countsAs: singleDay ? (day ? countsAs(day) : from.getTime() <= today.getTime() ? 'Not logged in' : '—') : null,
        flagged: day?.flagged ?? false,
        ...totals,
      });
    }
    return {
      from: istDayKey(range.from),
      to: istDayKey(range.to),
      singleDay,
      policy: {
        shiftStart: policy.shiftStart,
        shiftEnd: policy.shiftEnd,
        productionHoursFullDay: policy.productionHoursFullDay,
        halfDayBelowHours: policy.halfDayBelowHours,
        dayToleranceMinutes: policy.dayToleranceMinutes,
        lateGraceMinutes: policy.lateGraceMinutes,
      },
      rows,
      summary: {
        people: people.length,
        loggedInToday,
        lateLogins: rows.reduce((s, r) => s + r.lateDays, 0),
        absent: rows.reduce((s, r) => s + r.absentDays, 0),
        makeUpOwedSeconds,
        productionPercent: workedDays ? percent(productionSeconds, workedDays * fullSeconds) : null,
      },
    };
  }

  /** C-CallCenter: live agent board, calls in the period, missed calls, recordings, follow-ups and stuck registrations. */
  async callCenter(actorId: string, range: DateRange, now: Date) {
    const agents = (await this.people()).filter((p) => p.role === 'call_agent');
    const ids = agents.map((a) => a.id);
    const [live, calls, registered, interviews, missed, openCalls, recordings, followUps] = await Promise.all([
      this.reports.liveBoard({ id: actorId, role: 'ceo' }),
      this.prisma.callRecord.findMany({
        where: { staffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } },
        select: { staffId: true, answered: true, durationSec: true },
      }),
      this.prisma.jobSeeker.groupBy({ by: ['registeredByStaffId'], where: { registeredByStaffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } }, _count: { _all: true } }),
      this.prisma.interview.groupBy({ by: ['proposedByStaffId'], where: { proposedByStaffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } }, _count: { _all: true } }),
      this.prisma.callbackTask.findMany({
        where: { status: { in: ['pending', 'assigned'] } },
        include: { jobSeeker: { select: { id: true, code: true, name: true } }, assignedToStaff: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.callRecord.count({ where: { startedAt: { not: null, gte: new Date(now.getTime() - 2 * 3600 * 1000) }, endedAt: null } }),
      this.prisma.callRecord.findMany({
        where: { recordingStoragePath: { not: null }, recordingDeletedAt: null, createdAt: { gte: range.from, lte: range.to } },
        include: { staff: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.followUpTask.findMany({
        where: { dueAt: { gte: range.from, lte: range.to } },
        select: { kind: true, status: true, dueAt: true },
      }),
    ]);
    const liveById = new Map(live.people.map((p) => [p.staff.id, p]));
    const prodBy = new Map<string, number>();
    for (const agent of agents) {
      const days = await this.days.rowsBetween(agent.id, dbDate(range.from), dbDate(range.to));
      prodBy.set(agent.id, days.reduce((s, d) => s + d.productionSeconds, 0));
    }
    const rows = agents.map((agent) => {
      const mine = calls.filter((c) => c.staffId === agent.id);
      const answered = mine.filter((c) => c.answered);
      const lv = liveById.get(agent.id);
      return {
        staff: agent,
        now: lv ? { status: lv.status, since: lv.since, overBreak: lv.overBreak, idleSeconds: lv.idleSeconds } : null,
        calls: mine.length,
        answered: answered.length,
        connectPercent: percent(answered.length, mine.length),
        talkSeconds: answered.reduce((s, c) => s + (c.durationSec ?? 0), 0),
        registered: registered.find((r) => r.registeredByStaffId === agent.id)?._count._all ?? 0,
        interviews: interviews.find((r) => r.proposedByStaffId === agent.id)?._count._all ?? 0,
        productionSeconds: prodBy.get(agent.id) ?? 0,
      };
    });
    const answeredAll = calls.filter((c) => c.answered);
    const capacity = Number(process.env.TELEPHONY_LINE_CAPACITY) || 60;
    const groups = FOLLOW_UP_GROUPS.map((g) => {
      const tasks = followUps.filter((t) => g.kinds.includes(t.kind));
      return {
        key: g.key,
        label: g.label,
        due: tasks.length,
        done: tasks.filter((t) => t.status === 'done').length,
        overdue: tasks.filter((t) => t.status === 'pending' && t.dueAt.getTime() < now.getTime()).length,
      };
    });
    return {
      summary: {
        calls: calls.length,
        connectPercent: percent(answeredAll.length, calls.length),
        missedToReturn: missed.filter((m) => m.status === 'pending').length,
        linesInUse: openCalls,
        lineCapacity: capacity,
        averageTalkSeconds: average(answeredAll.map((c) => c.durationSec ?? 0)),
        agentsIdleNow: rows.filter((r) => r.now?.status === 'idle').length,
      },
      rows,
      missed: missed.map((m) => ({
        id: m.id,
        at: m.createdAt.toISOString(),
        phone: m.phone,
        callerName: m.callerName,
        jobSeeker: m.jobSeeker,
        status: m.status,
        assignedTo: m.assignedToStaff,
      })),
      recordings: recordings.map((r) => ({
        id: r.id,
        code: r.code,
        at: r.createdAt.toISOString(),
        purpose: r.purpose,
        direction: r.direction,
        durationSec: r.durationSec,
        agent: r.staff,
        subjectType: r.subjectType,
      })),
      followUps: groups,
      stuck: await this.stuckRegistrations(now),
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
    };
  }

  /** Job seekers who started registering over a day ago and have not paid, with the step they are stuck at. */
  private async stuckRegistrations(now: Date) {
    const seekers = await this.prisma.jobSeeker.findMany({
      where: {
        status: { in: ['lead', 'consented'] },
        paymentReceivedAt: null,
        anonymisedAt: null,
        createdAt: { lte: new Date(now.getTime() - DAY_MS), gte: new Date(now.getTime() - 30 * DAY_MS) },
      },
      select: { id: true, code: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 15,
    });
    const order = ['phone', 'consent', 'selfie', 'idCheck', 'payment'] as const;
    const out = [];
    for (const s of seekers) {
      let step: string = 'consent';
      let reason: string | null = null;
      let since = s.createdAt;
      try {
        const status = (await this.seekers.getRegistrationStatus(s.id)) as unknown as {
          steps: Record<string, { state: string; time: Date | string | null; reason: string | null }>;
        };
        const stuck = order.find((k) => status.steps[k]?.state === 'stuck') ?? order.find((k) => status.steps[k] && status.steps[k].state !== 'done');
        if (stuck) {
          step = stuck;
          reason = status.steps[stuck]?.reason ?? null;
          const t = status.steps[stuck]?.time;
          if (t) since = new Date(t);
        }
      } catch {
        // A record that cannot be read is still listed, at the consent step.
      }
      out.push({ id: s.id, code: s.code, name: s.name, step, reason, since: since.toISOString(), days: Math.max(1, Math.floor((now.getTime() - since.getTime()) / DAY_MS)) });
    }
    return out;
  }

  /** C-FieldOps: tiles, where agents are, visit proof to check, per-agent table, visit requests and revisits. */
  async fieldOps(actorId: string, range: DateRange, now: Date) {
    const agents = (await this.people()).filter((p) => p.role === 'field_agent');
    const ids = agents.map((a) => a.id);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [live, visits, onboarded, vacanciesWeek, shown, interviews, flags, checkIns, assignments] = await Promise.all([
      this.reports.liveBoard({ id: actorId, role: 'ceo' }),
      this.prisma.businessVisit.findMany({
        where: { visitedAt: { gte: range.from, lte: range.to } },
        include: { business: { select: { id: true, code: true, name: true, locality: true } }, staff: { select: { id: true, name: true } } },
        orderBy: { visitedAt: 'desc' },
      }),
      this.prisma.business.findMany({
        where: { leadCreatedByStaffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } },
        select: { leadCreatedByStaffId: true },
      }),
      this.prisma.vacancy.count({ where: { createdAt: { gte: weekAgo, lte: now } } }),
      this.prisma.candidateIntroduction.groupBy({ by: ['shownByStaffId'], where: { shownByStaffId: { in: ids }, shownAt: { gte: range.from, lte: range.to } }, _count: { _all: true } }),
      this.prisma.interview.groupBy({ by: ['proposedByStaffId'], where: { proposedByStaffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } }, _count: { _all: true } }),
      this.prisma.reviewFlag.findMany({
        where: { status: 'open', raisedForStaffId: { in: ids } },
        select: { id: true, code: true, kind: true, subjectType: true, subjectId: true, raisedForStaffId: true, details: true, raisedAt: true },
        orderBy: { raisedAt: 'desc' },
      }),
      this.prisma.fieldCheckIn.findMany({
        where: { staffId: { in: ids }, checkedInAt: { gte: new Date(now.getTime() - DAY_MS) } },
        orderBy: { checkedInAt: 'desc' },
      }),
      this.prisma.visitAssignment.findMany({
        where: { status: { in: ['pending', 'assigned'] } },
        include: {
          business: { select: { id: true, code: true, name: true, locality: true, latitude: true, longitude: true } },
          suggestedStaff: { select: { id: true, name: true } },
          assignedStaff: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
    ]);
    const liveById = new Map(live.people.map((p) => [p.staff.id, p]));
    const lastVisit = new Map<string, (typeof visits)[number]>();
    for (const v of visits) if (v.staffId && !lastVisit.has(v.staffId)) lastVisit.set(v.staffId, v);
    const rows = agents.map((agent) => {
      const mine = visits.filter((v) => v.staffId === agent.id);
      const lv = liveById.get(agent.id);
      const last = lastVisit.get(agent.id);
      const ci = checkIns.find((c) => c.staffId === agent.id);
      return {
        staff: agent,
        now: lv ? { status: lv.status, since: lv.since } : null,
        lastVisit: last
          ? { business: last.business?.name ?? last.shopName ?? 'Unregistered shop', area: last.business?.locality ?? null, at: last.visitedAt.toISOString() }
          : null,
        lastCheckInAt: ci?.checkedInAt.toISOString() ?? null,
        visits: mine.length,
        onboarded: onboarded.filter((b) => b.leadCreatedByStaffId === agent.id).length,
        vacancies: 0,
        shown: shown.find((s) => s.shownByStaffId === agent.id)?._count._all ?? 0,
        interviews: interviews.find((s) => s.proposedByStaffId === agent.id)?._count._all ?? 0,
        geofenceMismatches: mine.filter((v) => v.geofenceFlag).length,
        openFlags: flags.filter((f) => f.raisedForStaffId === agent.id).map((f) => f.kind),
        // Time inside the shop (visit timer), averaged over visits with a recorded length.
        avgVisitSeconds: average(mine.filter((v) => typeof v.durationSeconds === 'number').map((v) => v.durationSeconds as number)),
      };
    });
    // Where each field agent was last seen today: the latest check-in or visit, for "Nearest agent".
    const lastSeen = new Map<string, { latitude: number; longitude: number; at: Date }>();
    for (const c of checkIns) {
      if (!lastSeen.has(c.staffId)) lastSeen.set(c.staffId, { latitude: c.latitude, longitude: c.longitude, at: c.checkedInAt });
    }
    for (const v of visits) {
      if (!v.staffId) continue;
      const seen = lastSeen.get(v.staffId);
      if (!seen || seen.at < v.visitedAt) lastSeen.set(v.staffId, { latitude: v.latitude, longitude: v.longitude, at: v.visitedAt });
    }
    const nearestTo = (lat: number | null, lng: number | null) => {
      if (lat === null || lng === null) return null;
      let best: { id: string; name: string; distanceKm: number } | null = null;
      for (const agent of agents) {
        const seen = lastSeen.get(agent.id);
        if (!seen) continue;
        const km = calculateHaversineDistanceMeters(lat, lng, seen.latitude, seen.longitude) / 1000;
        if (!best || km < best.distanceKm) best = { id: agent.id, name: agent.name, distanceKm: Math.round(km * 10) / 10 };
      }
      return best;
    };
    // Revisits due this week: visits whose outcome set a revisit date in the next 7 days, with no later visit yet.
    const todayKey = istDayKey(now);
    const weekEndKey = istDayKey(new Date(now.getTime() + 6 * DAY_MS));
    const dueVisits = await this.prisma.businessVisit.findMany({
      where: { revisitOn: { gte: new Date(`${todayKey}T00:00:00.000Z`), lte: new Date(`${weekEndKey}T00:00:00.000Z`) } },
      include: { business: { select: { id: true, code: true, name: true, locality: true } }, staff: { select: { id: true, name: true } } },
      orderBy: { revisitOn: 'asc' },
      take: 200,
    });
    const revisitedIds = new Set(
      (await this.prisma.businessVisit.findMany({ where: { revisitOfVisitId: { in: dueVisits.map((v) => v.id) } }, select: { revisitOfVisitId: true } })).map((v) => v.revisitOfVisitId),
    );
    const revisitsDue = dueVisits
      .filter((v) => !revisitedIds.has(v.id))
      .map((v) => ({ id: v.id, on: v.revisitOn!.toISOString().slice(0, 10), business: v.business, shopName: v.business?.name ?? v.shopName ?? 'Unregistered shop', outcome: v.outcome, agent: v.staff }));
    const vacancyCounts = await this.prisma.vacancy.groupBy({ by: ['capturedByStaffId'], where: { capturedByStaffId: { in: ids }, createdAt: { gte: range.from, lte: range.to } }, _count: { _all: true } });
    for (const r of rows) r.vacancies = vacancyCounts.find((v) => v.capturedByStaffId === r.staff.id)?._count._all ?? 0;
    const visitCount = visits.length;
    const onboardedCount = onboarded.length;
    const proof = visits
      .filter((v) => v.geofenceFlag || v.photoLive === false || v.selfieUrl)
      .slice(0, 12)
      .map((v) => ({
        id: v.id,
        at: v.visitedAt.toISOString(),
        business: v.business,
        agent: v.staff,
        hasSelfie: Boolean(v.selfieUrl),
        photoLive: v.photoLive,
        geofenceFlag: v.geofenceFlag,
        flag: flags.find((f) => f.subjectId === v.businessId || f.subjectId === v.id) ?? null,
      }));
    return {
      summary: {
        visits: visitCount,
        onboarded: onboardedCount,
        vacanciesThisWeek: vacanciesWeek,
        visitToOnboardPercent: percent(onboardedCount, visitCount),
        geofenceMismatches: visits.filter((v) => v.geofenceFlag).length,
        openFlags: flags.length,
      },
      agentsNow: rows.map((r) => ({ staff: r.staff, status: r.now?.status ?? 'not_logged_in', area: r.lastVisit?.area ?? null, lastCheckInAt: r.lastCheckInAt })),
      proof,
      rows,
      requests: assignments
        .filter((a) => !a.assignedStaffId)
        .map((a) => ({
          id: a.id,
          business: { id: a.business.id, code: a.business.code, name: a.business.name, locality: a.business.locality },
          purpose: a.purpose,
          createdAt: a.createdAt.toISOString(),
          suggested: a.suggestedStaff,
          nearest: nearestTo(a.business.latitude, a.business.longitude),
        })),
      revisitsDue,
      revisits: assignments
        .filter((a) => a.assignedStaffId)
        .map((a) => ({ id: a.id, business: { id: a.business.id, code: a.business.code, name: a.business.name, locality: a.business.locality }, purpose: a.purpose, agent: a.assignedStaff, since: a.updatedAt.toISOString() })),
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
    };
  }

  /**
   * C-Checkins: joining confirmations (both calls answered) and the day-7 and
   * day-30 check-in calls due in the period.
   */
  async checkins(range: DateRange, now: Date) {
    const [joinings, tasks] = await Promise.all([
      this.prisma.placement.findMany({
        where: { joiningDate: { gte: range.from, lte: range.to } },
        include: {
          jobSeeker: { select: { id: true, code: true, name: true } },
          business: { select: { id: true, code: true, name: true } },
          joiningWorkerCall: { select: { answered: true } },
          joiningBusinessCall: { select: { answered: true } },
        },
        orderBy: { joiningDate: 'asc' },
      }),
      this.prisma.followUpTask.findMany({
        where: { kind: { in: ['placement_check_in_day_7', 'placement_check_in_day_30'] }, dueAt: { gte: range.from, lte: range.to } },
        include: { assignedStaff: { select: { id: true, name: true } } },
        orderBy: { dueAt: 'asc' },
      }),
    ]);
    const placementIds = tasks.filter((t) => t.relatedType === 'placement' && t.relatedId).map((t) => t.relatedId as string);
    const placements = placementIds.length
      ? await this.prisma.placement.findMany({
          where: { id: { in: placementIds } },
          include: { jobSeeker: { select: { id: true, code: true, name: true } }, business: { select: { id: true, code: true, name: true } } },
        })
      : [];
    const rows = [
      ...joinings.map((p) => {
        const worker = p.joiningWorkerCall?.answered ?? null;
        const owner = p.joiningBusinessCall?.answered ?? null;
        let result: string;
        let tone: string;
        if (p.joinedDate) {
          result = 'Both calls answered · joined';
          tone = 'good';
        } else if (p.status === 'cancelled' || p.status === 'dropped_out') {
          result = p.status === 'cancelled' ? 'Did not join · cancelled' : 'Left';
          tone = 'danger';
        } else if (worker === null && owner === null) {
          result = p.joiningDate && p.joiningDate.getTime() > now.getTime() ? 'Not due yet' : 'Calls not made yet';
          tone = 'warn';
        } else {
          result = `${worker ? 'Worker answered' : 'Worker not answered'} · ${owner ? 'owner answered' : 'owner not answered'}`;
          tone = 'warn';
        }
        return {
          id: `j-${p.id}`,
          check: 'joining',
          due: (p.joiningDate as Date).toISOString(),
          placement: { id: p.id, code: p.code },
          jobSeeker: p.jobSeeker,
          business: p.business,
          result,
          tone,
          agent: null as { id: string; name: string } | null,
        };
      }),
      ...tasks.map((t) => {
        const p = placements.find((x) => x.id === t.relatedId);
        const overdue = t.status === 'pending' && t.dueAt.getTime() < now.getTime();
        const answer: Record<string, string> = {
          working_at_introduced_business: 'Done · still working',
          working_elsewhere: 'Done · working elsewhere',
          not_working: 'Done · left',
          no_answer: 'No answer',
        };
        return {
          id: t.id,
          check: t.kind === 'placement_check_in_day_7' ? 'day7' : 'day30',
          due: t.dueAt.toISOString(),
          placement: p ? { id: p.id, code: p.code } : null,
          jobSeeker: p?.jobSeeker ?? null,
          business: p?.business ?? null,
          result: t.status === 'done' ? (answer[t.answer ?? ''] ?? 'Done') : t.status === 'missed' ? 'Missed' : overdue ? 'Overdue' : 'Due',
          tone: t.status === 'done' ? (t.answer === 'not_working' ? 'danger' : 'good') : overdue || t.status === 'missed' ? 'crit' : 'info',
          agent: t.assignedStaff,
        };
      }),
    ].sort((a, b) => a.due.localeCompare(b.due));
    return {
      rows,
      summary: {
        joinings: joinings.length,
        joined: joinings.filter((p) => p.joinedDate).length,
        checkInsDue: tasks.length,
        checkInsDone: tasks.filter((t) => t.status === 'done').length,
        overdue: rows.filter((r) => r.tone === 'crit').length,
      },
    };
  }
}
