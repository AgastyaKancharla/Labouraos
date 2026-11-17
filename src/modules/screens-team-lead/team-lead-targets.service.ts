import { BadRequestException, Injectable } from '@nestjs/common';
import { OwnTeam } from '../../common/rbac/own-team';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { parseMonth } from '../ceo-portal/ceo-team.service';
import { CompanyPlanService, PLAN_METRICS, PLAN_METRIC_LABEL, PlanMetricKey, valuesOf } from '../company-plan/company-plan.service';
import { TargetSplitService } from '../company-plan/target-split.service';
import { AGENT_FIELD_LABEL, AgentField, fieldsFor, workTypeOf } from '../company-plan/target-split';
import { monthOf } from '../screens-manager/manager-common';
import { ManagerTreeService } from '../screens-manager/manager-tree.service';
import { CallAgentMetricsService } from '../target/call-agent-metrics.service';
import { FieldAgentMetricsService } from '../target/field-agent-metrics.service';
import { paceRow } from './pace';
import { Actor, TeamLeadScreensService } from './team-lead-screens.service';

const HINT: Record<PlanMetricKey, string> = {
  registered: 'Profile made by an agent',
  paid: 'Job seekers who paid on their own phone',
  businessesSignedUp: 'Owner confirmed by OTP',
  vacancies: 'New job openings added',
  interviewsDone: 'Job seeker met the owner',
  placed: 'Each one earns a placement fee',
  leftWithin30: 'Placed people who left within 30 days: at most this many',
  repeatBusinesses: 'Businesses that hired through Laboura again',
};

/**
 * T-Targets with the automatic split (17 Nov): the team's eight numbers from
 * the team plan (TeamPlan) with what is done, each agent's targets marked
 * "Automatic" or "Set by hand", and the Team Lead's own changes for their
 * agents (PUT /team-lead/targets), "Reset to automatic" and "Transfer target".
 * Own team only, counts only; past months read-only.
 */
