import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnTeam, teamLeadOf } from '../../common/rbac/own-team';

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
  /** own_team: the Team Lead who approves (the registering agent's Team Lead, teamLeadOf). */
  ownTeamLead: string | null;
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

/** A staff account that can sign in now: active and not locked (staff.service lock: lockedByStaffId, or lockedUntil still ahead). */
export function usableStaff(staff: { status: string; lockedByStaffId?: string | null; lockedUntil?: Date | null }, now = new Date()): boolean {
  return staff.status === 'active' && !staff.lockedByStaffId && !(staff.lockedUntil && staff.lockedUntil.getTime() > now.getTime());
}

/** The same rule as a database filter. */
function usableStaffWhere(now: Date) {
  return { status: 'active', lockedByStaffId: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] };
}

interface Candidate extends ApprovalSubject {
  subjectType: OtherIdSubjectType;
  id: string;
  /** What the list is ordered by, oldest first (so nothing waits forever). */
  waitingSince: Date;
}

const LOCK_FIELDS = { status: true, lockedByStaffId: true, lockedUntil: true } as const;

@Injectable()
export class OtherIdApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The route of many people at once (four queries, whatever the count): the registrars, their Team
   * Leads, and the usable Team Leads of the cities involved. A locked or inactive Team Lead counts
   * for nothing: his team's IDs go to another Team Lead, and he doesn't keep the Manager fallback away.
   */
  async routeMany(subjects: ApprovalSubject[], now = new Date()): Promise<OtherIdApprovalRoute[]> {
    if (!subjects.length) return [];
    const registrarIds = [...new Set(subjects.map((s) => s.registeredByStaffId).filter((id): id is string => Boolean(id)))];
    const registrars = registrarIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: registrarIds } }, select: { id: true, role: true, teamLeadId: true, reportsToId: true } })
      : [];
    const registrarById = new Map(registrars.map((r) => [r.id, r]));
    const leadIdOf = new Map(registrars.map((r) => [r.id, teamLeadOf(r)]));
    const leadIds = [...new Set([...leadIdOf.values()].filter((id): id is string => Boolean(id)))];
    const leads = leadIds.length ? await this.prisma.staff.findMany({ where: { id: { in: leadIds } }, select: { id: true, role: true, ...LOCK_FIELDS } }) : [];
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const cities = [...new Set(subjects.map((s) => s.city))];
    const cityLeads = await this.prisma.staff.findMany({ where: { role: 'team_lead', city: { in: cities }, ...usableStaffWhere(now) }, select: { id: true, city: true } });
    return subjects.map((subject) => {
      const base = { city: subject.city, registeredByStaffId: subject.registeredByStaffId };
      const registrar = subject.registeredByStaffId ? registrarById.get(subject.registeredByStaffId) : undefined;
      const leadId = registrar ? leadIdOf.get(registrar.id) : null;
      const lead = leadId && leadId !== registrar?.id ? leadById.get(leadId) : undefined;
      if (lead && lead.role === 'team_lead' && usableStaff(lead, now)) return { ...base, mode: 'own_team' as const, ownTeamLead: lead.id };
      const others = cityLeads.filter((l) => l.city === subject.city && l.id !== subject.registeredByStaffId).length;
      return { ...base, mode: others > 0 ? ('another_team_lead' as const) : ('manager_or_ceo' as const), ownTeamLead: null };
    });
  }

  async routeFor(subject: ApprovalSubject): Promise<OtherIdApprovalRoute> {
    return (await this.routeMany([subject]))[0]!;
  }

  /** May this staff member approve (or reject) this person's pending other ID? Never the person who registered them. */
  async rightFor(actor: { id: string; role: string }, subject: ApprovalSubject, route?: OtherIdApprovalRoute): Promise<OtherIdDecisionRight> {
    const r = route ?? (await this.routeFor(subject));
    const no = (reason: string): OtherIdDecisionRight => ({ allowed: false, mode: r.mode, reason });
    if (subject.registeredByStaffId && actor.id === subject.registeredByStaffId) return no(SELF_APPROVAL_REFUSED);
    const me = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { role: true, city: true, ...LOCK_FIELDS } });
    if (!me || !usableStaff(me) || me.role !== actor.role) return no('Not an active staff account');
    if (r.mode === 'own_team') {
      // The registering agent is in this Team Lead's own team (OwnTeam: teamLeadId or the reporting line).
      return actor.role === 'team_lead' && (await new OwnTeam(this.prisma).includes(actor.id, subject.registeredByStaffId))
        ? { allowed: true, mode: r.mode, reason: null }
        : no('The Team Lead of the agent who registered this person checks the ID.');
    }
    return this.fallbackRight(actor, me.city, subject, r);
  }

  /** Another Team Lead of the city, or (no other Team Lead) a Manager of the city / the CEO. In memory. */
  private fallbackRight(actor: { id: string; role: string }, myCity: string, subject: ApprovalSubject, r: OtherIdApprovalRoute): OtherIdDecisionRight {
    const no = (reason: string): OtherIdDecisionRight => ({ allowed: false, mode: r.mode, reason });
    if (subject.registeredByStaffId && actor.id === subject.registeredByStaffId) return no(SELF_APPROVAL_REFUSED);
    if (r.mode === 'another_team_lead') {
      return actor.role === 'team_lead' && myCity === subject.city ? { allowed: true, mode: r.mode, reason: null } : no(`Another Team Lead in ${subject.city} checks this ID.`);
    }
    if (r.mode === 'manager_or_ceo' && (actor.role === 'ceo' || (actor.role === 'manager' && myCity === subject.city))) return { allowed: true, mode: r.mode, reason: null };
    return no(`No other Team Lead in ${subject.city}: a Manager there or the CEO checks this ID.`);
  }

  /** The candidates this actor checks as `mode`, oldest first, filtered before the limit (batched). */
  private async pick(actor: { id: string; role: string }, mode: 'another_team_lead' | 'manager_or_ceo', candidates: Candidate[], limit: number): Promise<Candidate[]> {
    if (!candidates.length) return [];
    const me = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { role: true, city: true, ...LOCK_FIELDS } });
    if (!me || !usableStaff(me) || me.role !== actor.role) return [];
    const routes = await this.routeMany(candidates);
    return candidates
      .filter((c, i) => routes[i]!.mode === mode && this.fallbackRight(actor, me.city, c, routes[i]!).allowed)
      .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime())
      .slice(0, limit);
  }

  private async myCity(actor: { id: string; role: string }): Promise<{ city: string } | null> {
    const me = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { city: true, ...LOCK_FIELDS } });
    return me && usableStaff(me) ? me : null;
  }

  /**
   * Pending other IDs this staff member may decide outside their own team: for a Team Lead the
   * "needs another Team Lead" ones of their city; for a Manager (their city) or the CEO (every city)
   * the ones with no other Team Lead. Oldest waiting first, at most 50.
   */
  async waitingFor(actor: { id: string; role: string }, mode: 'another_team_lead' | 'manager_or_ceo'): Promise<{ subjectType: OtherIdSubjectType; id: string }[]> {
    const me = await this.myCity(actor);
    if (!me) return [];
    const cityWhere = actor.role === 'ceo' ? {} : { city: me.city };
    const pendingWhere = { status: 'pending', vendor: 'team_lead_check' };
    const notMine = { OR: [{ registeredByStaffId: null }, { NOT: { registeredByStaffId: actor.id } }] };
    const select = {
      id: true, city: true, registeredByStaffId: true,
      identityVerifications: { where: pendingWhere, orderBy: { createdAt: 'asc' as const }, take: 1, select: { createdAt: true } },
    };
    // Pending checks close within 30 days (the photo expires), so this set stays small: no limit before filtering.
    const [seekers, referrals] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { ...cityWhere, ...notMine, anonymisedAt: null, identityVerifications: { some: pendingWhere } }, select }),
      this.prisma.referral.findMany({ where: { ...cityWhere, ...notMine, anonymisedAt: null, identityVerifications: { some: pendingWhere } }, select }),
    ]);
    const candidates: Candidate[] = [
      ...seekers.map((r) => ({ subjectType: 'job_seeker' as const, id: r.id, city: r.city, registeredByStaffId: r.registeredByStaffId, waitingSince: r.identityVerifications[0]?.createdAt ?? new Date(0) })),
      ...referrals.map((r) => ({ subjectType: 'referral' as const, id: r.id, city: r.city, registeredByStaffId: r.registeredByStaffId, waitingSince: r.identityVerifications[0]?.createdAt ?? new Date(0) })),
    ];
    return (await this.pick(actor, mode, candidates, 50)).map((c) => ({ subjectType: c.subjectType, id: c.id }));
  }

  /**
   * The general registration check (rev 169, same rule): job seekers registered since `since` (not
   * leads, not yet checked) that this staff member checks outside their own team — for a Team Lead
   * the "needs another Team Lead" ones of their city, for a Manager (their city) or the CEO (every
   * city) the ones with no other Team Lead. Never their own registrations. Oldest first, at most 100.
   */
  async uncheckedRegistrationsFor(actor: { id: string; role: string }, mode: 'another_team_lead' | 'manager_or_ceo', since: Date): Promise<string[]> {
    const me = await this.myCity(actor);
    if (!me) return [];
    const seekers = await this.prisma.jobSeeker.findMany({
      where: {
        ...(actor.role === 'ceo' ? {} : { city: me.city }),
        OR: [{ registeredByStaffId: null }, { NOT: { registeredByStaffId: actor.id } }],
        anonymisedAt: null,
        status: { notIn: ['lead'] },
        createdAt: { gte: since },
      },
      select: { id: true, city: true, registeredByStaffId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!seekers.length) return [];
    const checked = new Set(
      (await this.prisma.teamLeadCheck.findMany({ where: { subjectType: 'job_seeker', subjectId: { in: seekers.map((s) => s.id) } }, select: { subjectId: true } })).map((c) => c.subjectId),
    );
    const candidates: Candidate[] = seekers
      .filter((s) => !checked.has(s.id))
      .map((s) => ({ subjectType: 'job_seeker' as const, id: s.id, city: s.city, registeredByStaffId: s.registeredByStaffId, waitingSince: s.createdAt }));
    return (await this.pick(actor, mode, candidates, 100)).map((c) => c.id);
  }
}
