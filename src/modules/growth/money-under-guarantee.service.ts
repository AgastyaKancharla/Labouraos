import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { PricingService } from '../pricing/pricing.service';
import { REFUND_FORFEITING_HIT_REASONS } from '../job-seeker/job-seeker-refund-guards';
import {
  GUARANTEE_STATES,
  GuaranteeState,
  LIVE_REFUND_STATUSES,
  RECEIVED_PAYMENT_STATUSES,
} from './growth.constants';
import {
  ChainPlacement,
  classifyActivationPayment,
  classifyPlacementFeePayment,
  ExposureResult,
} from './guarantee-exposure';

export interface GuaranteeBucket {
  receivedPaise: number;
  /** under_guarantee + refund_due: money in the bank that could still have to go back. */
  couldGoBackPaise: number;
  underGuaranteePaise: number;
  refundDuePaise: number;
  refundedPaise: number;
  safelyEarnedPaise: number;
  counts: Record<GuaranteeState, number>;
}

export interface GuaranteeTotals {
  total: GuaranteeBucket;
  /** ₹499 registration fees (30-day guarantee). */
  activation: GuaranteeBucket;
  /** Placement fees as received, GST included (60-day guarantee and replacement windows). */
  placementFee: GuaranteeBucket;
}

export interface GuaranteeRow {
  paymentCode: string;
  type: 'activation' | 'placement_fee';
  subjectCode: string | null;
  amountPaise: number;
  receivedAt: string;
  state: GuaranteeState;
  guaranteeEndsAt: string | null;
}

export interface MoneyUnderGuaranteeResult {
  asOf: string;
  /** Money received in the chosen IST date range, each rupee in its state as of now. */
  range: ({ from: string; to: string } & GuaranteeTotals) | null;
  /** Every rupee ever received, in its state as of now. */
  asOfNow: GuaranteeTotals;
  rows?: GuaranteeRow[];
}

interface ClassifiedPayment {
  row: GuaranteeRow;
  receivedAt: Date;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function emptyBucket(): GuaranteeBucket {
  return {
    receivedPaise: 0,
    couldGoBackPaise: 0,
    underGuaranteePaise: 0,
    refundDuePaise: 0,
    refundedPaise: 0,
    safelyEarnedPaise: 0,
    counts: Object.fromEntries(GUARANTEE_STATES.map((state) => [state, 0])) as Record<GuaranteeState, number>,
  };
}

function addTo(bucket: GuaranteeBucket, amount: number, state: GuaranteeState) {
  bucket.receivedPaise += amount;
  bucket.counts[state] += 1;
  if (state === 'under_guarantee') bucket.underGuaranteePaise += amount;
  if (state === 'refund_due') bucket.refundDuePaise += amount;
  if (state === 'refunded') bucket.refundedPaise += amount;
  if (state === 'safely_earned') bucket.safelyEarnedPaise += amount;
  bucket.couldGoBackPaise = bucket.underGuaranteePaise + bucket.refundDuePaise;
}

function totalsOf(items: ClassifiedPayment[]): GuaranteeTotals {
  const totals: GuaranteeTotals = { total: emptyBucket(), activation: emptyBucket(), placementFee: emptyBucket() };
  for (const { row } of items) {
    addTo(totals.total, row.amountPaise, row.state);
    addTo(row.type === 'activation' ? totals.activation : totals.placementFee, row.amountPaise, row.state);
  }
  return totals;
}

/** "2026-11-01" read as an IST calendar date; returns that day's IST midnight in UTC. */
export function istDayStart(value: string, label: string): Date {
  const match = DATE_RE.exec(value);
  if (!match) throw new BadRequestException(`${label} must be a date like 2026-11-01`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = localCalendarToUtc(year, month, day);
  if (isNaN(start.getTime())) throw new BadRequestException(`${label} must be a real date`);
  return start;
}

/**
 * N1 "Money still under guarantee" (confirmed 11 Nov), for the CEO Command Center and
 * the Finance reports. Of the money received, how much could still have to go back
 * (₹499s inside their 30 days, placement fees inside their 60 days including the
 * replacement windows) and how much is safely earned. Computed fresh, never stored.
 * Only the CEO and Finance call it (the controller); Managers see no money.
 */
@Injectable()
export class MoneyUnderGuaranteeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
  ) {}

