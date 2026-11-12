import { maskCsvPhoneColumns } from '../../common/csv/csv-phone-mask';
import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REFUND_FORFEITING_HIT_REASONS } from '../job-seeker/job-seeker-refund-guards';
import { PricingService } from '../pricing/pricing.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { NotificationClock } from '../notification/notification-clock';
import { notificationLink } from '../notification/notification.constants';
import { NotificationDraft, NotificationService } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { DirectoryRow } from '../notification/staff-directory';
import {
  DAY_MS,
  OFFER_STATUSES,
  PRIORITY_BUCKETS,
  PriorityBucket,
  SEEKER_ENDED_STATUSES,
  daysLeftOn,
  priorityBucket,
} from './refund-priority.rules';

const RECEIVED_STATUSES = ['succeeded', 'completed'];
const DEAD_REFUND_STATUSES = ['failed', 'rejected', 'reversed'];
const AGENT_ROLES = ['call_agent', 'field_agent'];
/** Reads refresh the bells at most this often per process. */
const BELL_SYNC_THROTTLE_MS = 60_000;

/** One person (or one business placement) inside the close-to-refund window. */
export interface PriorityRow {
  kind: 'job_seeker' | 'business';
  /** Job seeker id, or the placement id for a business refund. */
  id: string;
  /** JS-… for a job seeker, the placement code for a business. */
  code: string;
  /** Job seeker's name or business name; left out for Finance (personal data masked). */
  name: string | null;
  trade: string | null;
  daysLeft: number;
  bucket: PriorityBucket;
  deadline: string;
  priority: true;
  /** Who works on it: the agent who registered the job seeker, or the business's account agent. */
  agent: { id: string; code: string; name: string } | null;
  businessId: string | null;
  businessName: string | null;
  /** Paise. CEO and Finance only — never in a Manager's, Team Lead's or agent's answer. */
  atStakePaise?: number;
}

export interface PriorityQuery {
  who?: string;
  bucket?: string;
  teamLeadId?: string;
  agentId?: string;
}

interface Actor {
  id: string;
  role: string;
}

interface Scope {
  /** Agents whose people the caller sees, or null for everyone. */
  staffIds: Set<string> | null;
  money: boolean;
  names: boolean;
  download: boolean;
}

/**
 * Close to a refund: the 15-day priority (Phase 21 Task 7, Master Guide
 * "Refund priority and bells", decided 9 Nov). Finding a job takes about a
 * week, so the warning starts `refundPriorityWindowDays` (Settings, 15) days
 * before a refund falls due:
 * - job seekers who paid, whose 30-day guarantee runs out within the window,
 *   with no suitable offer yet (no interview booked since paying), and whose
 *   refund has not already ended (declined, no reply, no-show) or been paid;
 * - businesses whose placement refund falls due within the window because no
 *   replacement has been found (dropped out, claim not turned down, no
 *   accepted replacement, no refund yet), counted from the dropout report.
 *
 * Grouped 0–5, 6–10 and 11–15 days. Rupees only for the CEO and Finance.
 */
