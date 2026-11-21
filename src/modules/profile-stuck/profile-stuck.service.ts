import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { eitherWheres, RecordWheres } from '../ceo-portal/record-scope';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { ManagerRecordsService } from '../screens-manager/manager-records.service';
import { TeamLeadRecordsService } from '../screens-team-lead/team-lead-records.service';

export type StuckKind = 'job_seeker' | 'business' | 'referral';
const KINDS: readonly StuckKind[] = ['job_seeker', 'business', 'referral'];

/**
 * The buttons the box may show. Each is an EXISTING route with its own
 * permissions (nothing new is sent from here):
 *   registration_link   POST /consent/links {jobSeekerId}
 *   payment_link        POST /job-seekers/:id/resend-payment
 *   someone_else_pays   POST /job-seekers/:id/payment-only-link {phone, relation}
 *   agreement_link      POST /businesses/:id/agreement-links
 *   partner_terms_link  POST /referrals/:id/terms-links
 */
export type StuckAction = 'registration_link' | 'payment_link' | 'someone_else_pays' | 'agreement_link' | 'partner_terms_link';

export interface StuckView {
  kind: StuckKind;
  id: string;
  code: string;
  name: string;
  /** Who holds the record: the agent it was assigned to, else the agent who registered it (or the account agent / lead creator). */
  owner: { name: string; code: string } | null;
  /** The step the person is on (job seeker: consent, selfie, id_check, payment; business: agreement, visit, team_lead_check; partner: terms, selfie, id_check, upi), or complete. */
  step: string;
  /** done, in_progress, stuck or not_started (of that step). */
  state: string;
  /** Why it is stuck, in words, when the server knows. */
  reason: string | null;
  /** Waiting for the Team Lead's ID check: shown as that, with no resend. */
  waitingForTeamLead: boolean;
  actions: StuckAction[];
  /** The owner's staff id (assigned ?? registered; business: account agent ?? lead creator), for "Remind". */
  ownerId?: string | null;
}

/** One row of a "Stuck registrations" list (22 Nov): a stuck job seeker, business or partner. */
export interface StuckListRow extends StuckView {
  /** When the record was created (newest first). */
  since: string;
}

/** Job seekers who have not paid yet and may be stuck in registration. */
const OPEN_SEEKER_STATUSES = ['lead', 'consented', 'pending_activation'];
/** At most this many of each kind are looked at (newest first). */
const LIST_CAP = 40;

type Actor = { id: string; role: string };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function staffLabel(staff: { name: string; code: string } | null | undefined): { name: string; code: string } | null {
  return staff ? { name: staff.name, code: staff.code } : null;
}

const STAFF = { select: { name: true, code: true } } as const;

/**
 * "Where they're stuck" on every job seeker, business and referral partner
 * profile (Master Guide rev 204, 21 Nov), in the call agent, Team Lead,
 * Manager and CEO views: the account owner, the step, and the buttons that
 * match it. A record outside the viewer's normal scope is 404 (the CEO: all;
 * a Manager: his tree plus not-assigned records in his teams' cities; a Team
 * Lead: his team plus not-assigned in his city; a call agent: the city-wide
 * read call agents have for these records).
 */
