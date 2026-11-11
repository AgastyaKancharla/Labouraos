import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PricingService } from '../pricing/pricing.service';
import { AttendanceService } from '../attendance/attendance.service';
import { CallService } from '../call/call.service';
import { parseClock } from '../call/call-window';
import { FINAL_CALL_STATUSES } from '../call/call-status';
import { MatchingService } from '../vacancy/matching.service';
import { InboundCallRouter } from '../telephony/inbound-call-router.service';
import { TargetOverviewService } from '../target/target-overview.service';
import { LeaderboardService } from '../target/leaderboard.service';
import { CallWorkClock, DAY_MS, istDayStart, istMinuteOfDay } from './call-work-clock';
import {
  countByCategory,
  KIND_CATEGORY,
  orderWorkItems,
  pickNext,
  WorkItem,
  WorkKind,
} from './work-queue';

type SubjectType = 'job_seeker' | 'business' | 'referral';

const REQUIRED_CONSENTS = ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates'];
const REFUND_ENDING_HITS = ['offer_declined', 'offer_no_reply', 'interview_no_show'];
const MATCHING_PURPOSES = ['offer', 'follow_up', 'interview_result', 'joining_confirmation'];
const CLOSED_SEEKER = ['placed', 'deactivated', 'closed'];
const STUCK_STATUSES = ['lead', 'consented', 'pending_activation'];
const STUCK_LIST_LIMIT = 20;

const FOLLOW_UP_PURPOSE: Record<string, string> = {
  not_selected_day_7: 'follow_up',
  not_selected_day_30: 'follow_up',
  not_selected_day_90: 'follow_up',
  placement_check_in_day_7: 'check_in',
  placement_check_in_day_30: 'check_in',
  refund_check: 'refund_check',
  exit_call: 'exit_call',
};

interface SeekerSummary {
  id: string;
  code: string;
  name: string;
  phone: string;
  status: string;
  preferredCallWindowStart: string;
  preferredCallWindowEnd: string;
  paymentReceivedAt: Date | null;
  trades: Array<{ trade: string; isPrimary: boolean; yearsExperience: number }>;
}

interface Subject {
  type: SubjectType;
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  trade: string | null;
  window: { start: string; end: string } | null;
  seeker?: SeekerSummary;
}

interface RefundInfo {
  daysLeft: number;
  day: number;
  priority: boolean;
}

interface QueueContext {
  now: Date;
  todayStart: Date;
  endOfToday: Date;
  inCallingHours: boolean;
  callingHours: { start: string; end: string };
  guaranteeDays: number;
  windowDays: number;
}

function primaryTrade(trades: Array<{ trade: string; isPrimary: boolean }>): string | null {
  return trades.find((t) => t.isPrimary)?.trade ?? trades[0]?.trade ?? null;
}

function withinClock(minute: number, start: string, end: string): boolean {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === null || e === null) return false;
  return minute >= s && minute <= e;
}

/**
 * Reads for the call agent console (CA03 Home, CA04 profile, CA05 on call,
 * CA10 follow-ups, CA11 targets, CA17 incoming call). Every answer is scoped
 * to the signed-in call agent and carries phone numbers as the last 4 digits
 * only. No rupee amounts except the public ₹499 fee label on a profile's
 * history (Phase 21 Task 7: agents see their own people near a refund as
 * counts, without rupees).
 */
