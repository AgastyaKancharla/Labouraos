import { PRODUCT_LANGUAGE, productLanguage } from '../../common/language/english-only';
import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { peopleOwnedBy } from '../../common/rbac/own-team';
import { codedError } from '../../common/http/coded-error';
import { phoneLast4 } from '../../common/phone/indian-mobile';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { AgentViewer, agentViewerFor, fieldAgentCanAct } from '../business/business-agent-view';
import { businessCandidateAccess, isBusinessSuspended } from '../business/business-candidate-access';
import { isVerificationVisitPurpose } from '../business/business.constants';
import { AttendanceService } from '../attendance/attendance.service';
import {
  AGREEMENT_LINK_MAX_PER_DAY,
  AGREEMENT_LINK_MIN_GAP_MS,
  agreementLinkWindow,
  AgreementLinkWindow,
  ConsentLinkService,
} from '../consent/consent-link.service';
import { LEGAL_DOCUMENT_VERSIONS } from '../legal/legal-documents';
import { FieldAgentMetricsService } from '../target/field-agent-metrics.service';
import { VacancyConfirmationService } from '../vacancy/vacancy-confirmation.service';
import { REVISIT_OUTCOMES } from '../field-visit/field-visit.constants';
import { sameShop } from '../field-visit/revisit-shops';
import { DAY_MS, FieldVisitClock, istDateKey, istDayStart, keyFromDate } from '../field-visit/field-visit-clock';
import { visitNextStep } from '../field-visit/field-visit.service';
import { handedAwayIds, handedTo, sweepHandovers } from '../field-visit/field-handover.service';
import { FIELD_REVISIT_EXCLUDE, FOLLOW_UP_KIND_LABELS, FieldWorkExtrasService } from './field-work-extras.service';

type Actor = { sub: string; role: string };

/** Rev 188 agreement resend: one link a minute and five a day per business (the shared counter, S2). */
export const AGREEMENT_RESEND_MIN_GAP_MS = AGREEMENT_LINK_MIN_GAP_MS;
export const AGREEMENT_RESEND_MAX_PER_DAY = AGREEMENT_LINK_MAX_PER_DAY;
/** Today's work: how far back the date picker may go. */
export const DAY_MAX_DAYS_BACK = 90;
/** Needs you now: unfinished visits from this many days back. */
const UNFINISHED_VISIT_DAYS = 7;
const LIST_LIMIT = 100;
/** The business page's history: visits and vacancy events, newest first. */
const HISTORY_LIMIT = 40;
/** All visits: rows per page (and the most a caller may ask for). */
const ALL_VISITS_PAGE = 30;
const ALL_VISITS_PAGE_MAX = 100;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type AgreementState = 'signed' | 'link_sent' | 'link_expired' | 'not_sent';

interface AgreementInfo {
  state: AgreementState;
  signedAt: Date | null;
  signedByName: string | null;
  signedVersion: string | null;
  linkSentAt: Date | null;
  linkExpiresAt: Date | null;
  linkOpenedAt: Date | null;
  /** Live (not revoked) links in the last 24 hours, newest first: the resend limit. */
  recentLinks: Date[];
}

type Due = 'overdue' | 'today' | 'tomorrow' | null;

export interface NeedsYouItem {
  id: string;
  kind:
    | 'interview_today'
    | 'verification_visit'
    | 'visit_unfinished'
    | 'agreement_waiting'
    | 'vacancy_awaiting_owner'
    | 'vacancy_draft'
    | 'ready_show_candidates'
    | 'vacancies_to_fill'
    | 'joining_due'
    | 'revisit_due'
    | 'followup_task';
  title: string;
  subtitle: string | null;
  at: string | null;
  due: Due;
  target: { type: string; id: string; step?: string; businessId?: string | null; vacancyId?: string } & Record<string, unknown>;
  [extra: string]: unknown;
}

const NEEDS_ORDER: NeedsYouItem['kind'][] = [
  'interview_today',
  'verification_visit',
  'visit_unfinished',
  'agreement_waiting',
  'vacancy_awaiting_owner',
  'vacancy_draft',
  'ready_show_candidates',
  'vacancies_to_fill',
  'joining_due',
  'revisit_due',
  'followup_task',
];
const DUE_ORDER: Record<string, number> = { overdue: 0, today: 1, tomorrow: 2 };
/** Items with no due date sort after tomorrow's. */
const NO_DUE_RANK = Object.keys(DUE_ORDER).length;

type BusinessForStep = {
  id: string;
  verificationStatus: string | null;
  pausedAt: Date | null;
  suspendedAt: Date | null;
  suspendedUntil: Date | null;
  inPersonOnboardedAt: Date | null;
  fieldVerifiedAt?: Date | null;
  vacancies: Array<{ id: string; status: string }>;
};

export type BusinessNextStep =
  | { kind: 'suspended' }
  | { kind: 'paused' }
  | { kind: 'agreement_waiting'; agreementState: AgreementState }
  | { kind: 'vacancy_to_confirm'; vacancyId: string }
  | { kind: 'vacancy_to_send'; vacancyId: string }
  | { kind: 'candidates_hidden'; reason: string }
  | { kind: 'waiting_tl_check' }
  | { kind: 'add_vacancy' }
  | { kind: 'ready_show_candidates'; vacancyId: string }
  | { kind: 'none' };

type OnboardingReader = Pick<PrismaService, 'businessVisit' | 'business'>;

/**
 * Rev 189: a business counts as Onboarded only once, on the IST day it was first onboarded
 * (registered from a shop visit, or its first visit marked onboarded), and for the agent who
 * did it. Returns the businesses this agent first onboarded inside `window`, with the visit
 * that did it when there is one.
 */
export async function firstOnboardingsBy(
  prisma: OnboardingReader,
  staffId: string,
  window: { gte: Date; lt: Date },
): Promise<Map<string, { at: Date; visitId: string | null }>> {
  const [visits, registered] = await Promise.all([
    prisma.businessVisit.findMany({
      where: { staffId, outcome: 'onboarded', outcomeRecordedAt: window, businessId: { not: null } },
      select: { businessId: true },
    }),
    prisma.business.findMany({ where: { leadCreatedByStaffId: staffId, leadChannel: 'field_visit', createdAt: window }, select: { id: true } }),
  ]);
  const ids = [...new Set([...visits.map((v) => v.businessId!), ...registered.map((b) => b.id)])];
  const result = new Map<string, { at: Date; visitId: string | null }>();
  if (!ids.length) return result;
  const [allOnboarded, businesses] = await Promise.all([
    prisma.businessVisit.findMany({
      where: { businessId: { in: ids }, outcome: 'onboarded', outcomeRecordedAt: { not: null } },
      orderBy: { outcomeRecordedAt: 'asc' },
      select: { id: true, businessId: true, staffId: true, outcomeRecordedAt: true },
    }),
    prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true, leadChannel: true, leadCreatedByStaffId: true } }),
  ]);
  for (const b of businesses) {
    const events: Array<{ at: Date; staffId: string | null; visitId: string | null }> = [];
    if (b.leadChannel === 'field_visit') events.push({ at: b.createdAt, staffId: b.leadCreatedByStaffId, visitId: null });
    const firstVisit = allOnboarded.find((v) => v.businessId === b.id);
    if (firstVisit) events.push({ at: firstVisit.outcomeRecordedAt!, staffId: firstVisit.staffId, visitId: firstVisit.id });
    events.sort((x, y) => x.at.getTime() - y.at.getTime());
    const first = events[0];
    if (!first || first.staffId !== staffId) continue;
    if (first.at.getTime() < window.gte.getTime() || first.at.getTime() >= window.lt.getTime()) continue;
    result.set(b.id, { at: first.at, visitId: firstVisit && firstVisit.staffId === staffId ? firstVisit.id : first.visitId });
  }
  return result;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** "Ramesh G." — first name and initial only. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] ?? '';
}

function whenOf(key: string, todayKey: string, tomorrowKey: string): Due {
  if (key < todayKey) return 'overdue';
  if (key === todayKey) return 'today';
  if (key === tomorrowKey) return 'tomorrow';
  return null;
}

/**
 * Laboura Field redesign (Master Guide rev 188): the Today tab (numbers, targets bar,
 * Needs you now), Today's work by date, my businesses with their next step, the one
 * business page with its onboarding checklist, the agreement screen and its resend,
 * and my job seekers with where each stands. Field agents only, own records only;
 * phone numbers leave only as their last 4 digits and no rupee totals are sent.
 */
