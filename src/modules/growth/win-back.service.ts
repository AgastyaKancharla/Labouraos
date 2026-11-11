import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { MatchingService } from '../vacancy/matching.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { isWithinClockWindow } from '../call/call-window';
import { primaryJobSeekerTrade } from '../job-seeker/job-seeker-legacy-read';
import {
  LIVE_REFUND_STATUSES,
  WIN_BACK_CALL_CONSENTS,
  WIN_BACK_LOOKBACK_DAYS,
  WinBackReason,
} from './growth.constants';
import { staffScopeFor } from './growth-scope';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WinBackSweepResult {
  vacanciesChecked: number;
  eligibleJobSeekers: number;
  added: number;
  closed: number;
}

interface Eligible {
  id: string;
  reason: WinBackReason;
}

/**
 * N5 "Win-back list" (confirmed 11 Nov). When a new or reopened vacancy matches a job
 * seeker whose ₹499 was refunded or whose profile was deactivated (never one closed for
 * finding his own job), he goes on the call agents' list — "a job for you has come in,
 * register again?" — with the vacancy that brought him back. One open entry per person.
 * He comes off the list when he pays again (re-registers) or says no on a recorded call.
 *
 * Calling: only people with job alerts (job_updates) and call recording consent still
 * given are listed, and each entry says whether he can be called right now (9 AM–9 PM
 * from the pricing policy, and inside his own preferred window). The call itself goes
 * through the calling system, which enforces the same rules.
 */
