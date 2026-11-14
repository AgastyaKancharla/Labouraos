import { PrismaService } from '../prisma/prisma.service';
import { ReportingScopeService } from '../../modules/staff/reporting-scope.service';

/**
 * A Team Lead's own team — the one definition every Team Lead check uses
 * (owner rule, Master Guide 14 Nov: "Team Leads work only on their own team").
 *
 * The team of Team Lead T is:
 * - T themselves (records T registered, calls T made, work assigned to T);
 * - everyone whose Team Lead is T (`Staff.teamLeadId = T`);
 * - everyone under T in the reporting line (`reportsToId`, walked by
 *   ReportingScopeService.peopleUnder; an agent with no reportsToId counts
 *   under their teamLeadId).
 *
 * Both links are read because accounts made before the reporting line
 * (Phase 21) have only `teamLeadId`, and new ones set both to the same Team
 * Lead. A record "belongs to the team" when the staff member who owns it
 * (registered it, made the call, holds the task) is in this set; a record
 * with no owner belongs to no team (the CEO and Managers handle it).
 */
export class OwnTeam {
  private readonly scope: Pick<ReportingScopeService, 'peopleUnder'>;

  /** `scope` reuses a service's injected ReportingScopeService when it has one. */
  constructor(
    private readonly prisma: PrismaService,
    scope?: Pick<ReportingScopeService, 'peopleUnder'>,
  ) {
    this.scope = scope ?? new ReportingScopeService(prisma);
  }

  /** Every staff id in the Team Lead's own team, the Team Lead included. */
  async memberIds(teamLeadId: string): Promise<string[]> {
    const [direct, under] = await Promise.all([
      this.prisma.staff.findMany({ where: { teamLeadId }, select: { id: true } }),
      this.scope.peopleUnder(teamLeadId),
    ]);
    return [...new Set([teamLeadId, ...direct.map((row) => row.id), ...under])];
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
}
