import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffRequest } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { AttendanceClock } from '../attendance/attendance-clock';
import { AttendanceDaysService } from '../attendance/attendance-days.service';
import { AttendanceRequestsService } from '../attendance/attendance-requests.service';
import { AttendanceService } from '../attendance/attendance.service';
import { classifyDay } from '../attendance/day-rules';
import { PricingService } from '../pricing/pricing.service';
import { Placement, placementOf, whereLabel } from '../attendance/request-routing';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PlacementService } from '../placement/placement.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { StaffDeviceService } from '../staff/staff-device.service';
import { TargetService } from '../target/target.service';
import {
  KIND_TITLE,
  REASON_TEXT,
  REQUEST_KINDS,
  RequestKind,
  STAFF_REQUEST_KINDS,
  StaffRequestKind,
  TARGET_METRICS,
  TARGET_METRIC_LABEL,
  TargetMetric,
} from './requests.constants';
import {
  Brief,
  Chain,
  canOverturnLevel,
  claimPlacement,
  deciderOf,
  deviceRoute,
  routeStaffRequest,
  startOfWeekIst,
} from './requests-routing';
import { RequestBellsService } from './request-bells.service';

export interface Actor {
  id: string;
  role: string;
}

/** The one shape every request is read in (T-Requests, T-Decided, MG-Requests, MG-Decided). */
export interface RequestView {
  /** `${kind}.${id}` — the id used in /requests/:ref and in the screens' URLs. */
  ref: string;
  kind: RequestKind;
  id: string;
  /** "Emergency leave", "Change a day", "Remove a hit"… */
  title: string;
  /** One line of what was asked: "Wed 11 Nov · 1 day", "4 Nov short day → full day". */
  summary: string;
  /** What it is about when that is not a staff member (a job seeker or a placement). */
  about: { type: 'staff' | 'job_seeker' | 'placement'; id: string; code: string; name: string } | null;
  /** The staff member the request concerns; scope follows them. */
  person: Brief | null;
  requestedBy: Brief | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  where: 'with_team_lead' | 'with_manager' | 'with_ceo' | 'decided';
  withTeamLead: boolean;
  withManager: boolean;
  withCeo: boolean;
  /** The lowest level that can decide it now (null once decided). */
  decider: 'team_lead' | 'manager' | 'ceo' | null;
  /** The named person at that level, when there is one. */
  deciderStaff: Brief | null;
  routeReason: string;
  routeReasonText: string;
  /** Why it is with the caller, when it is (plain words in whyWithYouText). */
  whyWithYou: string | null;
  whyWithYouText: string | null;
  /** A warning shown next to it ("2nd planned day in November", "3rd correction this month"). */
  alert: string | null;
  createdAt: string;
  /** Claims: the 48-hour limit. Others: when it also goes to the next level, if still pending. */
  dueAt: string | null;
  forwarded: { at: string; by: Brief | null; note: string | null } | null;
  decided: { at: string; by: Brief | null; role: string | null; reason: string | null } | null;
  overturned: { at: string; by: Brief | null; reason: string | null } | null;
  /** A Manager sent it back to the Team Lead (leave and corrections). */
  sentBack: { at: string; by: Brief | null; note: string | null } | null;
  canDecide: boolean;
  canForward: boolean;
  canOverturn: boolean;
  /** "Send back to the Team Lead": a Manager, on a leave or correction with them, from someone with a Team Lead. */
  canSendBack: boolean;
  /** Leave only: the caller may approve part of the dates (send fromDate/toDate with the approval). */
  canApprovePart: boolean;
  /** Kind-specific facts (dates, counts, the hit, the target numbers…). Never money. */
  details: Record<string, unknown>;
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const AGENT_ROLES = ['call_agent', 'field_agent'];
const BRIEF = { id: true, code: true, name: true, role: true } as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Wed 11 Nov" for a yyyy-mm-dd day. */
export function dayLabel(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return ymd;
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function istYmd(date: Date): string {
  return new Date(date.getTime() + 5.5 * HOUR_MS).toISOString().slice(0, 10);
}

function monthName(ymd: string): string {
  const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return fullMonths[Number(ymd.slice(5, 7)) - 1] ?? '';
}

/** `${kind}.${id}` → [kind, id]. */
export function parseRef(ref: string): [RequestKind, string] {
  const dot = ref.indexOf('.');
  const kind = (dot > 0 ? ref.slice(0, dot) : '') as RequestKind;
  const id = dot > 0 ? ref.slice(dot + 1) : '';
  if (!(REQUEST_KINDS as readonly string[]).includes(kind) || !id) {
    throw new BadRequestException('A request reference looks like leave.<id>');
  }
  return [kind, id];
}

/** Rows the leave/correction service returns (see AttendanceRequestsService.view). */
interface AttendanceView {
  kind: 'leave' | 'correction';
  id: string;
  staff: Brief | null;
  status: string;
  reason: string;
  where: string;
  withTeamLead: boolean;
  withManager: boolean;
  withCeo: boolean;
  routedToRole: string;
  routeReason: string;
  routeReasonText: string;
  createdAt: string;
  forwarded: { at: string; by: Brief | null; note: string | null } | null;
  decided: { at: string; by: Brief | null; role: string | null; reason: string | null } | null;
  canDecide: boolean;
  whyWithYou?: string;
  leaveKind?: string;
  fromDate?: string;
  toDate?: string;
  days?: number;
  paidDays?: number;
  unpaidDays?: number;
  casualDaysTakenThisMonth?: number;
  casualDaysPendingThisMonth?: number;
  overturned?: { at: string; by: Brief | null; reason: string | null } | null;
  sentBack?: { at: string; by: Brief | null; note: string | null } | null;
  approvedFromDate?: string | null;
  approvedToDate?: string | null;
  approvedDays?: number | null;
  date?: string;
  startAt?: string;
  endAt?: string;
  segmentStatus?: string;
  monthNumber?: number;
}

/**
 * The requests read model and the one place a request is decided, forwarded
 * or overturned. Each kind keeps its own table and its own rules; this service
 * reads them into RequestView, scopes them with ReportingScopeService (a Team
 * Lead sees their own team, a Manager their tree, the CEO everything), and
 * hands each decision to the service that owns the record. Every decision is
 * audited there (and here, for the reason, when the owner does not take one)
 * and the bells follow.
 */
@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ReportingScopeService,
    private readonly clock: AttendanceClock,
    private readonly attendanceRequests: AttendanceRequestsService,
    private readonly attendanceDays: AttendanceDaysService,
    private readonly attendance: AttendanceService,
    private readonly pricing: PricingService,
    private readonly devices: StaffDeviceService,
    private readonly placements: PlacementService,
    private readonly jobSeekers: JobSeekerService,
    private readonly targets: TargetService,
    private readonly bells: RequestBellsService,
  ) {}

  // ================================================================= reads

  /** Everything still pending in the caller's scope (theirs to decide or not), plus their own. */
  async open(actor: Actor): Promise<RequestView[]> {
    this.assertDecider(actor);
    const ctx = await this.context(actor);
    const rows = [
      ...(await this.attendanceRows(actor, ctx, 'pending')),
      ...(await this.deviceRows(actor, ctx, 'pending')),
      ...(await this.claimRows(actor, ctx, 'pending')),
      ...(await this.staffRequestRows(actor, ctx, 'pending')),
    ];
    return this.sorted(rows);
  }

  /** What is waiting for the caller to decide, each with why it is with them. */
  async waiting(actor: Actor): Promise<RequestView[]> {
    const rows = await this.open(actor);
    return rows.filter((row) => row.canDecide && row.whyWithYou);
  }

