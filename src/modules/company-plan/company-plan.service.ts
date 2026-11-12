import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { CompanyPlan, TeamPlan } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { istDayKey } from '../ceo-portal/ceo-common';
import { teamLabel } from '../ceo-portal/ceo-team.service';

/**
 * The metrics of the CEO's monthly plan (designs C-Team-Targets, MG-Targets,
 * MG-Plan, MG-Home): the guide's Manager home numbers plus repeat businesses
 * from the agents' targets. All counts; `leftWithin30` is a limit (at most).
 */
export const PLAN_METRICS = ['registered', 'paid', 'businessesSignedUp', 'vacancies', 'interviewsDone', 'placed', 'leftWithin30', 'repeatBusinesses'] as const;
export type PlanMetricKey = (typeof PLAN_METRICS)[number];
export type PlanValues = Record<PlanMetricKey, number | null>;

export const PLAN_METRIC_LABEL: Record<PlanMetricKey, string> = {
  registered: 'Registrations',
  paid: 'Paid ₹499',
  businessesSignedUp: 'Businesses',
  vacancies: 'Vacancies',
  interviewsDone: 'Interviews',
  placed: 'Placements',
  leftWithin30: 'Left within 30 days (limit)',
  repeatBusinesses: 'Repeat businesses',
};

/** The agent target field each plan metric is the sum of (the rest have no agent target). */
export const AGENT_TARGET_FIELD: Partial<Record<PlanMetricKey, 'candidatesActivated' | 'vacanciesCaptured' | 'placementsClosed' | 'repeatBusinesses'>> = {
  paid: 'candidatesActivated',
  vacancies: 'vacanciesCaptured',
  placed: 'placementsClosed',
  repeatBusinesses: 'repeatBusinesses',
};

export function emptyPlan(): PlanValues {
  return { registered: null, paid: null, businessesSignedUp: null, vacancies: null, interviewsDone: null, placed: null, leftWithin30: null, repeatBusinesses: null };
}

export function valuesOf(row: Partial<Record<PlanMetricKey, number | null>> | null | undefined): PlanValues {
  const out = emptyPlan();
  if (!row) return out;
  for (const key of PLAN_METRICS) out[key] = typeof row[key] === 'number' ? (row[key] as number) : null;
  return out;
}

/** Sum of the values that are set; null when none is. */
export function sumOrNull(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/**
 * Per metric: does the teams' split add up to the CEO's plan? `null` when the
 * CEO set no number for it; otherwise the difference (split − plan, 0 when it
 * adds up).
 */
export function splitDifference(plan: PlanValues | null, split: PlanValues): Record<PlanMetricKey, number | null> {
  const out = {} as Record<PlanMetricKey, number | null>;
  for (const key of PLAN_METRICS) {
    const p = plan?.[key];
    out[key] = typeof p === 'number' ? (split[key] ?? 0) - p : null;
  }
  return out;
}

/** Parse the metric numbers in a request body: whole numbers 0–100,000, empty = not set. Undefined keys are left out. */
export function parseValues(body: Record<string, unknown> | null | undefined): Partial<PlanValues> {
  const out: Partial<PlanValues> = {};
  for (const key of PLAN_METRICS) {
    const value = body?.[key];
    if (value === undefined) continue;
    if (value === null || value === '') {
      out[key] = null;
      continue;
    }
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100000) {
      throw new BadRequestException(`${key} must be a whole number of 0 or more`);
    }
    out[key] = n;
  }
  return out;
}

function changed(before: PlanValues, after: PlanValues): PlanMetricKey[] {
  return PLAN_METRICS.filter((key) => before[key] !== after[key]);
}

/**
 * The CEO's monthly company plan (CompanyPlan) and the Managers' split of it
 * into teams (TeamPlan). Every change is audited with the numbers before and
 * after. Past months are not changed (the same rule as agent targets).
 */
