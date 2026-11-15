import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface StaffBrief {
  id: string;
  code: string;
  name: string;
  role: string;
}

export interface ReportingChain {
  teamLead: StaffBrief | null;
  manager: StaffBrief | null;
  ceo: StaffBrief | null;
}

interface LinkRow {
  id: string;
  code: string;
  name: string;
  role: string;
  status: string;
  reportsToId: string | null;
  teamLeadId: string | null;
}

const AGENT_ROLES = ['call_agent', 'field_agent'];
/** A boss may be active or created but not signed in yet (rev 174–175, rule 15); never deactivated. */
const BOSS_STATUSES = ['active', 'pending_invite'];

/**
 * The one place that walks the reporting line.
 * chainOf returns a person's Team Lead, Manager and CEO.
 * peopleUnder returns everyone below that person.
 */
@Injectable()
export class ReportingScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async chainOf(staffId: string): Promise<ReportingChain> {
    const rows = await this.loadLinks();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const chain: ReportingChain = { teamLead: null, manager: null, ceo: null };
    const seen = new Set<string>([staffId]);
    let current = byId.get(staffId);
    for (let hop = 0; current && hop < 8; hop += 1) {
      const nextId = this.parentId(current);
      if (!nextId || seen.has(nextId)) {
        break;
      }
      seen.add(nextId);
      const next = byId.get(nextId);
      if (!next) {
        break;
      }
      if (next.role === 'team_lead' && !chain.teamLead) {
        chain.teamLead = this.brief(next);
      } else if (next.role === 'manager' && !chain.manager) {
        chain.manager = this.brief(next);
      } else if (next.role === 'ceo' && !chain.ceo) {
        chain.ceo = this.brief(next);
      }
      current = next;
    }
    return chain;
  }

  async peopleUnder(staffId: string): Promise<string[]> {
    const rows = await this.loadLinks();
    const byId = new Map(rows.map((row) => [row.id, row]));
    return rows
      .filter((row) => row.id !== staffId && this.reaches(row, staffId, byId))
      .map((row) => row.id);
  }

  async personIsUnder(actorId: string, targetId: string): Promise<boolean> {
    if (actorId === targetId) {
      return false;
    }
    const under = await this.peopleUnder(actorId);
    return under.includes(targetId);
  }

  /**
   * The line required on create and on a move.
   * A call or field agent reports to a Team Lead; an owner agent account
   * (isOwnerAccount) may instead report straight to a CEO (rev 174–175).
   * A Team Lead reports to a Manager.
   * A Manager or Finance reports to the CEO.
   * The CEO reports to nobody.
   * The boss may be active or created but not signed in yet (pending);
   * never deactivated.
   */
  async assertReportingLine(
    role: string,
    reportsToId: string | null | undefined,
    options: { ownerAccount?: boolean } = {},
  ): Promise<string | null> {
    return (await this.reportingLine(role, reportsToId, options)).id;
  }

  /** assertReportingLine, also saying which role the boss has. */
  async reportingLine(
    role: string,
    reportsToId: string | null | undefined,
    options: { ownerAccount?: boolean } = {},
  ): Promise<{ id: string | null; bossRole: string | null }> {
    if (role === 'ceo') {
      if (reportsToId) {
        throw new BadRequestException('The CEO reports to nobody');
      }
      return { id: null, bossRole: null };
    }
    const owner = Boolean(options.ownerAccount) && AGENT_ROLES.includes(role);
    if (!reportsToId) {
      throw new BadRequestException(this.missingLineMessage(role, owner));
    }
    const target = await this.prisma.staff.findUnique({
      where: { id: reportsToId },
      select: { role: true, status: true },
    });
    const expected = [this.expectedRole(role), ...(owner ? ['ceo'] : [])];
    if (!target || !expected.includes(target.role) || !BOSS_STATUSES.includes(target.status)) {
      throw new BadRequestException(this.missingLineMessage(role, owner));
    }
    return { id: reportsToId, bossRole: target.role };
  }

  private expectedRole(role: string): string {
    if (AGENT_ROLES.includes(role)) {
      return 'team_lead';
    }
    if (role === 'team_lead') {
      return 'manager';
    }
    return 'ceo';
  }

  private missingLineMessage(role: string, ownerAccount = false): string {
    if (AGENT_ROLES.includes(role)) {
      return ownerAccount
        ? 'An owner account must report to a Team Lead or a CEO (active or not signed in yet)'
        : 'A call agent or field agent must report to a Team Lead (active or not signed in yet)';
    }
    if (role === 'team_lead') {
      return 'A Team Lead must report to a Manager (active or not signed in yet)';
    }
    return 'A Manager or Finance must report to the CEO';
  }

  private parentId(row: LinkRow): string | null {
    if (row.reportsToId) {
      return row.reportsToId;
    }
    if (AGENT_ROLES.includes(row.role) && row.teamLeadId) {
      return row.teamLeadId;
    }
    return null;
  }

  private reaches(
    start: LinkRow,
    actorId: string,
    byId: Map<string, LinkRow>,
  ): boolean {
    const seen = new Set<string>();
    let current: LinkRow | undefined = start;
    for (let hop = 0; current && hop < 8; hop += 1) {
      if (seen.has(current.id)) {
        return false;
      }
      seen.add(current.id);
      const nextId = this.parentId(current);
      if (!nextId) {
        return false;
      }
      if (nextId === actorId) {
        return true;
      }
      current = byId.get(nextId);
    }
    return false;
  }

  private brief(row: LinkRow): StaffBrief {
    return { id: row.id, code: row.code, name: row.name, role: row.role };
  }

  private loadLinks(): Promise<LinkRow[]> {
    return this.prisma.staff.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        role: true,
        status: true,
        reportsToId: true,
        teamLeadId: true,
      },
    });
  }
}
