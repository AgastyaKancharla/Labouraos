import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { teamLabel } from '../ceo-portal/ceo-team.service';
import { DAY_MS, DateRange, median } from '../ceo-portal/ceo-common';
import { AGENT_ROLES } from './manager-common';

export interface TreePerson {
  id: string;
  code: string;
  name: string;
  role: string;
  isIntern: boolean;
  status: string;
  /** The Team Lead this person's team belongs to (themself for a Team Lead). */
  teamLeadId: string | null;
  team: string | null;
}

export interface TreeLead {
  id: string;
  code: string;
  name: string;
  team: string;
}

export interface ManagerTree {
  manager: { id: string; code: string; name: string };
  leads: TreeLead[];
  /** Everyone under the Manager (Team Leads and agents), not deactivated. */
  people: TreePerson[];
  agents: TreePerson[];
  ids: string[];
}

/** The work counts a team (or the whole tree) produced in a period. */
export interface WorkCounts {
  registered: number;
  paid: number;
  interviewsDone: number;
  offered: number;
  placed: number;
  leftWithin30: number;
  businessesSignedUp: number;
  vacancies: number;
  vacanciesClosed: number;
  vacanciesFilled: number;
  /** Median days from a vacancy being added to the candidate being selected. */
  daysToFill: number | null;
}

/**
 * Who a Manager looks after (Master Guide, Reporting lines: "the CEO and
 * Managers see the whole chain as a reporting tree") and the work counts
 * their people produced. Everything here is counts — never money.
 */
@Injectable()
export class ManagerTreeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ReportingScopeService,
  ) {}

  async load(managerId: string): Promise<ManagerTree> {
    const [me, under] = await Promise.all([
      this.prisma.staff.findUnique({ where: { id: managerId }, select: { id: true, code: true, name: true } }),
      this.scope.peopleUnder(managerId),
    ]);
    if (!me) throw new NotFoundException('Staff account not found');
    const rows = under.length
      ? await this.prisma.staff.findMany({
          where: { id: { in: under }, status: { not: 'deactivated' } },
          select: { id: true, code: true, name: true, role: true, isIntern: true, status: true, teamLeadId: true, reportsToId: true, teamName: true },
          orderBy: { name: 'asc' },
        })
      : [];
    const leadRows = rows.filter((r) => r.role === 'team_lead');
    const leadById = new Map(leadRows.map((l) => [l.id, l]));
    const leads: TreeLead[] = leadRows.map((l) => ({ id: l.id, code: l.code, name: l.name, team: teamLabel(l) as string }));
    const people: TreePerson[] = rows.map((r) => {
      const leadId = r.role === 'team_lead' ? r.id : (r.teamLeadId ?? r.reportsToId ?? null);
      const lead = leadId ? leadById.get(leadId) : undefined;
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        role: r.role,
        isIntern: r.isIntern,
        status: r.status,
        teamLeadId: lead ? lead.id : null,
        team: lead ? teamLabel(lead) : null,
      };
    });
    return {
      manager: me,
      leads,
      people,
      agents: people.filter((p) => AGENT_ROLES.includes(p.role)),
      ids: people.map((p) => p.id),
    };
  }

  /** The person, if they are in the Manager's tree; 403 otherwise (404 when nobody has that id). */
  async person(tree: ManagerTree, staffId: string): Promise<TreePerson> {
    const found = tree.people.find((p) => p.id === staffId);
    if (found) return found;
    const exists = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Staff account not found');
    throw new ForbiddenException('A Manager sees only the people in their own teams');
  }

  /** Ids of a team: the Team Lead and their agents. */
  teamIds(tree: ManagerTree, leadId: string): string[] {
    return tree.people.filter((p) => p.teamLeadId === leadId).map((p) => p.id);
  }

  /** Placements credited to these people: closed by them, or their own registered job seekers. */
  private placementOwner(ids: string[]): Prisma.PlacementWhereInput {
    return { OR: [{ createdByStaffId: { in: ids } }, { jobSeeker: { registeredByStaffId: { in: ids } } }] };
  }

  async counts(ids: string[], range: DateRange): Promise<WorkCounts> {
    if (!ids.length) {
      return { registered: 0, paid: 0, interviewsDone: 0, offered: 0, placed: 0, leftWithin30: 0, businessesSignedUp: 0, vacancies: 0, vacanciesClosed: 0, vacanciesFilled: 0, daysToFill: null };
    }
    const r = { gte: range.from, lte: range.to };
    const owner = this.placementOwner(ids);
    const [registered, paid, interviewsDone, offered, placed, leavers, signed, vacancies, closed, selected] = await Promise.all([
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: ids }, createdAt: r } }),
      this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: ids }, paymentReceivedAt: r } }),
      this.prisma.interview.count({ where: { proposedByStaffId: { in: ids }, slotStartsAt: r, status: 'completed' } }),
      this.prisma.interview.count({ where: { proposedByStaffId: { in: ids }, resultRecordedAt: r, result: 'selected' } }),
      this.prisma.placement.count({ where: { AND: [owner, { joinedDate: r, status: { not: 'cancelled' } }] } }),
      this.prisma.placement.findMany({ where: { AND: [owner, { dropoutReportedAt: r, joinedDate: { not: null } }] }, select: { joinedDate: true, dropoutReportedAt: true } }),
      this.prisma.businessAgreement.findMany({
        where: { signedAt: r, business: { OR: [{ accountAgentId: { in: ids } }, { leadCreatedByStaffId: { in: ids } }] } },
        distinct: ['businessId'],
        select: { businessId: true },
      }),
      this.prisma.vacancy.count({ where: { capturedByStaffId: { in: ids }, createdAt: r } }),
      this.prisma.vacancy.groupBy({ by: ['status'], where: { capturedByStaffId: { in: ids }, status: { in: ['filled', 'cancelled'] }, updatedAt: r }, _count: { _all: true } }),
      this.prisma.placement.findMany({ where: { AND: [owner, { selectedAt: r }] }, select: { selectedAt: true, vacancy: { select: { createdAt: true } } } }),
    ]);
    const leftWithin30 = leavers.filter(
      (p) => p.joinedDate && p.dropoutReportedAt && p.dropoutReportedAt.getTime() - p.joinedDate.getTime() <= 30 * DAY_MS,
    ).length;
    const filled = closed.find((c) => c.status === 'filled')?._count._all ?? 0;
    const cancelled = closed.find((c) => c.status === 'cancelled')?._count._all ?? 0;
    const fillDays = selected
      .filter((p) => p.selectedAt)
      .map((p) => Math.max(0, Math.round(((p.selectedAt as Date).getTime() - p.vacancy.createdAt.getTime()) / DAY_MS)));
    return {
      registered,
      paid,
      interviewsDone,
      offered,
      placed,
      leftWithin30,
      businessesSignedUp: signed.length,
      vacancies,
      vacanciesClosed: filled + cancelled,
      vacanciesFilled: filled,
      daysToFill: median(fillDays),
    };
  }
}