  async report(
    options: { from?: string; to?: string; includeRows?: boolean },
    now: Date = new Date(),
  ): Promise<MoneyUnderGuaranteeResult> {
    let range: { from: string; to: string; start: Date; end: Date } | null = null;
    if (options.from || options.to) {
      if (!options.from || !options.to) throw new BadRequestException('Send both from and to, or neither');
      const start = istDayStart(options.from, 'from');
      const toStart = istDayStart(options.to, 'to');
      if (toStart.getTime() < start.getTime()) throw new BadRequestException('to must not be before from');
      const end = new Date(toStart.getTime() + 24 * 60 * 60 * 1000); // to is inclusive
      range = { from: options.from, to: options.to, start, end };
    }

    const items = [...(await this.activationItems(now)), ...(await this.placementFeeItems(now))];
    items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.row.paymentCode.localeCompare(b.row.paymentCode));
    const inRange = range
      ? items.filter((item) => item.receivedAt >= range!.start && item.receivedAt < range!.end)
      : null;

    return {
      asOf: now.toISOString(),
      range: range && inRange ? { from: range.from, to: range.to, ...totalsOf(inRange) } : null,
      asOfNow: totalsOf(items),
      ...(options.includeRows ? { rows: (inRange ?? items).map((item) => item.row) } : {}),
    };
  }

  private receivedAt(payment: { confirmedAt: Date | null; paidAt: Date | null; createdAt: Date }): Date {
    return payment.confirmedAt ?? payment.paidAt ?? payment.createdAt;
  }

  private async activationItems(now: Date): Promise<ClassifiedPayment[]> {
    const policy = await this.pricingService.current();
    const payments = await this.prisma.payment.findMany({
      where: { type: 'activation', status: { in: [...RECEIVED_PAYMENT_STATUSES] }, jobSeekerId: { not: null } },
      select: {
        code: true, amount: true, confirmedAt: true, paidAt: true, createdAt: true, jobSeekerId: true,
        jobSeeker: { select: { code: true, status: true, paymentReceivedAt: true } },
      },
    });
    if (payments.length === 0) return [];
    const seekerIds = [...new Set(payments.map((p) => p.jobSeekerId!))];

    const [refunds, hits, withdrawn, bypassFlags, bypassFollowUps] = await Promise.all([
      this.prisma.payment.findMany({
        where: { type: 'refund', jobSeekerId: { in: seekerIds }, status: { in: [...LIVE_REFUND_STATUSES] } },
        select: { jobSeekerId: true, createdAt: true },
      }),
      this.prisma.jobSeekerHit.findMany({
        where: {
          jobSeekerId: { in: seekerIds },
          reason: { in: [...REFUND_FORFEITING_HIT_REASONS] },
          reversedAt: null,
          supersededAt: null,
        },
        select: { jobSeekerId: true },
      }),
      this.prisma.consent.findMany({
        where: {
          subjectType: 'job_seeker',
          subjectId: { in: seekerIds },
          purpose: { in: ['job_matching', 'profile_sharing', 'call_recording'] },
          withdrawnAt: { not: null },
        },
        select: { subjectId: true, withdrawnAt: true },
      }),
      this.prisma.reviewFlag.findMany({
        where: { subjectType: 'job_seeker', subjectId: { in: seekerIds }, kind: 'bypass_suspected', status: 'open' },
        select: { subjectId: true },
      }),
      this.prisma.followUpTask.findMany({
        where: {
          subjectType: 'job_seeker',
          subjectId: { in: seekerIds },
          kind: 'refund_check',
          answer: 'working_at_introduced_business',
        },
        select: { subjectId: true },
      }),
    ]);
    const hitSet = new Set(hits.map((h) => h.jobSeekerId));
    const bypassSet = new Set(bypassFlags.map((f) => f.subjectId));
    const bypassFollowUpSet = new Set(bypassFollowUps.map((t) => t.subjectId));

    // Every ₹499 of each seeker in time order: a cycle runs from one payment to the next.
    const bySeeker = new Map<string, typeof payments>();
    for (const payment of payments) {
      const list = bySeeker.get(payment.jobSeekerId!) ?? [];
      list.push(payment);
      bySeeker.set(payment.jobSeekerId!, list);
    }

    const items: ClassifiedPayment[] = [];
    for (const [seekerId, list] of bySeeker) {
      list.sort((a, b) => this.receivedAt(a).getTime() - this.receivedAt(b).getTime());
      list.forEach((payment, index) => {
        const isLatest = index === list.length - 1;
        // The seeker's own record is authoritative for the current guarantee's start.
        const start = isLatest && payment.jobSeeker?.paymentReceivedAt
          ? payment.jobSeeker.paymentReceivedAt
          : this.receivedAt(payment);
        const cycleEnd = isLatest ? null : this.receivedAt(list[index + 1]);
        const refundedThisCycle = refunds.some(
          (refund) =>
            refund.jobSeekerId === seekerId &&
            refund.createdAt >= start &&
            (cycleEnd === null || refund.createdAt < cycleEnd),
        );
        const withdrawnAfterPaying = withdrawn.some(
          (consent) => consent.subjectId === seekerId && consent.withdrawnAt !== null && consent.withdrawnAt >= start,
        );
        const result: ExposureResult = classifyActivationPayment(
          {
            code: payment.jobSeeker?.code ?? payment.code,
            amountPaise: payment.amount,
            receivedAt: start,
            isLatestActivation: isLatest,
            refundedThisCycle,
            seekerStatus: payment.jobSeeker?.status ?? 'lead',
            hasForfeitingHit: hitSet.has(seekerId),
            hasWithdrawnEssentialConsent: withdrawnAfterPaying,
            hasOpenBypassFlag: bypassSet.has(seekerId),
            hasWorkingAtIntroducedBusinessFollowUp: bypassFollowUpSet.has(seekerId),
            guaranteeDays: policy.jobSeekerGuaranteeDays,
          },
          now,
        );
        const receivedAt = this.receivedAt(payment);
        items.push({
          receivedAt,
          row: {
            paymentCode: payment.code,
            type: 'activation',
            subjectCode: payment.jobSeeker?.code ?? null,
            amountPaise: payment.amount,
            receivedAt: receivedAt.toISOString(),
            state: result.state,
            guaranteeEndsAt: result.guaranteeEndsAt?.toISOString() ?? null,
          },
        });
      });
    }
    return items;
  }

  private async placementFeeItems(now: Date): Promise<ClassifiedPayment[]> {
    const policy = await this.pricingService.current();
    const payments = await this.prisma.payment.findMany({
      where: { type: 'placement_fee', status: { in: [...RECEIVED_PAYMENT_STATUSES] }, placementId: { not: null } },
      select: {
        code: true, amount: true, confirmedAt: true, paidAt: true, createdAt: true, placementId: true,
        placement: { select: { id: true, code: true, rootPlacementId: true } },
      },
    });
    if (payments.length === 0) return [];
    const rootIds = [...new Set(payments.map((p) => p.placement?.rootPlacementId ?? p.placementId!))];
    const chainRows = await this.prisma.placement.findMany({
      where: { OR: [{ id: { in: rootIds } }, { rootPlacementId: { in: rootIds } }] },
      select: {
        id: true, code: true, status: true, placementFee: true, joinedDate: true, rootPlacementId: true,
        dropoutReportedAt: true, guaranteeEndedReason: true,
        replacementClaims: { select: { decision: true, reportedAt: true, decidedAt: true } },
        replacementCandidates: { select: { status: true } },
      },
    });
    const chainIds = chainRows.map((row) => row.id);
    const refunds = chainIds.length
      ? await this.prisma.payment.findMany({
          where: { type: 'refund', placementId: { in: chainIds }, status: { in: [...LIVE_REFUND_STATUSES] } },
          select: { placementId: true },
        })
      : [];
    const refundedPlacements = new Set(refunds.map((r) => r.placementId));

    const items: ClassifiedPayment[] = [];
    for (const payment of payments) {
      const rootId = payment.placement?.rootPlacementId ?? payment.placementId!;
      const root = chainRows.find((row) => row.id === rootId);
      const receivedAt = this.receivedAt(payment);
      let result: ExposureResult;
      if (!root) {
        result = { state: 'under_guarantee', guaranteeEndsAt: null };
      } else {
        const chainRaw = chainRows.filter((row) => row.id === rootId || row.rootPlacementId === rootId);
        const chain: ChainPlacement[] = chainRaw.map((row) => ({
          id: row.id,
          code: row.code,
          status: row.status,
          placementFee: row.placementFee,
          dropoutReportedAt: row.dropoutReportedAt,
          guaranteeEndedReason: row.guaranteeEndedReason,
          claims: row.replacementClaims,
          replacementCandidates: row.replacementCandidates,
        }));
        result = classifyPlacementFeePayment(
          {
            root: {
              code: root.code,
              joinedDate: root.joinedDate,
              guaranteeEndedReason: root.guaranteeEndedReason,
              status: root.status,
            },
            chain,
            refunded: chainRaw.some((row) => refundedPlacements.has(row.id)),
            windowDays: policy.replacementWindowDays,
            searchDays: policy.replacementSearchDays,
          },
          now,
        );
      }
      items.push({
        receivedAt,
        row: {
          paymentCode: payment.code,
          type: 'placement_fee',
          subjectCode: payment.placement?.code ?? null,
          amountPaise: payment.amount,
          receivedAt: receivedAt.toISOString(),
          state: result.state,
          guaranteeEndsAt: result.guaranteeEndsAt?.toISOString() ?? null,
        },
      });
    }
    return items;
  }
}