@Injectable()
export class TeamLeadTargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly screens: TeamLeadScreensService,
    private readonly split: TargetSplitService,
    private readonly plans: CompanyPlanService,
    private readonly tree: ManagerTreeService,
    private readonly callMetrics: CallAgentMetricsService,
    private readonly fieldMetrics: FieldAgentMetricsService,
    private readonly clock: AttendanceClock,
  ) {}

  async plan(actor: Actor, year?: unknown, month?: unknown) {
    const members = await this.screens.trackedMembers(actor);
    const now = this.clock.now();
    const sel = parseMonth(year, month, now);
    const m = monthOf(sel.year, sel.month, now);
    const started = now.getTime() >= m.from.getTime();
    const ids = members.map((r) => r.id);
    const [teamPlan, company, marks, targets] = await Promise.all([
      this.plans.teamPlans(m.year, m.month, [actor.id]).then((rows) => rows[0] ?? null),
      this.plans.company(m.year, m.month),
      this.split.readMarks(m.year, m.month, [actor.id], now),
      ids.length ? this.prisma.target.findMany({ where: { staffId: { in: ids }, year: m.year, month: m.month } }) : Promise.resolve([]),
    ]);
    const range = { from: m.from, to: now.getTime() < m.to.getTime() ? now : m.to };
    const counts = started ? await this.tree.counts([...ids, actor.id], range) : null;
    const agents = [];
    let repeatDone = 0;
    for (const member of members) {
      const type = workTypeOf(member.role);
      if (!type) continue;
      const target = targets.find((t) => t.staffId === member.id) ?? null;
      const done: Partial<Record<AgentField, number>> = {};
      if (started) {
        if (type === 'call') {
          const r = await this.callMetrics.getCallAgentMetrics(member.id, m.year, m.month, undefined, now);
          done.candidatesActivated = r.metrics.candidatesActivated;
          done.vacanciesCaptured = r.metrics.vacanciesCaptured;
        } else {
          const r = await this.fieldMetrics.getFieldAgentMetrics(member.id, m.year, m.month, undefined, now);
          done.placementsClosed = r.metrics.placementsClosed;
          done.repeatBusinesses = r.metrics.repeatBusinesses;
          repeatDone += r.metrics.repeatBusinesses;
        }
      }
      agents.push({
        staff: { id: member.id, code: member.code, name: member.name, role: member.role },
        workType: type,
        fields: fieldsFor(type).map((field) => ({
          field,
          label: AGENT_FIELD_LABEL[field],
          target: target?.[field] ?? null,
          done: done[field] ?? 0,
          handSet: Boolean(target?.handSetFields.includes(field)),
        })),
      });
    }
    const values = valuesOf(teamPlan);
    const doneOf: Record<PlanMetricKey, number> = {
      registered: counts?.registered ?? 0,
      paid: counts?.paid ?? 0,
      businessesSignedUp: counts?.businessesSignedUp ?? 0,
      vacancies: counts?.vacancies ?? 0,
      interviewsDone: counts?.interviewsDone ?? 0,
      placed: counts?.placed ?? 0,
      leftWithin30: counts?.leftWithin30 ?? 0,
      repeatBusinesses: repeatDone,
    };
    const team = PLAN_METRICS.map((key) => {
      const row = paceRow(values[key], doneOf[key], m.dayOfMonth, m.daysInMonth);
      if (key === 'leftWithin30' && values[key] !== null) {
        // A limit: fewer is better.
        const over = doneOf[key] - (values[key] as number);
        Object.assign(row, { stillToDo: null, needPerDay: null, verdict: over > 0 ? `Over the limit by ${over}` : 'Within the limit', onTrack: over <= 0 });
      }
      return { key, label: PLAN_METRIC_LABEL[key], hint: HINT[key], limit: key === 'leftWithin30', handSet: Boolean(teamPlan?.handSetFields.includes(key)), ...row };
    });
    const mark = marks.teams[0];
    // Agents who left the team this month with a target: their unreached part can be transferred.
    const everyone = (await new OwnTeam(this.prisma).memberIds(actor.id)).filter((id) => id !== actor.id);
    const leftPeople = everyone.length
      ? await this.prisma.staff.findMany({
          where: { id: { in: everyone }, status: 'deactivated', isOwnerAccount: false, deactivatedAt: { gte: m.from } },
          select: { id: true, code: true, name: true, role: true },
          orderBy: { name: 'asc' },
        })
      : [];
    const leftTargets = leftPeople.length ? await this.prisma.target.findMany({ where: { staffId: { in: leftPeople.map((p) => p.id) }, year: m.year, month: m.month } }) : [];
    const left = leftPeople
      .map((p) => {
        const t = leftTargets.find((x) => x.staffId === p.id);
        return t ? { staff: p, target: { candidatesActivated: t.candidatesActivated, vacanciesCaptured: t.vacanciesCaptured, placementsClosed: t.placementsClosed, repeatBusinesses: t.repeatBusinesses } } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      left,
      year: m.year,
      month: m.month,
      dayOfMonth: m.dayOfMonth,
      daysInMonth: m.daysInMonth,
      editable: now.getTime() <= m.to.getTime(),
      automatic: Boolean(company),
      team,
      flags: mark?.flags ?? [],
      leaverCredit: mark?.leaverCredit ?? {},
      agents,
    };
  }

  private async memberIds(actor: Actor): Promise<string[]> {
    return (await this.screens.trackedMembers(actor)).map((r) => r.id);
  }

  /** The Team Lead's own changes: { year, month, rows: [{ staffId, candidatesActivated?, … }] } for agents in their team. */
  async save(actor: Actor, body: { year?: unknown; month?: unknown; rows?: unknown }) {
    const now = this.clock.now();
    const sel = parseMonth(body?.year, body?.month, now);
    if (!Array.isArray(body?.rows) || body.rows.length === 0) throw new BadRequestException('rows must list the targets to save');
    await this.split.saveAgentValues(actor, sel.year, sel.month, body.rows, await this.memberIds(actor), now);
    return this.plan(actor, sel.year, sel.month);
  }

  /** "Reset to automatic" for one of the Team Lead's agents: { year, month, staffId, field? }. */
  async reset(actor: Actor, body: { year?: unknown; month?: unknown; staffId?: unknown; field?: unknown }) {
    const now = this.clock.now();
    const sel = parseMonth(body?.year, body?.month, now);
    const result = await this.split.reset(actor, { year: sel.year, month: sel.month, kind: 'agent', id: body?.staffId, key: body?.field }, { leadIds: [], agentIds: await this.memberIds(actor) }, now);
    return { ...result, plan: await this.plan(actor, sel.year, sel.month) };
  }

  /** "Transfer target" inside the team: { year, month, fromStaffId, toStaffId }; the one giving may have left the team. */
  async transfer(actor: Actor, body: { year?: unknown; month?: unknown; fromStaffId?: unknown; toStaffId?: unknown }) {
    const now = this.clock.now();
    const sel = parseMonth(body?.year, body?.month, now);
    const active = new Set(await this.memberIds(actor));
    const team = new OwnTeam(this.prisma);
    return this.split.transfer(
      actor,
      { year: sel.year, month: sel.month, fromStaffId: body?.fromStaffId, toStaffId: body?.toStaffId },
      async (staffId, opts) => active.has(staffId) || (opts.allowLeft && staffId !== actor.id && (await team.includes(actor.id, staffId))),
      now,
    );
  }
}
