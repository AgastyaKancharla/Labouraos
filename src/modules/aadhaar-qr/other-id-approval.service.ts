import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export type OtherIdSubjectType = 'job_seeker' | 'referral';

/**
 * Who approves another ID (PAN, driving licence, voter ID) — Master Guide rev 169 —
 * and, by the same rule, who does the general registration check in T-Verify
 * ("Looks right" / "Fake · flag it"):
 *   - own_team: the person was registered by an agent in a Team Lead's team —
 *     that Team Lead approves it;
 *   - another_team_lead: a Team Lead registered the person, or the person is in
 *     no Team Lead's team (registered by a Manager or the CEO, or by nobody) —
 *     ANOTHER active Team Lead in the same city approves it;
 *   - manager_or_ceo: there is no other active Team Lead in that city — a
 *     Manager of that city or the CEO approves it.
 * Nobody ever approves the ID of a person they registered themselves.
 */
export type OtherIdApprovalMode = 'own_team' | 'another_team_lead' | 'manager_or_ceo';

export interface OtherIdApprovalRoute {
  mode: OtherIdApprovalMode;
  city: string;
  registeredByStaffId: string | null;
  /** own_team: the Team Lead who approves. */
  teamLeadId: string | null;
}

export interface OtherIdDecisionRight {
  allowed: boolean;
  mode: OtherIdApprovalMode;
  /** Why not (shown on the screen), or null when allowed. */
  reason: string | null;
}

export interface ApprovalSubject {
  registeredByStaffId: string | null;
  city: string;
}

export const SELF_APPROVAL_REFUSED = 'You registered this person, so another Team Lead checks the ID.';
const AGENT_ROLES = ['call_agent', 'field_agent'];

@Injectable()
export class OtherIdApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async routeFor(subject: ApprovalSubject): Promise<OtherIdApprovalRoute> {
    const base = { city: subject.city, registeredByStaffId: subject.registeredByStaffId };
    const registrar = subject.registeredByStaffId
      ? await this.prisma.staff.findUnique({ where: { id: subject.registeredByStaffId }, select: { id: true, role: true, teamLeadId: true, reportsToId: true } })
      : null;
    if (registrar && AGENT_ROLES.includes(registrar.role)) {
      const leadId = registrar.teamLeadId ?? registrar.reportsToId;
      if (leadId && leadId !== registrar.id) {
        const lead = await this.prisma.staff.findUnique({ where: { id: leadId }, select: { id: true, role: true, status: true } });
        if (lead && lead.role === 'team_lead' && lead.status === 'active') return { ...base, mode: 'own_team', teamLeadId: lead.id };
      }
    }
    const otherLeads = await this.prisma.staff.count({
      where: { role: 'team_lead', status: 'active', city: subject.city, ...(registrar ? { NOT: { id: registrar.id } } : {}) },
    });
    return { ...base, mode: otherLeads > 0 ? 'another_team_lead' : 'manager_or_ceo', teamLeadId: null };
  }

  /** May this staff member approve (or reject) this person's pending other ID? Never the person who registered them. */
  async rightFor(actor: { id: string; role: string }, subject: ApprovalSubject, route?: OtherIdApprovalRoute): Promise<OtherIdDecisionRight> {
    const r = route ?? (await this.routeFor(subject));
    const no = (reason: string): OtherIdDecisionRight => ({ allowed: false, mode: r.mode, reason });
    if (subject.registeredByStaffId && actor.id === subject.registeredByStaffId) return no(SELF_APPROVAL_REFUSED);
    const me = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { role: true, status: true, city: true } });
    if (!me || me.status !== 'active' || me.role !== actor.role) return no('Not an active staff account');
    if (r.mode === 'own_team') {
      return actor.role === 'team_lead' && actor.id === r.teamLeadId
        ? { allowed: true, mode: r.mode, reason: null }
        : no('The Team Lead of the agent who registered this person checks the ID.');
    }
    if (r.mode === 'another_team_lead') {
      return actor.role === 'team_lead' && me.city === subject.city
        ? { allowed: true, mode: r.mode, reason: null }
        : no(`Another Team Lead in ${subject.city} checks this ID.`);
    }
    if (actor.role === 'ceo' || (actor.role === 'manager' && me.city === subject.city)) return { allowed: true, mode: r.mode, reason: null };
    return no(`No other Team Lead in ${subject.city}: a Manager there or the CEO checks this ID.`);
  }

  /**
   * Pending other IDs this staff member may decide outside their own team:
   * for a Team Lead the "needs another Team Lead" ones of their city; for a
   * Manager (their city) or the CEO (every city) the ones with no other Team
   * Lead. Newest first, at most 50 of each kind.
   */
  async waitingFor(actor: { id: string; role: string }, mode: 'another_team_lead' | 'manager_or_ceo'): Promise<{ subjectType: OtherIdSubjectType; id: string }[]> {
    const me = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { city: true, status: true } });
    if (!me || me.status !== 'active') return [];
    const cityWhere = actor.role === 'ceo' ? {} : { city: me.city };
    const pending = { some: { status: 'pending', vendor: 'team_lead_check' } };
    const notMine = { OR: [{ registeredByStaffId: null }, { NOT: { registeredByStaffId: actor.id } }] };
    const [seekers, referrals] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { ...cityWhere, ...notMine, anonymisedAt: null, identityVerifications: pending }, select: { id: true, city: true, registeredByStaffId: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.referral.findMany({ where: { ...cityWhere, ...notMine, anonymisedAt: null, identityVerifications: pending }, select: { id: true, city: true, registeredByStaffId: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const out: { subjectType: OtherIdSubjectType; id: string }[] = [];
    for (const [subjectType, rows] of [['job_seeker', seekers], ['referral', referrals]] as const) {
      for (const row of rows) {
        const route = await this.routeFor(row);
        if (route.mode !== mode) continue;
        if ((await this.rightFor(actor, row, route)).allowed) out.push({ subjectType, id: row.id });
      }
    }
    return out;
  }

  /**
   * The general registration check (rev 169, same rule): job seekers registered since `since` (not
   * leads, not yet checked) that this staff member checks outside their own team — for a Team Lead
   * the "needs another Team Lead" ones of their city, for a Manager (their city) or the CEO (every
   * city) the ones with no other Team Lead. Never their own registrations. Newest first, at most 100.
   */
  async uncheckedRegistrationsFor(actor: { id: string; role: string }, mode: 'another_team_lead' | 'manager_or_ceo', since: Date): Promise<string[]> {
    const me = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { city: true, status: true } });
    if (!me || me.status !== 'active') return [];
    const seekers = await this.prisma.jobSeeker.findMany({
      where: {
        ...(actor.role === 'ceo' ? {} : { city: me.city }),
        OR: [{ registeredByStaffId: null }, { NOT: { registeredByStaffId: actor.id } }],
        anonymisedAt: null,
        status: { notIn: ['lead'] },
        createdAt: { gte: since },
      },
      select: { id: true, city: true, registeredByStaffId: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    if (!seekers.length) return [];
    const checked = new Set(
      (await this.prisma.teamLeadCheck.findMany({ where: { subjectType: 'job_seeker', subjectId: { in: seekers.map((s) => s.id) } }, select: { subjectId: true } })).map((c) => c.subjectId),
    );
    const out: string[] = [];
    for (const seeker of seekers) {
      if (checked.has(seeker.id)) continue;
      const route = await this.routeFor(seeker);
      if (route.mode !== mode) continue;
      if ((await this.rightFor(actor, seeker, route)).allowed) out.push(seeker.id);
    }
    return out;
  }
}
