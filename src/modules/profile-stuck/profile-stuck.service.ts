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
}

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
        assignedStaff: STAFF, registeredBy: STAFF,
      },
    });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    const base = { kind: 'job_seeker' as const, id: seeker.id, code: seeker.code, name: seeker.name, owner: staffLabel(seeker.assignedStaff ?? seeker.registeredBy) };
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
    const base = { kind: 'business' as const, id: business.id, code: business.code, name: business.name, owner: staffLabel(owner) };
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
        assignedStaff: STAFF, registeredBy: STAFF,
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, nameMatches: true, isAdult: true, failureReason: true } },
      },
    });
    if (!referral) throw new NotFoundException('Referral partner not found');
    const base = { kind: 'referral' as const, id: referral.id, code: referral.code, name: referral.name, owner: staffLabel(referral.assignedStaff ?? referral.registeredBy) };
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