@Injectable()
export class ProfileStuckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSeekers: JobSeekerService,
    private readonly managerRecords: ManagerRecordsService,
    private readonly teamLeadRecords: TeamLeadRecordsService,
  ) {}

  async stuck(actor: Actor, kind: unknown, ref: unknown): Promise<StuckView> {
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw new BadRequestException('kind must be job_seeker, business or referral');
    if (typeof ref !== 'string' || !ref.trim() || ref.length > 64) throw new BadRequestException('id is required');
    const scope = await this.scopeFor(actor);
    const byRef = isUuid(ref) ? { id: ref } : { code: ref.trim() };
    if (kind === 'job_seeker') return this.jobSeeker(scope ? { AND: [scope.seeker, byRef] } : byRef);
    if (kind === 'business') return this.business(scope ? { AND: [scope.business, byRef] } : byRef);
    return this.referral(scope ? { AND: [scope.referral, byRef] } : byRef);
  }

  /**
   * "Stuck registrations" (22 Nov, owner testing): every stuck job seeker, business and referral
   * partner the viewer answers for, worked out with the same steps as the profile box — job seekers
   * stuck at payment, waiting for the Team Lead's ID check (no resend) or with the link not finished;
   * businesses whose agreement is not signed; partners whose terms, selfie, ID or UPI is not done.
   * Owner = the agent a record is assigned to, else the agent who registered it (business: account
   * agent, else lead creator). A call agent: his own; a Team Lead or Manager: his team's.
   */
  async list(actor: Actor): Promise<{ rows: StuckListRow[] }> {
    const scope = await this.ownerScope(actor);
    const [seekers, businesses, referrals] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where: { AND: [scope.seeker, { status: { in: OPEN_SEEKER_STATUSES }, paymentReceivedAt: null, anonymisedAt: null }] },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: LIST_CAP,
      }),
      this.prisma.business.findMany({
        where: { AND: [scope.business, { anonymisedAt: null, agreements: { none: {} } }] },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: LIST_CAP,
      }),
      this.prisma.referral.findMany({
        where: { AND: [scope.referral, { anonymisedAt: null, pausedAt: null }] },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: LIST_CAP,
      }),
    ]);
    // A job seeker still at the consent step counts only once his link went out ("link not finished").
    const linked = new Set(
      seekers.length
        ? (await this.prisma.publicLink.findMany({ where: { purpose: 'registration', subjectType: 'job_seeker', subjectId: { in: seekers.map((s) => s.id) } }, select: { subjectId: true } })).map((l) => l.subjectId)
        : [],
    );
    const rows: StuckListRow[] = [];
    for (const s of seekers) {
      const view = await this.jobSeeker({ id: s.id });
      if (view.step === 'complete' || view.step === 'closed') continue;
      if (view.step === 'consent' && !linked.has(s.id)) continue;
      rows.push({ ...view, since: s.createdAt.toISOString() });
    }
    for (const b of businesses) {
      const view = await this.business({ id: b.id });
      if (view.step === 'agreement') rows.push({ ...view, since: b.createdAt.toISOString() });
    }
    for (const r of referrals) {
      const view = await this.referral({ id: r.id });
      if (view.step !== 'complete') rows.push({ ...view, since: r.createdAt.toISOString() });
    }
    rows.sort((a, b) => b.since.localeCompare(a.since));
    return { rows };
  }

  /** Whose records a "Stuck registrations" list holds (owner rules of own-team.ts / record-scope.ts). */
  private async ownerScope(actor: Actor): Promise<RecordWheres> {
    if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      const mine = { OR: [{ assignedStaffId: actor.id }, { assignedStaffId: null, registeredByStaffId: actor.id }] };
      return {
        seeker: mine as Prisma.JobSeekerWhereInput,
        referral: mine as Prisma.ReferralWhereInput,
        business: { OR: [{ accountAgentId: actor.id }, { accountAgentId: null, leadCreatedByStaffId: actor.id }] },
        vacancy: {},
        interview: {},
        placement: {},
      };
    }
    if (actor.role === 'team_lead') return (await this.teamLeadRecords.scope(actor)).team;
    if (actor.role === 'manager') return (await this.managerRecords.sectionScope(actor)).team;
    throw new ForbiddenException('Not available for this role');
  }

  /** The viewer's record scope (null = every record). */
  private async scopeFor(actor: Actor): Promise<RecordWheres | null> {
    if (actor.role === 'ceo' || actor.role === 'call_agent') return null;
    if (actor.role === 'manager') {
      const s = await this.managerRecords.sectionScope(actor);
      return eitherWheres(s.team, s.unassigned);
    }
    if (actor.role === 'team_lead') {
      const s = await this.teamLeadRecords.scope(actor);
      return eitherWheres(s.team, s.unassigned);
    }
    throw new ForbiddenException('Not available for this role');
  }

  private async jobSeeker(where: Prisma.JobSeekerWhereInput): Promise<StuckView> {
    const seeker = await this.prisma.jobSeeker.findFirst({
      where,
      select: {
        id: true, code: true, name: true, status: true, paymentReceivedAt: true,
        assignedStaff: STAFF, registeredBy: STAFF, assignedStaffId: true, registeredByStaffId: true,
      },
    });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    const base = {
      kind: 'job_seeker' as const, id: seeker.id, code: seeker.code, name: seeker.name,
      owner: staffLabel(seeker.assignedStaff ?? seeker.registeredBy), ownerId: seeker.assignedStaffId ?? seeker.registeredByStaffId ?? null,
    };
    const { steps } = await this.jobSeekers.getRegistrationStatus(seeker.id);
    if (seeker.status === 'active' || (seeker.paymentReceivedAt && steps.payment.state === 'done')) {
      return { ...base, step: 'complete', state: 'done', reason: null, waitingForTeamLead: false, actions: [] };
    }
    if (['banned', 'deactivated', 'refunded', 'anonymised'].includes(seeker.status)) {
      return { ...base, step: 'closed', state: 'stuck', reason: `Status: ${seeker.status}`, waitingForTeamLead: false, actions: [] };
    }
    const order: Array<[string, { state: string; reason: string | null }]> = [
      ['consent', steps.consent], ['selfie', steps.selfie], ['id_check', steps.idCheck], ['payment', steps.payment],
    ];
    const current = order.find(([, s]) => s.state !== 'done');
    if (!current) return { ...base, step: 'complete', state: 'done', reason: null, waitingForTeamLead: false, actions: [] };
    const [step, s] = current;
    if (step === 'id_check') {
      const waiting = s.state === 'in_progress' && /Team Lead/i.test(s.reason ?? '');
      if (waiting || s.state === 'stuck') return { ...base, step, state: s.state, reason: s.reason, waitingForTeamLead: waiting, actions: [] };
      return { ...base, step, state: s.state, reason: s.reason, waitingForTeamLead: false, actions: ['registration_link'] };
    }
    if (step === 'payment') {
      // Waiting for a new trade to be added: nothing to send until it is.
      if (s.state === 'stuck') return { ...base, step, state: s.state, reason: s.reason, waitingForTeamLead: false, actions: [] };
      return { ...base, step, state: s.state, reason: s.reason, waitingForTeamLead: false, actions: ['payment_link', 'someone_else_pays'] };
    }
    return { ...base, step, state: s.state, reason: s.reason, waitingForTeamLead: false, actions: ['registration_link'] };
  }

  private async business(where: Prisma.BusinessWhereInput): Promise<StuckView> {
    const business = await this.prisma.business.findFirst({
      where,
      select: {
        id: true, code: true, name: true, verificationStatus: true, verifiedAt: true, inPersonOnboardedAt: true,
        accountAgentId: true, leadCreatedByStaffId: true,
        agreements: { orderBy: { signedAt: 'desc' }, take: 1, select: { signedAt: true } },
        visits: { orderBy: { visitedAt: 'desc' }, take: 1, select: { visitedAt: true } },
        visitAssignments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, assignedStaff: STAFF, suggestedStaff: STAFF } },
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    const ownerId = business.accountAgentId ?? business.leadCreatedByStaffId;
    const owner = ownerId ? await this.prisma.staff.findUnique({ where: { id: ownerId }, select: { name: true, code: true } }) : null;
    const base = { kind: 'business' as const, id: business.id, code: business.code, name: business.name, owner: staffLabel(owner), ownerId: ownerId ?? null };
    const status = business.verificationStatus ?? 'lead';
    const verified = status === 'verified' || Boolean(business.inPersonOnboardedAt);
    if (!business.agreements[0]) {
      return { ...base, step: 'agreement', state: 'not_started', reason: null, waitingForTeamLead: false, actions: ['agreement_link'] };
    }
    if (verified) return { ...base, step: 'complete', state: 'done', reason: null, waitingForTeamLead: false, actions: [] };
    if (status === 'rejected') return { ...base, step: 'team_lead_check', state: 'stuck', reason: 'The Team Lead rejected the verification', waitingForTeamLead: false, actions: [] };
    if (status === 'pending_tl_check') return { ...base, step: 'team_lead_check', state: 'in_progress', reason: 'Waiting for the Team Lead to approve the verification', waitingForTeamLead: true, actions: [] };
    const assignment = business.visitAssignments[0];
    const who = assignment?.assignedStaff ?? assignment?.suggestedStaff;
    return {
      ...base,
      step: 'visit',
      state: business.visits[0] ? 'done' : assignment ? 'in_progress' : 'not_started',
      reason: who ? `Verification visit with ${who.name} (${who.code})` : 'Waiting for a field agent’s verification visit',
      waitingForTeamLead: false,
      actions: [],
    };
  }

  private async referral(where: Prisma.ReferralWhereInput): Promise<StuckView> {
    const referral = await this.prisma.referral.findFirst({
      where,
      select: {
        id: true, code: true, name: true, photoStoragePath: true, pausedAt: true,
        assignedStaff: STAFF, registeredBy: STAFF, assignedStaffId: true, registeredByStaffId: true,
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, nameMatches: true, isAdult: true, failureReason: true } },
      },
    });
    if (!referral) throw new NotFoundException('Referral partner not found');
    const base = {
      kind: 'referral' as const, id: referral.id, code: referral.code, name: referral.name,
      owner: staffLabel(referral.assignedStaff ?? referral.registeredBy), ownerId: referral.assignedStaffId ?? referral.registeredByStaffId ?? null,
    };
    const [terms, account] = await Promise.all([
      this.prisma.consent.findFirst({ where: { subjectType: 'referral', subjectId: referral.id, purpose: 'agreement_terms', granted: true, withdrawnAt: null }, select: { id: true } }),
      this.prisma.payoutAccount.findFirst({ where: { ownerType: 'referral', ownerId: referral.id, status: { not: 'superseded' } }, orderBy: { createdAt: 'desc' }, select: { status: true, nameMatches: true } }),
    ]);
    const identity = referral.identityVerifications[0];
    const link: StuckAction[] = ['partner_terms_link'];
    if (!terms) return { ...base, step: 'terms', state: 'not_started', reason: null, waitingForTeamLead: false, actions: link };
    if (!referral.photoStoragePath) return { ...base, step: 'selfie', state: 'not_started', reason: null, waitingForTeamLead: false, actions: link };
    const idDone = identity?.status === 'verified' && identity.nameMatches === true && identity.isAdult === true;
    if (!idDone) {
      if (identity?.status === 'pending') {
        return { ...base, step: 'id_check', state: 'in_progress', reason: "Waiting for the Team Lead's ID check", waitingForTeamLead: true, actions: [] };
      }
      if (identity && identity.isAdult === false) {
        return { ...base, step: 'id_check', state: 'stuck', reason: 'Under 18: registration stops (only a Manager or the CEO can lift it)', waitingForTeamLead: false, actions: [] };
      }
      return { ...base, step: 'id_check', state: identity ? 'stuck' : 'not_started', reason: identity?.failureReason ?? null, waitingForTeamLead: false, actions: link };
    }
    if (account?.status !== 'verified') {
      return {
        ...base,
        step: 'upi',
        state: account ? 'in_progress' : 'not_started',
        reason: account?.nameMatches === false ? 'UPI or bank account name did not match the verified identity' : null,
        waitingForTeamLead: false,
        actions: account ? [] : link,
      };
    }
    return { ...base, step: 'complete', state: 'done', reason: null, waitingForTeamLead: false, actions: [] };
  }
}
