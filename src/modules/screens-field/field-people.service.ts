import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { peopleOwnedBy } from '../../common/rbac/own-team';
import { phoneLast4 } from '../../common/phone/indian-mobile';
import { refundGuaranteeDeadline } from '../../common/money/money';
import { agentViewerFor, fieldAgentCanAct } from '../business/business-agent-view';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { PricingService } from '../pricing/pricing.service';
import { ProfileStuckService, StuckView } from '../profile-stuck/profile-stuck.service';
import { REVISIT_OUTCOMES } from '../field-visit/field-visit.constants';
import { DAY_MS, FieldVisitClock, istDateKey, keyFromDate } from '../field-visit/field-visit-clock';
import { BusinessNextStep, FieldRedesignService } from './field-redesign.service';

type Actor = { sub: string; role: string };

/** Which filter chip a row sits under (Laboura Field lists, 22 Nov): All · Needs action · Waiting for Team Lead · Active · Done. */
export type ListGroup = 'needs_action' | 'waiting_tl' | 'active' | 'done';

/** The one next-step button a business row may show. Each opens an existing screen or calls an existing route. */
export type BusinessRowAction = 'agreement_link' | 'confirm_vacancy' | 'add_shifts' | 'add_vacancy' | 'show_candidates' | 'record_visit';

/** Where a business stands, in one plain-words line (the app has the words). */
export type BusinessRowStatus =
  | 'suspended'
  | 'paused'
  | 'agreement_not_sent'
  | 'agreement_waiting'
  | 'agreement_expired'
  | 'vacancy_to_confirm'
  | 'vacancy_to_send'
  | 'waiting_tl'
  | 'visit_outside_area'
  | 'not_verified'
  | 'no_shifts'
  | 'no_vacancy'
  | 'ready'
  | 'candidates_shown'
  | 'all_good';

export interface BusinessRowState {
  status: BusinessRowStatus;
  action: BusinessRowAction | null;
  /** The vacancy the button is about (confirm_vacancy, show_candidates). */
  vacancyId: string | null;
  /** Nothing to do but wait (the Team Lead): the row shows "Waiting", never a button. */
  waiting: boolean;
  /** Onboarding finished and nothing to do: the row shows "Done". */
  done: boolean;
  group: ListGroup;
}

/** The one next-step button a job seeker row may show (existing routes and screens). */
export type SeekerRowAction = 'registration_link' | 'payment_link' | 'scan_aadhaar' | 'book_interview';

export type SeekerRowStatus =
  | 'link_not_sent'
  | 'link_not_finished'
  | 'waiting_tl'
  | 'id_check_needed'
  | 'id_stopped'
  | 'stuck_payment'
  | 'trade_waiting'
  | 'active'
  | 'interview_booked'
  | 'placed'
  | 'closed';

export interface SeekerRowState {
  status: SeekerRowStatus;
  action: SeekerRowAction | null;
  /** book_interview: the vacancy he was shown for. */
  vacancyId: string | null;
  waiting: boolean;
  done: boolean;
  group: ListGroup;
}

const ROW_ORDER: Record<ListGroup, number> = { needs_action: 0, waiting_tl: 1, active: 2, done: 3 };
const OPEN_INTERVIEW = ['offered', 'confirmed'];
const LIVE_PLACEMENT_EXCLUDE = ['cancelled', 'awaiting_payment'];
const ENDED_SEEKER = ['deactivated', 'closed', 'banned', 'refunded', 'anonymised'];
const PAGE_HISTORY_LIMIT = 30;

/** Needs action first, then the rest; within a group the server's own order (newest first) stays. */
export function sortRows<T extends { row: { group: ListGroup } }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ROW_ORDER[a.r.row.group] - ROW_ORDER[b.r.row.group] || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * A business row's status line and its one button, from the server's next step
 * (FieldRedesignService.businessNextStep). `freshVacancy`: an open vacancy no
 * candidate was shown for yet; `shifts`: how many shifts the business has (a
 * vacancy picks one, so with none the next step is Add shifts).
 */