@Injectable()
export class WinBackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly pricingService: PricingService,
    private readonly reportingScope: ReportingScopeService,
    private readonly auditService: AuditService,
  ) {}

  async sweep(now: Date = new Date()): Promise<WinBackSweepResult> {
    const closed = await this.closeStale(now);

    const since = new Date(now.getTime() - WIN_BACK_LOOKBACK_DAYS * DAY_MS);
    const reopenedIds = (
      await this.prisma.statusHistory.findMany({
        where: { subjectType: 'vacancy', toStatus: 'open', changedAt: { gte: since, lte: now } },
        select: { subjectId: true },
      })
    ).map((row) => row.subjectId);
    const vacancies = await this.prisma.vacancy.findMany({
      where: {
        status: 'open',
        OR: [
          { confirmedAt: { gte: since, lte: now } },
          { createdAt: { gte: since, lte: now } },
          ...(reopenedIds.length ? [{ id: { in: reopenedIds } }] : []),
        ],
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (vacancies.length === 0) return { vacanciesChecked: 0, eligibleJobSeekers: 0, added: 0, closed };

    const eligible = await this.eligibleJobSeekers();
    if (eligible.length === 0) {
      return { vacanciesChecked: vacancies.length, eligibleJobSeekers: 0, added: 0, closed };
    }
    const reasonOf = new Map(eligible.map((e) => [e.id, e.reason]));
    const matches = await this.matching.suitableSeekerIds(
      vacancies.map((v) => v.id),
      { id: { in: eligible.map((e) => e.id) } },
    );

    const open = new Set(
      (
        await this.prisma.winBackEntry.findMany({
          where: { status: 'open', jobSeekerId: { in: eligible.map((e) => e.id) } },
          select: { jobSeekerId: true },
        })
      ).map((row) => row.jobSeekerId),
    );
    let added = 0;
    for (const vacancy of vacancies) {
      for (const jobSeekerId of matches.get(vacancy.id) ?? []) {
        const reason = reasonOf.get(jobSeekerId);
        if (!reason || open.has(jobSeekerId)) continue;
        try {
          await this.prisma.winBackEntry.create({
            data: {
              openKey: jobSeekerId,
              jobSeekerId,
              vacancyId: vacancy.id,
              reason,
              status: 'open',
              addedAt: now,
            },
          });
          open.add(jobSeekerId);
          added++;
        } catch (error) {
          // Already listed for this vacancy before, or listed a moment ago by another run.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
          throw error;
        }
      }
    }
    return { vacanciesChecked: vacancies.length, eligibleJobSeekers: eligible.length, added, closed };
  }

  /** The call list. Call agents and the CEO see everyone, a Manager his tree's job seekers, a Team Lead his team's. */
  async list(actor: { id: string; role: string }, options: { callableNow?: boolean } = {}, now: Date = new Date()) {
    const scope = actor.role === 'call_agent' ? null : await staffScopeFor(actor, this.reportingScope);
    const policy = await this.pricingService.current();
    const entries = await this.prisma.winBackEntry.findMany({
      where: { status: 'open' },
      orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
    });
    if (entries.length === 0) return { asOf: now.toISOString(), callingHours: this.hours(policy), total: 0, rows: [] };

    const seekerWhere: Prisma.JobSeekerWhereInput = { id: { in: entries.map((e) => e.jobSeekerId) } };
    if (scope) seekerWhere.registeredByStaffId = { in: scope };
    const [seekers, vacancies, consenting] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where: seekerWhere,
        select: {
          id: true, code: true, name: true, locality: true, status: true, paymentReceivedAt: true,
          preferredCallWindowStart: true, preferredCallWindowEnd: true,
          trades: { select: { trade: true, isPrimary: true } },
        },
      }),
      this.prisma.vacancy.findMany({
        where: { id: { in: entries.map((e) => e.vacancyId) } },
        select: {
          id: true, code: true, tradeSkill: true, locality: true, status: true, shift: true,
          salaryMinPaise: true, salaryMaxPaise: true, salaryPeriod: true,
        },
      }),
      this.consentingIds(entries.map((e) => e.jobSeekerId)),
    ]);
    const withinCompanyHours = isWithinClockWindow(now, policy.callingHoursStart, policy.callingHoursEnd);

    const rows = entries.flatMap((entry) => {
      const seeker = seekers.find((s) => s.id === entry.jobSeekerId);
      if (!seeker || !consenting.has(seeker.id)) return [];
      // Paid again since: he has re-registered (the daily sweep closes the entry).
      if (seeker.paymentReceivedAt && seeker.paymentReceivedAt > entry.addedAt) return [];
      const vacancy = vacancies.find((v) => v.id === entry.vacancyId) ?? null;
      const callableNow =
        withinCompanyHours &&
        isWithinClockWindow(now, seeker.preferredCallWindowStart, seeker.preferredCallWindowEnd);
      return [{
        id: entry.id,
        reason: entry.reason,
        addedAt: entry.addedAt.toISOString(),
        callableNow,
        jobSeeker: {
          id: seeker.id,
          code: seeker.code,
          firstName: seeker.name.trim().split(/\s+/)[0] ?? '',
          trade: primaryJobSeekerTrade(seeker) ?? null,
          locality: seeker.locality,
          status: seeker.status,
          preferredCallWindow: { start: seeker.preferredCallWindowStart, end: seeker.preferredCallWindowEnd },
        },
        // Before an interview is booked the candidate hears only the job type, area, salary and shift.
        vacancy: vacancy
          ? {
              id: vacancy.id,
              code: vacancy.code,
              trade: vacancy.tradeSkill,
              area: vacancy.locality,
              shift: vacancy.shift,
              salaryMinPaise: vacancy.salaryMinPaise,
              salaryMaxPaise: vacancy.salaryMaxPaise,
              salaryPeriod: vacancy.salaryPeriod,
              status: vacancy.status,
            }
          : null,
      }];
    });
    const filtered = options.callableNow ? rows.filter((row) => row.callableNow) : rows;
    filtered.sort((a, b) => Number(b.callableNow) - Number(a.callableNow) || a.addedAt.localeCompare(b.addedAt));
    return { asOf: now.toISOString(), callingHours: this.hours(policy), total: filtered.length, rows: filtered };
  }

  /** He said no on an answered, recorded call: off the list, and not listed again until he pays again. */
  async decline(
    actor: { id: string; role: string },
    entryId: string,
    body: { callRecordId?: string; reason?: string },
    now: Date = new Date(),
  ) {
    const entry = await this.prisma.winBackEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException(`Win-back entry '${entryId}' not found`);
    if (entry.status !== 'open') throw new BadRequestException(`This entry is already ${entry.status}`);
    if (actor.role !== 'call_agent') {
      const scope = await staffScopeFor(actor, this.reportingScope);
      if (scope) {
        const seeker = await this.prisma.jobSeeker.findUnique({
          where: { id: entry.jobSeekerId },
          select: { registeredByStaffId: true },
        });
        if (!seeker?.registeredByStaffId || !scope.includes(seeker.registeredByStaffId)) {
          throw new ForbiddenException('This job seeker is outside your team');
        }
      }
    }
    if (!body.callRecordId) throw new BadRequestException('callRecordId is required: "no" is recorded only from an answered call');
    const call = await this.prisma.callRecord.findUnique({ where: { id: body.callRecordId } });
    if (!call) throw new NotFoundException(`CallRecord '${body.callRecordId}' not found`);
    if (!call.answered) throw new BadRequestException('Only an answered call can record that he said no');
    if (call.subjectType !== 'job_seeker' || call.subjectId !== entry.jobSeekerId) {
      throw new BadRequestException('The call was not with this job seeker');
    }
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    const changed = await this.prisma.winBackEntry.updateMany({
      where: { id: entry.id, status: 'open' },
      data: {
        status: 'declined',
        openKey: null,
        closedAt: now,
        closedReason: 'said_no',
        closedByStaffId: actor.id,
        callRecordId: call.id,
      },
    });
    if (changed.count !== 1) throw new BadRequestException('This entry was closed a moment ago');
    await this.auditService.log({
      actorId: actor.id,
      action: 'win_back.declined',
      entityType: 'win_back_entry',
      entityCode: entry.id,
      before: { status: 'open' },
      after: { status: 'declined', closedReason: 'said_no', callRecordId: call.id, jobSeekerId: entry.jobSeekerId },
      reason,
      changedFields: ['status', 'closedAt', 'closedReason', 'callRecordId'],
    });
    return this.prisma.winBackEntry.findUniqueOrThrow({ where: { id: entry.id } });
  }

  /** Closes entries whose person paid again, left the pool or withdrew a calling consent. */
  private async closeStale(now: Date): Promise<number> {
    const entries = await this.prisma.winBackEntry.findMany({ where: { status: 'open' } });
    if (entries.length === 0) return 0;
    const ids = entries.map((e) => e.jobSeekerId);
    const [seekers, consenting, eligible] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where: { id: { in: ids } },
        select: { id: true, paymentReceivedAt: true },
      }),
      this.consentingIds(ids),
      this.eligibleJobSeekers(ids),
    ]);
    const eligibleIds = new Set(eligible.map((e) => e.id));
    let closed = 0;
    for (const entry of entries) {
      const seeker = seekers.find((s) => s.id === entry.jobSeekerId);
      let status: string | null = null;
      let reason: string | null = null;
      if (seeker?.paymentReceivedAt && seeker.paymentReceivedAt > entry.addedAt) {
        status = 're_registered';
        reason = 're_registered';
      } else if (seeker && !consenting.has(seeker.id)) {
        status = 'closed';
        reason = 'consent_withdrawn';
      } else if (!seeker || !eligibleIds.has(seeker.id)) {
        status = 'closed';
        reason = 'no_longer_eligible';
      }
      if (!status) continue;
      const changed = await this.prisma.winBackEntry.updateMany({
        where: { id: entry.id, status: 'open' },
        data: { status, openKey: null, closedAt: now, closedReason: reason },
      });
      closed += changed.count;
    }
    return closed;
  }

  /**
   * Refunded (a live refund in his current guarantee) or deactivated, never closed for
   * finding his own job, not anonymised, with the calling consents still given, and
   * not someone who already said no since he last paid.
   */
  private async eligibleJobSeekers(onlyIds?: string[]): Promise<Eligible[]> {
    const seekers = await this.prisma.jobSeeker.findMany({
      where: {
        ...(onlyIds ? { id: { in: onlyIds } } : {}),
        anonymisedAt: null,
        foundOwnJobAt: null,
        status: { notIn: ['closed', 'placed'] },
        OR: [
          { status: 'deactivated' },
          { payments: { some: { type: 'refund', status: { in: [...LIVE_REFUND_STATUSES] } } } },
        ],
      },
      select: {
        id: true,
        status: true,
        paymentReceivedAt: true,
        payments: {
          where: { type: 'refund', status: { in: [...LIVE_REFUND_STATUSES] } },
          select: { createdAt: true },
        },
      },
    });
    if (seekers.length === 0) return [];
    const ids = seekers.map((s) => s.id);
    const [consenting, declined] = await Promise.all([
      this.consentingIds(ids),
      this.prisma.winBackEntry.findMany({
        where: { jobSeekerId: { in: ids }, status: 'declined' },
        select: { jobSeekerId: true, addedAt: true },
      }),
    ]);
    const result: Eligible[] = [];
    for (const seeker of seekers) {
      const cycleStart = seeker.paymentReceivedAt;
      const refunded = seeker.payments.some((p) => !cycleStart || p.createdAt >= cycleStart);
      const reason: WinBackReason | null = seeker.status === 'deactivated' ? 'deactivated' : refunded ? 'refunded' : null;
      if (!reason || !consenting.has(seeker.id)) continue;
      if (declined.some((d) => d.jobSeekerId === seeker.id && (!cycleStart || d.addedAt >= cycleStart))) continue;
      result.push({ id: seeker.id, reason });
    }
    return result;
  }

  /** Job seekers with every calling consent still given. */
  private async consentingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.consent.findMany({
      where: {
        subjectType: 'job_seeker',
        subjectId: { in: ids },
        purpose: { in: [...WIN_BACK_CALL_CONSENTS] },
        granted: true,
        grantedAt: { not: null },
        withdrawnAt: null,
      },
      select: { subjectId: true, purpose: true },
    });
    const purposes = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = purposes.get(row.subjectId) ?? new Set<string>();
      set.add(row.purpose);
      purposes.set(row.subjectId, set);
    }
    return new Set(
      [...purposes.entries()]
        .filter(([, set]) => WIN_BACK_CALL_CONSENTS.every((purpose) => set.has(purpose)))
        .map(([id]) => id),
    );
  }

  private hours(policy: { callingHoursStart: string; callingHoursEnd: string }) {
    return { start: policy.callingHoursStart, end: policy.callingHoursEnd, timeZone: 'Asia/Kolkata' };
  }
}
