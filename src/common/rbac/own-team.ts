import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** The roles that make up a Team Lead's team (besides the Team Lead). */
export const TEAM_AGENT_ROLES: readonly string[] = ['call_agent', 'field_agent'];

/**
 * A Team Lead's own team — the one definition every Team Lead check uses
 * (owner rule, Master Guide 14 Nov: "Team Leads work only on their own team").
 *
 * The team of Team Lead T is T and the call and field agents linked to T,
 * either by `Staff.teamLeadId = T` (accounts made before the reporting line,
 * Phase 21) or by `Staff.reportsToId = T` (the reporting line; agents report
 * to their Team Lead). Agents have nobody under them, so this is the whole
 * reporting tree below a Team Lead. A record belongs to the team when the
 * staff member who owns it is in this set; a record with no owner belongs to
 * no team (the CEO and Managers handle it).
 *
 * Create one per request (or per check): it remembers the team it loaded, so
 * several checks in one request read the database once.
 */
export class OwnTeam {
  private readonly loaded = new Map<string, Promise<string[]>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Every staff id in the Team Lead's own team, the Team Lead included. */
  memberIds(teamLeadId: string): Promise<string[]> {
    let team = this.loaded.get(teamLeadId);
    if (!team) {
      team = this.prisma.staff
        .findMany({
          where: {
            role: { in: [...TEAM_AGENT_ROLES] },
            OR: [{ teamLeadId }, { reportsToId: teamLeadId }],
          },
          select: { id: true },
        })
        .then((rows) => [teamLeadId, ...rows.map((row) => row.id).filter((id) => id !== teamLeadId)]);
      this.loaded.set(teamLeadId, team);
    }
    return team;
  }

  /** True when any of the given owners is in the Team Lead's own team. */
  async includesAny(teamLeadId: string, owners: Array<string | null | undefined>): Promise<boolean> {
    const ids = owners.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return false;
    if (ids.includes(teamLeadId)) return true;
    const team = await this.memberIds(teamLeadId);
    return ids.some((id) => team.includes(id));
  }

  /** True when the owner is in the Team Lead's own team. */
  includes(teamLeadId: string, owner: string | null | undefined): Promise<boolean> {
    return this.includesAny(teamLeadId, [owner]);
  }

  /** True when the business belongs to the Team Lead's own team (businessOwners). */
  ownsBusiness(teamLeadId: string, business: BusinessOwnerFields): Promise<boolean> {
    return this.includesAny(teamLeadId, businessOwners(business));
  }
}

/**
 * The Team Lead a call or field agent belongs to (teamLeadId, else the
 * reporting line). Anyone else has no Team Lead here.
 */
export function teamLeadOf(staff: { role: string; teamLeadId?: string | null; reportsToId?: string | null }): string | null {
  if (!TEAM_AGENT_ROLES.includes(staff.role)) return null;
  return staff.teamLeadId ?? staff.reportsToId ?? null;
}

export interface BusinessOwnerFields {
  accountAgentId?: string | null;
  leadCreatedByStaffId?: string | null;
}

/**
 * Which team a business belongs to (owner decision, Master Guide rev 170):
 * once it has an account agent, only the account agent's team is in charge of
 * it; until then the team of the agent who created the lead; with neither it
 * belongs to no team (Managers and the CEO).
 */
export function businessOwners(business: BusinessOwnerFields): string[] {
  if (business.accountAgentId) return [business.accountAgentId];
  if (business.leadCreatedByStaffId) return [business.leadCreatedByStaffId];
  return [];
}

/** The same rule as a database filter: businesses that belong to these staff ids. */
export function businessesOwnedBy(staffIds: string[]): Prisma.BusinessWhereInput {
  return {
    OR: [
      { accountAgentId: { in: staffIds } },
      { accountAgentId: null, leadCreatedByStaffId: { in: staffIds } },
    ],
  };
}
