import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { codedError } from '../../common/http/coded-error';
import { phoneLast4 } from '../../common/phone/indian-mobile';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { AgentViewer, agentViewerFor, fieldAgentCanAct } from '../business/business-agent-view';
import { businessCandidateAccess, isBusinessSuspended } from '../business/business-candidate-access';
import { isVerificationVisitPurpose } from '../business/business.constants';
import { AttendanceService } from '../attendance/attendance.service';
import { ConsentLinkService } from '../consent/consent-link.service';
import { LEGAL_DOCUMENT_VERSIONS } from '../legal/legal-documents';
import { FieldAgentMetricsService } from '../target/field-agent-metrics.service';
import { VacancyConfirmationService } from '../vacancy/vacancy-confirmation.service';
import { REVISIT_OUTCOMES } from '../field-visit/field-visit.constants';
import { DAY_MS, FieldVisitClock, istDateKey, istDayStart, keyFromDate } from '../field-visit/field-visit-clock';
import { visitNextStep } from '../field-visit/field-visit.service';

type Actor = { sub: string; role: string };

/** Rev 188 agreement resend: one link a minute and five a day per business. */
export const AGREEMENT_RESEND_MIN_GAP_MS = 60 * 1000;
export const AGREEMENT_RESEND_MAX_PER_DAY = 5;
/** Today's work: how far back the date picker may go. */
export const DAY_MAX_DAYS_BACK = 90;
/** Needs you now: unfinished visits from this many days back. */
const UNFINISHED_VISIT_DAYS = 7;
const LIST_LIMIT = 100;
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
    | 'visit_unfinished'
    | 'agreement_waiting'
    | 'vacancy_awaiting_owner'
    | 'vacancy_draft'
    | 'ready_show_candidates'
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
  'visit_unfinished',
  'agreement_waiting',
  'vacancy_awaiting_owner',
  'vacancy_draft',
  'ready_show_candidates',
  'joining_due',
  'revisit_due',
  'followup_task',
];
const DUE_ORDER: Record<string, number> = { overdue: 0, today: 1, tomorrow: 2 };