export function businessRowState(step: BusinessNextStep, ctx: { canAct: boolean; shifts: number; freshVacancy: boolean }): BusinessRowState {
  const base = { vacancyId: null, waiting: false, done: false } as const;
  const act = (status: BusinessRowStatus, action: BusinessRowAction, vacancyId: string | null = null, group: ListGroup = 'needs_action'): BusinessRowState =>
    ctx.canAct ? { ...base, status, action, vacancyId, group } : { ...base, status, action: null, vacancyId: null, group: group === 'needs_action' ? 'active' : group };
  switch (step.kind) {
    case 'suspended':
    case 'paused':
      return { ...base, status: step.kind, action: null, group: 'active' };
    case 'agreement_waiting':
      return act(step.agreementState === 'not_sent' ? 'agreement_not_sent' : step.agreementState === 'link_expired' ? 'agreement_expired' : 'agreement_waiting', 'agreement_link');
    case 'vacancy_to_confirm':
      return act('vacancy_to_confirm', 'confirm_vacancy', step.vacancyId);
    case 'vacancy_to_send':
      return act('vacancy_to_send', 'confirm_vacancy', step.vacancyId);
    case 'waiting_tl_check':
      return { ...base, status: 'waiting_tl', action: null, waiting: true, group: 'waiting_tl' };
    case 'candidates_hidden':
      return act(step.reason === 'visit_outside_area' ? 'visit_outside_area' : 'not_verified', 'record_visit');
    case 'add_vacancy':
      return ctx.shifts === 0 ? act('no_shifts', 'add_shifts') : act('no_vacancy', 'add_vacancy');
    case 'ready_show_candidates':
      return ctx.freshVacancy ? act('ready', 'show_candidates', step.vacancyId) : act('candidates_shown', 'show_candidates', step.vacancyId, 'active');
    default:
      return { ...base, status: 'all_good', action: null, done: true, group: 'done' };
  }
}

/**
 * A job seeker row's status line and its one button. Before payment it follows
 * "Where they're stuck" (ProfileStuckService, the same steps as the office
 * profiles): link not finished → Resend link; ID check → Scan Aadhaar QR, or
 * Waiting while the Team Lead checks another ID; payment → Send payment link.
 * After payment: placed, an interview booked, a business he was shown to with
 * no interview yet (Book interview), or active.
 */
export function seekerRowState(input: {
  status: string;
  stuck: Pick<StuckView, 'step' | 'state' | 'reason' | 'waitingForTeamLead'> | null;
  linkSent: boolean;
  placed: boolean;
  nextInterviewAt: Date | null;
  bookableVacancyId: string | null;
}): SeekerRowState {
  const base = { action: null, vacancyId: null, waiting: false, done: false } as const;
  if (input.placed) return { ...base, status: 'placed', done: true, group: 'done' };
  if (ENDED_SEEKER.includes(input.status) || input.stuck?.step === 'closed') return { ...base, status: 'closed', group: 'done' };
  const s = input.stuck;
  if (!s || s.step === 'complete') {
    if (input.nextInterviewAt) return { ...base, status: 'interview_booked', done: true, group: 'active' };
    if (input.bookableVacancyId) return { ...base, status: 'active', action: 'book_interview', vacancyId: input.bookableVacancyId, group: 'needs_action' };
    return { ...base, status: 'active', done: true, group: 'active' };
  }
  if (s.step === 'id_check') {
    if (s.waitingForTeamLead) return { ...base, status: 'waiting_tl', waiting: true, group: 'waiting_tl' };
    // Under 18: registration stops (only a Manager or the CEO can lift it). Nothing to send.
    if (s.state === 'stuck' && /18/.test(s.reason ?? '')) return { ...base, status: 'id_stopped', group: 'done' };
    return { ...base, status: 'id_check_needed', action: 'scan_aadhaar', group: 'needs_action' };
  }
  if (s.step === 'payment') {
    // Waiting for a new trade to be added in the Command Center: nothing to send until it is.
    if (s.state === 'stuck') return { ...base, status: 'trade_waiting', waiting: true, group: 'active' };
    return { ...base, status: 'stuck_payment', action: 'payment_link', group: 'needs_action' };
  }
  return { ...base, status: input.linkSent ? 'link_not_finished' : 'link_not_sent', action: 'registration_link', group: 'needs_action' };
}