@Injectable()
export class CallWorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly attendance: AttendanceService,
    private readonly calls: CallService,
    private readonly matching: MatchingService,
    private readonly router: InboundCallRouter,
    private readonly targetOverview: TargetOverviewService,
    private readonly leaderboard: LeaderboardService,
    private readonly clock: CallWorkClock,
  ) {}

  // ---------------------------------------------------------------- context

  private async context(): Promise<QueueContext> {
    const now = this.clock.now();
    const policy = await this.pricing.current();
    const todayStart = istDayStart(now);
    return {
      now,
      todayStart,
      endOfToday: new Date(todayStart.getTime() + DAY_MS),
      inCallingHours: withinClock(istMinuteOfDay(now), policy.callingHoursStart, policy.callingHoursEnd),
      callingHours: { start: policy.callingHoursStart, end: policy.callingHoursEnd },
      guaranteeDays: policy.jobSeekerGuaranteeDays,
      windowDays: policy.refundPriorityWindowDays,
    };
  }

  private async loadSeekers(ids: string[]): Promise<Map<string, SeekerSummary>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.jobSeeker.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        status: true,
        preferredCallWindowStart: true,
        preferredCallWindowEnd: true,
        paymentReceivedAt: true,
        trades: { select: { trade: true, isPrimary: true, yearsExperience: true } },
      },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async loadSubjects(refs: Array<{ type: SubjectType; id: string }>): Promise<Map<string, Subject>> {
    const ids = (type: SubjectType) => [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))];
    const [seekers, businesses, referrals] = await Promise.all([
      this.loadSeekers(ids('job_seeker')),
      ids('business').length
        ? this.prisma.business.findMany({
            where: { id: { in: ids('business') } },
            select: { id: true, code: true, name: true, phone: true, businessType: true },
          })
        : Promise.resolve([]),
      ids('referral').length
        ? this.prisma.referral.findMany({
            where: { id: { in: ids('referral') } },
            select: { id: true, code: true, name: true, phone: true },
          })
        : Promise.resolve([]),
    ]);
    const map = new Map<string, Subject>();
    for (const s of seekers.values()) {
      map.set(`job_seeker:${s.id}`, {
        type: 'job_seeker',
        id: s.id,
        code: s.code,
        name: s.name,
        phone: s.phone,
        trade: primaryTrade(s.trades),
        window: { start: s.preferredCallWindowStart, end: s.preferredCallWindowEnd },
        seeker: s,
      });
    }
    for (const b of businesses) {
      map.set(`business:${b.id}`, { type: 'business', id: b.id, code: b.code, name: b.name, phone: b.phone, trade: b.businessType, window: null });
    }
    for (const r of referrals) {
      map.set(`referral:${r.id}`, { type: 'referral', id: r.id, code: r.code, name: r.name, phone: r.phone, trade: null, window: null });
    }
    return map;
  }

  private async consentMap(seekerIds: string[]): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    if (seekerIds.length === 0) return map;
    const rows = await this.prisma.consent.findMany({
      where: { subjectType: 'job_seeker', subjectId: { in: [...new Set(seekerIds)] }, granted: true, withdrawnAt: null },
      select: { subjectId: true, purpose: true },
    });
    for (const row of rows) {
      const set = map.get(row.subjectId) ?? new Set<string>();
      set.add(row.purpose);
      map.set(row.subjectId, set);
    }
    return map;
  }

  /**
   * Paid job seekers and where they are on the 30-day clock. `priority` is
   * the 15-day close-to-refund window: paid, refund still possible, no
   * suitable offer (interview) since paying.
   */
  private async refundInfo(seekers: SeekerSummary[], ctx: QueueContext): Promise<Map<string, RefundInfo>> {
    const paid = seekers.filter((s) => s.paymentReceivedAt && !CLOSED_SEEKER.includes(s.status));
    const map = new Map<string, RefundInfo>();
    if (paid.length === 0) return map;
    const ids = paid.map((s) => s.id);
    const [hits, refunds, interviews] = await Promise.all([
      this.prisma.jobSeekerHit.findMany({
        where: { jobSeekerId: { in: ids }, reason: { in: REFUND_ENDING_HITS }, reversedAt: null, supersededAt: null },
        select: { jobSeekerId: true },
      }),
      this.prisma.payment.findMany({
        where: { jobSeekerId: { in: ids }, type: 'refund', status: { in: ['pending', 'processing', 'completed', 'succeeded'] } },
        select: { jobSeekerId: true },
      }),
      this.prisma.interview.findMany({
        where: { jobSeekerId: { in: ids }, status: { not: 'cancelled' } },
        select: { jobSeekerId: true, createdAt: true },
      }),
    ]);
    const ended = new Set([...hits.map((h) => h.jobSeekerId), ...refunds.map((r) => r.jobSeekerId!)]);
    for (const s of paid) {
      const deadline = refundGuaranteeDeadline(s.paymentReceivedAt!, ctx.guaranteeDays);
      const msLeft = deadline.getTime() - ctx.now.getTime();
      const daysLeft = Math.ceil(msLeft / DAY_MS);
      const day = Math.min(ctx.guaranteeDays, Math.max(1, ctx.guaranteeDays - daysLeft + 1));
      const offered = interviews.some((i) => i.jobSeekerId === s.id && i.createdAt >= s.paymentReceivedAt!);
      const priority = msLeft > 0 && daysLeft <= ctx.windowDays && !ended.has(s.id) && !offered;
      map.set(s.id, { daysLeft, day, priority });
    }
    return map;
  }

  private lockedReason(
    subject: Subject,
    purpose: string,
    consents: Map<string, Set<string>>,
    ctx: QueueContext,
    dueAt: Date,
  ): string | null {
    if (!ctx.inCallingHours) return 'outside_calling_hours';
    if (dueAt.getTime() > ctx.now.getTime()) return 'due_later';
    if (subject.type === 'job_seeker') {
      const minute = istMinuteOfDay(ctx.now);
      if (subject.window && !withinClock(minute, subject.window.start, subject.window.end)) return 'outside_his_window';
      const given = consents.get(subject.id) ?? new Set<string>();
      if (purpose !== 'consent_explain' && !given.has('call_recording')) return 'no_call_consent';
      if (MATCHING_PURPOSES.includes(purpose) && !given.has('job_matching')) return 'no_matching_consent';
    }
    return null;
  }

  // ---------------------------------------------------------------- queue

  /** Today's work for one call agent, in priority order, one row per person. */
  async queue(staffId: string): Promise<{ ctx: QueueContext; items: WorkItem[]; stuck: StuckRow[] }> {
    const ctx = await this.context();
    type Raw = {
      kind: WorkKind;
      key: string;
      type: SubjectType;
      id: string;
      dueAt: Date;
      purpose: string;
      relatedType: string | null;
      relatedId: string | null;
      detail: Record<string, string | number | null>;
    };
    const raw: Raw[] = [];

    const [tasks, callbacks, followUps, mine, offers, todays] = await Promise.all([
      this.prisma.callTask.findMany({
        where: { staffId, status: 'open', dueAt: { lt: ctx.endOfToday } },
        orderBy: { dueAt: 'asc' },
      }),
      this.prisma.callbackTask.findMany({
        where: { assignedToStaffId: staffId, status: 'assigned' },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      this.prisma.followUpTask.findMany({
        where: { assignedStaffId: staffId, status: 'pending', dueAt: { lt: ctx.endOfToday } },
        orderBy: { dueAt: 'asc' },
      }),
      this.prisma.jobSeeker.findMany({
        where: {
          registeredByStaffId: staffId,
          paymentReceivedAt: {
            not: null,
            gt: new Date(ctx.now.getTime() - ctx.guaranteeDays * DAY_MS),
            lte: new Date(ctx.now.getTime() - (ctx.guaranteeDays - ctx.windowDays) * DAY_MS),
          },
          status: { notIn: CLOSED_SEEKER },
        },
        select: { id: true, paymentReceivedAt: true },
      }),
      this.prisma.interview.findMany({
        where: { proposedByStaffId: staffId, status: 'offered', replyDueAt: { gt: ctx.now } },
        select: { id: true, jobSeekerId: true, offerSentAt: true, replyDueAt: true, vacancy: { select: { tradeSkill: true } } },
      }),
      this.prisma.interview.findMany({
        where: { proposedByStaffId: staffId, status: 'confirmed', slotStartsAt: { gte: ctx.now, lt: ctx.endOfToday } },
        select: { id: true, jobSeekerId: true, slotStartsAt: true },
      }),
    ]);

    for (const t of tasks) {
      raw.push({
        kind: t.kind === 'callback' ? 'callback' : 'retry',
        key: `task:${t.id}`,
        type: t.subjectType as SubjectType,
        id: t.subjectId,
        dueAt: t.dueAt,
        purpose: 'general',
        relatedType: null,
        relatedId: null,
        detail: { taskId: t.id },
      });
    }
    for (const c of callbacks) {
      let ref: { type: SubjectType; id: string } | null = c.jobSeekerId ? { type: 'job_seeker', id: c.jobSeekerId } : null;
      if (!ref) {
        const who = await this.router.identify(c.phone);
        if (who) ref = { type: who.type, id: who.id };
      }
      if (!ref) continue;
      raw.push({
        kind: 'missed_call',
        key: `inbound:${c.id}`,
        type: ref.type,
        id: ref.id,
        dueAt: c.createdAt,
        purpose: 'general',
        relatedType: null,
        relatedId: null,
        detail: { callbackTaskId: c.id, calledAt: c.createdAt.toISOString() },
      });
    }
    const relatedInterviewIds = followUps.filter((f) => f.relatedType === 'interview' && f.relatedId).map((f) => f.relatedId!);
    const relatedPlacementIds = followUps.filter((f) => f.relatedType === 'placement' && f.relatedId).map((f) => f.relatedId!);
    const [fInterviews, fPlacements] = await Promise.all([
      relatedInterviewIds.length
        ? this.prisma.interview.findMany({ where: { id: { in: relatedInterviewIds } }, select: { id: true, business: { select: { name: true } } } })
        : Promise.resolve([]),
      relatedPlacementIds.length
        ? this.prisma.placement.findMany({ where: { id: { in: relatedPlacementIds } }, select: { id: true, business: { select: { name: true } } } })
        : Promise.resolve([]),
    ]);
    const businessFor = new Map<string, string>([
      ...fInterviews.map((i) => [i.id, i.business.name] as [string, string]),
      ...fPlacements.map((p) => [p.id, p.business.name] as [string, string]),
    ]);
    for (const f of followUps) {
      raw.push({
        kind: f.kind === 'refund_check' ? 'refund_check' : 'follow_up',
        key: `follow_up:${f.id}`,
        type: f.subjectType as SubjectType,
        id: f.subjectId,
        dueAt: f.dueAt,
        purpose: FOLLOW_UP_PURPOSE[f.kind] ?? 'follow_up',
        relatedType: 'follow_up_task',
        relatedId: f.id,
        detail: {
          followUpTaskId: f.id,
          followUpKind: f.kind,
          businessName: f.relatedId ? businessFor.get(f.relatedId) ?? null : null,
          missed: f.dueAt < ctx.todayStart ? 1 : 0,
        },
      });
    }
    for (const s of mine) {
      raw.push({
        kind: 'close_to_refund',
        key: `refund:${s.id}`,
        type: 'job_seeker',
        id: s.id,
        dueAt: s.paymentReceivedAt!,
        purpose: 'general',
        relatedType: null,
        relatedId: null,
        detail: {},
      });
    }
    for (const o of offers) {
      raw.push({
        kind: 'offer_reply',
        key: `offer:${o.id}`,
        type: 'job_seeker',
        id: o.jobSeekerId,
        dueAt: o.offerSentAt,
        purpose: 'offer',
        relatedType: 'interview',
        relatedId: o.id,
        detail: { interviewId: o.id, replyDueAt: o.replyDueAt.toISOString(), jobTrade: o.vacancy.tradeSkill },
      });
    }
    for (const i of todays) {
      raw.push({
        kind: 'interview_today',
        key: `interview:${i.id}`,
        type: 'job_seeker',
        id: i.jobSeekerId,
        dueAt: ctx.todayStart,
        purpose: 'general',
        relatedType: 'interview',
        relatedId: i.id,
        detail: { interviewId: i.id, slotStartsAt: i.slotStartsAt.toISOString() },
      });
    }

    // N5 win-back list: shared by every call agent (growth module keeps it).
    const winBack = await this.prisma.winBackEntry.findMany({
      where: { status: 'open' },
      orderBy: { addedAt: 'asc' },
      take: 30,
      select: { id: true, jobSeekerId: true, addedAt: true, reason: true },
    });
    for (const w of winBack) {
      raw.push({
        kind: 'win_back',
        key: `win_back:${w.id}`,
        type: 'job_seeker',
        id: w.jobSeekerId,
        dueAt: w.addedAt,
        purpose: 'general',
        relatedType: 'win_back_entry',
        relatedId: w.id,
        detail: { winBackEntryId: w.id, reason: w.reason },
      });
    }

    const stuck = await this.stuckRegistrations(staffId, ctx);
    for (const s of stuck) {
      raw.push({
        kind: 'stuck_registration',
        key: `stuck:${s.jobSeekerId}`,
        type: 'job_seeker',
        id: s.jobSeekerId,
        dueAt: new Date(s.since),
        purpose: 'consent_explain',
        relatedType: null,
        relatedId: null,
        detail: { step: s.step, failures: s.failures },
      });
    }

    const subjects = await this.loadSubjects(raw.map((r) => ({ type: r.type, id: r.id })));
    const seekers = [...subjects.values()].filter((s) => s.seeker).map((s) => s.seeker!);
    const [consents, refunds] = await Promise.all([
      this.consentMap(seekers.map((s) => s.id)),
      this.refundInfo(seekers, ctx),
    ]);

    const items: WorkItem[] = [];
    for (const r of raw) {
      const subject = subjects.get(`${r.type}:${r.id}`);
      if (!subject) continue;
      const refund = r.type === 'job_seeker' ? refunds.get(r.id) : undefined;
      if (r.kind === 'close_to_refund' && !refund?.priority) continue;
      const lockedReason = this.lockedReason(subject, r.purpose, consents, ctx, r.dueAt);
      items.push({
        key: r.key,
        kind: r.kind,
        category: KIND_CATEGORY[r.kind],
        subjectType: r.type,
        subjectId: r.id,
        code: subject.code,
        name: subject.name,
        maskedPhone: subject.phone ? maskPhoneLast4(subject.phone) : null,
        trade: subject.trade,
        dueAt: r.dueAt.toISOString(),
        priority: refund?.priority ?? false,
        daysLeft: refund ? refund.daysLeft : null,
        guaranteeDay: refund ? refund.day : null,
        guaranteeDays: refund ? ctx.guaranteeDays : null,
        detail: {
          ...r.detail,
          ...(lockedReason === 'outside_his_window' && subject.window
            ? { windowStart: subject.window.start, windowEnd: subject.window.end }
            : {}),
        },
        call: { purpose: r.purpose, relatedType: r.relatedType, relatedId: r.relatedId },
        callable: lockedReason === null,
        lockedReason,
      });
    }
    return { ctx, items: orderWorkItems(items), stuck };
  }

  /** Registration link sent, not finished: which step he is stuck on. Newest first. */
  private async stuckRegistrations(staffId: string, ctx: QueueContext): Promise<StuckRow[]> {
    const seekers = await this.prisma.jobSeeker.findMany({
      where: { registeredByStaffId: staffId, paymentReceivedAt: null, status: { in: STUCK_STATUSES }, anonymisedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        createdAt: true,
        photoStoragePath: true,
        guaranteeFloorPaise: true,
        trades: { select: { trade: true, isPrimary: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (seekers.length === 0) return [];
    const ids = seekers.map((s) => s.id);
    const links = await this.prisma.publicLink.findMany({
      where: { purpose: 'registration', subjectType: 'job_seeker', subjectId: { in: ids } },
      select: { subjectId: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const sent = seekers.filter((s) => links.some((l) => l.subjectId === s.id)).slice(0, STUCK_LIST_LIMIT);
    if (sent.length === 0) return [];
    const sentIds = sent.map((s) => s.id);
    const [consents, verifications, payments, idService] = await Promise.all([
      this.consentMap(sentIds),
      this.prisma.identityVerification.findMany({
        where: { jobSeekerId: { in: sentIds } },
        orderBy: { createdAt: 'desc' },
        select: { jobSeekerId: true, status: true },
      }),
      this.prisma.payment.findMany({
        where: { jobSeekerId: { in: sentIds }, type: 'activation' },
        select: { jobSeekerId: true, status: true },
      }),
      this.prisma.kycServiceState.findUnique({ where: { id: 'id-check' } }),
    ]);
    return sent.map((s) => {
      const given = consents.get(s.id) ?? new Set<string>();
      const consentDone = REQUIRED_CONSENTS.every((p) => given.has(p));
      const idv = verifications.find((v) => v.jobSeekerId === s.id);
      const failures = payments.filter((p) => p.jobSeekerId === s.id && p.status === 'failed').length;
      let step: string;
      if (!consentDone) step = 'consent';
      else if (!s.photoStoragePath) step = 'selfie';
      else if (idv?.status !== 'verified') step = idService?.status === 'down' ? 'id_service_down' : 'id_check';
      else if (s.guaranteeFloorPaise === null) step = 'trade_pending';
      else step = failures > 0 ? 'payment_failed' : 'payment';
      const latest = links.find((l) => l.subjectId === s.id)!;
      const linkLive = !latest.usedAt && !latest.revokedAt && latest.expiresAt > ctx.now;
      return {
        jobSeekerId: s.id,
        code: s.code,
        name: s.name,
        maskedPhone: maskPhoneLast4(s.phone),
        trade: primaryTrade(s.trades),
        step,
        failures,
        linkLive,
        since: latest.createdAt.toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------- home

  async home(user: JwtPayload) {
    const staffId = user.sub;
    const { ctx, items, stuck } = await this.queue(staffId);
    const [numbers, team, today, month, done] = await Promise.all([
      this.todaysNumbers([staffId], ctx),
      this.teamAverages(staffId, ctx),
      this.attendance.today(staffId),
      this.monthTargets(user),
      this.doneToday(staffId, ctx),
    ]);
    const policy = await this.pricing.current();
    const mine = numbers.get(staffId) ?? emptyNumbers();
    const available = today.status === 'available';
    const next = pickNext(items);
    return {
      now: ctx.now.toISOString(),
      callingHours: ctx.callingHours,
      inCallingHours: ctx.inCallingHours,
      attendanceStatus: today.status,
      canCall: ctx.inCallingHours && available,
      callNext: next ? { key: next.key, name: next.name, subjectType: next.subjectType, subjectId: next.subjectId } : null,
      today: {
        callsAnswered: mine.callsAnswered,
        talkSeconds: mine.talkSeconds,
        productionSeconds: today.productionSeconds,
        productionTargetSeconds: Math.round(policy.productionHoursFullDay * 3600),
        registrations: mine.registrations,
        interviewsBooked: mine.interviewsBooked,
        teamAverage: team,
      },
      work: { items, counts: countByCategory(items) },
      month,
      stuck,
      // Counts only: agents see their own people near a refund, without rupees (Phase 21 Task 7).
      nearRefund: {
        count: items.filter((i) => i.priority).length,
        windowDays: ctx.windowDays,
      },
      doneToday: done,
    };
  }

  private async todaysNumbers(staffIds: string[], ctx: QueueContext): Promise<Map<string, DayNumbers>> {
    const since = ctx.todayStart;
    const [calls, regs, interviews] = await Promise.all([
      this.prisma.callRecord.groupBy({
        by: ['staffId'],
        where: { staffId: { in: staffIds }, answered: true, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { durationSec: true },
      }),
      this.prisma.jobSeeker.groupBy({
        by: ['registeredByStaffId'],
        where: { registeredByStaffId: { in: staffIds }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.interview.groupBy({
        by: ['proposedByStaffId'],
        where: { proposedByStaffId: { in: staffIds }, proposedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const map = new Map<string, DayNumbers>();
    for (const id of staffIds) map.set(id, emptyNumbers());
    for (const c of calls) {
      if (!c.staffId) continue;
      const row = map.get(c.staffId)!;
      row.callsAnswered = c._count._all;
      row.talkSeconds = c._sum.durationSec ?? 0;
    }
    for (const r of regs) if (r.registeredByStaffId) map.get(r.registeredByStaffId)!.registrations = r._count._all;
    for (const i of interviews) map.get(i.proposedByStaffId)!.interviewsBooked = i._count._all;
    return map;
  }

  /** Average over the call agents in the same team (or every call agent when there is no team). */
  private async teamAverages(staffId: string, ctx: QueueContext) {
    const me = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { teamLeadId: true } });
    const team = await this.prisma.staff.findMany({
      where: { role: 'call_agent', status: 'active', ...(me?.teamLeadId ? { teamLeadId: me.teamLeadId } : {}) },
      select: { id: true },
    });
    const ids = team.map((t) => t.id);
    if (!ids.includes(staffId)) ids.push(staffId);
    const numbers = await this.todaysNumbers(ids, ctx);
    const rows = [...numbers.values()];
    const avg = (pick: (n: DayNumbers) => number) => Math.round(rows.reduce((sum, n) => sum + pick(n), 0) / rows.length);
    return {
      agents: rows.length,
      callsAnswered: avg((n) => n.callsAnswered),
      talkSeconds: avg((n) => n.talkSeconds),
      registrations: avg((n) => n.registrations),
      interviewsBooked: avg((n) => n.interviewsBooked),
    };
  }

  private async monthTargets(user: JwtPayload) {
    const overview = await this.targetOverview.getOverview({ staffId: user.sub }, user, this.clock.now());
    const agent = overview.agent;
    const metric = (key: 'candidatesActivated' | 'vacanciesCaptured' | 'refundRate') => {
      const m = agent?.metrics?.[key];
      return {
        achieved: m?.achieved ?? null,
        target: m?.effectiveTarget ?? null,
        expectedPace: m?.expectedPace ?? null,
        status: m?.status ?? null,
        behindPace: m?.isBehindPace ?? false,
        breached: m?.isBreached ?? false,
      };
    };
    return {
      year: overview.period.year,
      month: overview.period.month,
      currentDay: overview.period.currentDay,
      daysInMonth: overview.period.daysInMonth,
      candidatesActivated: metric('candidatesActivated'),
      vacanciesCaptured: metric('vacanciesCaptured'),
      refundRate: { ...metric('refundRate'), matured: agent?.metrics?.refundRate?.maturedCount ?? null },
    };
  }

  private async doneToday(staffId: string, ctx: QueueContext) {
    const since = ctx.todayStart;
    const [regs, interviews, vacancies, outcomes] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where: { registeredByStaffId: staffId, createdAt: { gte: since } },
        select: { id: true, code: true, name: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.interview.findMany({
        where: { proposedByStaffId: staffId, proposedAt: { gte: since } },
        select: { id: true, slotStartsAt: true, proposedAt: true, status: true, jobSeeker: { select: { id: true, code: true, name: true } } },
        orderBy: { proposedAt: 'desc' },
        take: 10,
      }),
      this.prisma.vacancy.findMany({
        where: { capturedByStaffId: staffId, createdAt: { gte: since } },
        select: { id: true, code: true, tradeSkill: true, createdAt: true, business: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.callRecord.findMany({
        where: { staffId, agentOutcomeAt: { gte: since }, agentOutcome: { not: null } },
        select: { id: true, subjectType: true, subjectId: true, agentOutcome: true, agentOutcomeAt: true },
        orderBy: { agentOutcomeAt: 'desc' },
        take: 10,
      }),
    ]);
    const subjects = await this.loadSubjects(
      outcomes.filter((o) => o.subjectType && o.subjectId).map((o) => ({ type: o.subjectType as SubjectType, id: o.subjectId! })),
    );
    const rows = [
      ...regs.map((r) => ({ kind: 'registered', at: r.createdAt.toISOString(), name: r.name, code: r.code, status: r.status, extra: null as string | null })),
      ...interviews.map((i) => ({ kind: 'interview_booked', at: i.proposedAt.toISOString(), name: i.jobSeeker.name, code: i.jobSeeker.code, status: i.status, extra: i.slotStartsAt.toISOString() })),
      ...vacancies.map((v) => ({ kind: 'vacancy_added', at: v.createdAt.toISOString(), name: v.business.name, code: v.code, status: 'captured', extra: v.tradeSkill })),
      ...outcomes.map((o) => {
        const s = subjects.get(`${o.subjectType}:${o.subjectId}`);
        return { kind: 'call_outcome', at: o.agentOutcomeAt!.toISOString(), name: s?.name ?? '', code: s?.code ?? null, status: o.agentOutcome!, extra: null };
      }),
    ];
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  }

  // ---------------------------------------------------------------- call next

  /**
   * "Call next": picks the most urgent person the agent may call now and
   * places the call through the calling system. Refuses outside calling
   * hours and when the agent is not Available. `skip` holds people the
   * agent set aside this session.
   */
  async callNext(user: JwtPayload, skip: string[] = []) {
    const { ctx, items } = await this.queue(user.sub);
    if (!ctx.inCallingHours) {
      return { placed: false, blocked: 'outside_calling_hours', callingHours: ctx.callingHours, item: null, callRecordId: null };
    }
    if (!(await this.attendance.isAvailable(user.sub))) {
      return { placed: false, blocked: 'not_available', callingHours: ctx.callingHours, item: null, callRecordId: null };
    }
    const next = pickNext(items, new Set(skip));
    if (!next) {
      return { placed: false, blocked: 'nothing_to_call', callingHours: ctx.callingHours, item: null, callRecordId: null };
    }
    try {
      const placed = await this.calls.place(
        { id: user.sub, role: user.role },
        {
          subjectType: next.subjectType,
          subjectId: next.subjectId,
          purpose: next.call.purpose,
          relatedType: next.call.relatedType ?? undefined,
          relatedId: next.call.relatedId ?? undefined,
        },
      );
      return { placed: true, blocked: null, callingHours: ctx.callingHours, item: next, callRecordId: placed.callRecordId };
    } catch (err) {
      return {
        placed: false,
        blocked: 'call_refused',
        message: (err as Error).message,
        callingHours: ctx.callingHours,
        item: next,
        callRecordId: null,
      };
    }
  }

  // ---------------------------------------------------------------- profile

  private async resolveRef(ref: string): Promise<{ type: SubjectType; id: string }> {
    const value = ref.trim();
    const upper = value.toUpperCase();
    if (upper.startsWith('JS-')) {
      const row = await this.prisma.jobSeeker.findUnique({ where: { code: upper }, select: { id: true } });
      if (row) return { type: 'job_seeker', id: row.id };
    } else if (upper.startsWith('BZ-')) {
      const row = await this.prisma.business.findUnique({ where: { code: upper }, select: { id: true } });
      if (row) return { type: 'business', id: row.id };
    } else if (upper.startsWith('RF-')) {
      const row = await this.prisma.referral.findUnique({ where: { code: upper }, select: { id: true } });
      if (row) return { type: 'referral', id: row.id };
    } else {
      const [js, bz, rf] = await Promise.all([
        this.prisma.jobSeeker.findUnique({ where: { id: value }, select: { id: true } }).catch(() => null),
        this.prisma.business.findUnique({ where: { id: value }, select: { id: true } }).catch(() => null),
        this.prisma.referral.findUnique({ where: { id: value }, select: { id: true } }).catch(() => null),
      ]);
      if (js) return { type: 'job_seeker', id: js.id };
      if (bz) return { type: 'business', id: bz.id };
      if (rf) return { type: 'referral', id: rf.id };
    }
    throw new NotFoundException(`No one found for '${ref}'`);
  }

  /** The one full profile opened from Home, follow-ups, search or an incoming call. */
  async profile(user: JwtPayload, ref: string) {
    const { type, id } = await this.resolveRef(ref);
    const { ctx, items } = await this.queue(user.sub);
    const onList = items.find((i) => i.subjectType === type && i.subjectId === id) ?? null;
    const available = await this.attendance.isAvailable(user.sub);
    const history = await this.history(user.sub, type, id);
    const base = { onList, history, canCallNow: ctx.inCallingHours && available, attendanceAvailable: available, inCallingHours: ctx.inCallingHours, callingHours: ctx.callingHours };
    if (type === 'job_seeker') return { type, ...base, ...(await this.seekerProfile(id, ctx)) };
    if (type === 'business') return { type, ...base, ...(await this.businessProfile(id)) };
    return { type, ...base, ...(await this.referralProfile(id)) };
  }

  private async seekerProfile(id: string, ctx: QueueContext) {
    const s = await this.prisma.jobSeeker.findUniqueOrThrow({
      where: { id },
      include: {
        trades: true,
        languages: true,
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
        hits: { where: { supersededAt: null, reversedAt: null }, select: { id: true } },
        registeredBy: { select: { name: true } },
      },
    });
    const policy = await this.pricing.current();
    const [consents, refund, interviews, followUp] = await Promise.all([
      this.consentMap([s.id]),
      this.refundInfo([s as unknown as SeekerSummary], ctx),
      this.prisma.interview.findMany({
        where: { jobSeekerId: s.id },
        orderBy: { createdAt: 'desc' },
        include: {
          business: { select: { id: true, name: true } },
          vacancy: { select: { tradeSkill: true, roleTitle: true } },
          placement: { select: { paidAt: true, status: true } },
        },
      }),
      this.prisma.followUpTask.findFirst({
        where: { subjectType: 'job_seeker', subjectId: s.id, status: 'pending' },
        orderBy: { dueAt: 'asc' },
      }),
    ]);
    const given = consents.get(s.id) ?? new Set<string>();
    const consentCount = REQUIRED_CONSENTS.filter((p) => given.has(p)).length;
    const idv = s.identityVerifications[0];
    const r = refund.get(s.id);
    const minute = istMinuteOfDay(ctx.now);
    const regSteps = {
      consent: consentCount === REQUIRED_CONSENTS.length,
      selfie: Boolean(s.photoStoragePath),
      idCheck: idv?.status === 'verified',
      payment: Boolean(s.paymentReceivedAt),
    };
    const liveOffer = interviews.find((i) => i.status === 'offered');
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      maskedPhone: maskPhoneLast4(s.phone),
      status: s.status,
      trades: s.trades
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
        .map((t) => ({ trade: t.trade, years: t.yearsExperience, primary: t.isPrimary })),
      languages: s.languages.filter((l) => l.speaks).map((l) => l.language),
      salary: { minPaise: s.minSalary, maxPaise: s.maxSalary, period: s.salaryPeriod ?? 'monthly' },
      locality: s.locality,
      travelDistanceKm: s.travelDistanceKm,
      shiftPreference: s.shiftPreference,
      availableFrom: s.availableFrom?.toISOString() ?? null,
      bestTime: { start: s.preferredCallWindowStart, end: s.preferredCallWindowEnd },
      withinBestTimeNow: withinClock(minute, s.preferredCallWindowStart, s.preferredCallWindowEnd),
      registeredBy: s.registeredBy?.name ?? null,
      registeredAt: s.createdAt.toISOString(),
      // Money involved (he has paid): agents can't edit; a Team Lead corrects.
      editLocked: Boolean(s.paymentReceivedAt),
      glance: {
        consentsGiven: consentCount,
        consentsRequired: REQUIRED_CONSENTS.length,
        callRecordingConsent: given.has('call_recording'),
        paid: Boolean(s.paymentReceivedAt),
        guaranteeDay: r?.day ?? null,
        guaranteeDays: ctx.guaranteeDays,
        daysLeft: r?.daysLeft ?? null,
        priority: r?.priority ?? false,
        aadhaar: idv?.status ?? 'not_started',
        hits: s.hits.length,
        maxHits: policy.maxHits,
      },
      registration: { steps: regSteps, done: Object.values(regSteps).filter(Boolean).length, total: 4 },
      liveOffer: liveOffer
        ? { interviewId: liveOffer.id, replyDueAt: liveOffer.replyDueAt.toISOString(), trade: liveOffer.vacancy.tradeSkill }
        : null,
      followUpDue: followUp
        ? { id: followUp.id, kind: followUp.kind, dueAt: followUp.dueAt.toISOString() }
        : null,
      introductions: interviews.map((i) => ({
        interviewId: i.id,
        businessId: i.business.id,
        businessName: i.business.name,
        trade: i.vacancy.roleTitle ?? i.vacancy.tradeSkill,
        slotStartsAt: i.slotStartsAt.toISOString(),
        offerSentAt: i.offerSentAt.toISOString(),
        status: i.status,
        result: i.result,
        feePaid: Boolean(i.placement?.paidAt),
      })),
    };
  }

  private async businessProfile(id: string) {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id },
      include: {
        vacancies: { where: { status: 'open' }, select: { id: true, code: true, tradeSkill: true, headcount: true, roleTitle: true } },
      },
    });
    const agent = b.accountAgentId
      ? await this.prisma.staff.findUnique({ where: { id: b.accountAgentId }, select: { name: true } })
      : null;
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      maskedPhone: maskPhoneLast4(b.phone),
      businessType: b.businessType,
      locality: b.locality,
      contactName: b.ownerName,
      contactRole: b.contactRole,
      verificationStatus: b.verificationStatus,
      accountAgent: agent?.name ?? null,
      openVacancies: b.vacancies,
    };
  }

  private async referralProfile(id: string) {
    const r = await this.prisma.referral.findUniqueOrThrow({
      where: { id },
      include: { jobSeekers: { select: { id: true, status: true } } },
    });
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      maskedPhone: maskPhoneLast4(r.phone),
      partnerType: r.type,
      occupation: r.individualRole ?? r.partnerBusinessType,
      locality: r.locality,
      referred: r.jobSeekers.length,
      joined: r.jobSeekers.filter((j) => j.status === 'placed').length,
    };
  }

  /** Calls, messages, interviews and payments for one person, newest first. */
  private async history(staffId: string, type: SubjectType, id: string) {
    const [calls, messages, interviews, payments, seeker] = await Promise.all([
      this.prisma.callRecord.findMany({
        where: { subjectType: type, subjectId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          staffId: true,
          direction: true,
          answered: true,
          providerStatus: true,
          durationSec: true,
          createdAt: true,
          startedAt: true,
          agentOutcome: true,
          agentOutcomeReason: true,
          staff: { select: { name: true } },
        },
      }),
      this.prisma.messageLog.findMany({
        where: { subjectType: type, subjectId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, channel: true, template: true, status: true, createdAt: true, sentAt: true },
      }),
      type === 'job_seeker'
        ? this.prisma.interview.findMany({
            where: { jobSeekerId: id },
            select: { id: true, status: true, result: true, offerSentAt: true, slotStartsAt: true, business: { select: { name: true } } },
          })
        : Promise.resolve([]),
      type === 'job_seeker'
        ? this.prisma.payment.findMany({
            where: { jobSeekerId: id, type: { in: ['activation', 'reactivation'] }, status: { in: ['succeeded', 'completed'] } },
            select: { id: true, confirmedAt: true, createdAt: true, amount: true },
          })
        : Promise.resolve([]),
      type === 'job_seeker'
        ? this.prisma.jobSeeker.findUnique({ where: { id }, select: { createdAt: true, registeredBy: { select: { name: true } } } })
        : Promise.resolve(null),
    ]);
    const rows: HistoryRow[] = [
      ...calls.map((c) => ({
        kind: 'call',
        at: (c.startedAt ?? c.createdAt).toISOString(),
        direction: c.direction,
        answered: c.answered,
        status: c.providerStatus,
        durationSec: c.durationSec,
        by: c.staffId === staffId ? 'you' : c.staff?.name ?? null,
        outcome: c.agentOutcome,
        // Notes are shown only to the agent who wrote them.
        note: c.staffId === staffId ? c.agentOutcomeReason : null,
      })),
      ...messages.map((m) => ({ kind: 'message', at: (m.sentAt ?? m.createdAt).toISOString(), channel: m.channel, template: m.template, status: m.status })),
      ...interviews.flatMap((i) => [
        { kind: 'offer', at: i.offerSentAt.toISOString(), businessName: i.business.name, status: i.status, result: i.result, slotStartsAt: i.slotStartsAt.toISOString() },
      ]),
      ...payments.map((p) => ({ kind: 'payment_confirmed', at: (p.confirmedAt ?? p.createdAt).toISOString(), feePaise: p.amount })),
      ...(seeker ? [{ kind: 'registered', at: seeker.createdAt.toISOString(), by: seeker.registeredBy?.name ?? null }] : []),
    ];
    return rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
  }

  async jobs(ref: string, page: number) {
    const { type, id } = await this.resolveRef(ref);
    if (type !== 'job_seeker') throw new NotFoundException('Matching jobs are only for job seekers');
    return this.matching.jobsForSeeker(id, { page });
  }

  // ---------------------------------------------------------------- on call

  /** The on-call screen: the call's state from the calling system, and what was done automatically. */
  async call(user: JwtPayload, callRecordId: string) {
    const call = await this.prisma.callRecord.findUnique({ where: { id: callRecordId } });
    if (!call) throw new NotFoundException('Call not found');
    if (call.staffId !== user.sub) throw new ForbiddenException('This is not your call');
    const ctx = await this.context();
    const final = (FINAL_CALL_STATUSES as readonly string[]).includes(call.providerStatus);
    let noAnswer: Record<string, unknown> | null = null;
    if (final && !call.answered) {
      const [whatsapp, retry, followUp, missedToday] = await Promise.all([
        call.subjectType === 'job_seeker'
          ? this.prisma.messageLog.findFirst({
              where: { subjectType: 'job_seeker', subjectId: call.subjectId!, template: 'call_attempt_notice', createdAt: { gte: ctx.todayStart } },
              orderBy: { createdAt: 'desc' },
              select: { status: true, sentAt: true, createdAt: true },
            })
          : Promise.resolve(null),
        this.prisma.callTask.findFirst({ where: { sourceCallRecordId: call.id, kind: 'retry' }, select: { dueAt: true, status: true } }),
        call.relatedType === 'follow_up_task' && call.relatedId
          ? this.prisma.followUpTask.findUnique({ where: { id: call.relatedId }, select: { dueAt: true } })
          : Promise.resolve(null),
        call.subjectType === 'job_seeker'
          ? this.prisma.contactAttempt.count({
              where: { jobSeekerId: call.subjectId!, channel: 'call', outcome: 'no_pickup', attemptedAt: { gte: ctx.todayStart } },
            })
          : Promise.resolve(0),
      ]);
      noAnswer = {
        endedAt: (call.endedAt ?? call.createdAt).toISOString(),
        whatsapp: whatsapp ? { status: whatsapp.status, at: (whatsapp.sentAt ?? whatsapp.createdAt).toISOString() } : null,
        nextTryAt: retry?.dueAt.toISOString() ?? followUp?.dueAt.toISOString() ?? null,
        missedToday,
        // AM and PM calls unanswered plus a WhatsApp, all on one day, is one hit (Master Guide, Hits).
        missedForHit: 2,
      };
    }
    let next: { name: string; subjectId: string } | null = null;
    if (final) {
      const { items } = await this.queue(user.sub);
      const candidate = pickNext(items, new Set(call.subjectId ? [call.subjectId] : []));
      next = candidate ? { name: candidate.name, subjectId: candidate.subjectId } : null;
    }
    return {
      id: call.id,
      code: call.code,
      subjectType: call.subjectType,
      subjectId: call.subjectId,
      purpose: call.purpose,
      relatedType: call.relatedType,
      relatedId: call.relatedId,
      status: call.providerStatus,
      answered: call.answered,
      final,
      startedAt: call.startedAt?.toISOString() ?? null,
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      durationSec: call.durationSec,
      recorded: call.announcementPlayed,
      agentOutcome: call.agentOutcome,
      noAnswer,
      next,
    };
  }

  // ---------------------------------------------------------------- follow-ups

  async followUps(user: JwtPayload) {
    const ctx = await this.context();
    const tasks = await this.prisma.followUpTask.findMany({
      where: {
        assignedStaffId: user.sub,
        OR: [{ status: 'pending' }, { status: 'done', completedAt: { gte: ctx.todayStart } }],
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
    });
    const subjects = await this.loadSubjects(tasks.map((t) => ({ type: t.subjectType as SubjectType, id: t.subjectId })));
    const names = await this.relatedBusinessNames(tasks);
    return {
      now: ctx.now.toISOString(),
      rows: tasks.map((t) => {
        const s = subjects.get(`${t.subjectType}:${t.subjectId}`);
        return {
          id: t.id,
          code: t.code,
          kind: t.kind,
          status: t.status,
          answer: t.answer,
          subjectType: t.subjectType,
          subjectId: t.subjectId,
          personCode: s?.code ?? null,
          name: s?.name ?? '',
          maskedPhone: s?.phone ? maskPhoneLast4(s.phone) : null,
          businessName: t.relatedId ? names.get(t.relatedId) ?? null : null,
          dueAt: t.dueAt.toISOString(),
          missed: t.status === 'pending' && t.dueAt < ctx.todayStart,
          call: { purpose: FOLLOW_UP_PURPOSE[t.kind] ?? 'follow_up', relatedType: 'follow_up_task', relatedId: t.id },
        };
      }),
    };
  }

  private async relatedBusinessNames(tasks: Array<{ relatedType: string | null; relatedId: string | null }>) {
    const ids = (type: string) => tasks.filter((t) => t.relatedType === type && t.relatedId).map((t) => t.relatedId!);
    const [interviews, placements, claims] = await Promise.all([
      ids('interview').length ? this.prisma.interview.findMany({ where: { id: { in: ids('interview') } }, select: { id: true, business: { select: { name: true } } } }) : Promise.resolve([]),
      ids('placement').length ? this.prisma.placement.findMany({ where: { id: { in: ids('placement') } }, select: { id: true, business: { select: { name: true } } } }) : Promise.resolve([]),
      ids('replacement_claim').length
        ? this.prisma.replacementClaim.findMany({ where: { id: { in: ids('replacement_claim') } }, select: { id: true, placement: { select: { business: { select: { name: true } } } } } })
        : Promise.resolve([]),
    ]);
    return new Map<string, string>([
      ...interviews.map((i) => [i.id, i.business.name] as [string, string]),
      ...placements.map((p) => [p.id, p.business.name] as [string, string]),
      ...claims.map((c) => [c.id, c.placement.business.name] as [string, string]),
    ]);
  }

  async followUp(user: JwtPayload, id: string) {
    const task = await this.prisma.followUpTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Follow-up not found');
    if (task.assignedStaffId !== user.sub) throw new ForbiddenException('This follow-up is not on your list');
    const subjects = await this.loadSubjects([{ type: task.subjectType as SubjectType, id: task.subjectId }]);
    const s = subjects.get(`${task.subjectType}:${task.subjectId}`);
    const names = await this.relatedBusinessNames([task]);
    let introduced: Array<Record<string, unknown>> = [];
    if (task.subjectType === 'job_seeker') {
      const intros = await this.prisma.candidateIntroduction.findMany({
        where: { jobSeekerId: task.subjectId },
        select: { businessId: true, shownAt: true, business: { select: { id: true, name: true } } },
        orderBy: { shownAt: 'asc' },
      });
      const byBusiness = new Map<string, { id: string; name: string; introducedAt: Date }>();
      for (const i of intros) if (!byBusiness.has(i.businessId)) byBusiness.set(i.businessId, { id: i.business.id, name: i.business.name, introducedAt: i.shownAt });
      const interviews = await this.prisma.interview.findMany({
        where: { jobSeekerId: task.subjectId },
        select: { businessId: true, result: true, resultRecordedAt: true, slotStartsAt: true, business: { select: { id: true, name: true } }, placement: { select: { paidAt: true } } },
        orderBy: { createdAt: 'desc' },
      });
      for (const i of interviews) if (!byBusiness.has(i.businessId)) byBusiness.set(i.businessId, { id: i.business.id, name: i.business.name, introducedAt: i.slotStartsAt });
      introduced = [...byBusiness.values()].map((b) => {
        const last = interviews.find((i) => i.businessId === b.id);
        return {
          businessId: b.id,
          name: b.name,
          introducedAt: b.introducedAt.toISOString(),
          result: last?.result ?? null,
          resultAt: last?.resultRecordedAt?.toISOString() ?? null,
          feePaid: interviews.some((i) => i.businessId === b.id && i.placement?.paidAt),
        };
      });
    }
    return {
      id: task.id,
      code: task.code,
      kind: task.kind,
      status: task.status,
      dueAt: task.dueAt.toISOString(),
      subjectType: task.subjectType,
      subjectId: task.subjectId,
      personCode: s?.code ?? null,
      name: s?.name ?? '',
      maskedPhone: s?.phone ? maskPhoneLast4(s.phone) : null,
      businessName: task.relatedId ? names.get(task.relatedId) ?? null : null,
      call: { purpose: FOLLOW_UP_PURPOSE[task.kind] ?? 'follow_up', relatedType: 'follow_up_task', relatedId: task.id },
      introducedBusinesses: introduced,
    };
  }

  // ---------------------------------------------------------------- incoming

  /** CA17 / CA17b: who is calling, before the agent says hello. */
  async incoming(user: JwtPayload, callbackTaskId: string) {
    const task = await this.prisma.callbackTask.findUnique({ where: { id: callbackTaskId } });
    if (!task) throw new NotFoundException('Incoming call not found');
    if (task.assignedToStaffId !== user.sub) throw new ForbiddenException('This call did not ring you');
    const caller = await this.router.identify(task.phone);
    const base = {
      callbackTaskId: task.id,
      status: task.status,
      ringingSince: task.createdAt.toISOString(),
      maskedPhone: maskPhoneLast4(task.phone),
      known: Boolean(caller),
    };
    if (!caller) return { ...base, caller: null };
    const ctx = await this.context();
    const lastCall = await this.prisma.callRecord.findFirst({
      where: { subjectType: caller.type, subjectId: caller.id, OR: [{ answered: true }, { agentOutcome: { not: null } }] },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, staffId: true, agentOutcome: true, agentOutcomeReason: true, staff: { select: { name: true } } },
    });
    let standing: Record<string, unknown> = {};
    let likelyAbout = 'general';
    if (caller.type === 'job_seeker') {
      const seeker = (await this.loadSeekers([caller.id])).get(caller.id)!;
      const refund = (await this.refundInfo([seeker], ctx)).get(seeker.id);
      const offer = await this.prisma.interview.findFirst({
        where: { jobSeekerId: seeker.id, status: { in: ['offered', 'confirmed'] } },
        select: { status: true },
      });
      standing = {
        status: seeker.status,
        guaranteeDay: refund?.day ?? null,
        guaranteeDays: ctx.guaranteeDays,
        hasOffer: Boolean(offer),
        trade: primaryTrade(seeker.trades),
      };
      if (STUCK_STATUSES.includes(seeker.status)) likelyAbout = 'registration';
      else if (offer) likelyAbout = 'offer';
      else if (seeker.status === 'placed') likelyAbout = 'job';
      else if (seeker.paymentReceivedAt) likelyAbout = 'job_search_refund';
    } else if (caller.type === 'business') {
      likelyAbout = 'staff_vacancy';
    } else {
      likelyAbout = 'referral';
    }
    return {
      ...base,
      caller: { type: caller.type, id: caller.id, code: caller.code, name: caller.name },
      standing,
      likelyAbout,
      lastContact: lastCall
        ? {
            at: lastCall.createdAt.toISOString(),
            by: lastCall.staffId === user.sub ? 'you' : lastCall.staff?.name ?? null,
            outcome: lastCall.agentOutcome,
            note: lastCall.staffId === user.sub ? lastCall.agentOutcomeReason : null,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------- targets

  async targets(user: JwtPayload) {
    const [month, board] = await Promise.all([this.monthTargets(user), this.leaderboard.getLeaderboard({}, user, this.clock.now())]);
    return {
      ...month,
      leaderboard: board.leaderboard.slice(0, 10).map((row) => ({
        position: row.position,
        name: row.name,
        staffCode: row.staffCode,
        placementsClosed: row.placementsClosed,
        isMe: row.staffId === user.sub,
      })),
    };
  }
}

export interface StuckRow {
  jobSeekerId: string;
  code: string;
  name: string;
  maskedPhone: string;
  trade: string | null;
  step: string;
  failures: number;
  linkLive: boolean;
  since: string;
}

interface DayNumbers {
  callsAnswered: number;
  talkSeconds: number;
  registrations: number;
  interviewsBooked: number;
}

type HistoryRow = Record<string, unknown> & { kind: string; at: string };

function emptyNumbers(): DayNumbers {
  return { callsAnswered: 0, talkSeconds: 0, registrations: 0, interviewsBooked: 0 };
}