@Injectable()
export class FieldRedesignService {
  private readonly logger = new Logger(FieldRedesignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: FieldVisitClock,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly metrics: FieldAgentMetricsService,
    private readonly consentLinks: ConsentLinkService,
    private readonly confirmation: VacancyConfirmationService,
    private readonly extras: FieldWorkExtrasService,
  ) {}

  // ------------------------------------------------------------------ Today

  async today(actor: Actor) {
    const now = this.clock.now();
    const staffId = actor.sub;
    const dayStart = istDayStart(now);
    const window = { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) };
    const [attendance, numbers, targets, needsYou] = await Promise.all([
      this.attendance.today(staffId).catch((error: unknown) => {
        this.logger.warn(`Attendance not read for the Today tab: ${String(error)}`);
        return null;
      }),
      this.numbersFor(staffId, window),
      this.targetsBar(staffId, now),
      this.needsYou(actor, now),
    ]);
    return { now: now.toISOString(), date: istDateKey(now), attendance, numbers, targets, needsYou };
  }

  /**
   * Today's numbers, counted from records (never typed). Onboarded counts each business
   * once, on the day it was first onboarded (B3/B24, rev 189).
   */
  async numbersFor(staffId: string, window: { gte: Date; lt: Date }) {
    const [shopsVisited, onboarded, vacanciesConfirmed, candidatesShown, interviewsBooked, attended] =
      await Promise.all([
        this.prisma.businessVisit.count({
          where: { staffId, visitedAt: window, OR: [{ boardPhotoHash: { not: null } }, { selfieHash: { not: null } }] },
        }),
        firstOnboardingsBy(this.prisma, staffId, window),
        this.prisma.vacancy.count({ where: { capturedByStaffId: staffId, confirmedAt: window } }),
        this.prisma.candidateIntroduction.count({ where: { shownByStaffId: staffId, shownAt: window } }),
        this.prisma.interview.count({ where: { proposedByStaffId: staffId, createdAt: window } }),
        this.attendedInterviews(staffId, window),
      ]);
    return {
      shopsVisited,
      onboarded: onboarded.size,
      vacanciesConfirmed,
      candidatesShown,
      interviewsBooked,
      interviewsAttended: attended.length,
    };
  }

  private attendedInterviews(staffId: string, window: { gte: Date; lt: Date }) {
    return this.prisma.interview.findMany({
      where: {
        OR: [
          { candidateArrivedByStaffId: staffId, candidateArrivedAt: window },
          { resultRecordedByStaffId: staffId, result: 'candidate_no_show', resultRecordedAt: window },
        ],
      },
      select: {
        id: true, code: true, candidateArrivedAt: true, resultRecordedAt: true, status: true,
        jobSeeker: { select: { name: true } }, business: { select: { id: true, name: true } },
      },
    });
  }

  private async targetsBar(staffId: string, now: Date) {
    const parts = getCalendarPartsInTimezone(now, 'Asia/Kolkata');
    const [metrics, target] = await Promise.all([
      this.metrics.getFieldAgentMetrics(staffId, parts.year, parts.month, undefined, now).catch((error: unknown) => {
        this.logger.warn(`Placements closed not counted for the targets bar: ${String(error)}`);
        return null;
      }),
      this.prisma.target.findUnique({
        where: { staffId_year_month: { staffId, year: parts.year, month: parts.month } },
        select: { placementsClosed: true },
      }),
    ]);
    return {
      year: parts.year,
      month: parts.month,
      placementsClosed: metrics?.metrics.placementsClosed ?? 0,
      placementsTarget: target?.placementsClosed ?? null,
    };
  }

  /** "Needs you now": everything waiting on the agent, each opening the exact step. */
  async needsYou(actor: Actor, now: Date = this.clock.now()): Promise<NeedsYouItem[]> {
    const staffId = actor.sub;
    await sweepHandovers(this.prisma, staffId, now);
    const todayKey = istDateKey(now);
    const tomorrowKey = istDateKey(new Date(now.getTime() + DAY_MS));
    const dayStart = istDayStart(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const tomorrowEnd = new Date(dayStart.getTime() + 2 * DAY_MS);
    const items: NeedsYouItem[] = [];

    // My businesses (what I act on): agreement, vacancies, candidates.
    const businesses = await this.prisma.business.findMany({
      where: { ...this.myBusinessesWhere(staffId), anonymisedAt: null },
      take: 500,
      select: {
        id: true, code: true, name: true, locality: true, verificationStatus: true, pausedAt: true,
        suspendedAt: true, suspendedUntil: true, inPersonOnboardedAt: true, fieldVerifiedAt: true, accountAgentId: true, leadCreatedByStaffId: true,
        createdAt: true,
        vacancies: {
          where: { status: { in: ['draft', 'awaiting_confirmation', 'open'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, code: true, tradeSkill: true, headcount: true, status: true, createdAt: true, updatedAt: true },
        },
      },
    });
    const agreements = await this.agreementInfos(businesses.map((b) => b.id), now);
    const openIds = businesses.flatMap((b) => b.vacancies.filter((v) => v.status === 'open').map((v) => v.id));
    const [shown, seatsTaken] = await Promise.all([this.shownByVacancy(openIds), this.seatsTakenByVacancy(openIds)]);
    for (const b of businesses) {
      const agreement = agreements.get(b.id)!;
      if (agreement.state !== 'signed') {
        items.push({
          id: `agreement_waiting:${b.id}`,
          kind: 'agreement_waiting',
          title: b.name,
          subtitle: b.locality,
          at: (agreement.linkSentAt ?? b.createdAt).toISOString(),
          due: null,
          target: { type: 'business', id: b.id, step: 'agreement' },
          agreement: {
            state: agreement.state,
            linkSentAt: agreement.linkSentAt?.toISOString() ?? null,
            linkExpiresAt: agreement.linkExpiresAt?.toISOString() ?? null,
          },
        });
      }
      for (const v of b.vacancies) {
        const vacancy = { code: v.code, trade: v.tradeSkill, headcount: v.headcount };
        if (v.status === 'awaiting_confirmation') {
          items.push({
            id: `vacancy_awaiting_owner:${v.id}`, kind: 'vacancy_awaiting_owner', title: b.name, subtitle: v.tradeSkill,
            at: v.updatedAt.toISOString(), due: null,
            target: { type: 'vacancy', id: v.id, step: 'enter_code', businessId: b.id }, vacancy,
          });
        } else if (v.status === 'draft') {
          items.push({
            id: `vacancy_draft:${v.id}`, kind: 'vacancy_draft', title: b.name, subtitle: v.tradeSkill,
            at: v.createdAt.toISOString(), due: null,
            target: { type: 'vacancy', id: v.id, step: 'send_to_owner', businessId: b.id }, vacancy,
          });
        }
      }
      const access = businessCandidateAccess(b, now);
      const fresh = b.vacancies.find((v) => v.status === 'open' && !shown.get(v.id));
      if (access.allowed && fresh) {
        items.push({
          id: `ready_show_candidates:${fresh.id}`, kind: 'ready_show_candidates', title: b.name, subtitle: fresh.tradeSkill,
          at: fresh.createdAt.toISOString(), due: null,
          target: { type: 'business', id: b.id, step: 'show_candidates', vacancyId: fresh.id },
          vacancy: { code: fresh.code, trade: fresh.tradeSkill, headcount: fresh.headcount },
        });
      }
      // 17 Nov: a heads-up per business with open vacancies still to fill ("2 vacancies to fill"),
      // opening that business. Seats are each open vacancy's headcount less its placements (not cancelled).
      if (!b.pausedAt && !isBusinessSuspended(b, now)) {
        const open = b.vacancies.filter((v) => v.status === 'open');
        const toFill = open.reduce((sum, v) => sum + Math.max(0, v.headcount - (seatsTaken.get(v.id) ?? 0)), 0);
        if (toFill > 0) {
          const oldest = open.reduce((a, v) => (v.createdAt < a ? v.createdAt : a), open[0].createdAt);
          items.push({
            id: `vacancies_to_fill:${b.id}`, kind: 'vacancies_to_fill', title: b.name, subtitle: b.locality,
            at: oldest.toISOString(), due: null,
            target: { type: 'business', id: b.id, step: 'fill_vacancies' },
            toFill: { count: toFill, vacancies: open.length, trades: [...new Set(open.map((v) => v.tradeSkill))] },
          });
        }
      }
    }

    // Interviews at a shop today that I attend.
    const interviewAssignments = await this.prisma.visitAssignment.findMany({
      where: { assignedStaffId: staffId, relatedType: 'interview', relatedId: { not: null }, status: { in: ['assigned', 'done'] } },
      select: { relatedId: true },
    });
    const interviewsToday = await this.prisma.interview.findMany({
      where: {
        slotStartsAt: { gte: dayStart, lt: dayEnd },
        status: { in: ['offered', 'confirmed'] },
        // 21 Nov re-check: an arrived candidate stays until the owner's decision is recorded.
        resultRecordedAt: null,
        OR: [
          { id: { in: interviewAssignments.map((a) => a.relatedId!) } },
          { proposedByStaffId: staffId, agentWillAttend: true },
        ],
      },
      orderBy: { slotStartsAt: 'asc' },
      select: { id: true, code: true, slotStartsAt: true, candidateArrivedAt: true, jobSeeker: { select: { name: true } }, business: { select: { id: true, name: true, locality: true } } },
    });
    const interviewsAway = await handedAwayIds(this.prisma, staffId, 'interview', now);
    for (const i of interviewsToday) {
      if (interviewsAway.has(i.id) && !interviewAssignments.some((a) => a.relatedId === i.id)) continue;
      items.push({
        id: `interview_today:${i.id}`, kind: 'interview_today', title: i.business.name, subtitle: i.business.locality,
        at: i.slotStartsAt.toISOString(), due: 'today',
        target: { type: 'interview', id: i.id, step: i.candidateArrivedAt ? 'owner_decision' : 'attend', businessId: i.business.id },
        interview: {
          code: i.code, startsAt: i.slotStartsAt.toISOString(), candidateName: shortName(i.jobSeeker.name),
          candidateArrivedAt: i.candidateArrivedAt?.toISOString() ?? null,
        },
      });
    }

    // 21 Nov: open verification visits (customer-app sign-ups and call-agent leads) as job cards,
    // opening the verification steps; a started one shows once, as the visit to finish.
    const cards = await this.extras.verificationJobCards(staffId);
    for (const c of cards) {
      const revisitKey = c.lastAttempt?.revisitOn ?? null;
      items.push({
        id: `verification_visit:${c.assignmentId}`, kind: 'verification_visit', title: c.business.name || c.business.code,
        subtitle: c.business.address ?? c.business.locality,
        at: c.requestedFor ?? (revisitKey ? `${revisitKey}T${c.lastAttempt?.revisitTime ?? '00:00'}:00.000+05:30` : null),
        due: c.requestedFor ? whenOf(istDateKey(new Date(c.requestedFor)), todayKey, tomorrowKey) : revisitKey ? whenOf(revisitKey, todayKey, tomorrowKey) : 'today',
        target: {
          type: 'verification', id: c.assignmentId, step: 'verify', businessId: c.business.id,
          assignmentId: c.assignmentId, ...(c.unfinishedVisitId ? { visitId: c.unfinishedVisitId } : {}),
        },
        job: c,
      });
    }
    const cardAssignments = new Set(cards.map((c) => c.assignmentId));

    // My visits that are not finished (B8: resume the onboarding).
    const unfinished = await this.prisma.businessVisit.findMany({
      where: {
        staffId,
        outcome: null,
        visitedAt: { gte: new Date(dayStart.getTime() - UNFINISHED_VISIT_DAYS * DAY_MS) },
      },
      orderBy: { visitedAt: 'desc' },
      take: 50,
      include: { business: { select: { id: true, name: true, locality: true } } },
    });
    for (const v of unfinished) {
      const step = visitNextStep(v);
      if (step === 'done') continue;
      if (isVerificationVisitPurpose(v.purpose) && v.assignmentId) {
        // The verification job card above resumes it (21 Nov: one row per verification visit).
        if (cardAssignments.has(v.assignmentId)) continue;
        const open = await this.prisma.visitAssignment.findFirst({
          where: { id: v.assignmentId, assignedStaffId: staffId, status: 'assigned' },
          select: { id: true },
        });
        if (!open) continue;
      }
      const startedAt = v.startedAt ?? v.visitedAt;
      items.push({
        id: `visit_unfinished:${v.id}`, kind: 'visit_unfinished', title: v.business?.name || v.shopName || v.business?.locality || 'Shop visit',
        subtitle: v.business?.locality ?? null, at: startedAt.toISOString(),
        due: whenOf(istDateKey(startedAt), todayKey, tomorrowKey),
        target: { type: 'visit', id: v.id, step, businessId: v.businessId, assignmentId: v.assignmentId },
        visit: { startedAt: startedAt.toISOString(), purpose: v.purpose },
      });
    }

    // Joinings to confirm by tomorrow.
    // 21 Nov: joinings handed over to me on a teammate's leave come in; mine handed away go out.
    const [joiningsIn, joiningsAway] = await Promise.all([handedTo(this.prisma, staffId, 'joining', now), handedAwayIds(this.prisma, staffId, 'joining', now)]);
    const joinings = await this.prisma.placement.findMany({
      where: {
        joinedDate: null,
        joiningDate: { lt: tomorrowEnd },
        status: { in: ['confirmed', 'active'] },
        OR: [{ createdByStaffId: staffId }, { business: { accountAgentId: staffId } }, { id: { in: joiningsIn.map((j) => j.recordId) } }],
        ...(joiningsAway.size ? { id: { notIn: [...joiningsAway] } } : {}),
      },
      take: 50,
      select: { id: true, code: true, joiningDate: true, jobSeeker: { select: { name: true } }, business: { select: { id: true, name: true } } },
    });
    for (const p of joinings) {
      items.push({
        id: `joining_due:${p.id}`, kind: 'joining_due', title: p.business.name, subtitle: firstName(p.jobSeeker.name),
        at: p.joiningDate!.toISOString(), due: whenOf(istDateKey(p.joiningDate!), todayKey, tomorrowKey),
        target: { type: 'placement', id: p.id, step: 'confirm_joining', businessId: p.business.id },
        placement: { code: p.code, joiningDate: istDateKey(p.joiningDate!), candidateFirstName: firstName(p.jobSeeker.name) },
      });
    }

    // Revisits due by today.
    for (const r of await this.revisitsDue(staffId, todayKey)) {
      items.push({
        id: `revisit_due:${r.visitId}`, kind: 'revisit_due', title: r.name || r.locality || 'Shop visit', subtitle: r.locality,
        at: r.revisitOn ? `${r.revisitOn}T${r.revisitTime ?? '00:00'}:00.000+05:30` : null,
        due: r.revisitOn ? whenOf(r.revisitOn, todayKey, tomorrowKey) : null,
        target: { type: 'revisit', id: r.visitId, step: 'start_visit', businessId: r.businessId },
        revisitOn: r.revisitOn,
        revisitTime: r.revisitTime,
        coverFor: r.coverFor,
        // 22 Nov: shown at the top when the revisit starts ("Last visit Fri 20 Nov: …").
        note: r.note,
        lastVisitAt: r.lastVisitAt,
      });
    }

    // Follow-up tasks due by tomorrow.
    const tasks = await this.prisma.followUpTask.findMany({
      where: { assignedStaffId: staffId, status: 'pending', dueAt: { lt: tomorrowEnd } },
      orderBy: { dueAt: 'asc' },
      take: 50,
      select: { id: true, code: true, kind: true, dueAt: true, subjectType: true, subjectId: true, relatedType: true, relatedId: true },
    });
    const seekerIds = tasks.filter((t) => t.subjectType === 'job_seeker').map((t) => t.subjectId);
    const bizIds = tasks.filter((t) => t.subjectType === 'business').map((t) => t.subjectId);
    const [seekers, bizNames] = await Promise.all([
      seekerIds.length ? this.prisma.jobSeeker.findMany({ where: { id: { in: seekerIds } }, select: { id: true, name: true } }) : [],
      bizIds.length ? this.prisma.business.findMany({ where: { id: { in: bizIds } }, select: { id: true, name: true } }) : [],
    ]);
    const names = new Map<string, string>([
      ...seekers.map((s) => [s.id, firstName(s.name)] as [string, string]),
      ...bizNames.map((b) => [b.id, b.name] as [string, string]),
    ]);
    for (const t of tasks) {
      items.push({
        id: `followup_task:${t.id}`, kind: 'followup_task', title: names.get(t.subjectId) || FOLLOW_UP_KIND_LABELS[t.kind] || t.code, subtitle: FOLLOW_UP_KIND_LABELS[t.kind] ?? null,
        at: t.dueAt.toISOString(), due: whenOf(istDateKey(t.dueAt), todayKey, tomorrowKey),
        target: {
          type: 'followup', id: t.id, step: t.kind,
          subjectType: t.subjectType, subjectId: t.subjectId, relatedType: t.relatedType, relatedId: t.relatedId,
        },
        taskKind: t.kind,
        kindLabel: FOLLOW_UP_KIND_LABELS[t.kind] ?? t.kind.replace(/_/g, ' '),
        code: t.code,
      });
    }

    return items
      .sort((a, b) => {
        const kind = NEEDS_ORDER.indexOf(a.kind) - NEEDS_ORDER.indexOf(b.kind);
        if (kind) return kind;
        if (a.kind === 'agreement_waiting') {
          const expired = Number((b.agreement as { state: string }).state === 'link_expired') -
            Number((a.agreement as { state: string }).state === 'link_expired');
          if (expired) return expired;
        }
        const due = (DUE_ORDER[a.due ?? ''] ?? NO_DUE_RANK) - (DUE_ORDER[b.due ?? ''] ?? NO_DUE_RANK);
        if (due) return due;
        return (a.at ?? '').localeCompare(b.at ?? '');
      })
      .slice(0, LIST_LIMIT);
  }

  // --------------------------------------------------------- Today's work

  async day(actor: Actor, dateValue?: string) {
    const now = this.clock.now();
    const todayKey = istDateKey(now);
    const key = (dateValue ?? '').trim() || todayKey;
    if (!DATE_KEY.test(key) || Number.isNaN(new Date(`${key}T00:00:00.000Z`).getTime()) ||
      new Date(`${key}T00:00:00.000Z`).toISOString().slice(0, 10) !== key) {
      throw codedError(HttpStatus.BAD_REQUEST, 'DATE_INVALID', 'date must be YYYY-MM-DD');
    }
    if (key > todayKey) throw codedError(HttpStatus.BAD_REQUEST, 'DATE_IN_FUTURE', 'Pick today or an earlier day');
    const oldest = istDateKey(new Date(istDayStart(now).getTime() - DAY_MAX_DAYS_BACK * DAY_MS));
    if (key < oldest) {
      throw codedError(HttpStatus.BAD_REQUEST, 'DATE_TOO_OLD', `Pick a day in the last ${DAY_MAX_DAYS_BACK} days`, { oldest });
    }
    const start = new Date(`${key}T00:00:00.000+05:30`);
    const window = { gte: start, lt: new Date(start.getTime() + DAY_MS) };
    const staffId = actor.sub;

    const [firsts, visits, businesses, seekers, partners, intros, booked, attended] = await Promise.all([
      firstOnboardingsBy(this.prisma, staffId, window),
      this.prisma.businessVisit.findMany({
        where: { staffId, visitedAt: window },
        include: { business: { select: { id: true, name: true, locality: true } } },
      }),
      this.prisma.business.findMany({
        where: { leadCreatedByStaffId: staffId, createdAt: window },
        select: { id: true, name: true, locality: true, verificationStatus: true, createdAt: true },
      }),
      this.prisma.jobSeeker.findMany({
        where: { registeredByStaffId: staffId, createdAt: window, anonymisedAt: null },
        select: { id: true, code: true, name: true, locality: true, status: true, createdAt: true },
      }),
      this.prisma.referral.findMany({
        where: { registeredByStaffId: staffId, createdAt: window, anonymisedAt: null },
        select: { id: true, code: true, name: true, locality: true, pausedAt: true, createdAt: true },
      }),
      this.prisma.candidateIntroduction.findMany({
        where: { shownByStaffId: staffId, shownAt: window },
        select: { vacancyId: true, shownAt: true, business: { select: { id: true, name: true } }, vacancy: { select: { tradeSkill: true } } },
      }),
      this.prisma.interview.findMany({
        where: { proposedByStaffId: staffId, createdAt: window },
        select: { id: true, code: true, status: true, createdAt: true, business: { select: { id: true, name: true } }, jobSeeker: { select: { name: true } } },
      }),
      this.attendedInterviews(staffId, window),
    ]);

    type DayItem = {
      type: string; id: string; at: string; title: string; subtitle: string | null; status: string | null;
      target: Record<string, unknown>; count?: number; countsAsOnboarded?: boolean;
    };
    // The Onboarded tile: one row per business first onboarded that day (its visit, else its registration).
    const countedVisits = new Set([...firsts.values()].map((f) => f.visitId).filter((v): v is string => Boolean(v)));
    const countedByRegistration = new Set([...firsts.entries()].filter(([, f]) => !f.visitId).map(([id]) => id));
    const items: DayItem[] = [];
    for (const v of visits) {
      items.push({
        type: 'visit', id: `visit:${v.id}`, at: (v.startedAt ?? v.visitedAt).toISOString(),
        title: v.business?.name ?? v.shopName ?? '', subtitle: v.business?.locality ?? null,
        status: v.outcome ?? 'unfinished', target: { type: 'visit', id: v.id, businessId: v.businessId }, countsAsOnboarded: countedVisits.has(v.id),
      });
    }
    for (const b of businesses) {
      items.push({
        type: 'business_registered', id: `business:${b.id}`, at: b.createdAt.toISOString(), title: b.name,
        subtitle: b.locality, status: b.verificationStatus, target: { type: 'business', id: b.id },
        countsAsOnboarded: countedByRegistration.has(b.id),
      });
    }
    for (const s of seekers) {
      items.push({
        type: 'job_seeker_registered', id: `job_seeker:${s.id}`, at: s.createdAt.toISOString(), title: s.name,
        subtitle: s.locality, status: s.status, target: { type: 'job_seeker', id: s.id },
      });
    }
    for (const r of partners) {
      items.push({
        type: 'referral_registered', id: `referral:${r.id}`, at: r.createdAt.toISOString(), title: r.name,
        subtitle: r.locality, status: r.pausedAt ? 'paused' : 'active', target: { type: 'referral', id: r.id },
      });
    }
    // Adding or confirming a vacancy is not a row here (17 Nov): both show on the business page's history.
    const groups = new Map<string, DayItem>();
    for (const i of intros) {
      const id = `candidates_shown:${i.vacancyId}`;
      const group = groups.get(id);
      if (group) {
        group.count = (group.count ?? 0) + 1;
        if (i.shownAt.toISOString() > group.at) group.at = i.shownAt.toISOString();
      } else {
        groups.set(id, {
          type: 'candidates_shown', id, at: i.shownAt.toISOString(), title: i.business.name, subtitle: i.vacancy.tradeSkill,
          status: null, target: { type: 'business', id: i.business.id, vacancyId: i.vacancyId }, count: 1,
        });
      }
    }
    items.push(...groups.values());
    for (const i of booked) {
      items.push({
        type: 'interview_booked', id: `interview_booked:${i.id}`, at: i.createdAt.toISOString(), title: i.business.name,
        subtitle: shortName(i.jobSeeker.name), status: i.status, target: { type: 'interview', id: i.id, businessId: i.business.id },
      });
    }
    for (const i of attended) {
      const at = i.candidateArrivedAt ?? i.resultRecordedAt!;
      items.push({
        type: 'interview_attended', id: `interview_attended:${i.id}`, at: at.toISOString(), title: i.business.name,
        subtitle: shortName(i.jobSeeker.name), status: i.candidateArrivedAt ? 'arrived' : 'no_show',
        target: { type: 'interview', id: i.id, businessId: i.business.id },
      });
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    const counts: Record<string, number> = {
      visit: 0, business_registered: 0, job_seeker_registered: 0, referral_registered: 0,
      candidates_shown: 0, interview_booked: 0, interview_attended: 0,
    };
    for (const item of items) counts[item.type] += 1;
    return { date: key, isToday: key === todayKey, counts, items };
  }

  // ----------------------------------------------------------- All visits

  /**
   * My visits → All visits (17 Nov, item 2): the agent's own visits, newest
   * first, the full history (no 90-day limit), with a search on the shop
   * name, area or business code and an optional IST date range. Paged by
   * `before` (the `at` of the last row seen).
   */
  async allVisits(actor: Actor, query: { q?: string; from?: string; to?: string; before?: string; limit?: string }) {
    const staffId = actor.sub;
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? '', 10) || ALL_VISITS_PAGE, 1), ALL_VISITS_PAGE_MAX);
    const day = (value: unknown, name: 'from' | 'to'): string | null => {
      if (value === undefined || value === null || value === '') return null;
      const v = typeof value === 'string' ? value.trim() : '';
      if (!v && typeof value === 'string') return null;
      const parsed = new Date(`${v}T00:00:00.000Z`);
      // Not a string (a repeated ?from=), not YYYY-MM-DD, not a real date (2026-13-45, 2026-02-30): 400, never 500.
      if (!DATE_KEY.test(v) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) {
        throw codedError(HttpStatus.BAD_REQUEST, 'DATE_INVALID', `${name} must be YYYY-MM-DD`);
      }
      return v;
    };
    const from = day(query.from, 'from');
    const to = day(query.to, 'to');
    if (from && to && from > to) throw codedError(HttpStatus.BAD_REQUEST, 'DATE_RANGE_INVALID', 'from must be on or before to');
    // The cursor is "<visitedAt ISO>|<visit id>" of the last row seen (ties on the time are kept apart by the id).
    let cursor: { at: Date; id: string } | null = null;
    if (query.before !== undefined && query.before !== '') {
      if (typeof query.before !== 'string') throw codedError(HttpStatus.BAD_REQUEST, 'CURSOR_INVALID', 'before is not a cursor from this list');
      const [iso, id] = query.before.split('|');
      const at = new Date(iso);
      if (Number.isNaN(at.getTime()) || !id) throw codedError(HttpStatus.BAD_REQUEST, 'CURSOR_INVALID', 'before is not a cursor from this list');
      cursor = { at, id };
    }
    const visitedAt: Prisma.DateTimeFilter = {};
    if (from) visitedAt.gte = new Date(`${from}T00:00:00.000+05:30`);
    if (to) visitedAt.lt = new Date(new Date(`${to}T00:00:00.000+05:30`).getTime() + DAY_MS);
    const q = (typeof query.q === 'string' ? query.q : '').trim().slice(0, 80);
    const insensitive = { contains: q, mode: Prisma.QueryMode.insensitive };
    const and: Prisma.BusinessVisitWhereInput[] = [];
    if (cursor) and.push({ OR: [{ visitedAt: { lt: cursor.at } }, { visitedAt: cursor.at, id: { lt: cursor.id } }] });
    if (q) {
      and.push({
        OR: [
          { shopName: insensitive },
          { business: { name: insensitive } },
          { business: { locality: insensitive } },
          { business: { code: insensitive } },
        ],
      });
    }
    const where: Prisma.BusinessVisitWhereInput = {
      staffId,
      ...(Object.keys(visitedAt).length ? { visitedAt } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const rows = await this.prisma.businessVisit.findMany({
      where,
      orderBy: [{ visitedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { business: { select: { id: true, code: true, name: true, locality: true } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((v) => ({
        id: v.id,
        at: (v.startedAt ?? v.visitedAt).toISOString(),
        visitedAt: v.visitedAt.toISOString(),
        title: v.business?.name ?? v.shopName ?? '',
        subtitle: v.business?.locality ?? null,
        businessId: v.businessId,
        businessCode: v.business?.code ?? null,
        purpose: v.purpose,
        status: v.outcome ?? 'unfinished',
        durationSeconds: v.durationSeconds,
        hasBoardPhoto: Boolean(v.boardPhotoHash),
        hasSelfie: Boolean(v.selfieHash),
      })),
      nextBefore: rows.length > limit ? `${page[page.length - 1].visitedAt.toISOString()}|${page[page.length - 1].id}` : null,
    };
  }

  // ------------------------------------------------------- My businesses

  /** The businesses this agent works on (account agent, or his lead with no account agent). */
  private myBusinessesWhere(staffId: string): Prisma.BusinessWhereInput {
    return { OR: [{ accountAgentId: staffId }, { accountAgentId: null, leadCreatedByStaffId: staffId }] };
  }

  async myBusinesses(actor: Actor, q?: string) {
    const now = this.clock.now();
    const query = (q ?? '').trim();
    // 22 Nov (rev 208): the Businesses tab lists his businesses — account agent (or his lead), or
    // onboarded by him on a visit.
    const filters: Prisma.BusinessWhereInput[] = [
      { OR: [this.myBusinessesWhere(actor.sub), { visits: { some: { staffId: actor.sub, outcome: 'onboarded' } } }] },
      { anonymisedAt: null },
    ];
    if (query) {
      filters.push({
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { code: query.toUpperCase() },
          { locality: { contains: query, mode: 'insensitive' } },
        ],
      });
    }
    const rows = await this.prisma.business.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }],
      take: LIST_LIMIT,
      select: {
        id: true, code: true, name: true, locality: true, verificationStatus: true, pausedAt: true, suspendedAt: true,
        suspendedUntil: true, inPersonOnboardedAt: true, fieldVerifiedAt: true, leadChannel: true, accountAgentId: true,
        vacancies: {
          where: { status: { in: ['draft', 'awaiting_confirmation', 'open'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, status: true, headcount: true },
        },
      },
    });
    const ids = rows.map((b) => b.id);
    const dayStart = istDayStart(now);
    const [agreements, shown, outside, interviews] = await Promise.all([
      this.agreementInfos(ids, now),
      this.shownByVacancy(rows.flatMap((b) => b.vacancies.filter((v) => v.status === 'open').map((v) => v.id))),
      this.outsideAreaBusinesses(rows),
      // 22 Nov: "Interviews today" on the row.
      ids.length
        ? this.prisma.interview.groupBy({
            by: ['businessId'],
            where: { businessId: { in: ids }, slotStartsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) }, status: { in: ['offered', 'confirmed'] } },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ businessId: string; _count: { _all: number } }>),
    ]);
    const interviewsToday = new Map(interviews.map((r) => [r.businessId, r._count._all]));
    return {
      query,
      results: rows.map((b) => {
        const agreement = agreements.get(b.id)!;
        return {
          id: b.id,
          code: b.code,
          name: b.name,
          locality: b.locality,
          verificationStatus: b.verificationStatus,
          agreementSigned: agreement.state === 'signed',
          openVacancies: b.vacancies.filter((v) => v.status === 'open').reduce((sum, v) => sum + v.headcount, 0),
          nextStep: this.businessNextStep(b, agreement, shown, outside.has(b.id), now),
          interviewsToday: interviewsToday.get(b.id) ?? 0,
          isAccountAgent: b.accountAgentId === actor.sub,
        };
      }),
    };
  }

  /** Signed, field-registered leads whose only selfie visits were outside the business's area (B25). */
  private async outsideAreaBusinesses(rows: Array<{ id: string; verificationStatus: string | null; leadChannel: string | null; accountAgentId: string | null }>) {
    const candidates = rows.filter((b) => b.verificationStatus === 'lead' && b.leadChannel === 'field_visit' && b.accountAgentId);
    if (!candidates.length) return new Set<string>();
    const visits = await this.prisma.businessVisit.findMany({
      where: { businessId: { in: candidates.map((b) => b.id) }, selfieHash: { not: null } },
      select: { businessId: true, staffId: true, geofenceFlag: true },
    });
    const outside = new Set<string>();
    for (const b of candidates) {
      const own = visits.filter((v) => v.businessId === b.id && v.staffId === b.accountAgentId);
      if (own.length && own.every((v) => v.geofenceFlag)) outside.add(b.id);
    }
    return outside;
  }

  private candidatesHiddenReason(
    business: BusinessForStep,
    agreement: AgreementInfo,
    outsideArea: boolean,
    now: Date,
  ): string | null {
    const access = businessCandidateAccess(business, now);
    if (access.allowed) return null;
    if (access.reason === 'suspended' || access.reason === 'paused') return access.reason;
    if (agreement.state !== 'signed') return 'agreement_not_signed';
    if (outsideArea) return 'visit_outside_area';
    return 'not_verified';
  }

  businessNextStep(
    business: BusinessForStep,
    agreement: AgreementInfo,
    shown: Map<string, number>,
    outsideArea: boolean,
    now: Date,
  ): BusinessNextStep {
    if (isBusinessSuspended(business, now)) return { kind: 'suspended' };
    if (business.pausedAt) return { kind: 'paused' };
    if (agreement.state !== 'signed') return { kind: 'agreement_waiting', agreementState: agreement.state };
    const waiting = business.vacancies.find((v) => v.status === 'awaiting_confirmation');
    if (waiting) return { kind: 'vacancy_to_confirm', vacancyId: waiting.id };
    const draft = business.vacancies.find((v) => v.status === 'draft');
    if (draft) return { kind: 'vacancy_to_send', vacancyId: draft.id };
    const hidden = this.candidatesHiddenReason(business, agreement, outsideArea, now);
    if (hidden) {
      if (business.verificationStatus === 'pending_tl_check') return { kind: 'waiting_tl_check' };
      return { kind: 'candidates_hidden', reason: hidden };
    }
    const open = business.vacancies.filter((v) => v.status === 'open');
    if (!open.length) return { kind: 'add_vacancy' };
    const fresh = open.find((v) => !shown.get(v.id)) ?? open[0];
    return { kind: 'ready_show_candidates', vacancyId: fresh.id };
  }

  // ------------------------------------------------------ Business page

  private async findBusiness(ref: string) {
    const business = await this.prisma.business.findFirst({
      where: { OR: [{ id: ref }, { code: ref.toUpperCase() }], anonymisedAt: null },
      include: {
        vacancies: {
          where: { status: { in: ['draft', 'awaiting_confirmation', 'open'] } },
          orderBy: { createdAt: 'asc' },
          include: { branch: { select: { contactPersonName: true, contactPersonPhone: true } } },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async businessPage(actor: Actor, ref: string) {
    const now = this.clock.now();
    const business = await this.findBusiness(ref);
    const viewer = await agentViewerFor(this.prisma, actor.sub, 'field_agent');
    const canAct = fieldAgentCanAct(business, viewer);
    const dayStart = istDayStart(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const vacancyIds = business.vacancies.map((v) => v.id);
    const [agreements, accountAgent, shownTotal, shownByMe, shown, interviewTotal, interviewToday, interviewUpcoming,
      recentInterviews, placements, inGuarantee, visits, outside, confirmLinks, vacancyEvents] = await Promise.all([
      this.agreementInfos([business.id], now),
      business.accountAgentId
        ? this.prisma.staff.findUnique({ where: { id: business.accountAgentId }, select: { id: true, name: true, code: true } })
        : Promise.resolve(null),
      this.prisma.candidateIntroduction.count({ where: { businessId: business.id } }),
      this.prisma.candidateIntroduction.count({ where: { businessId: business.id, shownByStaffId: actor.sub } }),
      this.shownByVacancy(vacancyIds),
      this.prisma.interview.count({ where: { businessId: business.id } }),
      this.prisma.interview.count({ where: { businessId: business.id, slotStartsAt: { gte: dayStart, lt: dayEnd }, status: { in: ['offered', 'confirmed'] } } }),
      this.prisma.interview.count({ where: { businessId: business.id, slotStartsAt: { gte: dayEnd }, status: { in: ['offered', 'confirmed'] } } }),
      this.prisma.interview.findMany({
        where: { businessId: business.id },
        orderBy: { slotStartsAt: 'desc' },
        take: 5,
        select: { id: true, code: true, slotStartsAt: true, status: true, result: true, jobSeeker: { select: { name: true } } },
      }),
      this.prisma.placement.count({ where: { businessId: business.id, joinedDate: { not: null } } }),
      this.prisma.placement.count({ where: { businessId: business.id, status: 'active' } }),
      this.prisma.businessVisit.findMany({
        where: { businessId: business.id },
        orderBy: { visitedAt: 'desc' },
        take: 20,
        include: { staff: { select: { name: true } } },
      }),
      this.outsideAreaBusinesses([business]),
      vacancyIds.length
        ? this.prisma.publicLink.findMany({
            where: { purpose: 'vacancy_confirm', subjectType: 'vacancy', subjectId: { in: vacancyIds }, revokedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { subjectId: true, createdAt: true, expiresAt: true },
          })
        : Promise.resolve([]),
      this.vacancyEvents(business.id),
    ]);
    const agreement = agreements.get(business.id)!;
    const outsideArea = outside.has(business.id);
    const access = businessCandidateAccess(business, now);
    const hiddenReason = this.candidatesHiddenReason(business, agreement, outsideArea, now);
    const resend = this.resendWindow(agreement, now);
    const latestConfirmLink = new Map<string, { createdAt: Date; expiresAt: Date }>();
    for (const l of confirmLinks) if (!latestConfirmLink.has(l.subjectId)) latestConfirmLink.set(l.subjectId, l);

    const vacancies = [];
    for (const v of business.vacancies) {
      const contactPhone = v.branch?.contactPersonPhone ?? business.phone;
      let nextStep: Record<string, unknown> = { kind: 'none' };
      if (canAct && v.status === 'draft') {
        const missing = [
          ['tradeSkill', v.tradeSkill?.trim()],
          ['salaryMinPaise', v.salaryMinPaise],
          ['headcount', v.headcount],
          ['shift', v.shift?.trim()],
          ['startDate', v.startDate],
        ].filter(([, value]) => value === null || value === undefined || value === '').map(([field]) => field);
        const check = v.tradeSkill?.trim() && typeof v.salaryMinPaise === 'number'
          ? await this.confirmation.checkLegalMinimum(v.tradeSkill, v.salaryMinPaise, v.salaryPeriod, { businessId: business.id })
          : null;
        nextStep = {
          kind: 'send_to_owner',
          missing,
          needsMinimumWageTick: Boolean(check?.below),
          legalMinimumPaise: check?.legalMinimumPaise ?? null,
        };
      } else if (canAct && v.status === 'awaiting_confirmation') {
        const link = latestConfirmLink.get(v.id);
        nextStep = {
          kind: 'enter_code',
          sentToLast4: phoneLast4(contactPhone),
          linkSentAt: link?.createdAt.toISOString() ?? null,
          linkExpiresAt: link?.expiresAt.toISOString() ?? null,
        };
      } else if (canAct && v.status === 'open' && access.allowed) {
        nextStep = { kind: 'show_candidates', shown: shown.get(v.id) ?? 0 };
      }
      vacancies.push({
        id: v.id,
        code: v.code,
        trade: v.tradeSkill,
        roleTitle: v.roleTitle,
        headcount: v.headcount,
        salaryMinPaise: v.salaryMinPaise,
        salaryMaxPaise: v.salaryMaxPaise,
        salaryPeriod: v.salaryPeriod,
        shift: v.shift,
        startDate: keyFromDate(v.startDate),
        status: v.status,
        confirmedAt: v.confirmedAt?.toISOString() ?? null,
        belowLegalMinimum: v.belowLegalMinimum,
        contactName: canAct ? v.branch?.contactPersonName ?? business.additionalContactName ?? business.ownerName : null,
        contactPhoneLast4: canAct ? phoneLast4(contactPhone) : null,
        nextStep,
      });
    }

    const teamLeadCheck = business.verificationStatus === 'verified'
      ? { state: 'done', at: business.verifiedAt?.toISOString() ?? null }
      : business.verificationStatus === 'pending_tl_check'
        ? { state: 'waiting', at: null }
        : { state: 'not_yet', at: null };
    const shownMap = shown;
    const visitRows = visits.map((v) => ({
      id: v.id,
      at: (v.startedAt ?? v.visitedAt).toISOString(),
      durationSeconds: v.durationSeconds,
      purpose: v.purpose,
      outcome: v.outcome,
      staffName: v.staff?.name ?? null,
      mine: v.staffId === actor.sub,
      hasBoardPhoto: Boolean(v.boardPhotoHash),
      hasSelfie: Boolean(v.selfieHash),
    }));
    return {
      id: business.id,
      code: business.code,
      name: business.name,
      locality: business.locality,
      businessType: business.businessType,
      latitude: business.latitude,
      longitude: business.longitude,
      accountAgent: accountAgent ? { ...accountAgent, isMe: accountAgent.id === actor.sub } : null,
      isMine: business.accountAgentId === actor.sub || (!business.accountAgentId && business.leadCreatedByStaffId === actor.sub),
      canAct,
      status: {
        verificationStatus: business.verificationStatus,
        paused: Boolean(business.pausedAt),
        suspended: isBusinessSuspended(business, now),
        suspendedUntil: isBusinessSuspended(business, now) ? business.suspendedUntil?.toISOString() ?? null : null,
        canShowCandidates: access.allowed,
        candidatesHiddenReason: hiddenReason,
      },
      nextStep: canAct ? this.businessNextStep(business, agreement, shownMap, outsideArea, now) : { kind: 'none' },
      contact: canAct
        ? {
            name: business.additionalContactName ?? business.ownerName,
            role: business.contactRole,
            phoneLast4: phoneLast4(business.phone),
            language: PRODUCT_LANGUAGE,
          }
        : null,
      checklist: {
        registered: { done: true, at: business.createdAt.toISOString() },
        ownerPhoneVerified: { done: business.phoneVerified },
        agreement: canAct
          ? {
              state: agreement.state,
              signedAt: agreement.signedAt?.toISOString() ?? null,
              signedByName: agreement.signedByName,
              linkSentAt: agreement.linkSentAt?.toISOString() ?? null,
              linkExpiresAt: agreement.linkExpiresAt?.toISOString() ?? null,
              linkOpenedAt: agreement.linkOpenedAt?.toISOString() ?? null,
              sentToLast4: phoneLast4(business.phone),
              canResend: !this.signedCurrentVersion(agreement) && resend.allowedNow,
              resendAvailableAt: this.signedCurrentVersion(agreement) || resend.allowedNow ? null : resend.retryAt?.toISOString() ?? null,
            }
          : { state: agreement.state, signedAt: agreement.signedAt?.toISOString() ?? null },
        teamLeadCheck,
      },
      vacancies,
      candidates: {
        shown: shownTotal,
        shownByMe,
        interviews: { total: interviewTotal, today: interviewToday, upcoming: interviewUpcoming },
        placements,
        inGuarantee,
        recentInterviews: recentInterviews.map((i) => ({
          id: i.id,
          code: i.code,
          startsAt: i.slotStartsAt.toISOString(),
          status: i.status,
          result: i.result,
          candidateName: shortName(i.jobSeeker.name),
        })),
      },
      visits: visitRows,
      // The business's history (17 Nov): its visits and its vacancy events, newest first.
      history: [...visitRows.map((v) => ({ kind: 'visit' as const, at: v.at, visit: v })), ...vacancyEvents]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, HISTORY_LIMIT),
      actions: {
        recordVisit: canAct,
        callOwner: canAct,
        addVacancy: canAct && !isBusinessSuspended(business, now),
        resendAgreement: canAct && !this.signedCurrentVersion(agreement),
        showCandidates: canAct && access.allowed && business.vacancies.some((v) => v.status === 'open'),
      },
    };
  }

  // ------------------------------------------------------------ Agreement

  private async ownBusiness(actor: Actor, ref: string) {
    const business = await this.findBusiness(ref);
    const viewer: AgentViewer = await agentViewerFor(this.prisma, actor.sub, 'field_agent');
    if (!fieldAgentCanAct(business, viewer)) {
      throw codedError(HttpStatus.FORBIDDEN, 'NOT_YOUR_BUSINESS', 'This business belongs to another field agent. You can view it but not act on it.');
    }
    return business;
  }

  /** The agreement screen after the business form: polled until the owner signs on his own phone. */
  async agreementStatus(actor: Actor, ref: string) {
    const now = this.clock.now();
    const business = await this.ownBusiness(actor, ref);
    const [agreements, outside] = await Promise.all([this.agreementInfos([business.id], now), this.outsideAreaBusinesses([business])]);
    const agreement = agreements.get(business.id)!;
    const resend = this.resendWindow(agreement, now);
    const signedCurrent = this.signedCurrentVersion(agreement);
    return {
      businessId: business.id,
      state: agreement.state,
      signedAt: agreement.signedAt?.toISOString() ?? null,
      signedByName: agreement.signedByName,
      linkSentAt: agreement.linkSentAt?.toISOString() ?? null,
      linkExpiresAt: agreement.linkExpiresAt?.toISOString() ?? null,
      linkOpenedAt: agreement.linkOpenedAt?.toISOString() ?? null,
      sentToLast4: phoneLast4(business.phone),
      canResend: !signedCurrent && resend.allowedNow,
      resendAvailableAt: signedCurrent || resend.allowedNow ? null : resend.retryAt?.toISOString() ?? null,
      canShowCandidates: businessCandidateAccess(business, now).allowed,
      candidatesHiddenReason: this.candidatesHiddenReason(business, agreement, outside.has(business.id), now),
    };
  }

  /**
   * "Resend agreement link" (rev 188): a new SMS link for the owner to sign on his own
   * phone. Own business only; never once the current version is signed; one link a
   * minute and five a day per business; a failed SMS is reported, never swallowed.
   */
  async resendAgreement(actor: Actor, ref: string, body: { language?: string }) {
    const now = this.clock.now();
    const business = await this.ownBusiness(actor, ref);
    const agreement = (await this.agreementInfos([business.id], now)).get(business.id)!;
    if (this.signedCurrentVersion(agreement)) {
      throw codedError(HttpStatus.CONFLICT, 'AGREEMENT_ALREADY_SIGNED', 'The owner has already signed the agreement', {
        signedAt: agreement.signedAt?.toISOString() ?? null,
      });
    }
    // English only (rev 193): a language an older app sends is ignored.
    const language = productLanguage(body?.language);
    // The one-a-minute / five-a-day limit is checked inside createAgreementLink (shared by
    // every path that sends a link, S2); a link whose SMS failed is withdrawn there.
    const issued = await this.consentLinks.createAgreementLink(business.id, actor.sub, language);
    if (issued.smsSent === false) {
      throw codedError(HttpStatus.BAD_GATEWAY, 'AGREEMENT_SMS_FAILED', 'The SMS could not be sent. Try again in a moment.');
    }
    await this.audit.log({
      actorId: actor.sub,
      action: 'business.agreement_link_resent',
      entityType: 'business',
      entityCode: business.code,
      after: { expiresAt: issued.expiresAt.toISOString(), language, sentToLast4: phoneLast4(business.phone) },
      changedFields: ['agreementLink'],
      reason: 'Agreement link sent again from Laboura Field',
      city: business.city,
    });
    return {
      success: true,
      linkSentAt: now.toISOString(),
      linkExpiresAt: issued.expiresAt.toISOString(),
      sentToLast4: phoneLast4(business.phone),
    };
  }

  private signedCurrentVersion(agreement: AgreementInfo): boolean {
    return agreement.state === 'signed' && agreement.signedVersion === LEGAL_DOCUMENT_VERSIONS.business_agreement;
  }

  private resendWindow(agreement: AgreementInfo, now: Date): AgreementLinkWindow {
    return agreementLinkWindow(agreement.recentLinks, now);
  }

  /** The signed agreement (latest) and the latest live link for each business. */
  private async agreementInfos(ids: string[], now: Date): Promise<Map<string, AgreementInfo>> {
    const result = new Map<string, AgreementInfo>();
    if (!ids.length) return result;
    const [agreements, links] = await Promise.all([
      this.prisma.businessAgreement.findMany({
        where: { businessId: { in: ids } },
        orderBy: { signedAt: 'desc' },
        select: { businessId: true, signedAt: true, signedName: true, version: true },
      }),
      this.prisma.publicLink.findMany({
        where: { purpose: 'business_agreement', subjectType: 'business', subjectId: { in: ids }, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { subjectId: true, createdAt: true, expiresAt: true, openedAt: true, usedAt: true },
      }),
    ]);
    const dayAgo = now.getTime() - DAY_MS;
    for (const id of ids) {
      const signed = agreements.find((a) => a.businessId === id) ?? null;
      const own = links.filter((l) => l.subjectId === id);
      const latest = own[0] ?? null;
      const state: AgreementState = signed
        ? 'signed'
        : !latest
          ? 'not_sent'
          : !latest.usedAt && latest.expiresAt.getTime() > now.getTime()
            ? 'link_sent'
            : 'link_expired';
      result.set(id, {
        state,
        signedAt: signed?.signedAt ?? null,
        signedByName: signed?.signedName ?? null,
        signedVersion: signed?.version ?? null,
        linkSentAt: latest?.createdAt ?? null,
        linkExpiresAt: latest?.expiresAt ?? null,
        linkOpenedAt: latest?.openedAt ?? null,
        recentLinks: own.filter((l) => l.createdAt.getTime() > dayAgo).map((l) => l.createdAt),
      });
    }
    return result;
  }

  /** Placements (not cancelled) per vacancy: the seats already taken. */
  private async seatsTakenByVacancy(vacancyIds: string[]): Promise<Map<string, number>> {
    if (vacancyIds.length === 0) return new Map();
    const rows = await this.prisma.placement.groupBy({
      by: ['vacancyId'],
      where: { vacancyId: { in: vacancyIds }, status: { not: 'cancelled' } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.vacancyId, r._count._all]));
  }

  /**
   * The business page's history (17 Nov): vacancy events — added, sent to the
   * owner, confirmed, filled, closed — so adding a vacancy shows here rather
   * than as a row of My visits / Today's work.
   */
  private async vacancyEvents(businessId: string): Promise<Array<{
    kind: 'vacancy'; at: string; event: 'added' | 'sent' | 'confirmed' | 'filled' | 'closed';
    vacancyId: string; code: string; trade: string; headcount: number; byName: string | null;
  }>> {
    const vacancies = await this.prisma.vacancy.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, code: true, tradeSkill: true, headcount: true, createdAt: true, confirmedAt: true,
        capturedBy: { select: { name: true } },
      },
    });
    if (vacancies.length === 0) return [];
    const history = await this.prisma.statusHistory.findMany({
      where: { subjectType: 'vacancy', subjectId: { in: vacancies.map((v) => v.id) }, toStatus: { in: ['awaiting_confirmation', 'filled', 'cancelled', 'closed'] } },
      orderBy: { changedAt: 'desc' },
      take: 200,
      select: { subjectId: true, toStatus: true, changedAt: true, changedByStaff: { select: { name: true } } },
    });
    const byId = new Map(vacancies.map((v) => [v.id, v]));
    const base = (v: (typeof vacancies)[number]) => ({ vacancyId: v.id, code: v.code, trade: v.tradeSkill, headcount: v.headcount });
    const events: Awaited<ReturnType<FieldRedesignService['vacancyEvents']>> = [];
    for (const v of vacancies) {
      events.push({ kind: 'vacancy', at: v.createdAt.toISOString(), event: 'added', ...base(v), byName: v.capturedBy?.name ?? null });
      if (v.confirmedAt) events.push({ kind: 'vacancy', at: v.confirmedAt.toISOString(), event: 'confirmed', ...base(v), byName: null });
    }
    for (const h of history) {
      const v = byId.get(h.subjectId);
      if (!v) continue;
      const event = h.toStatus === 'awaiting_confirmation' ? 'sent' : h.toStatus === 'filled' ? 'filled' : 'closed';
      events.push({ kind: 'vacancy', at: h.changedAt.toISOString(), event, ...base(v), byName: h.changedByStaff?.name ?? null });
    }
    return events;
  }

  private async shownByVacancy(vacancyIds: string[]): Promise<Map<string, number>> {
    if (!vacancyIds.length) return new Map();
    const rows = await this.prisma.candidateIntroduction.groupBy({
      by: ['vacancyId'],
      where: { vacancyId: { in: vacancyIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.vacancyId, r._count._all]));
  }

  // --------------------------------------------------------- Job seekers

  async myJobSeekers(actor: Actor, q?: string) {
    const query = (q ?? '').trim();
    // His own: registered by him, or assigned to him by his Team Lead (peopleOwnedBy, rev 194).
    const filters: Prisma.JobSeekerWhereInput[] = [peopleOwnedBy([actor.sub]), { anonymisedAt: null }];
    if (query) {
      // Own records only; a phone matches by exactly its last 4 digits (never a longer run, AC-2).
      filters.push({
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { code: query.toUpperCase() },
          ...(/^\d{4}$/.test(query) ? [{ phone: { endsWith: query } }] : []),
        ],
      });
    }
    const rows = await this.prisma.jobSeeker.findMany({
      where: { AND: filters },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true, code: true, name: true, phone: true, status: true, createdAt: true, paymentReceivedAt: true,
        identityVerifications: { select: { status: true, verifiedAt: true } },
        _count: { select: { interviews: true } },
        placements: { where: { status: { notIn: ['cancelled', 'awaiting_payment'] } }, select: { id: true }, take: 1 },
      },
    });
    const ids = rows.map((r) => r.id);
    const [links, consents] = ids.length
      ? await Promise.all([
          this.prisma.publicLink.findMany({
            where: { purpose: 'registration', subjectType: 'job_seeker', subjectId: { in: ids } },
            orderBy: { createdAt: 'asc' },
            select: { subjectId: true, createdAt: true },
          }),
          this.prisma.consent.findMany({
            where: { subjectType: 'job_seeker', subjectId: { in: ids }, granted: true, grantedAt: { not: null } },
            orderBy: { grantedAt: 'asc' },
            select: { subjectId: true, grantedAt: true },
          }),
        ])
      : [[], []];
    const firstLink = new Map<string, Date>();
    for (const l of links) if (!firstLink.has(l.subjectId)) firstLink.set(l.subjectId, l.createdAt);
    const firstConsent = new Map<string, Date>();
    for (const c of consents) if (!firstConsent.has(c.subjectId)) firstConsent.set(c.subjectId, c.grantedAt!);
    return {
      query,
      results: rows.map((s) => {
        const verified = s.identityVerifications.filter((v) => v.status === 'verified');
        const idCheckedAt = verified.map((v) => v.verifiedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
        const idChecked = verified.length > 0;
        const steps = {
          linkSentAt: firstLink.get(s.id)?.toISOString() ?? null,
          consentGivenAt: firstConsent.get(s.id)?.toISOString() ?? null,
          paidAt: s.paymentReceivedAt?.toISOString() ?? null,
          idCheckedAt: idChecked ? (idCheckedAt ?? s.createdAt).toISOString() : null,
          idCheckPending: !idChecked && s.identityVerifications.some((v) => v.status === 'pending'),
          interviews: s._count.interviews,
          placed: s.placements.length > 0,
        };
        const stage = ['deactivated', 'closed'].includes(s.status)
          ? 'inactive'
          : steps.placed
            ? 'placed'
            : steps.interviews > 0
              ? 'interviewing'
              : steps.idCheckedAt
                ? 'id_checked'
                : steps.paidAt
                  ? 'paid'
                  : steps.consentGivenAt
                    ? 'consent_given'
                    : steps.linkSentAt
                      ? 'link_sent'
                      : 'registered';
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          phoneLast4: phoneLast4(s.phone),
          status: s.status,
          registeredAt: s.createdAt.toISOString(),
          stage,
          steps,
        };
      }),
    };
  }

  // ------------------------------------------------------------- helpers

  /** My revisits due by `byKey`: the latest visit of each shop that brings me back, with no later visit. */
  private async revisitsDue(staffId: string, byKey: string) {
    // 21 Nov: revisits handed over to me on a teammate's leave come in; mine handed away go out;
    // a verification visit still open is its job card, not a revisit (no double row, M2).
    const [handedIn, away] = await Promise.all([handedTo(this.prisma, staffId, 'revisit', this.clock.now()), handedAwayIds(this.prisma, staffId, 'revisit', this.clock.now())]);
    const rows = await this.prisma.businessVisit.findMany({
      where: {
        OR: [{ staffId }, { id: { in: handedIn.map((h) => h.recordId) } }],
        outcome: { in: [...REVISIT_OUTCOMES] },
        revisitOn: { lte: new Date(`${byKey}T00:00:00.000Z`) },
        // 22 Nov (rev 208): a closed revisit never comes back.
        revisitClosedAt: null,
      },
      orderBy: { visitedAt: 'desc' },
      include: { business: { select: { id: true, name: true, locality: true } } },
      take: 200,
    });
    const openVerification = await this.extras.openVerificationVisitIds(rows);
    const result: Array<{ visitId: string; businessId: string | null; name: string; locality: string | null; revisitOn: string | null; revisitTime: string | null; coverFor: string | null; note: string | null; lastVisitAt: string }> = [];
    // One row per shop (22 Nov): the business, or the same board name close by (two separate visits).
    const kept: Array<{ businessId: string | null; shopName: string | null; latitude: number; longitude: number }> = [];
    for (const v of rows) {
      if (kept.some((k) => sameShop(k, v))) continue;
      kept.push(v);
      if (away.has(v.id) || openVerification.has(v.id) || FIELD_REVISIT_EXCLUDE.has(v.purpose ?? '')) continue;
      const later = v.businessId
        ? await this.prisma.businessVisit.findFirst({ where: { businessId: v.businessId, visitedAt: { gt: v.visitedAt } }, select: { id: true } })
        : await this.prisma.businessVisit.findFirst({ where: { revisitOfVisitId: v.id }, select: { id: true } });
      if (later) continue;
      result.push({
        visitId: v.id,
        businessId: v.businessId,
        name: v.business?.name ?? v.shopName ?? '',
        locality: v.business?.locality ?? null,
        revisitOn: keyFromDate(v.revisitOn),
        revisitTime: v.revisitTime,
        coverFor: v.staffId !== staffId ? v.staffId : null,
        note: v.note,
        lastVisitAt: v.visitedAt.toISOString(),
      });
    }
    const coverIds = [...new Set(result.map((r) => r.coverFor).filter((id): id is string => Boolean(id)))];
    if (coverIds.length) {
      const names = new Map((await this.prisma.staff.findMany({ where: { id: { in: coverIds } }, select: { id: true, name: true } })).map((p) => [p.id, firstName(p.name)]));
      for (const r of result) if (r.coverFor) r.coverFor = names.get(r.coverFor) ?? null;
    }
    return result;
  }
}