/**
 * Laboura Field lists (Master Guide, "Laboura Field lists, decided 22 Nov
 * evening"): the Businesses and Job seekers tabs list the agent's own people,
 * each with its name, one plain status line, a few numbers and either "Done",
 * "Waiting" (the Team Lead) or ONE next-step button; needs-action rows first.
 * Tapping a row opens the profile (GET /field-work/job-seekers/:ref/page for a
 * job seeker; the business page for a business) with "Where they're stuck" and
 * the remaining steps as buttons. One list endpoint per tab, scoped to the
 * agent; phone numbers leave as their last 4 digits; no rupee amounts.
 */
@Injectable()
export class FieldPeopleService {
  private readonly logger = new Logger(FieldPeopleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: FieldVisitClock,
    private readonly redesign: FieldRedesignService,
    private readonly stuck: ProfileStuckService,
    private readonly pricing: PricingService,
    @Optional() @Inject(CANDIDATE_PHOTO_STORAGE) private readonly photos?: CandidatePhotoStorage,
  ) {}

  // ------------------------------------------------------------ Businesses

  /** GET /field-work/businesses: my businesses (FA09) with type, numbers, last visit and the row's status and button. */
  async businesses(actor: Actor, q?: string) {
    const list = await this.redesign.myBusinesses(actor, q);
    const ids = list.results.map((b) => b.id);
    if (!ids.length) return { ...list, results: [] };
    const now = this.clock.now();
    const todayKey = istDateKey(now);
    const [details, shifts, shown, latestVisits, viewer] = await Promise.all([
      this.prisma.business.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, businessType: true, businessTypeOther: true, accountAgentId: true, leadCreatedByStaffId: true, verificationStatus: true,
          vacancies: { where: { status: 'open' }, select: { id: true } },
        },
      }),
      this.prisma.businessShift.groupBy({ by: ['businessId'], where: { businessId: { in: ids } }, _count: { _all: true } }),
      this.prisma.candidateIntroduction.groupBy({ by: ['vacancyId', 'businessId'], where: { businessId: { in: ids } }, _count: { _all: true } }),
      this.prisma.businessVisit.findMany({
        where: { businessId: { in: ids } },
        orderBy: { visitedAt: 'desc' },
        distinct: ['businessId'],
        select: { businessId: true, visitedAt: true, outcome: true, revisitOn: true, revisitClosedAt: true },
      }),
      agentViewerFor(this.prisma, actor.sub, 'field_agent'),
    ]);
    const byId = new Map(details.map((d) => [d.id, d]));
    const shiftCount = new Map(shifts.map((s) => [s.businessId, s._count._all]));
    const shownByBusiness = new Map<string, number>();
    const shownVacancies = new Set<string>();
    for (const s of shown) {
      shownByBusiness.set(s.businessId, (shownByBusiness.get(s.businessId) ?? 0) + s._count._all);
      shownVacancies.add(s.vacancyId);
    }
    const lastVisit = new Map(latestVisits.map((v) => [v.businessId!, v]));
    const results = list.results.map((b) => {
      const d = byId.get(b.id);
      const visit = lastVisit.get(b.id);
      const revisitKey = visit?.revisitOn ? keyFromDate(visit.revisitOn) : null;
      const canAct = d ? fieldAgentCanAct(d, viewer) : false;
      return {
        ...b,
        businessType: d?.businessType ?? null,
        businessTypeOther: d?.businessTypeOther ?? null,
        candidatesShown: shownByBusiness.get(b.id) ?? 0,
        lastVisitAt: visit?.visitedAt.toISOString() ?? null,
        revisitOverdue: Boolean(
          visit && revisitKey && revisitKey < todayKey && !visit.revisitClosedAt && REVISIT_OUTCOMES.includes(visit.outcome ?? ''),
        ),
        canAct,
        row: businessRowState(b.nextStep, {
          canAct,
          shifts: shiftCount.get(b.id) ?? 0,
          freshVacancy: (d?.vacancies ?? []).some((v) => !shownVacancies.has(v.id)),
        }),
      };
    });
    return { ...list, results: sortRows(results) };
  }

  /** GET /field-work/businesses/:ref/page: the business page plus its "Where they're stuck" state (the row's). */
  async businessPage(actor: Actor, ref: string) {
    const page = await this.redesign.businessPage(actor, ref);
    const [shifts, shown] = await Promise.all([
      this.prisma.businessShift.count({ where: { businessId: page.id } }),
      this.prisma.candidateIntroduction.findMany({ where: { businessId: page.id }, distinct: ['vacancyId'], select: { vacancyId: true } }),
    ]);
    const shownVacancies = new Set(shown.map((s) => s.vacancyId));
    const open = page.vacancies.filter((v: { status: string }) => v.status === 'open') as Array<{ id: string }>;
    return {
      ...page,
      row: businessRowState(page.nextStep as BusinessNextStep, { canAct: page.canAct, shifts, freshVacancy: open.some((v) => !shownVacancies.has(v.id)) }),
    };
  }

  // ----------------------------------------------------------- Job seekers

  /** GET /field-work/job-seekers: my job seekers (FA10d) with photo, trade, area, status line, guarantee day, hits and the row's button. */
  async jobSeekers(actor: Actor, q?: string) {
    const list = await this.redesign.myJobSeekers(actor, q);
    const ids = list.results.map((s) => s.id);
    if (!ids.length) return { ...list, results: [] };
    const now = this.clock.now();
    const [extra, policy] = await Promise.all([this.seekerExtras(ids, now), this.pricing.current()]);
    const results = await Promise.all(
      list.results.map(async (s) => {
        const e = extra.get(s.id)!;
        const unpaid = !s.steps.paidAt && !ENDED_SEEKER.includes(s.status) && s.status !== 'active';
        const stuck = unpaid ? await this.stuckOf(s.id).catch(() => null) : null;
        const row = seekerRowState({
          status: s.status,
          stuck,
          linkSent: Boolean(s.steps.linkSentAt),
          placed: s.steps.placed,
          nextInterviewAt: e.nextInterviewAt,
          bookableVacancyId: e.bookableVacancyId,
        });
        return {
          ...s,
          photoUrl: await this.photoUrl(e.photoStoragePath),
          trade: e.trade,
          yearsExperience: e.yearsExperience,
          locality: e.locality,
          hits: e.hits,
          guarantee: this.guarantee(e.paidAt, s.status, policy.jobSeekerGuaranteeDays, now),
          nextInterviewAt: e.nextInterviewAt?.toISOString() ?? null,
          row,
        };
      }),
    );
    return { ...list, results: sortRows(results) };
  }

  /**
   * GET /field-work/job-seekers/:ref/page — FA10e, the job seeker's profile in Laboura Field:
   * photo, name, trade, area; "Where they're stuck" (the same steps as the office profiles)
   * with the row's next step; details; guarantee day and hits once paid; interviews and
   * placements; history. His own job seekers only (registered by him or assigned to him).
   */
  async jobSeekerPage(actor: Actor, ref: string) {
    const key = String(ref ?? '').trim();
    if (!key || key.length > 64) throw new NotFoundException('Job seeker not found');
    const seeker = await this.prisma.jobSeeker.findFirst({
      where: { AND: [peopleOwnedBy([actor.sub]), { anonymisedAt: null }, { OR: [{ id: key }, { code: key.toUpperCase() }] }] },
      select: {
        id: true, code: true, name: true, phone: true, status: true, createdAt: true, paymentReceivedAt: true, hitCount: true,
        photoStoragePath: true, locality: true, gender: true, dateOfBirth: true, shiftPreference: true, jobType: true, travelDistanceKm: true,
        lastRole: true, lastEmployer: true, availableFrom: true, registeredByStaffId: true, assignedStaffId: true,
        trades: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { trade: true, yearsExperience: true, isPrimary: true } },
        languages: { select: { language: true, speaks: true } },
        identityVerifications: { orderBy: { createdAt: 'asc' }, select: { status: true, method: true, createdAt: true, verifiedAt: true } },
      },
    });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    const now = this.clock.now();
    const [extra, policy, interviews, placements, links, consent] = await Promise.all([
      this.seekerExtras([seeker.id], now),
      this.pricing.current(),
      this.prisma.interview.findMany({
        where: { jobSeekerId: seeker.id },
        orderBy: { slotStartsAt: 'desc' },
        take: 10,
        select: { id: true, code: true, slotStartsAt: true, status: true, result: true, createdAt: true, business: { select: { name: true } }, vacancy: { select: { tradeSkill: true } } },
      }),
      this.prisma.placement.findMany({
        where: { jobSeekerId: seeker.id, status: { not: 'cancelled' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, code: true, status: true, joiningDate: true, createdAt: true, business: { select: { name: true } }, vacancy: { select: { tradeSkill: true } } },
      }),
      this.prisma.publicLink.findMany({
        where: { purpose: 'registration', subjectType: 'job_seeker', subjectId: seeker.id },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.consent.findFirst({
        where: { subjectType: 'job_seeker', subjectId: seeker.id, granted: true, grantedAt: { not: null } },
        orderBy: { grantedAt: 'asc' },
        select: { grantedAt: true },
      }),
    ]);
    const e = extra.get(seeker.id)!;
    const stuck = await this.stuckOf(seeker.id);
    const placed = placements.some((p) => !LIVE_PLACEMENT_EXCLUDE.includes(p.status));
    const row = seekerRowState({
      status: seeker.status,
      stuck: seeker.paymentReceivedAt ? null : stuck,
      linkSent: links.length > 0,
      placed,
      nextInterviewAt: e.nextInterviewAt,
      bookableVacancyId: e.bookableVacancyId,
    });
    type Event = { at: string; kind: string; detail: string | null };
    const history: Event[] = [{ at: seeker.createdAt.toISOString(), kind: 'registered', detail: null }];
    for (const l of links) history.push({ at: l.createdAt.toISOString(), kind: 'link_sent', detail: null });
    if (consent?.grantedAt) history.push({ at: consent.grantedAt.toISOString(), kind: 'consent', detail: null });
    for (const v of seeker.identityVerifications) {
      history.push({ at: v.createdAt.toISOString(), kind: 'id_sent', detail: v.method ?? null });
      if (v.status === 'verified' && v.verifiedAt) history.push({ at: v.verifiedAt.toISOString(), kind: 'id_checked', detail: v.method ?? null });
    }
    if (seeker.paymentReceivedAt) history.push({ at: seeker.paymentReceivedAt.toISOString(), kind: 'paid', detail: null });
    for (const i of interviews) history.push({ at: i.createdAt.toISOString(), kind: 'interview_booked', detail: i.business.name });
    for (const p of placements) history.push({ at: p.createdAt.toISOString(), kind: 'placement', detail: p.business.name });
    history.sort((a, b) => b.at.localeCompare(a.at));
    const primary = seeker.trades[0] ?? null;
    return {
      id: seeker.id,
      code: seeker.code,
      name: seeker.name,
      phoneLast4: phoneLast4(seeker.phone),
      photoUrl: await this.photoUrl(seeker.photoStoragePath),
      status: seeker.status,
      registeredAt: seeker.createdAt.toISOString(),
      registeredByMe: seeker.registeredByStaffId === actor.sub,
      trade: primary?.trade ?? null,
      yearsExperience: primary?.yearsExperience ?? null,
      otherTrades: seeker.trades.slice(1).map((t) => t.trade),
      locality: seeker.locality,
      details: {
        gender: seeker.gender,
        age: seeker.dateOfBirth ? ageOn(seeker.dateOfBirth, now) : null,
        languages: seeker.languages.filter((l) => l.speaks).map((l) => l.language),
        shift: seeker.shiftPreference,
        jobType: seeker.jobType,
        travelDistanceKm: seeker.travelDistanceKm,
        lastRole: seeker.lastRole,
        lastEmployer: seeker.lastEmployer,
        availableFrom: seeker.availableFrom ? keyFromDate(seeker.availableFrom) : null,
      },
      stuck: { step: stuck.step, state: stuck.state, reason: stuck.reason, waitingForTeamLead: stuck.waitingForTeamLead, actions: stuck.actions },
      row,
      hits: seeker.hitCount,
      guarantee: this.guarantee(seeker.paymentReceivedAt, seeker.status, policy.jobSeekerGuaranteeDays, now),
      nextInterviewAt: e.nextInterviewAt?.toISOString() ?? null,
      interviews: interviews.map((i) => ({
        id: i.id,
        code: i.code,
        startsAt: i.slotStartsAt.toISOString(),
        status: i.status,
        result: i.result,
        businessName: i.business.name,
        trade: i.vacancy.tradeSkill,
      })),
      placements: placements.map((p) => ({
        id: p.id,
        code: p.code,
        status: p.status,
        joiningDate: p.joiningDate ? keyFromDate(p.joiningDate) : null,
        businessName: p.business.name,
        trade: p.vacancy.tradeSkill,
      })),
      history: history.slice(0, PAGE_HISTORY_LIMIT),
    };
  }

  // ------------------------------------------------------------- helpers

  /** "Where they're stuck" for one job seeker (the list catches a failure so one row never breaks it). */
  private async stuckOf(id: string): Promise<StuckView> {
    return this.stuck.forJobSeeker(id);
  }

  /** "Day X of 30" once paid, while the guarantee runs (no amounts). */
  private guarantee(paidAt: Date | null, status: string, days: number, now: Date): { day: number; days: number; endsAt: string } | null {
    if (!paidAt || ENDED_SEEKER.includes(status)) return null;
    const deadline = refundGuaranteeDeadline(paidAt, days);
    const day = Math.min(days, Math.max(1, days - Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS)));
    return { day, days, endsAt: deadline.toISOString() };
  }

  /** A signed link (5 minutes) to his live selfie, or null; a storage failure only hides the photo. */
  private async photoUrl(path: string | null): Promise<string | null> {
    if (!path || !this.photos) return null;
    try {
      return await this.photos.signedUrl(path, CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Selfie link failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** Photo, primary trade and experience, area, hits, next interview and a vacancy he can be booked for. */
  private async seekerExtras(ids: string[], now: Date) {
    const [seekers, upcoming, intros, interviewed] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, photoStoragePath: true, locality: true, hitCount: true, paymentReceivedAt: true,
          trades: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1, select: { trade: true, yearsExperience: true } },
        },
      }),
      this.prisma.interview.findMany({
        where: { jobSeekerId: { in: ids }, status: { in: OPEN_INTERVIEW }, slotStartsAt: { gte: now } },
        orderBy: { slotStartsAt: 'asc' },
        select: { jobSeekerId: true, slotStartsAt: true },
      }),
      // Shown to a business for a vacancy still open: "Book interview" unless he already has one there.
      this.prisma.candidateIntroduction.findMany({
        where: { jobSeekerId: { in: ids }, vacancy: { status: 'open' } },
        orderBy: { shownAt: 'desc' },
        select: { jobSeekerId: true, vacancyId: true },
      }),
      this.prisma.interview.findMany({ where: { jobSeekerId: { in: ids } }, select: { jobSeekerId: true, vacancyId: true } }),
    ]);
    const next = new Map<string, Date>();
    for (const i of upcoming) if (!next.has(i.jobSeekerId)) next.set(i.jobSeekerId, i.slotStartsAt);
    const had = new Set(interviewed.map((i) => `${i.jobSeekerId}:${i.vacancyId}`));
    const bookable = new Map<string, string>();
    for (const i of intros) if (!bookable.has(i.jobSeekerId) && !had.has(`${i.jobSeekerId}:${i.vacancyId}`)) bookable.set(i.jobSeekerId, i.vacancyId);
    return new Map(
      seekers.map((s) => [
        s.id,
        {
          photoStoragePath: s.photoStoragePath,
          trade: s.trades[0]?.trade ?? null,
          yearsExperience: s.trades[0]?.yearsExperience ?? null,
          locality: s.locality,
          hits: s.hitCount,
          paidAt: s.paymentReceivedAt,
          nextInterviewAt: next.get(s.id) ?? null,
          bookableVacancyId: s.paymentReceivedAt ? (bookable.get(s.id) ?? null) : null,
        },
      ]),
    );
  }
}

function ageOn(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}