@Injectable()
export class CompanyPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertNotPast(year: number, month: number, now: Date) {
    const [ny, nm] = istDayKey(now).split('-').map(Number);
    if (year * 12 + month < ny * 12 + nm) throw new BadRequestException('A past month cannot be changed');
  }

  async company(year: number, month: number): Promise<CompanyPlan | null> {
    return this.prisma.companyPlan.findUnique({ where: { year_month: { year, month } } });
  }

  /** Every team's split for a month (optionally only these Team Leads). */
  async teamPlans(year: number, month: number, leadIds?: string[]): Promise<TeamPlan[]> {
    return this.prisma.teamPlan.findMany({ where: { year, month, ...(leadIds ? { teamLeadId: { in: leadIds } } : {}) } });
  }

  /** The CEO sets (or changes) the month's plan. CEO only. */
  async setCompany(actor: { id: string; role: string }, year: number, month: number, body: Record<string, unknown>, now: Date) {
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO sets the company plan');
    this.assertNotPast(year, month, now);
    const values = parseValues(body);
    if (!Object.keys(values).length) throw new BadRequestException('Give at least one number of the plan');
    const existing = await this.company(year, month);
    const before = valuesOf(existing);
    const after = { ...before, ...values };
    const fields = changed(before, after);
    if (existing && !fields.length) return existing;
    const saved = await this.prisma.companyPlan.upsert({
      where: { year_month: { year, month } },
      create: { year, month, ...after, setByStaffId: actor.id },
      update: { ...values, setByStaffId: actor.id },
    });
    await this.audit.log({
      actorId: actor.id,
      action: existing ? 'company_plan.updated' : 'company_plan.set',
      entityType: 'company_plan',
      entityCode: `${year}-${String(month).padStart(2, '0')}`,
      before: existing ? { ...before } : null,
      after: { ...after },
      changedFields: fields,
    });
    return saved;
  }

  /**
   * A Manager saves the split for teams in their tree (`allowedLeadIds`).
   * Each row: { teamLeadId, ...metrics }. Changes are audited per team.
   */
  async saveTeamPlans(
    actor: { id: string; role: string },
    year: number,
    month: number,
    rows: unknown,
    allowedLeadIds: string[],
    now: Date,
  ): Promise<{ created: number; updated: number; unchanged: number }> {
    if (actor.role !== 'manager') throw new ForbiddenException('A Manager splits the plan for their own teams');
    this.assertNotPast(year, month, now);
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('rows must list the teams to save');
    if (rows.length > 100) throw new BadRequestException('At most 100 teams at a time');
    const allowed = new Set(allowedLeadIds);
    const parsed = (rows as Array<Record<string, unknown>>).map((row) => {
      const teamLeadId = typeof row?.teamLeadId === 'string' ? row.teamLeadId : '';
      if (!allowed.has(teamLeadId)) throw new ForbiddenException('Every row must be a team in your reporting tree');
      return { teamLeadId, values: parseValues(row) };
    });
    const leads = await this.prisma.staff.findMany({ where: { id: { in: parsed.map((p) => p.teamLeadId) } }, select: { id: true, code: true } });
    const codeOf = new Map(leads.map((l) => [l.id, l.code]));
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const row of parsed) {
      const existing = await this.prisma.teamPlan.findUnique({ where: { teamLeadId_year_month: { teamLeadId: row.teamLeadId, year, month } } });
      const before = valuesOf(existing);
      const after = { ...before, ...row.values };
      const fields = changed(before, after);
      if (!fields.length) {
        unchanged += 1;
        continue;
      }
      await this.prisma.teamPlan.upsert({
        where: { teamLeadId_year_month: { teamLeadId: row.teamLeadId, year, month } },
        create: { teamLeadId: row.teamLeadId, year, month, ...after, setByStaffId: actor.id },
        update: { ...row.values, setByStaffId: actor.id },
      });
      await this.audit.log({
        actorId: actor.id,
        action: existing ? 'team_plan.updated' : 'team_plan.set',
        entityType: 'team_plan',
        entityCode: `${codeOf.get(row.teamLeadId) ?? row.teamLeadId}:${year}-${String(month).padStart(2, '0')}`,
        before: existing ? { ...before } : null,
        after: { ...after },
        changedFields: fields,
      });
      if (existing) updated += 1;
      else created += 1;
    }
    return { created, updated, unchanged };
  }

  /** The agents' monthly targets summed per plan metric (null where no agent has one). */
  async agentSums(staffIds: string[], year: number, month: number): Promise<PlanValues> {
    const out = emptyPlan();
    if (!staffIds.length) return out;
    const rows = await this.prisma.target.findMany({ where: { staffId: { in: staffIds }, year, month } });
    for (const key of PLAN_METRICS) {
      const field = AGENT_TARGET_FIELD[key];
      if (field) out[key] = sumOrNull(rows.map((r) => r[field]));
    }
    return out;
  }

  /**
   * The CEO's view: the plan, every team's split and whether it adds up
   * (C-Team-Targets "Company plan"). Counts only.
   */
  async ceoBoard(year: number, month: number) {
    const [plan, splits, leads] = await Promise.all([
      this.company(year, month),
      this.teamPlans(year, month),
      this.prisma.staff.findMany({
        where: { role: 'team_lead', status: { not: 'deactivated' } },
        select: { id: true, code: true, name: true, teamName: true, reportsTo: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);
    const planValues = plan ? valuesOf(plan) : null;
    const teams = leads.map((l) => ({
      teamLeadId: l.id,
      team: teamLabel(l) as string,
      teamLead: l.name,
      manager: l.reportsTo ? { id: l.reportsTo.id, name: l.reportsTo.name } : null,
      split: valuesOf(splits.find((s) => s.teamLeadId === l.id)),
    }));
    const total = emptyPlan();
    for (const key of PLAN_METRICS) total[key] = sumOrNull(teams.map((t) => t.split[key]));
    return {
      year,
      month,
      plan: planValues,
      setAt: plan?.updatedAt.toISOString() ?? null,
      teams,
      total,
      difference: splitDifference(planValues, total),
    };
  }
}