type BusinessForStep = {
  id: string;
  verificationStatus: string | null;
  pausedAt: Date | null;
  suspendedAt: Date | null;
  suspendedUntil: Date | null;
  inPersonOnboardedAt: Date | null;
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
   * Today's numbers, counted from records (never typed). Onboarded counts a visit of
   * mine marked onboarded that day or a business I registered from a shop visit that
   * day (B3/B24), each business once.
   */
  async numbersFor(staffId: string, window: { gte: Date; lt: Date }) {
    const [shopsVisited, onboardedVisits, registered, vacanciesConfirmed, candidatesShown, interviewsBooked, attended] =
      await Promise.all([
        this.prisma.businessVisit.count({
          where: { staffId, visitedAt: window, OR: [{ boardPhotoHash: { not: null } }, { selfieHash: { not: null } }] },
        }),
        this.prisma.businessVisit.findMany({
          where: { staffId, outcome: 'onboarded', outcomeRecordedAt: window, businessId: { not: null } },
          select: { businessId: true },
          distinct: ['businessId'],
        }),
        this.prisma.business.findMany({
          where: { leadCreatedByStaffId: staffId, leadChannel: 'field_visit', createdAt: window },
          select: { id: true },
        }),
        this.prisma.vacancy.count({ where: { capturedByStaffId: staffId, confirmedAt: window } }),
        this.prisma.candidateIntroduction.count({ where: { shownByStaffId: staffId, shownAt: window } }),
        this.prisma.interview.count({ where: { proposedByStaffId: staffId, createdAt: window } }),
        this.attendedInterviews(staffId, window),
      ]);
    const onboarded = new Set<string>([...onboardedVisits.map((v) => v.businessId!), ...registered.map((b) => b.id)]);
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
        suspendedAt: true, suspendedUntil: true, inPersonOnboardedAt: true, accountAgentId: true, leadCreatedByStaffId: true,
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
    const shown = await this.shownByVacancy(openIds);
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
    }

    // Interviews at a shop today that I attend.
    const interviewAssignments = await this.prisma.visitAssignment.findMany({
      where: { assignedStaffId: staffId, relatedType: 'interview', relatedId: { not: null } },
      select: { relatedId: true },
    });
    const interviewsToday = await this.prisma.interview.findMany({
      where: {
        slotStartsAt: { gte: dayStart, lt: dayEnd },
        status: { in: ['offered', 'confirmed'] },
        candidateArrivedAt: null,
        resultRecordedAt: null,
        OR: [
          { id: { in: interviewAssignments.map((a) => a.relatedId!) } },
          { proposedByStaffId: staffId, agentWillAttend: true },
        ],
      },
      orderBy: { slotStartsAt: 'asc' },
      select: { id: true, code: true, slotStartsAt: true, jobSeeker: { select: { name: true } }, business: { select: { id: true, name: true, locality: true } } },
    });
    for (const i of interviewsToday) {
      items.push({
        id: `interview_today:${i.id}`, kind: 'interview_today', title: i.business.name, subtitle: i.business.locality,
        at: i.slotStartsAt.toISOString(), due: 'today',
        target: { type: 'interview', id: i.id, step: 'attend', businessId: i.business.id },
        interview: { code: i.code, startsAt: i.slotStartsAt.toISOString(), candidateName: shortName(i.jobSeeker.name) },
      });
    }

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
        const open = await this.prisma.visitAssignment.findFirst({
          where: { id: v.assignmentId, assignedStaffId: staffId, status: 'assigned' },
          select: { id: true },
        });
        if (!open) continue;
      }
      const startedAt = v.startedAt ?? v.visitedAt;
      items.push({
        id: `visit_unfinished:${v.id}`, kind: 'visit_unfinished', title: v.business?.name ?? v.shopName ?? '',
        subtitle: v.business?.locality ?? null, at: startedAt.toISOString(),
        due: whenOf(istDateKey(startedAt), todayKey, tomorrowKey),
        target: { type: 'visit', id: v.id, step, businessId: v.businessId },
        visit: { startedAt: startedAt.toISOString(), purpose: v.purpose },
      });
    }

    // Joinings to confirm by tomorrow.
    const joinings = await this.prisma.placement.findMany({
      where: {
        joinedDate: null,
        joiningDate: { lt: tomorrowEnd },
        status: { in: ['confirmed', 'active'] },
        OR: [{ createdByStaffId: staffId }, { business: { accountAgentId: staffId } }],
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
        id: `revisit_due:${r.visitId}`, kind: 'revisit_due', title: r.name, subtitle: r.locality,
        at: r.revisitOn ? `${r.revisitOn}T00:00:00.000+05:30` : null,
        due: r.revisitOn ? whenOf(r.revisitOn, todayKey, tomorrowKey) : null,
        target: { type: 'revisit', id: r.visitId, step: 'start_visit', businessId: r.businessId },
        revisitOn: r.revisitOn,
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
        id: `followup_task:${t.id}`, kind: 'followup_task', title: names.get(t.subjectId) ?? '', subtitle: null,
        at: t.dueAt.toISOString(), due: whenOf(istDateKey(t.dueAt), todayKey, tomorrowKey),
        target: {
          type: 'followup', id: t.id, step: t.kind,
          subjectType: t.subjectType, subjectId: t.subjectId, relatedType: t.relatedType, relatedId: t.relatedId,
        },
        taskKind: t.kind,
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
        const due = (DUE_ORDER[a.due ?? ''] ?? 3) - (DUE_ORDER[b.due ?? ''] ?? 3);
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

    const [visits, businesses, seekers, partners, added, confirmed, intros, booked, attended] = await Promise.all([
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
      this.prisma.vacancy.findMany({
        where: { capturedByStaffId: staffId, createdAt: window },
        select: { id: true, code: true, tradeSkill: true, status: true, createdAt: true, business: { select: { id: true, name: true } } },
      }),
      this.prisma.vacancy.findMany({
        where: { capturedByStaffId: staffId, confirmedAt: window },
        select: { id: true, code: true, tradeSkill: true, status: true, confirmedAt: true, business: { select: { id: true, name: true } } },
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
      target: Record<string, unknown>; count?: number;
    };
    const items: DayItem[] = [];
    for (const v of visits) {
      items.push({
        type: 'visit', id: `visit:${v.id}`, at: (v.startedAt ?? v.visitedAt).toISOString(),
        title: v.business?.name ?? v.shopName ?? '', subtitle: v.business?.locality ?? null,
        status: v.outcome ?? 'unfinished', target: { type: 'visit', id: v.id },
      });
    }
    for (const b of businesses) {
      items.push({
        type: 'business_registered', id: `business:${b.id}`, at: b.createdAt.toISOString(), title: b.name,
        subtitle: b.locality, status: b.verificationStatus, target: { type: 'business', id: b.id },
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
    for (const v of added) {
      items.push({
        type: 'vacancy_added', id: `vacancy_added:${v.id}`, at: v.createdAt.toISOString(), title: v.business.name,
        subtitle: v.tradeSkill, status: v.status, target: { type: 'vacancy', id: v.id, businessId: v.business.id },
      });
    }
    for (const v of confirmed) {
      items.push({
        type: 'vacancy_confirmed', id: `vacancy_confirmed:${v.id}`, at: v.confirmedAt!.toISOString(), title: v.business.name,
        subtitle: v.tradeSkill, status: v.status, target: { type: 'vacancy', id: v.id, businessId: v.business.id },
      });
    }
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
      visit: 0, business_registered: 0, job_seeker_registered: 0, referral_registered: 0, vacancy_added: 0,
      vacancy_confirmed: 0, candidates_shown: 0, interview_booked: 0, interview_attended: 0,
    };
    for (const item of items) counts[item.type] += 1;
    return { date: key, isToday: key === todayKey, counts, items };
  }

  // ------------------------------------------------------- My businesses

  /** The businesses this agent works on (account agent, or his lead with no account agent). */
  private myBusinessesWhere(staffId: string): Prisma.BusinessWhereInput {
    return { OR: [{ accountAgentId: staffId }, { accountAgentId: null, leadCreatedByStaffId: staffId }] };
  }

  async myBusinesses(actor: Actor, q?: string) {
    const now = this.clock.now();
    const query = (q ?? '').trim();
    const filters: Prisma.BusinessWhereInput[] = [this.myBusinessesWhere(actor.sub), { anonymisedAt: null }];
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
        suspendedUntil: true, inPersonOnboardedAt: true, leadChannel: true, accountAgentId: true,
        vacancies: {
          where: { status: { in: ['draft', 'awaiting_confirmation', 'open'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, status: true, headcount: true },
        },
      },
    });
    const ids = rows.map((b) => b.id);
    const [agreements, shown, outside] = await Promise.all([
      this.agreementInfos(ids, now),
      this.shownByVacancy(rows.flatMap((b) => b.vacancies.filter((v) => v.status === 'open').map((v) => v.id))),
      this.outsideAreaBusinesses(rows),
    ]);
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
      recentInterviews, placements, inGuarantee, visits, outside, confirmLinks] = await Promise.all([
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
          ? await this.confirmation.checkLegalMinimum(v.tradeSkill, v.salaryMinPaise, v.salaryPeriod)
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
            language: business.contactLanguage,
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
      visits: visits.map((v) => ({
        id: v.id,
        at: (v.startedAt ?? v.visitedAt).toISOString(),
        durationSeconds: v.durationSeconds,
        purpose: v.purpose,
        outcome: v.outcome,
        staffName: v.staff?.name ?? null,
        mine: v.staffId === actor.sub,
        hasBoardPhoto: Boolean(v.boardPhotoHash),
        hasSelfie: Boolean(v.selfieHash),
      })),
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
    const resend = this.resendWindow(agreement, now);
    if (!resend.allowedNow) {
      throw codedError(
        HttpStatus.TOO_MANY_REQUESTS,
        resend.limit === 'gap' ? 'AGREEMENT_RESEND_TOO_SOON' : 'AGREEMENT_RESEND_LIMIT',
        resend.limit === 'gap'
          ? 'A link was just sent. Wait a minute before sending another.'
          : `At most ${AGREEMENT_RESEND_MAX_PER_DAY} agreement links a day for one business.`,
        { retryAt: resend.retryAt?.toISOString() ?? null },
      );
    }
    const requested = (body?.language ?? '').trim();
    const language = requested || (['kn', 'en', 'hi'].includes(business.contactLanguage ?? '') ? business.contactLanguage! : 'en');
    const issued = await this.consentLinks.createAgreementLink(business.id, actor.sub, language);
    if (issued.smsSent === false) {
      // Nothing reached the owner: this link is withdrawn (it never counts towards the limit).
      await this.prisma.publicLink.updateMany({ where: { id: issued.linkId, usedAt: null }, data: { revokedAt: now } });
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

  private resendWindow(agreement: AgreementInfo, now: Date): { allowedNow: boolean; retryAt: Date | null; limit: 'gap' | 'day' | null } {
    const latest = agreement.recentLinks[0];
    if (latest && now.getTime() - latest.getTime() < AGREEMENT_RESEND_MIN_GAP_MS) {
      return { allowedNow: false, retryAt: new Date(latest.getTime() + AGREEMENT_RESEND_MIN_GAP_MS), limit: 'gap' };
    }
    if (agreement.recentLinks.length >= AGREEMENT_RESEND_MAX_PER_DAY) {
      const oldest = agreement.recentLinks[AGREEMENT_RESEND_MAX_PER_DAY - 1];
      return { allowedNow: false, retryAt: new Date(oldest.getTime() + DAY_MS), limit: 'day' };
    }
    return { allowedNow: true, retryAt: null, limit: null };
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
    const filters: Prisma.JobSeekerWhereInput[] = [{ registeredByStaffId: actor.sub }, { anonymisedAt: null }];
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
    const rows = await this.prisma.businessVisit.findMany({
      where: { staffId, outcome: { in: [...REVISIT_OUTCOMES] }, revisitOn: { lte: new Date(`${byKey}T00:00:00.000Z`) } },
      orderBy: { visitedAt: 'desc' },
      include: { business: { select: { id: true, name: true, locality: true } } },
      take: 200,
    });
    const result: Array<{ visitId: string; businessId: string | null; name: string; locality: string | null; revisitOn: string | null }> = [];
    const seen = new Set<string>();
    for (const v of rows) {
      const shopKey = v.businessId ?? v.id;
      if (seen.has(shopKey)) continue;
      seen.add(shopKey);
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
      });
    }
    return result;
  }
}
