import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DAY_MS, istDayKey, istStartOfDay } from '../ceo-portal/ceo-common';
import { CeoCommandCenterService } from '../ceo-portal/ceo-command-center.service';
import { CompanyPlanService, PLAN_METRICS, emptyPlan, valuesOf } from '../company-plan/company-plan.service';
import { MoneyUnderGuaranteeService } from '../growth/money-under-guarantee.service';
import { notificationLink } from '../notification/notification.constants';
import { NotificationService } from '../notification/notification.service';
import { ManagerPlanService } from '../screens-manager/manager-plan.service';
import { ManagerTreeService } from '../screens-manager/manager-tree.service';
import { monthWindow } from '../screens-manager/manager-common';

export interface ReportWeek {
  /** yyyy-mm-dd of the Monday (IST). */
  start: string;
  /** yyyy-mm-dd of the Sunday (IST). */
  end: string;
  from: Date;
  to: Date;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Monday–Sunday week (IST) that starts on `monday` (yyyy-mm-dd). */
export function weekStarting(monday: string): ReportWeek {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) throw new BadRequestException('week must be a date like 2026-11-09');
  const day = new Date(`${monday}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) throw new BadRequestException('week must be a valid date');
  if (day.getUTCDay() !== 1) throw new BadRequestException('A report week starts on a Monday');
  const from = istStartOfDay(monday);
  const to = new Date(from.getTime() + 7 * DAY_MS - 1);
  return { start: monday, end: istDayKey(to), from, to };
}

/** The last full Monday–Sunday week (IST) before `now`: on Monday 16 Nov, 9–15 Nov. */
export function lastFullWeek(now: Date): ReportWeek {
  const today = new Date(`${istDayKey(now)}T00:00:00.000Z`);
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const thisMonday = new Date(today.getTime() - sinceMonday * DAY_MS);
  return weekStarting(new Date(thisMonday.getTime() - 7 * DAY_MS).toISOString().slice(0, 10));
}

/** "9–15 Nov", "30 Nov – 6 Dec". */
export function weekLabel(week: Pick<ReportWeek, 'start' | 'end'>): string {
  const [, sm, sd] = week.start.split('-').map(Number);
  const [, em, ed] = week.end.split('-').map(Number);
  return sm === em ? `${sd}–${ed} ${MONTHS[em - 1]}` : `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
}

export interface WeeklyRunResult {
  managers: number;
  created: number;
  alreadyThere: number;
  bells: number;
  failed: number;
}

/**
 * The Monday weekly report (MG-Reports "sent every Monday at 9 AM", C-Reports):
 * builds last week's report for each Manager's tree (counts only, the same
 * content as MG-Reports) and for the whole company for the CEO (the C-Reports
 * content for that week, plus the same weekly counts), keeps each as a
 * snapshot (WeeklyReport) and rings a bell that opens it. A week that already
 * has its snapshot is not built or rung again, so a repeated run does nothing.
 */
@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: ManagerTreeService,
    private readonly plan: ManagerPlanService,
    private readonly ceo: CeoCommandCenterService,
    private readonly guarantee: MoneyUnderGuaranteeService,
    private readonly plans: CompanyPlanService,
    private readonly notifications: NotificationService,
  ) {}

  /** Build, keep and announce last week's reports. Safe to run twice. */
  async run(now: Date = new Date()): Promise<WeeklyRunResult> {
    const week = lastFullWeek(now);
    const result: WeeklyRunResult = { managers: 0, created: 0, alreadyThere: 0, bells: 0, failed: 0 };
    const managers = await this.prisma.staff.findMany({ where: { role: 'manager', status: 'active' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    result.managers = managers.length;
    for (const manager of managers) {
      try {
        const made = await this.keep(`manager:${manager.id}`, 'manager', manager.id, week, async () => this.managerContent(manager.id, week, now));
        if (made) result.created += 1;
        else result.alreadyThere += 1;
        if (made && (await this.ring(manager.id, 'manager', week, 'Your teams'))) result.bells += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.error(`Weekly report for a Manager failed: ${(error as Error).message}`);
      }
    }
    try {
      const made = await this.keep('company', 'company', null, week, async () => this.companyContent(week, now));
      if (made) {
        result.created += 1;
        const ceos = await this.prisma.staff.findMany({ where: { role: 'ceo', status: 'active' }, select: { id: true } });
        for (const ceo of ceos) if (await this.ring(ceo.id, 'ceo', week, 'The whole company')) result.bells += 1;
      } else {
        result.alreadyThere += 1;
      }
    } catch (error) {
      result.failed += 1;
      this.logger.error(`Weekly report for the company failed: ${(error as Error).message}`);
    }
    if (result.failed) throw new Error(`${result.failed} weekly report(s) could not be built`);
    return result;
  }

  /** MG-Reports content for one Manager's tree and week — counts only. */
  async managerContent(managerId: string, week: ReportWeek, now: Date) {
    const tree = await this.tree.load(managerId);
    const report = await this.plan.weekReport(tree, week, now);
    return { week: { start: week.start, end: week.end, label: weekLabel(week) }, ...report };
  }

  /** The CEO's report for one week: the whole company's weekly counts and the C-Reports content. */
  async companyContent(week: ReportWeek, now: Date) {
    const tree = await this.tree.company();
    const m = monthWindow(week.to, now);
    // The whole company's plan: the CEO's plan where set, else the agents' targets.
    const [company, agents] = await Promise.all([this.plans.company(m.year, m.month), this.plans.agentSums(tree.ids, m.year, m.month)]);
    const values = valuesOf(company);
    const targets = emptyPlan();
    for (const key of PLAN_METRICS) targets[key] = values[key] ?? agents[key];
    const [weekly, reports, guarantee] = await Promise.all([
      this.plan.weekReport(tree, week, now, targets),
      this.ceo.reports({ from: week.from, to: week.to }, now),
      this.guarantee.report({ from: week.start, to: week.end, includeRows: false }, now).catch((error: Error) => {
        this.logger.warn(`Money under guarantee left out of the weekly report: ${error.message}`);
        return null;
      }),
    ]);
    return { week: { start: week.start, end: week.end, label: weekLabel(week) }, ...weekly, reports, guarantee };
  }

  /** Keep the snapshot once; false when that scope already has this week's report. */
  private async keep(scopeKey: string, scope: 'manager' | 'company', ownerStaffId: string | null, week: ReportWeek, build: () => Promise<unknown>): Promise<boolean> {
    const weekStart = new Date(`${week.start}T00:00:00.000Z`);
    const existing = await this.prisma.weeklyReport.findUnique({ where: { scopeKey_weekStart: { scopeKey, weekStart } }, select: { id: true } });
    if (existing) return false;
    const content = (await build()) as Prisma.InputJsonValue;
    try {
      await this.prisma.weeklyReport.create({ data: { scopeKey, scope, ownerStaffId, weekStart, content: JSON.parse(JSON.stringify(content)) as Prisma.InputJsonValue } });
      return true;
    } catch (error) {
      // Another run kept it a moment ago: not a second report, and no second bell.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  private async ring(staffId: string, role: 'manager' | 'ceo', week: ReportWeek, who: string): Promise<boolean> {
    const opened = await this.notifications.open({
      recipientStaffId: staffId,
      kind: 'weekly_report',
      title: `Weekly report · ${weekLabel(week)}`,
      body: role === 'manager' ? `${who} last week, against plan · counts only` : `${who} last week · ready to open or download`,
      link: notificationLink(role, 'weekly_report', { week: week.start }),
      subjectType: 'weekly_report',
      subjectId: week.start,
      once: true,
    });
    return Boolean(opened);
  }

  // ------------------------------------------------------------- reading

  private scopeOf(actor: { id: string; role: string }): string {
    if (actor.role === 'manager') return `manager:${actor.id}`;
    if (actor.role === 'ceo') return 'company';
    throw new ForbiddenException('Weekly reports are for Managers and the CEO');
  }

  /** The kept reports for the caller (a Manager: their own; the CEO: the company's), newest first. */
  async list(actor: { id: string; role: string }) {
    const rows = await this.prisma.weeklyReport.findMany({
      where: { scopeKey: this.scopeOf(actor) },
      orderBy: { weekStart: 'desc' },
      take: 104,
      select: { weekStart: true, createdAt: true },
    });
    return rows.map((r) => {
      const start = r.weekStart.toISOString().slice(0, 10);
      const week = weekStarting(start);
      return { week: start, end: week.end, label: weekLabel(week), sentAt: r.createdAt.toISOString() };
    });
  }

  /** One kept report, as it was sent. */
  async get(actor: { id: string; role: string }, weekText: string) {
    const week = weekStarting(weekText);
    const row = await this.prisma.weeklyReport.findUnique({
      where: { scopeKey_weekStart: { scopeKey: this.scopeOf(actor), weekStart: new Date(`${week.start}T00:00:00.000Z`) } },
    });
    if (!row) throw new NotFoundException(`No weekly report was kept for the week of ${weekLabel(week)}`);
    return { week: week.start, end: week.end, label: weekLabel(week), sentAt: row.createdAt.toISOString(), content: row.content };
  }
}