@Injectable()
export class RefundPriorityService {
  private readonly logger = new Logger(RefundPriorityService.name);
  private lastBellSync = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly scope: ReportingScopeService,
    private readonly clock: NotificationClock,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly sources?: NotificationSourcesService,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  /** Everyone in the window, unscoped, with rupees. Soonest first. */
  async rows(now: Date = this.clock.now()): Promise<{ windowDays: number; rows: PriorityRow[] }> {
    const policy = await this.pricing.current();
    const windowDays = policy.refundPriorityWindowDays;
    const guaranteeDays = policy.jobSeekerGuaranteeDays;
    const searchDays = policy.replacementSearchDays;
    const rows: PriorityRow[] = [];

    // Job seekers: paid within (guaranteeDays − windowDays − 1 .. guaranteeDays) days ago.
    const oldest = new Date(now.getTime() - guaranteeDays * DAY_MS);
    const newest = new Date(now.getTime() - (guaranteeDays - windowDays - 1) * DAY_MS);
    const seekers = await this.prisma.jobSeeker.findMany({
      where: {
        anonymisedAt: null,
        status: { notIn: SEEKER_ENDED_STATUSES },
        paymentReceivedAt: { gt: oldest, lte: newest },
      },
      include: {
        trades: { select: { trade: true, isPrimary: true } },
        registeredBy: { select: { id: true, code: true, name: true } },
        interviews: { select: { status: true, offerSentAt: true } },
        hits: {
          where: { reversedAt: null, supersededAt: null, reason: { in: [...REFUND_FORFEITING_HIT_REASONS] } },
          select: { id: true },
        },
        payments: {
          where: { type: { in: ['activation', 'reactivation', 'refund'] } },
          select: { type: true, status: true, amount: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    for (const s of seekers) {
      const paidAt = s.paymentReceivedAt as Date;
      if (s.hits.length > 0) continue;
      if (s.payments.some((p) => p.type === 'refund' && p.createdAt >= paidAt && !DEAD_REFUND_STATUSES.includes(p.status))) {
        continue;
      }
      if (s.interviews.some((i) => i.offerSentAt >= paidAt && OFFER_STATUSES.includes(i.status))) continue;
      const deadline = new Date(paidAt.getTime() + guaranteeDays * DAY_MS);
      const left = daysLeftOn(deadline, now);
      const bucket = priorityBucket(left, windowDays);
      if (!bucket) continue;
      const activation = s.payments.find(
        (p) => (p.type === 'activation' || p.type === 'reactivation') && RECEIVED_STATUSES.includes(p.status),
      );
      rows.push({
        kind: 'job_seeker',
        id: s.id,
        code: s.code,
        name: s.name,
        trade: s.trades.find((t) => t.isPrimary)?.trade ?? s.trades[0]?.trade ?? null,
        daysLeft: left,
        bucket,
        deadline: deadline.toISOString(),
        priority: true,
        agent: s.registeredBy,
        businessId: null,
        businessName: null,
        atStakePaise: activation?.amount ?? policy.activationFeePaise,
      });
    }

    // Businesses: a replacement search whose refund falls due within the window.
    const searchFloor = new Date(now.getTime() - searchDays * DAY_MS);
    const placements = await this.prisma.placement.findMany({
      where: {
        status: 'dropped_out',
        guaranteeEndedReason: null,
        dropoutReportedAt: { gt: new Date(searchFloor.getTime() - DAY_MS) },
      },
      include: {
        business: { select: { id: true, name: true, accountAgentId: true } },
        vacancy: { select: { tradeSkill: true } },
        replacementCandidates: { select: { status: true } },
        replacementClaims: { select: { decision: true, reportedAt: true }, orderBy: { reportedAt: 'desc' } },
        payments: { where: { type: 'refund' }, select: { status: true } },
      },
    });
    const agentIds = [
      ...new Set(placements.map((p) => p.business.accountAgentId).filter((id): id is string => Boolean(id))),
    ];
    const agents = agentIds.length
      ? await this.prisma.staff.findMany({ where: { id: { in: agentIds } }, select: { id: true, code: true, name: true } })
      : [];
    const agentById = new Map(agents.map((a) => [a.id, a]));
    for (const p of placements) {
      if (p.replacementCandidates.some((r) => r.status === 'accepted')) continue;
      if (p.payments.some((r) => !DEAD_REFUND_STATUSES.includes(r.status))) continue;
      const claim = p.replacementClaims[0];
      // A turned-down claim carries no refund.
      if (claim?.decision === 'rejected') continue;
      const start = claim?.reportedAt ?? p.dropoutReportedAt;
      if (!start) continue;
      const deadline = new Date(start.getTime() + searchDays * DAY_MS);
      const left = daysLeftOn(deadline, now);
      const bucket = priorityBucket(left, windowDays);
      if (!bucket) continue;
      rows.push({
        kind: 'business',
        id: p.id,
        code: p.code,
        name: p.business.name,
        trade: p.vacancy.tradeSkill,
        daysLeft: left,
        bucket,
        deadline: deadline.toISOString(),
        priority: true,
        agent: p.business.accountAgentId ? (agentById.get(p.business.accountAgentId) ?? null) : null,
        businessId: p.business.id,
        businessName: p.business.name,
        atStakePaise: p.placementFee,
      });
    }

    rows.sort(
      (a, b) =>
        a.daysLeft - b.daysLeft ||
        (b.atStakePaise ?? 0) - (a.atStakePaise ?? 0) ||
        a.code.localeCompare(b.code),
    );
    return { windowDays, rows };
  }

  /** Job seeker id → days left, for everyone in the window (used to put them first in work lists). */
  async priorityDaysLeft(now: Date = this.clock.now()): Promise<Map<string, number>> {
    const { rows } = await this.rows(now);
    return new Map(rows.filter((row) => row.kind === 'job_seeker').map((row) => [row.id, row.daysLeft]));
  }

  // ------------------------------------------------------------------ scope

  private async scopeFor(actor: Actor): Promise<Scope> {
    switch (actor.role) {
      case 'ceo':
        return { staffIds: null, money: true, names: true, download: true };
      case 'finance':
        return { staffIds: null, money: true, names: false, download: true };
      case 'manager':
        return {
          staffIds: new Set([actor.id, ...(await this.scope.peopleUnder(actor.id))]),
          money: false,
          names: true,
          download: true,
        };
      case 'team_lead':
        return {
          staffIds: new Set([actor.id, ...(await this.scope.peopleUnder(actor.id))]),
          money: false,
          names: true,
          download: false,
        };
      case 'call_agent':
      case 'field_agent':
        return { staffIds: new Set([actor.id]), money: false, names: true, download: false };
      default:
        throw new ForbiddenException('This list is for staff');
    }
  }

  /** The close-to-refund list for the caller, with buckets and totals. */
  async list(actor: Actor, query: PriorityQuery = {}, now: Date = this.clock.now()) {
    const who = query.who ?? 'all';
    if (!['all', 'job_seekers', 'businesses'].includes(who)) {
      throw new BadRequestException("who is 'job_seekers', 'businesses' or 'all'");
    }
    if (query.bucket && !(PRIORITY_BUCKETS as readonly string[]).includes(query.bucket)) {
      throw new BadRequestException("bucket is '0-5', '6-10' or '11-15'");
    }
    const scope = await this.scopeFor(actor);
    let teamIds: Set<string> | null = null;
    if (query.teamLeadId) {
      if (scope.staffIds && !scope.staffIds.has(query.teamLeadId)) {
        throw new ForbiddenException('That team is not in your scope');
      }
      teamIds = new Set([query.teamLeadId, ...(await this.scope.peopleUnder(query.teamLeadId))]);
    }
    if (query.agentId && scope.staffIds && !scope.staffIds.has(query.agentId)) {
      throw new ForbiddenException('That agent is not in your scope');
    }

    const { windowDays, rows: all } = await this.rows(now);
    void this.maybeSyncBells(now, all);
    const rows = all.filter((row) => {
      if (who === 'job_seekers' && row.kind !== 'job_seeker') return false;
      if (who === 'businesses' && row.kind !== 'business') return false;
      if (query.bucket && row.bucket !== query.bucket) return false;
      const agentId = row.agent?.id ?? null;
      if (scope.staffIds && (!agentId || !scope.staffIds.has(agentId))) return false;
      if (teamIds && (!agentId || !teamIds.has(agentId))) return false;
      if (query.agentId && agentId !== query.agentId) return false;
      return true;
    });

    const shaped = rows.map((row) => this.shape(row, scope));
    const buckets = PRIORITY_BUCKETS.map((bucket) => {
      const inBucket = rows.filter((row) => row.bucket === bucket);
      return {
        bucket,
        count: inBucket.length,
        jobSeekers: inBucket.filter((row) => row.kind === 'job_seeker').length,
        businesses: inBucket.filter((row) => row.kind === 'business').length,
        ...(scope.money ? { atStakePaise: this.sum(inBucket) } : {}),
      };
    });
    return {
      asOf: now.toISOString(),
      windowDays,
      buckets,
      totals: {
        count: rows.length,
        jobSeekers: rows.filter((row) => row.kind === 'job_seeker').length,
        businesses: rows.filter((row) => row.kind === 'business').length,
        ...(scope.money ? { atStakePaise: this.sum(rows) } : {}),
      },
      rows: shaped,
    };
  }

  /** The same list as CSV. CEO, Finance and Managers only (nobody below Manager downloads lists). */
  async csv(actor: Actor, query: PriorityQuery = {}, now: Date = this.clock.now()): Promise<string> {
    const scope = await this.scopeFor(actor);
    if (!scope.download) {
      throw new ForbiddenException('Nobody below Manager downloads lists');
    }
    const list = await this.list(actor, query, now);
    const header = ['Kind', 'Code', ...(scope.names ? ['Name'] : []), 'Trade', 'Days left', 'Bucket', 'Deadline', 'Agent code', 'Agent'];
    if (scope.money) header.push('At stake (Rs)');
    const lines = [header];
    for (const row of list.rows) {
      const line = [
        row.kind === 'job_seeker' ? 'Job seeker' : 'Business',
        row.code,
        ...(scope.names ? [row.name ?? ''] : []),
        row.trade ?? '',
        String(row.daysLeft),
        row.bucket,
        row.deadline.slice(0, 10),
        row.agent?.code ?? '',
        row.agent?.name ?? '',
      ];
      if (scope.money) line.push(((row.atStakePaise ?? 0) / 100).toFixed(2));
      lines.push(line);
    }
    const [head, ...body] = lines;
    return [head, ...maskCsvPhoneColumns(head, body, actor.role)].map((cells) => cells.map((cell) => this.csvCell(cell)).join(',')).join('\n') + '\n';
  }

  private csvCell(value: string): string {
    // A leading =, +, - or @ would run as a formula in Excel.
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  private shape(row: PriorityRow, scope: Scope): PriorityRow {
    const { atStakePaise, ...rest } = row;
    return {
      ...rest,
      name: scope.names ? row.name : null,
      ...(scope.money ? { atStakePaise } : {}),
    };
  }

  private sum(rows: PriorityRow[]): number {
    return rows.reduce((total, row) => total + (row.atStakePaise ?? 0), 0);
  }

  // ------------------------------------------------------------------ bells

  private async maybeSyncBells(now: Date, rows: PriorityRow[]): Promise<void> {
    if (Date.now() - this.lastBellSync < BELL_SYNC_THROTTLE_MS) return;
    this.lastBellSync = Date.now();
    try {
      await this.syncBells(now, rows);
    } catch (error) {
      this.logger.warn(`Refund priority bells failed: ${(error as Error).message}`);
    }
  }

  /**
   * One `refund_priority` notification per person in the window for the
   * agent working on them, that agent's Team Lead and Manager (no rupees);
   * cleared when the person leaves the window, with what took them out.
   */
  async syncBells(now: Date = this.clock.now(), known?: PriorityRow[]): Promise<{ opened: number; cleared: number }> {
    if (!this.notifications || !this.sources) return { opened: 0, cleared: 0 };
    const rows = known ?? (await this.rows(now)).rows;
    const dir = await this.sources.directory();
    const drafts: NotificationDraft[] = [];
    for (const row of rows) {
      const agent = dir.get(row.agent?.id);
      if (!agent) continue;
      const chain = dir.chainOf(agent.id);
      const recipients: Array<DirectoryRow | null> = [
        AGENT_ROLES.includes(agent.role) ? agent : null,
        agent.role === 'team_lead' ? agent : chain.teamLead,
        chain.manager,
      ];
      const title =
        row.kind === 'job_seeker'
          ? `${row.code}: ${row.daysLeft} day${row.daysLeft === 1 ? '' : 's'} to a refund, no suitable offer yet`
          : `${row.businessName ?? row.code}: ${row.daysLeft} day${row.daysLeft === 1 ? '' : 's'} to a refund, no replacement yet`;
      const body = [row.trade, row.kind === 'business' ? row.code : null, `${row.bucket} days`].filter(Boolean).join(' · ');
      for (const draft of this.sources.drafts(recipients, {
        kind: 'refund_priority',
        title,
        body,
        subjectType: row.kind === 'job_seeker' ? 'job_seeker' : 'placement',
        subjectId: row.id,
      })) {
        const recipient = dir.get(draft.recipientStaffId)!;
        // The call agent opens the person's profile; others go to their list.
        draft.link = notificationLink(recipient.role, 'refund_priority', {
          id: row.kind === 'job_seeker' ? row.code : null,
        });
        drafts.push(draft);
      }
    }
    return this.notifications.reconcileKind(
      'refund_priority',
      drafts,
      async (open) => {
        if (open.subjectType === 'job_seeker') {
          const offer = await this.prisma.interview.findFirst({
            where: { jobSeekerId: open.subjectId, status: { in: OFFER_STATUSES }, createdAt: { gte: open.createdAt } },
            orderBy: { createdAt: 'desc' },
            select: { proposedByStaffId: true },
          });
          if (offer) return { byStaffId: offer.proposedByStaffId, reason: 'offer_made' };
        } else {
          const replaced = await this.prisma.replacementCandidate.findFirst({
            where: { placementId: open.subjectId, status: 'accepted' },
            select: { id: true },
          });
          if (replaced) return { byStaffId: null, reason: 'replacement_found' };
        }
        return { byStaffId: null, reason: 'left_window' };
      },
      now,
    );
  }
}