  /** Decided since Monday (IST) — or since `sinceText` — in the caller's scope, by anyone. */
  async decided(actor: Actor, sinceText?: string): Promise<RequestView[]> {
    this.assertDecider(actor);
    const ctx = await this.context(actor);
    let since = startOfWeekIst(ctx.now);
    if (sinceText) {
      const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(sinceText) ? `${sinceText}T00:00:00+05:30` : sinceText);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('since must be a date');
      since = parsed;
    }
    ctx.since = since;
    const rows = [
      ...(await this.attendanceRows(actor, ctx, 'decided')),
      ...(await this.deviceRows(actor, ctx, 'decided')),
      ...(await this.claimRows(actor, ctx, 'decided')),
      ...(await this.staffRequestRows(actor, ctx, 'decided')),
    ];
    return rows
      .filter((row) => row.decided && new Date(row.decided.at).getTime() >= since.getTime())
      .sort((a, b) => (b.decided?.at ?? '').localeCompare(a.decided?.at ?? ''));
  }

  /** One request with its history (T-Req-Sneha, MG-Req-*). */
  async get(actor: Actor, ref: string) {
    this.assertDecider(actor);
    const [kind, id] = parseRef(ref);
    const view = await this.one(actor, kind, id);
    const history = this.history(view, this.clock.now());
    return { ...view, history };
  }

  // ============================================================== actions

  /**
   * Approve or reject. For leave, `fromDate`/`toDate` inside the asked dates
   * approve only part of it; the rest is rejected with the reason, which is
   * then required (MG-Req-Vikram: "approve 3 of 5 days").
   */
  async decide(actor: Actor, ref: string, body: { decision?: string; reason?: string; fromDate?: string; toDate?: string }) {
    this.assertDecider(actor);
    const [kind, id] = parseRef(ref);
    const decision = body?.decision === 'approved' || body?.decision === 'approve' ? 'approved' : body?.decision === 'rejected' || body?.decision === 'reject' ? 'rejected' : null;
    if (!decision) throw new BadRequestException('decision is approved or rejected');
    const note = String(body?.reason ?? '').trim();
    if (decision === 'rejected' && !note) throw new BadRequestException('A reason is needed to reject');
    const part = Boolean(body?.fromDate || body?.toDate);
    if (part && (kind !== 'leave' || decision !== 'approved')) {
      throw new BadRequestException('Only a leave approval can be for part of the dates');
    }
    if (part && !note) throw new BadRequestException('A reason is needed: the days not approved are rejected');
    const reason = note || 'Approved';
    const view = await this.one(actor, kind, id);
    if (view.status !== 'pending') {
      throw new ConflictException({
        statusCode: 409,
        message: view.decided?.by ? `Already ${view.status} by ${view.decided.by.name} (${view.decided.by.code})` : 'This request has already been handled',
        decidedBy: view.decided?.by ?? null,
        status: view.status,
      });
    }
    if (!view.canDecide) throw new ForbiddenException(this.whyNot(actor, view));

    if (kind === 'leave' || kind === 'correction') {
      await this.attendanceRequests.decide(actor, kind, id, decision, {
        reason,
        ...(part ? { fromDate: body.fromDate, toDate: body.toDate } : {}),
      });
    } else if (kind === 'device') {
      if (decision === 'approved') await this.devices.approve(id, actor);
      else await this.devices.revoke(id, actor);
      await this.audit.log({
        actorId: actor.id,
        action: `requests.device_${decision}`,
        entityType: 'staff_device',
        entityCode: view.person?.code ?? id,
        after: { status: decision === 'approved' ? 'approved' : 'revoked' },
        reason,
      });
    } else if (kind === 'claim') {
      const claim = await this.prisma.replacementClaim.findUniqueOrThrow({ where: { id }, select: { placementId: true } });
      await this.placements.decideClaim(
        claim.placementId,
        id,
        { decision: decision === 'approved' ? 'accepted' : 'rejected', decisionReason: reason },
        actor.id,
        this.clock.now(),
      );
    } else {
      await this.decideStaffRequest(actor, id, decision, reason);
    }
    return this.one(actor, kind, id);
  }

  /** "Send to Manager": a Team Lead hands a request in their list to their Manager, with a note. */
  async forward(actor: Actor, ref: string, body: { note?: string }) {
    if (actor.role !== 'team_lead') throw new ForbiddenException('Only a Team Lead sends a request to the Manager');
    const [kind, id] = parseRef(ref);
    const note = String(body?.note ?? '').trim();
    if (!note) throw new BadRequestException('A note is required to send it to the Manager');
    const view = await this.one(actor, kind, id);
    if (!view.canForward) {
      throw new BadRequestException(
        kind === 'claim' || kind === 'device'
          ? 'Claims and devices go to the Manager by themselves after 24 hours'
          : 'Only a request waiting with you can be sent to the Manager',
      );
    }
    if (kind === 'leave' || kind === 'correction') {
      await this.attendanceRequests.forward(actor, kind, id, { note });
    } else {
      const now = this.clock.now();
      const claimed = await this.prisma.staffRequest.updateMany({
        where: { id, status: 'pending', forwardedAt: null, routedToRole: 'team_lead' },
        data: { forwardedAt: now, forwardedByStaffId: actor.id, forwardNote: note },
      });
      if (claimed.count === 0) throw new ConflictException('This request has just changed');
      await this.audit.log({
        actorId: actor.id,
        action: `requests.${kind}_forwarded`,
        entityType: 'staff_request',
        entityCode: view.person?.code ?? id,
        after: { forwardedTo: 'manager' },
        reason: note,
      });
      await this.bells.sync(id);
    }
    return this.one(actor, kind, id);
  }

  /**
   * "Send back to the Team Lead" (MG-Req-Sneha, MG-Req-Vikram): a Manager
   * hands a leave or correction request that reached them back to the
   * person's Team Lead, with a note. It stays pending; audited; the Team
   * Lead's bell rings.
   */
  async sendBack(actor: Actor, ref: string, body: { note?: string }) {
    if (actor.role !== 'manager') throw new ForbiddenException('Only a Manager sends a request back to the Team Lead');
    const [kind, id] = parseRef(ref);
    const note = String(body?.note ?? '').trim();
    if (!note) throw new BadRequestException('A note is required to send it back to the Team Lead');
    if (kind !== 'leave' && kind !== 'correction') {
      throw new BadRequestException('Only leave and attendance corrections can be sent back to the Team Lead');
    }
    const view = await this.one(actor, kind, id);
    if (view.status !== 'pending') {
      throw new ConflictException({
        statusCode: 409,
        message: view.decided?.by ? `Already ${view.status} by ${view.decided.by.name} (${view.decided.by.code})` : 'This request has already been handled',
        decidedBy: view.decided?.by ?? null,
        status: view.status,
      });
    }
    await this.attendanceRequests.sendBack(actor, kind, id, { note });
    return this.one(actor, kind, id);
  }

  /**
   * Overturn, one level up only: a Manager over the person overturns a Team
   * Lead's decision, the CEO a Manager's — always with a reason.
   */
  async overturn(actor: Actor, ref: string, body: { reason?: string }) {
    if (actor.role !== 'manager' && actor.role !== 'ceo') {
      throw new ForbiddenException('A Manager or the CEO overturns a decision');
    }
    const [kind, id] = parseRef(ref);
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required to overturn a decision');
    const view = await this.one(actor, kind, id);
    if (!view.canOverturn) throw new ForbiddenException(this.whyNotOverturn(actor, view));
    if (kind === 'leave') {
      await this.attendanceRequests.overturn(actor, 'leave', id, { reason });
    } else if (kind === 'claim') {
      const claim = await this.prisma.replacementClaim.findUniqueOrThrow({ where: { id }, select: { placementId: true, decision: true } });
      await this.placements.decideClaim(
        claim.placementId,
        id,
        { decision: claim.decision === 'accepted' ? 'rejected' : 'accepted', decisionReason: reason },
        actor.id,
        this.clock.now(),
      );
    } else {
      await this.overturnStaffRequest(actor, id, reason);
    }
    return this.one(actor, kind, id);
  }

  /**
   * Raise a request that has no table of its own.
   * - hit_removal { hitId }: an agent asks their Team Lead (a Team Lead raises it
   *   only for a 3rd removal, which goes to the Manager).
   * - target_change { staffId, metric, to, year?, month? }: a Team Lead asks the Manager.
   * - written_warning { staffId, text }: a Team Lead asks the Manager.
   * - day_change { dayId, dayType }: an agent asks their Team Lead; a Team Lead
   *   or Manager changing a day in their team applies it at once — unless it is
   *   the person's 3rd change this month, which goes to the Manager.
   */
  async create(actor: Actor, body: Record<string, unknown>) {
    const kind = String(body?.kind ?? '') as StaffRequestKind;
    if (!(STAFF_REQUEST_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`kind is one of ${STAFF_REQUEST_KINDS.join(', ')}`);
    }
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required');
    if (kind === 'hit_removal') return this.createHitRemoval(actor, String(body.hitId ?? ''), reason);
    if (kind === 'target_change') return this.createTargetChange(actor, body, reason);
    if (kind === 'written_warning') return this.createWrittenWarning(actor, body, reason);
    return this.createDayChange(actor, String(body.dayId ?? ''), String(body.dayType ?? ''), reason);
  }

  // ================================================ StaffRequest: create

  private async createHitRemoval(actor: Actor, hitId: string, reason: string) {
    if (!['call_agent', 'field_agent', 'team_lead'].includes(actor.role)) {
      throw new ForbiddenException('An agent or their Team Lead asks for a hit to be removed');
    }
    const hit = await this.prisma.jobSeekerHit.findUnique({
      where: { id: hitId },
      include: { jobSeeker: { select: { id: true, code: true, name: true, registeredByStaffId: true } } },
    });
    if (!hit) throw new NotFoundException('Hit not found');
    if (hit.reversedAt) throw new BadRequestException('This hit has already been removed');
    if (hit.supersededAt) throw new BadRequestException('This hit is from an earlier guarantee and no longer counts');
    // The job seeker belongs to the team of the agent who registered him.
    const personId = hit.jobSeeker.registeredByStaffId ?? actor.id;
    const person = await this.requireStaff(personId);
    if (actor.role === 'team_lead') {
      if (personId !== actor.id && !(await this.scope.personIsUnder(actor.id, personId))) {
        throw new ForbiddenException('A Team Lead asks only for job seekers handled by their own team');
      }
    } else if (personId !== actor.id) {
      const sameTeam = (await this.scope.chainOf(actor.id)).teamLead?.id;
      if (!sameTeam || !(await this.scope.personIsUnder(sameTeam, personId))) {
        throw new ForbiddenException('You can ask only about job seekers your team handles');
      }
    }
    const open = await this.prisma.staffRequest.findFirst({ where: { kind: 'hit_removal', subjectId: hit.id, status: 'pending' } });
    if (open) throw new ConflictException('A request to remove this hit is already waiting');
    const earlier = await this.prisma.jobSeekerHit.count({ where: { jobSeekerId: hit.jobSeekerId, reversedAt: { not: null } } });
    const chain = await this.scope.chainOf(person.id);
    const route = routeStaffRequest({ kind: 'hit_removal', personRole: person.role, chain, ceoId: await this.ceoId(chain), earlier });
    if (actor.role === 'team_lead' && route.routedToRole === 'team_lead') {
      throw new BadRequestException('You can remove this hit yourself: approve it from the job seeker or POST /job-seeker-hits/:id/reverse');
    }
    const hitNumber = await this.prisma.jobSeekerHit.count({
      where: { jobSeekerId: hit.jobSeekerId, supersededAt: null, recordedAt: { lte: hit.recordedAt } },
    });
    const recordedBy = hit.recordedBy && hit.recordedBy !== 'system' ? await this.prisma.staff.findUnique({ where: { id: hit.recordedBy }, select: BRIEF }) : null;
    return this.insertStaffRequest(actor, {
      kind: 'hit_removal',
      staffId: person.id,
      subjectType: 'job_seeker_hit',
      subjectId: hit.id,
      reason,
      route,
      details: {
        hitId: hit.id,
        hitReason: hit.reason,
        hitNote: hit.note,
        hitRecordedAt: hit.recordedAt.toISOString(),
        hitRecordedBy: recordedBy ? recordedBy.name : hit.recordedBy === 'system' ? 'Phone system' : null,
        hitNumber,
        earlierRemovals: earlier,
        jobSeeker: { id: hit.jobSeeker.id, code: hit.jobSeeker.code, name: hit.jobSeeker.name },
      },
    });
  }

  private async createTargetChange(actor: Actor, body: Record<string, unknown>, reason: string) {
    if (actor.role !== 'team_lead') throw new ForbiddenException('A Team Lead asks the Manager to change a target');
    const staffId = String(body.staffId ?? '');
    if (!(await this.scope.personIsUnder(actor.id, staffId))) {
      throw new ForbiddenException('Only for agents in your own team');
    }
    const metric = String(body.metric ?? '') as TargetMetric;
    if (!(TARGET_METRICS as readonly string[]).includes(metric)) {
      throw new BadRequestException(`metric is one of ${TARGET_METRICS.join(', ')}`);
    }
    const to = Number(body.to);
    if (!Number.isInteger(to) || to < 0 || to > 100000) throw new BadRequestException('to must be a whole number');
    const now = this.clock.now();
    const ymd = istYmd(now);
    const year = body.year === undefined ? Number(ymd.slice(0, 4)) : Number(body.year);
    const month = body.month === undefined ? Number(ymd.slice(5, 7)) : Number(body.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('year and month must be whole numbers');
    }
    const person = await this.requireStaff(staffId);
    const current = await this.prisma.target.findUnique({ where: { staffId_year_month: { staffId, year, month } } });
    const from = current ? ((current as unknown as Record<string, number | null>)[metric] ?? null) : null;
    const chain = await this.scope.chainOf(person.id);
    const route = routeStaffRequest({ kind: 'target_change', personRole: person.role, chain, ceoId: await this.ceoId(chain), earlier: 0 });
    return this.insertStaffRequest(actor, {
      kind: 'target_change',
      staffId,
      subjectType: 'target',
      subjectId: `${staffId}:${year}-${month}`,
      reason,
      route,
      details: { metric, metricLabel: TARGET_METRIC_LABEL[metric], from, to, year, month },
    });
  }

  private async createWrittenWarning(actor: Actor, body: Record<string, unknown>, reason: string) {
    if (actor.role !== 'team_lead') throw new ForbiddenException('A Team Lead asks the Manager for a written warning');
    const staffId = String(body.staffId ?? '');
    if (!(await this.scope.personIsUnder(actor.id, staffId))) throw new ForbiddenException('Only for agents in your own team');
    const person = await this.requireStaff(staffId);
    const chain = await this.scope.chainOf(person.id);
    const route = routeStaffRequest({ kind: 'written_warning', personRole: person.role, chain, ceoId: await this.ceoId(chain), earlier: 0 });
    const text = String(body.text ?? '').trim() || reason;
    return this.insertStaffRequest(actor, {
      kind: 'written_warning',
      staffId,
      subjectType: 'staff',
      subjectId: staffId,
      reason,
      route,
      details: { text },
    });
  }

  private async createDayChange(actor: Actor, dayId: string, dayType: string, reason: string) {
    if (!['full', 'half'].includes(dayType)) throw new BadRequestException('A day can be changed to a full day or a half day');
    const day = await this.prisma.attendanceDay.findUnique({ where: { id: dayId } });
    if (!day) throw new NotFoundException('Attendance day not found');
    if (day.dayType === 'open') throw new BadRequestException('The day is still open');
    if (!['full', 'half', 'absent'].includes(day.dayType)) throw new BadRequestException('Only a full, half or absent day can be changed');
    if (day.dayType === dayType) throw new BadRequestException(`It already counts as a ${dayType} day`);
    const own = day.staffId === actor.id;
    if (own && !AGENT_ROLES.includes(actor.role) && actor.role !== 'team_lead') {
      throw new ForbiddenException('Ask the CEO to change your own day');
    }
    if (!own && !(await this.attendanceDays.canManage(actor, day.staffId))) {
      throw new ForbiddenException("Only the person's Team Lead, a Manager over them or the CEO can change a day");
    }
    const pendingSame = await this.prisma.staffRequest.findFirst({ where: { kind: 'day_change', subjectId: day.id, status: 'pending' } });
    if (pendingSame) throw new ConflictException('A change for this day is already waiting');
    const person = await this.requireStaff(day.staffId);
    const ymd = day.date.toISOString().slice(0, 10);
    const monthStart = new Date(`${ymd.slice(0, 8)}01T00:00:00.000Z`);
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
    const [changedDays, pendingChanges] = await Promise.all([
      this.prisma.attendanceDay.count({
        where: { staffId: day.staffId, date: { gte: monthStart, lte: monthEnd }, dayTypeChangedAt: { not: null }, id: { not: day.id } },
      }),
      this.prisma.staffRequest.count({ where: { kind: 'day_change', staffId: day.staffId, status: 'pending', subjectType: 'attendance_day', details: { path: ['month'], equals: ymd.slice(0, 7) } } }),
    ]);
    const earlier = changedDays + pendingChanges;
    const chain = await this.scope.chainOf(person.id);
    const route = routeStaffRequest({ kind: 'day_change', personRole: person.role, chain, ceoId: await this.ceoId(chain), earlier });
    const details = {
      dayId: day.id,
      date: ymd,
      month: ymd.slice(0, 7),
      fromDayType: day.dayType,
      toDayType: dayType,
      productionSeconds: day.productionSeconds,
      changeNumber: earlier + 1,
    };
    const created = await this.insertStaffRequest(actor, {
      kind: 'day_change',
      staffId: person.id,
      subjectType: 'attendance_day',
      subjectId: day.id,
      reason,
      route,
      details,
    });
    // The decider changing a day in their own team: done at once, and kept as a decided request.
    const decidesNow =
      !own &&
      ((actor.role === 'team_lead' && route.routedToRole === 'team_lead') ||
        (actor.role === 'manager' && route.routedToRole !== 'ceo') ||
        actor.role === 'ceo');
    if (decidesNow) {
      await this.decideStaffRequest(actor, created.id, 'approved', reason);
      return this.one(actor, 'day_change', created.id);
    }
    return created;
  }

  private async insertStaffRequest(
    actor: Actor,
    input: {
      kind: StaffRequestKind;
      staffId: string;
      subjectType: string;
      subjectId: string;
      reason: string;
      route: { routedToRole: string; routedToStaffId: string | null; routeReason: string };
      details: Record<string, unknown>;
    },
  ): Promise<RequestView> {
    const now = this.clock.now();
    const row = await this.prisma.staffRequest.create({
      data: {
        kind: input.kind,
        staffId: input.staffId,
        requestedByStaffId: actor.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        details: input.details as Prisma.InputJsonValue,
        reason: input.reason,
        status: 'pending',
        routedToRole: input.route.routedToRole,
        routedToStaffId: input.route.routedToStaffId,
        routeReason: input.route.routeReason,
        createdAt: now,
      },
    });
    const person = await this.prisma.staff.findUnique({ where: { id: input.staffId }, select: { code: true } });
    await this.audit.log({
      actorId: actor.id,
      action: `requests.${input.kind}_requested`,
      entityType: 'staff_request',
      entityCode: person?.code ?? input.staffId,
      after: { kind: input.kind, routedToRole: row.routedToRole, routeReason: row.routeReason, ...this.auditDetails(input.details) },
      reason: input.reason,
    });
    await this.bells.sync(row.id);
    return this.one(actor, input.kind, row.id);
  }

  /** Only counts and codes go to the audit log, never personal data. */
  private auditDetails(details: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of ['hitId', 'hitNumber', 'metric', 'from', 'to', 'year', 'month', 'dayId', 'date', 'fromDayType', 'toDayType', 'changeNumber']) {
      if (key in details) out[key] = details[key];
    }
    const seeker = details.jobSeeker as { code?: string } | undefined;
    if (seeker?.code) out.jobSeekerCode = seeker.code;
    return out;
  }

  // =============================================== StaffRequest: decide

  private async decideStaffRequest(actor: Actor, id: string, decision: 'approved' | 'rejected', reason: string) {
    const row = await this.prisma.staffRequest.findUniqueOrThrow({ where: { id } });
    const now = this.clock.now();
    const claimed = await this.prisma.staffRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: decision, decidedAt: now, decidedByStaffId: actor.id, decidedByRole: actor.role, decisionReason: reason },
    });
    if (claimed.count === 0) throw new ConflictException('This request has already been handled');
    if (decision === 'approved') {
      try {
        await this.applyStaffRequest(actor, row, reason, now);
      } catch (error) {
        // Nothing changed: put it back so someone can decide it again.
        await this.prisma.staffRequest.update({
          where: { id },
          data: { status: 'pending', decidedAt: null, decidedByStaffId: null, decidedByRole: null, decisionReason: null },
        });
        throw error;
      }
    }
    const person = await this.prisma.staff.findUnique({ where: { id: row.staffId }, select: { code: true } });
    await this.audit.log({
      actorId: actor.id,
      action: `requests.${row.kind}_${decision}`,
      entityType: 'staff_request',
      entityCode: person?.code ?? row.staffId,
      before: { status: 'pending' },
      after: { status: decision, ...this.auditDetails(row.details as Record<string, unknown>) },
      reason,
    });
    await this.bells.sync(id);
  }

  /** What an approval changes, done by the service that owns the record. */
  private async applyStaffRequest(actor: Actor, row: StaffRequest, reason: string, now: Date) {
    const details = row.details as Record<string, unknown>;
    if (row.kind === 'hit_removal') {
      await this.jobSeekers.reverseHit(String(details.hitId), `${row.reason} — ${reason}`, actor.id, actor.role);
      return;
    }
    if (row.kind === 'target_change') {
      const metric = String(details.metric) as TargetMetric;
      const year = Number(details.year);
      const month = Number(details.month);
      const jwt = { sub: actor.id, role: actor.role, email: null, code: actor.id };
      const current = await this.prisma.target.findUnique({ where: { staffId_year_month: { staffId: row.staffId, year, month } } });
      if (current) {
        await this.targets.updateTarget(current.id, { [metric]: Number(details.to) }, actor.id, now, jwt);
      } else {
        await this.targets.setTarget({ staffId: row.staffId, year, month, [metric]: Number(details.to) }, actor.id, now, jwt);
      }
      return;
    }
    if (row.kind === 'day_change') {
      await this.attendanceDays.changeDayType(actor, String(details.dayId), { dayType: String(details.toDayType), reason });
      return;
    }
    if (row.kind === 'written_warning') {
      await this.prisma.staffCoachingNote.create({
        data: { staffId: row.staffId, authorStaffId: actor.id, kind: 'written_warning', text: String(details.text ?? row.reason), createdAt: now },
      });
    }
  }

  private async overturnStaffRequest(actor: Actor, id: string, reason: string) {
    const row = await this.prisma.staffRequest.findUniqueOrThrow({ where: { id } });
    const now = this.clock.now();
    const next = row.status === 'approved' ? 'rejected' : 'approved';
    const claimed = await this.prisma.staffRequest.updateMany({
      where: { id, status: row.status, overturnedAt: null },
      data: { status: next, overturnedAt: now, overturnedByStaffId: actor.id, overturnReason: reason },
    });
    if (claimed.count === 0) throw new ConflictException('This decision has just changed');
    try {
      if (next === 'approved') await this.applyStaffRequest(actor, row, reason, now);
      else await this.undoStaffRequest(actor, row, reason, now);
    } catch (error) {
      await this.prisma.staffRequest.update({
        where: { id },
        data: { status: row.status, overturnedAt: null, overturnedByStaffId: null, overturnReason: null },
      });
      throw error;
    }
    const person = await this.prisma.staff.findUnique({ where: { id: row.staffId }, select: { code: true } });
    await this.audit.log({
      actorId: actor.id,
      action: `requests.${row.kind}_overturned`,
      entityType: 'staff_request',
      entityCode: person?.code ?? row.staffId,
      before: { status: row.status },
      after: { status: next },
      reason,
    });
    await this.bells.sync(id);
  }

  /** Undoes an approval being overturned. Only what can be undone cleanly is allowed (see canOverturn). */
  private async undoStaffRequest(actor: Actor, row: StaffRequest, reason: string, now: Date) {
    const details = row.details as Record<string, unknown>;
    if (row.kind === 'day_change') {
      const day = await this.prisma.attendanceDay.findUniqueOrThrow({ where: { id: String(details.dayId) } });
      // Back to how the day counted before the change, with its shortfall and make-up worked out again.
      const from = String(details.fromDayType);
      const policy = await this.pricing.current();
      const rules = classifyDay(day.productionSeconds, policy, false);
      await this.prisma.attendanceDay.update({
        where: { id: day.id },
        data: {
          dayType: from,
          dayTypeChangedAt: null,
          dayTypeChangedById: null,
          dayTypeChangeReason: null,
          shortfallSeconds: from === 'full' ? rules.shortfallSeconds : 0,
          makeUpSeconds: from === 'full' ? rules.makeUpSeconds : 0,
        },
      });
      const fresh = { dayType: from };
      await recordStatusChange(this.prisma, {
        subjectType: 'attendance_day',
        subjectId: day.id,
        fromStatus: day.dayType,
        toStatus: fresh.dayType,
        changedByStaffId: actor.id,
        reason,
        changedAt: now,
      });
      return;
    }
    if (row.kind === 'target_change') {
      const metric = String(details.metric) as TargetMetric;
      const current = await this.prisma.target.findUnique({
        where: { staffId_year_month: { staffId: row.staffId, year: Number(details.year), month: Number(details.month) } },
      });
      if (current) {
        const jwt = { sub: actor.id, role: actor.role, email: null, code: actor.id };
        await this.targets.updateTarget(current.id, { [metric]: details.from === null ? null : Number(details.from) }, actor.id, now, jwt);
      }
      return;
    }
    if (row.kind === 'written_warning') {
      await this.prisma.staffCoachingNote.create({
        data: { staffId: row.staffId, authorStaffId: actor.id, kind: 'note', text: `Written warning withdrawn: ${reason}`, createdAt: now },
      });
      return;
    }
    throw new BadRequestException('A removed hit cannot be put back here');
  }

  // ============================================================== views

  private async context(actor: Actor) {
    const now = this.clock.now();
    const people = actor.role === 'ceo' ? null : await this.scope.peopleUnder(actor.id);
    return { now, people, since: startOfWeekIst(now), staff: new Map<string, Brief | null>() };
  }

  private inScope(ctx: { people: string[] | null }, staffId: string | null | undefined): boolean {
    if (!staffId) return false;
    return ctx.people === null || ctx.people.includes(staffId);
  }

  private async brief(ctx: { staff: Map<string, Brief | null> }, id: string | null | undefined): Promise<Brief | null> {
    if (!id) return null;
    if (!ctx.staff.has(id)) {
      ctx.staff.set(id, await this.prisma.staff.findUnique({ where: { id }, select: BRIEF }));
    }
    return ctx.staff.get(id) ?? null;
  }

  private async one(actor: Actor, kind: RequestKind, id: string): Promise<RequestView> {
    const ctx = await this.context(actor);
    let rows: RequestView[] = [];
    if (kind === 'leave' || kind === 'correction') {
      rows = (await this.attendanceRows(actor, ctx, 'all', { kind, id })).filter((row) => row.id === id);
    } else if (kind === 'device') {
      rows = await this.deviceRows(actor, ctx, 'all', id);
    } else if (kind === 'claim') {
      rows = await this.claimRows(actor, ctx, 'all', id);
    } else {
      rows = await this.staffRequestRows(actor, ctx, 'all', id);
      rows = rows.filter((row) => row.kind === kind);
    }
    const view = rows[0];
    if (!view) throw new NotFoundException('Request not found in your team');
    return view;
  }

  private base(partial: Partial<RequestView> & Pick<RequestView, 'kind' | 'id' | 'title' | 'summary' | 'status' | 'createdAt' | 'routeReason'>): RequestView {
    return {
      ref: `${partial.kind}.${partial.id}`,
      about: null,
      person: null,
      requestedBy: null,
      reason: null,
      where: 'decided',
      withTeamLead: false,
      withManager: false,
      withCeo: false,
      decider: null,
      deciderStaff: null,
      routeReasonText: REASON_TEXT[partial.routeReason] ?? partial.routeReason,
      whyWithYou: null,
      whyWithYouText: null,
      alert: null,
      dueAt: null,
      forwarded: null,
      decided: null,
      overturned: null,
      sentBack: null,
      canDecide: false,
      canForward: false,
      canOverturn: false,
      canSendBack: false,
      canApprovePart: false,
      details: {},
      ...partial,
    } as RequestView;
  }

  /** Who the caller is to this placement: why it is with them, if it is. */
  private whyFor(actor: Actor, placement: Placement, routeReason: string, mineToDecide: boolean): string | null {
    if (!mineToDecide) return null;
    if (actor.role === 'team_lead' && placement.withTeamLead) return routeReason;
    if (actor.role === 'manager' && placement.withManager) return placement.managerReason ?? routeReason;
    if (actor.role === 'ceo' && placement.withCeo) return placement.ceoReason ?? routeReason;
    if (actor.role === 'ceo' && placement.withManager) return placement.managerReason ?? routeReason;
    return null;
  }

  // ------------------------------------------------- leave and corrections

  private async attendanceRows(
    actor: Actor,
    ctx: { now: Date; people: string[] | null; since: Date; staff: Map<string, Brief | null> },
    which: 'pending' | 'decided' | 'all',
    only?: { kind: 'leave' | 'correction'; id: string },
  ): Promise<RequestView[]> {
    const team = (await this.attendanceRequests.team(actor)) as AttendanceView[];
    const waiting = new Map(((await this.attendanceRequests.waiting(actor)) as AttendanceView[]).map((row) => [`${row.kind}.${row.id}`, row]));
    // A Team Lead's own requests sit with the Manager: shown in "With the Manager".
    const mine = actor.role === 'team_lead' ? ((await this.attendanceRequests.mine(actor)) as AttendanceView[]) : [];
    const all = [...team, ...mine.filter((row) => !team.some((other) => other.kind === row.kind && other.id === row.id))];
    if (only && !all.some((row) => row.kind === only.kind && row.id === only.id)) {
      // Decided more than 30 days ago: still readable by those who could see it.
      const row = await this.prisma[only.kind === 'leave' ? 'leaveRequest' : 'attendanceCorrection' as 'leaveRequest'].findUnique({ where: { id: only.id }, select: { staffId: true } });
      if (row && (this.inScope(ctx, row.staffId) || row.staffId === actor.id)) {
        const list = (await this.attendanceRequests.mine({ id: row.staffId, role: 'call_agent' })) as AttendanceView[];
        const found = list.find((item) => item.kind === only.kind && item.id === only.id);
        if (found) all.push({ ...found, canDecide: false });
      }
    }
    const out: RequestView[] = [];
    for (const row of all) {
      if (which === 'pending' && row.status !== 'pending') continue;
      if (which === 'decided' && row.status === 'pending') continue;
      out.push(await this.fromAttendance(actor, ctx, row, waiting.get(`${row.kind}.${row.id}`)));
    }
    return out;
  }

  private async fromAttendance(
    actor: Actor,
    ctx: { now: Date; staff: Map<string, Brief | null> },
    row: AttendanceView,
    waiting: AttendanceView | undefined,
  ): Promise<RequestView> {
    const status = (row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending') as RequestView['status'];
    const placement: Placement = {
      withTeamLead: row.withTeamLead,
      withManager: row.withManager,
      withCeo: row.withCeo,
      managerReason: null,
      ceoReason: null,
      managerSince: null,
    };
    const decider = deciderOf(placement, status);
    let title: string;
    let summary: string;
    let alert: string | null = null;
    const details: Record<string, unknown> = {};
    if (row.kind === 'leave') {
      const planned = row.leaveKind === 'casual';
      title = planned ? 'Planned leave' : 'Emergency leave';
      const dates = row.fromDate === row.toDate ? dayLabel(row.fromDate ?? '') : `${dayLabel(row.fromDate ?? '')} – ${dayLabel(row.toDate ?? '')}`;
      summary = `${dates} · ${row.days ?? 0} day${row.days === 1 ? '' : 's'}`;
      if (row.approvedDays && row.approvedFromDate) {
        const approved = row.approvedFromDate === row.approvedToDate ? dayLabel(row.approvedFromDate) : `${dayLabel(row.approvedFromDate)} – ${dayLabel(row.approvedToDate ?? '')}`;
        summary += ` · ${row.approvedDays} approved (${approved})`;
      }
      const taken = row.casualDaysTakenThisMonth ?? 0;
      const pendingOthers = row.casualDaysPendingThisMonth ?? 0;
      if (planned && status === 'pending') {
        const total = taken + pendingOthers + (row.days ?? 0);
        if (total > 1) alert = `${ordinal(total)} planned day${row.days && row.days > 1 ? 's' : ''} in ${monthName(row.fromDate ?? '')}`;
      }
      Object.assign(details, {
        leaveKind: row.leaveKind,
        fromDate: row.fromDate,
        toDate: row.toDate,
        days: row.days,
        unpaidDays: row.unpaidDays ?? 0,
        approvedFromDate: row.approvedFromDate ?? null,
        approvedToDate: row.approvedToDate ?? null,
        approvedDays: row.approvedDays ?? null,
        casualDaysTakenThisMonth: taken,
        casualDaysPendingThisMonth: pendingOthers,
      });
    } else {
      title = 'Attendance correction';
      const from = row.startAt ? new Date(row.startAt) : null;
      const to = row.endAt ? new Date(row.endAt) : null;
      const hhmm = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * HOUR_MS).toISOString().slice(11, 16) : '');
      summary = `${dayLabel(row.date ?? '')} · ${hhmm(from)}–${hhmm(to)}`;
      if ((row.monthNumber ?? 0) >= 3) alert = `${ordinal(row.monthNumber as number)} correction this month`;
      Object.assign(details, { date: row.date, startAt: row.startAt, endAt: row.endAt, segmentStatus: row.segmentStatus, monthNumber: row.monthNumber });
    }
    const why = waiting?.whyWithYou ?? null;
    const view = this.base({
      kind: row.kind,
      id: row.id,
      title,
      summary,
      person: row.staff,
      requestedBy: row.staff,
      reason: row.reason,
      status,
      where: whereLabel(placement, status) as RequestView['where'],
      withTeamLead: row.withTeamLead,
      withManager: row.withManager,
      withCeo: row.withCeo,
      decider,
      routeReason: row.routeReason,
      whyWithYou: why,
      whyWithYouText: why ? (REASON_TEXT[why] ?? why) : null,
      alert,
      createdAt: row.createdAt,
      forwarded: row.forwarded,
      decided: row.decided,
      overturned: row.overturned ?? null,
      sentBack: row.sentBack ?? null,
      canDecide: row.canDecide,
      canForward: actor.role === 'team_lead' && row.canDecide && row.withTeamLead && !row.forwarded,
      canApprovePart: row.kind === 'leave' && row.canDecide && (row.days ?? 0) > 1,
      details,
    });
    view.deciderStaff = await this.deciderStaff(ctx, view, row.staff?.id ?? null);
    view.dueAt = this.escalationDue(row.sentBack?.at ?? row.createdAt, row.forwarded?.at ?? null, view);
    if (actor.role === 'manager' && status === 'pending' && row.withManager && row.canDecide && row.staff && AGENT_ROLES.includes(row.staff.role)) {
      view.canSendBack = Boolean((await this.scope.chainOf(row.staff.id)).teamLead);
    }
    if (row.kind === 'leave' && status !== 'pending' && !row.overturned && row.decided && actor.id !== row.decided.by?.id && actor.id !== row.staff?.id) {
      view.canOverturn = canOverturnLevel(actor.role, row.decided.role) && (actor.role === 'ceo' || this.inScopeSync(ctx, row.staff?.id));
    }
    return view;
  }

  private inScopeSync(ctx: unknown, staffId: string | null | undefined): boolean {
    const people = (ctx as { people?: string[] | null }).people;
    if (people === undefined) return false;
    return this.inScope({ people }, staffId);
  }

  /** When a pending request also reaches the next level by the clock (24 h TL, 48 h Manager). */
  private escalationDue(createdAt: string, forwardedAt: string | null, view: RequestView): string | null {
    if (view.status !== 'pending') return null;
    const created = new Date(createdAt).getTime();
    if (view.withTeamLead && !view.withManager) return new Date(created + 24 * HOUR_MS).toISOString();
    if (view.withManager && !view.withCeo) {
      const since = forwardedAt
        ? new Date(forwardedAt).getTime()
        : view.routeReason === 'team_lead' || view.routeReason === 'sent_back'
          ? created + 24 * HOUR_MS
          : created;
      return new Date(since + 48 * HOUR_MS).toISOString();
    }
    return null;
  }

  private async deciderStaff(ctx: { staff: Map<string, Brief | null> }, view: RequestView, personId: string | null): Promise<Brief | null> {
    if (!view.decider || !personId) return null;
    const chain = await this.scope.chainOf(personId);
    if (view.decider === 'team_lead') return chain.teamLead;
    if (view.decider === 'manager') return chain.manager;
    return chain.ceo ?? (await this.brief(ctx, await this.ceoId(chain)));
  }

  // ------------------------------------------------------------- devices

  private async deviceRows(
    actor: Actor,
    ctx: { now: Date; people: string[] | null; since: Date; staff: Map<string, Brief | null> },
    which: 'pending' | 'decided' | 'all',
    onlyId?: string,
  ): Promise<RequestView[]> {
    const scopeWhere: Prisma.StaffDeviceWhereInput =
      ctx.people === null ? {} : { OR: [{ staffId: { in: ctx.people } }, { staffId: actor.id }] };
    const statusWhere: Prisma.StaffDeviceWhereInput =
      which === 'pending'
        ? { status: 'pending' }
        : which === 'decided'
          ? { OR: [{ approvedAt: { gte: ctx.since } }, { revokedAt: { gte: ctx.since } }] }
          : {};
    const rows = await this.prisma.staffDevice.findMany({
      where: { AND: [scopeWhere, statusWhere, onlyId ? { id: onlyId } : {}] },
      include: { staff: { select: { ...BRIEF, teamLeadId: true, reportsToId: true } } },
      orderBy: { requestedAt: 'asc' },
      take: 300,
    });
    const out: RequestView[] = [];
    for (const device of rows) {
      if (device.staff.role === 'ceo') continue;
      const own = device.staffId === actor.id;
      if (!own && !this.inScope(ctx, device.staffId)) continue;
      const chain = await this.scope.chainOf(device.staffId);
      const route = deviceRoute(device.staff.role, chain, await this.ceoId(chain));
      const createdAt = device.requestedAt ?? device.approvedAt ?? device.revokedAt ?? ctx.now;
      const status: RequestView['status'] = device.status === 'pending' ? 'pending' : device.status === 'approved' ? 'approved' : 'rejected';
      const placement = placementOf({ status, routedToRole: route.routedToRole, routeReason: route.routeReason, forwardedAt: null, createdAt }, ctx.now);
      if (route.routeReason === 'device_agent' && placement.managerReason === 'team_lead_24h') placement.managerReason = 'device_24h';
      const decider = deciderOf(placement, status);
      let mine = false;
      if (status === 'pending' && !own) {
        if (actor.role === 'ceo') mine = true;
        else if (actor.role === 'team_lead') mine = placement.withTeamLead && (device.staff.teamLeadId === actor.id || device.staff.reportsToId === actor.id);
        else if (actor.role === 'manager') mine = placement.withManager && !['manager', 'finance'].includes(device.staff.role);
      }
      const why = this.whyFor(actor, placement, route.routeReason, mine);
      const decidedById = device.status === 'approved' ? device.approvedByStaffId : device.status === 'revoked' ? device.revokedByStaffId : null;
      const decidedAt = device.status === 'approved' ? device.approvedAt : device.status === 'revoked' ? device.revokedAt : null;
      const by = await this.brief(ctx, decidedById);
      const view = this.base({
        kind: 'device',
        id: device.id,
        title: 'New device',
        summary: `${device.label}${device.platform ? ` · ${device.platform}` : ''}`,
        person: { id: device.staff.id, code: device.staff.code, name: device.staff.name, role: device.staff.role },
        requestedBy: { id: device.staff.id, code: device.staff.code, name: device.staff.name, role: device.staff.role },
        status,
        where: whereLabel(placement, status) as RequestView['where'],
        withTeamLead: placement.withTeamLead,
        withManager: placement.withManager,
        withCeo: placement.withCeo,
        decider,
        routeReason: route.routeReason,
        whyWithYou: why,
        whyWithYouText: why ? (REASON_TEXT[why] ?? why) : null,
        createdAt: createdAt.toISOString(),
        decided: decidedAt ? { at: decidedAt.toISOString(), by, role: by?.role ?? null, reason: null } : null,
        canDecide: mine,
        details: { label: device.label, platform: device.platform, lastSeenAt: device.lastSeenAt?.toISOString() ?? null },
      });
      view.deciderStaff = await this.deciderStaff(ctx, view, device.staffId);
      view.dueAt = this.escalationDue(view.createdAt, null, view);
      out.push(view);
    }
    return out;
  }

  // -------------------------------------------------------------- claims

  private async claimRows(
    actor: Actor,
    ctx: { now: Date; people: string[] | null; since: Date; staff: Map<string, Brief | null> },
    which: 'pending' | 'decided' | 'all',
    onlyId?: string,
  ): Promise<RequestView[]> {
    const statusWhere: Prisma.ReplacementClaimWhereInput =
      which === 'pending'
        ? { decision: null }
        : which === 'decided'
          ? { decidedAt: { gte: ctx.since }, OR: [{ decidedByStaffId: { not: null } }, { overruledByStaffId: { not: null } }] }
          : {};
    const scopeWhere: Prisma.ReplacementClaimWhereInput =
      ctx.people === null ? {} : { placement: { business: { accountAgentId: { in: ctx.people } } } };
    const rows = await this.prisma.replacementClaim.findMany({
      where: { AND: [statusWhere, scopeWhere, onlyId ? { id: onlyId } : {}] },
      include: {
        placement: {
          select: {
            id: true,
            code: true,
            business: { select: { id: true, code: true, name: true, accountAgentId: true } },
            jobSeeker: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { reportedAt: 'asc' },
      take: 300,
    });
    const out: RequestView[] = [];
    for (const claim of rows) {
      const agentId = claim.placement.business.accountAgentId;
      const chain: Chain = agentId ? await this.scope.chainOf(agentId) : { teamLead: null, manager: null, ceo: null };
      const agent = await this.brief(ctx, agentId);
      const leadId = agent?.role === 'team_lead' ? agent.id : chain.teamLead?.id ?? null;
      const status: RequestView['status'] = claim.decision === null ? 'pending' : claim.decision === 'accepted' ? 'approved' : 'rejected';
      const placement = claimPlacement({ reportedAt: claim.reportedAt, decisionDueAt: claim.decisionDueAt, hasTeamLead: Boolean(leadId), now: ctx.now });
      if (status !== 'pending') {
        placement.withTeamLead = false;
        placement.withManager = false;
        placement.withCeo = false;
      }
      let mine = false;
      if (status === 'pending') {
        if (actor.role === 'ceo') mine = true;
        else if (actor.role === 'team_lead') mine = placement.withTeamLead && leadId === actor.id;
        else if (actor.role === 'manager') mine = placement.withManager && this.inScope(ctx, agentId);
      }
      const why = this.whyFor(actor, placement, 'claim', mine);
      const decidedBy = await this.brief(ctx, claim.decidedByStaffId);
      const overruledBy = await this.brief(ctx, claim.overruledByStaffId);
      const hoursLeft = Math.max(0, Math.round((claim.decisionDueAt.getTime() - ctx.now.getTime()) / HOUR_MS));
      const day = Math.max(1, Math.round((claim.workerLeftOn.getTime() - claim.reportedAt.getTime()) / DAY_MS) || 0);
      void day;
      const view = this.base({
        kind: 'claim',
        id: claim.id,
        title: 'Replacement claim',
        summary: `${claim.placement.code} · ${claim.placement.business.name}`,
        about: { type: 'placement', id: claim.placement.id, code: claim.placement.code, name: claim.placement.business.name },
        person: agent,
        requestedBy: agent,
        reason: claim.reason,
        status,
        where: whereLabel(placement, status) as RequestView['where'],
        withTeamLead: placement.withTeamLead,
        withManager: placement.withManager,
        withCeo: placement.withCeo,
        decider: deciderOf(placement, status),
        routeReason: leadId ? 'claim' : 'claim_no_team',
        whyWithYou: why,
        whyWithYouText: why ? (REASON_TEXT[why] ?? why) : null,
        alert:
          status === 'pending'
            ? placement.withCeo
              ? 'Past the 48-hour limit'
              : placement.withManager && placement.withTeamLead
                ? `The Manager can also decide now · ${hoursLeft} h left`
                : `Decide within 48 hours · ${hoursLeft} h left`
            : null,
        createdAt: claim.reportedAt.toISOString(),
        dueAt: claim.decisionDueAt.toISOString(),
        decided: claim.decidedAt && (decidedBy || overruledBy) ? { at: claim.decidedAt.toISOString(), by: decidedBy, role: decidedBy?.role ?? null, reason: claim.decisionReason } : null,
        overturned: overruledBy ? { at: (claim.decidedAt ?? claim.updatedAt).toISOString(), by: overruledBy, reason: claim.overruleReason } : null,
        canDecide: mine,
        details: {
          claimCode: claim.code,
          placementCode: claim.placement.code,
          business: { id: claim.placement.business.id, code: claim.placement.business.code, name: claim.placement.business.name },
          worker: { code: claim.placement.jobSeeker.code, name: claim.placement.jobSeeker.name },
          workerLeftOn: claim.workerLeftOn.toISOString().slice(0, 10),
          reportedWithinDeadline: claim.reportedWithinDeadline,
          feePaidInFull: claim.feePaidInFull,
          exitCallRecorded: Boolean(claim.exitCallRecordId),
          hoursLeft,
        },
      });
      view.deciderStaff = view.decider === 'team_lead' ? await this.brief(ctx, leadId) : view.decider === 'manager' ? chain.manager : view.decider === 'ceo' ? chain.ceo : null;
      if (status !== 'pending' && !overruledBy && decidedBy && actor.id !== decidedBy.id) {
        view.canOverturn = canOverturnLevel(actor.role, decidedBy.role) && (actor.role === 'ceo' || this.inScope(ctx, agentId));
      }
      out.push(view);
    }
    return out;
  }

  // ------------------------------------------------------- StaffRequests

  private async staffRequestRows(
    actor: Actor,
    ctx: { now: Date; people: string[] | null; since: Date; staff: Map<string, Brief | null> },
    which: 'pending' | 'decided' | 'all',
    onlyId?: string,
  ): Promise<RequestView[]> {
    const scopeWhere: Prisma.StaffRequestWhereInput =
      ctx.people === null ? {} : { OR: [{ staffId: { in: ctx.people } }, { staffId: actor.id }, { requestedByStaffId: actor.id }] };
    const statusWhere: Prisma.StaffRequestWhereInput =
      which === 'pending' ? { status: 'pending' } : which === 'decided' ? { OR: [{ decidedAt: { gte: ctx.since } }, { overturnedAt: { gte: ctx.since } }] } : {};
    const rows = await this.prisma.staffRequest.findMany({
      where: { AND: [scopeWhere, statusWhere, onlyId ? { id: onlyId } : {}] },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const out: RequestView[] = [];
    for (const row of rows) out.push(await this.fromStaffRequest(actor, ctx, row));
    return out;
  }

  /** The view of one StaffRequest for the caller. */
  async fromStaffRequest(
    actor: Actor,
    ctx: { now: Date; people: string[] | null; staff: Map<string, Brief | null> },
    row: StaffRequest,
  ): Promise<RequestView> {
    const status = row.status as RequestView['status'];
    const placement = placementOf(row, ctx.now);
    const person = await this.brief(ctx, row.staffId);
    const requestedBy = await this.brief(ctx, row.requestedByStaffId);
    const under = this.inScope(ctx, row.staffId);
    let mine = false;
    if (status === 'pending' && row.staffId !== actor.id && row.requestedByStaffId !== actor.id) {
      if (actor.role === 'ceo') mine = true;
      else if (actor.role === 'team_lead') mine = placement.withTeamLead && under;
      else if (actor.role === 'manager') mine = placement.withManager && under;
    }
    const why = this.whyFor(actor, placement, row.routeReason, mine);
    const details = row.details as Record<string, unknown>;
    let summary = '';
    let about: RequestView['about'] = null;
    let alert: string | null = null;
    if (row.kind === 'hit_removal') {
      const seeker = details.jobSeeker as { id: string; code: string; name: string };
      about = { type: 'job_seeker', id: seeker.id, code: seeker.code, name: seeker.name };
      summary = `"${String(details.hitReason ?? '').replace(/_/g, ' ')}" — ${row.reason}`;
      const n = Number(details.earlierRemovals ?? 0) + 1;
      alert = n >= 3 ? `${ordinal(n)} hit removal on this job seeker` : `${ordinal(Number(details.hitNumber ?? 1))} hit on them`;
    } else if (row.kind === 'target_change') {
      summary = `${details.metricLabel ?? details.metric} ${details.from ?? '—'} → ${details.to}`;
    } else if (row.kind === 'day_change') {
      summary = `${dayLabel(String(details.date))} ${String(details.fromDayType)} day → ${String(details.toDayType)} day`;
      if (Number(details.changeNumber ?? 1) >= 3) alert = `${ordinal(Number(details.changeNumber))} day change this month`;
    } else {
      summary = String(details.text ?? row.reason);
    }
    const decidedBy = await this.brief(ctx, row.decidedByStaffId);
    const overturnedBy = await this.brief(ctx, row.overturnedByStaffId);
    const forwardedBy = await this.brief(ctx, row.forwardedByStaffId);
    const view = this.base({
      kind: row.kind as StaffRequestKind,
      id: row.id,
      title: KIND_TITLE[row.kind as StaffRequestKind],
      summary,
      about,
      person,
      requestedBy,
      reason: row.reason,
      status,
      where: whereLabel(placement, status) as RequestView['where'],
      withTeamLead: placement.withTeamLead,
      withManager: placement.withManager,
      withCeo: placement.withCeo,
      decider: deciderOf(placement, status),
      routeReason: row.routeReason,
      whyWithYou: why,
      whyWithYouText: why ? (REASON_TEXT[why] ?? why) : null,
      alert,
      createdAt: row.createdAt.toISOString(),
      forwarded: row.forwardedAt ? { at: row.forwardedAt.toISOString(), by: forwardedBy, note: row.forwardNote } : null,
      decided: row.decidedAt ? { at: row.decidedAt.toISOString(), by: decidedBy, role: row.decidedByRole, reason: row.decisionReason } : null,
      overturned: row.overturnedAt ? { at: row.overturnedAt.toISOString(), by: overturnedBy, reason: row.overturnReason } : null,
      canDecide: mine,
      canForward: actor.role === 'team_lead' && mine && placement.withTeamLead && !row.forwardedAt,
      details: { ...details },
    });
    view.deciderStaff = await this.deciderStaff(ctx, view, row.staffId);
    view.dueAt = this.escalationDue(view.createdAt, view.forwarded?.at ?? null, view);
    if (status !== 'pending' && !row.overturnedAt && row.decidedByStaffId !== actor.id && row.staffId !== actor.id) {
      const undoable = status === 'rejected' || row.kind !== 'hit_removal';
      view.canOverturn = undoable && canOverturnLevel(actor.role, row.decidedByRole) && (actor.role === 'ceo' || under);
    }
    return view;
  }

  // ============================================================ helpers

  private history(view: RequestView, now: Date): Array<{ at: string; text: string }> {
    const events: Array<{ at: string; text: string }> = [];
    const who = view.requestedBy?.name ?? 'Someone';
    events.push({ at: view.createdAt, text: `${who} asked: ${view.title.toLowerCase()} · ${view.summary}` });
    if (view.routeReason && view.routeReason !== 'team_lead' && view.routeReason !== 'claim' && view.routeReason !== 'sent_back') {
      events.push({ at: view.createdAt, text: view.routeReasonText });
    }
    if (view.sentBack) {
      events.push({ at: view.sentBack.at, text: `Sent back to the Team Lead by ${view.sentBack.by?.name ?? 'the Manager'}${view.sentBack.note ? ` · "${view.sentBack.note}"` : ''}` });
      const at = new Date(new Date(view.sentBack.at).getTime() + 24 * HOUR_MS);
      if (view.status === 'pending' && !view.forwarded) {
        events.push({ at: at.toISOString(), text: now.getTime() < at.getTime() ? 'Comes back to the Manager too if the Team Lead has not answered in 24 h' : 'Not answered in 24 h · the Manager can decide it too' });
      }
    }
    if (view.forwarded) events.push({ at: view.forwarded.at, text: `Sent to the Manager by ${view.forwarded.by?.name ?? 'the Team Lead'}${view.forwarded.note ? ` · "${view.forwarded.note}"` : ''}` });
    if (view.kind !== 'claim' && (view.routeReason === 'team_lead' || view.routeReason === 'device_agent')) {
      const at = new Date(new Date(view.createdAt).getTime() + 24 * HOUR_MS);
      if (!view.decided || new Date(view.decided.at).getTime() > at.getTime()) {
        if (!view.forwarded) events.push({ at: at.toISOString(), text: view.status === 'pending' && now.getTime() < at.getTime() ? 'Goes to the Manager too if not answered in 24 h' : "Not answered in 24 h · the Manager can decide it too" });
      }
    }
    if (view.status === 'pending' && view.dueAt && view.withManager && !view.withCeo) {
      events.push({ at: view.dueAt, text: 'Goes to the CEO if still not answered' });
    }
    if (view.decided) {
      const part = view.kind === 'leave' && view.status === 'approved' && typeof view.details.approvedDays === 'number' && view.details.approvedDays > 0;
      const verdict = part ? `${view.details.approvedDays} of ${view.details.days} days approved, the rest rejected` : view.status === 'approved' ? 'Approved' : 'Rejected';
      events.push({ at: view.decided.at, text: `${verdict} by ${view.decided.by?.name ?? 'someone'}${view.decided.reason && view.decided.reason !== 'Approved' ? ` · "${view.decided.reason}"` : ''}` });
    }
    if (view.overturned) {
      events.push({ at: view.overturned.at, text: `Overturned by ${view.overturned.by?.name ?? 'someone'} · "${view.overturned.reason ?? ''}"` });
    }
    return events.sort((a, b) => a.at.localeCompare(b.at));
  }

  private whyNot(actor: Actor, view: RequestView): string {
    if (view.person?.id === actor.id || view.requestedBy?.id === actor.id) return 'You cannot decide your own request';
    if (actor.role === 'team_lead' && view.withManager && !view.withTeamLead) return 'This request is with the Manager';
    if (actor.role === 'manager' && view.withTeamLead && !view.withManager) return 'This request is still with the Team Lead';
    return 'This request is not yours to decide';
  }

  private whyNotOverturn(actor: Actor, view: RequestView): string {
    if (view.status === 'pending') return 'This request has not been decided yet';
    if (view.overturned) return 'This decision has already been overturned';
    if (view.kind === 'correction' || view.kind === 'device') return 'This kind of decision cannot be overturned';
    if (view.decided?.by?.id === actor.id) return 'You cannot overturn your own decision';
    if (actor.role === 'manager') return "A Manager over the person overturns a Team Lead's decision";
    return "The CEO overturns a Manager's decision";
  }

  private assertDecider(actor: Actor) {
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) {
      throw new ForbiddenException('Requests are decided by Team Leads, Managers and the CEO');
    }
  }

  private async requireStaff(id: string): Promise<Brief> {
    const staff = await this.prisma.staff.findUnique({ where: { id }, select: BRIEF });
    if (!staff) throw new NotFoundException('Staff account not found');
    return staff;
  }

  private async ceoId(chain: Chain): Promise<string | null> {
    if (chain.ceo) return chain.ceo.id;
    const ceo = await this.prisma.staff.findFirst({ where: { role: 'ceo', status: 'active' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    return ceo?.id ?? null;
  }

  private sorted(rows: RequestView[]): RequestView[] {
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Logs instead of failing: used where a side read must never block the answer. */
  async safely<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`${label} failed: ${(error as Error).message}`);
      return fallback;
    }
  }
}
