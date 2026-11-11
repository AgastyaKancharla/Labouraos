import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { evaluatePlacementRefundEligibility } from '../placement/placement-refund-eligibility';
import { REFUND_FORFEITING_HIT_REASONS } from '../job-seeker/job-seeker-refund-guards';
import {
  DateRange,
  PageRequest,
  PAYOUT_DUE_STATUSES,
  PAYOUT_TYPES,
  RECEIVED_STATUSES,
  contains,
  daysSince,
  istDayKey,
  sumPaise,
} from './ceo-common';
import { phoneSearchDigits } from '../../common/phone/indian-mobile';

export interface MoneyTotals {
  activationPaise: number;
  activationCount: number;
  placementFeePaise: number;
  placementCount: number;
  gstPaise: number;
  grossPaise: number;
  refundsPaidPaise: number;
  refundsPaidCount: number;
  netPaise: number;
  receivedInclGstPaise: number;
}

type ReceivedPayment = {
  type: string;
  amount: number;
  placement: { placementFee: number; gstAmount: number } | null;
};

/**
 * Money in for a period, in integer paise. Placement fees count without GST
 * (the fee and its GST come from the placement); ₹499 activation fees carry
 * no GST (decided); refunds paid are refunds that left the bank in the period.
 */
export function summariseReceived(received: readonly ReceivedPayment[], refundsPaid: readonly { amount: number }[]): MoneyTotals {
  const activation = received.filter((p) => p.type === 'activation' || p.type === 'reactivation');
  const placement = received.filter((p) => p.type === 'placement_fee');
  const activationPaise = sumPaise(activation.map((p) => p.amount));
  const placementFeePaise = sumPaise(placement.map((p) => p.placement?.placementFee ?? p.amount - (p.placement?.gstAmount ?? 0)));
  const gstPaise = sumPaise(placement.map((p) => (p.placement ? p.amount - p.placement.placementFee : 0)));
  const refundsPaidPaise = sumPaise(refundsPaid.map((p) => p.amount));
  const grossPaise = activationPaise + placementFeePaise;
  return {
    activationPaise,
    activationCount: activation.length,
    placementFeePaise,
    placementCount: placement.length,
    gstPaise,
    grossPaise,
    refundsPaidPaise,
    refundsPaidCount: refundsPaid.length,
    netPaise: grossPaise - refundsPaidPaise,
    receivedInclGstPaise: activationPaise + placementFeePaise + gstPaise,
  };
}

/** GSTR-1 is due on the 11th and GSTR-3B on the 20th of the month after the period. */
export function gstDueDates(periodEnd: Date): { gstr1: string; gstr3b: string } {
  const [y, m] = istDayKey(periodEnd).split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const mm = String(nm).padStart(2, '0');
  return { gstr1: `${ny}-${mm}-11`, gstr3b: `${ny}-${mm}-20` };
}

@Injectable()
export class CeoMoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  private receivedAtFilter(range: DateRange): Prisma.PaymentWhereInput {
    return {
      OR: [
        { confirmedAt: { gte: range.from, lte: range.to } },
        { confirmedAt: null, paidAt: { gte: range.from, lte: range.to } },
      ],
    };
  }

  async totals(range: DateRange): Promise<MoneyTotals> {
    const [received, refunds] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: { in: RECEIVED_STATUSES }, type: { in: ['activation', 'reactivation', 'placement_fee'] }, ...this.receivedAtFilter(range) },
        select: { type: true, amount: true, placement: { select: { placementFee: true, gstAmount: true } } },
      }),
      this.prisma.payment.findMany({
        where: { type: 'refund', status: { in: RECEIVED_STATUSES }, OR: [{ paidAt: { gte: range.from, lte: range.to } }, { paidAt: null, updatedAt: { gte: range.from, lte: range.to } }] },
        select: { amount: true },
      }),
    ]);
    return summariseReceived(received, refunds);
  }

  async payouts() {
    const rows = await this.prisma.payment.findMany({ where: { type: { in: PAYOUT_TYPES }, status: { in: [...PAYOUT_DUE_STATUSES, 'failed'] } }, select: { type: true, status: true, amount: true } });
    const due = rows.filter((r) => r.status !== 'failed');
    return {
      duePaise: sumPaise(due.map((r) => r.amount)),
      dueCount: due.length,
      referralDuePaise: sumPaise(due.filter((r) => r.type === 'referral_payout').map((r) => r.amount)),
      referralDueCount: due.filter((r) => r.type === 'referral_payout').length,
      rewardDuePaise: sumPaise(due.filter((r) => r.type === 'joining_reward').map((r) => r.amount)),
      rewardDueCount: due.filter((r) => r.type === 'joining_reward').length,
      failedCount: rows.filter((r) => r.status === 'failed').length,
    };
  }

  /** Money in (C-Payments): every confirmed payment and unmatched bank credit in the period. */
  async moneyIn(range: DateRange, page: PageRequest, search?: string, type?: string) {
    const where: Prisma.PaymentWhereInput = {
      AND: [
        { type: { in: type ? [type] : ['activation', 'reactivation', 'placement_fee'] } },
        { status: { in: RECEIVED_STATUSES } },
        this.receivedAtFilter(range),
        ...(search
          ? [{ OR: [{ code: contains(search) }, { bankUtr: contains(search) }, { upiReference: contains(search) }, { jobSeeker: { name: contains(search) } }, { business: { name: contains(search) } }] }]
          : []),
      ],
    };
    const [total, payments, totals, unmatched, mismatches, duplicates, unpaid] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: [{ confirmedAt: 'desc' }, { paidAt: 'desc' }],
        skip: page.skip,
        take: page.pageSize,
        include: {
          jobSeeker: { select: { id: true, code: true, name: true } },
          business: { select: { id: true, code: true, name: true } },
          placement: { select: { id: true, code: true } },
        },
      }),
      this.totals(range),
      this.prisma.bankCredit.findMany({ where: { status: 'unmatched' }, orderBy: { receivedAt: 'desc' }, take: 50 }),
      this.prisma.reviewFlag.count({ where: { kind: 'payment_mismatch', status: 'open' } }),
      this.prisma.payment.count({ where: { type: 'duplicate_refund', status: { in: ['pending', 'approved'] } } }),
      this.prisma.placement.findMany({
        where: { status: 'awaiting_payment' },
        select: { id: true, code: true, paymentDueAt: true, placementFee: true, gstAmount: true, business: { select: { name: true } } },
      }),
    ]);
    const now = new Date();
    return {
      rows: payments.map((p) => ({
        id: p.id,
        code: p.code,
        at: (p.confirmedAt ?? p.paidAt ?? p.createdAt).toISOString(),
        amountPaise: p.amount,
        type: p.type,
        method: p.method,
        reference: p.bankUtr ?? p.upiReference ?? p.gatewayReference,
        confirmedBy: p.confirmedBy,
        jobSeeker: p.jobSeeker,
        business: p.business,
        placement: p.placement,
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
      summary: {
        receivedInclGstPaise: totals.receivedInclGstPaise,
        matched: total,
        unmatchedCredits: unmatched.length,
        amountMismatches: mismatches,
        duplicatesToRefund: duplicates,
      },
      byType: totals,
      unmatched: unmatched.map((c) => ({ id: c.id, utr: c.bankUtr, amountPaise: c.amountPaise, at: c.receivedAt.toISOString(), payerName: c.payerName })),
      unpaidFees: {
        withinDue: unpaid.filter((p) => !p.paymentDueAt || p.paymentDueAt >= now).map((p) => ({ id: p.id, code: p.code, business: p.business.name, amountPaise: p.placementFee + p.gstAmount })),
        overdue: unpaid.filter((p) => p.paymentDueAt && p.paymentDueAt < now).map((p) => ({ id: p.id, code: p.code, business: p.business.name, amountPaise: p.placementFee + p.gstAmount })),
      },
    };
  }

  /** Money out (C-Payments-Out): owed → approved → paid. */
  async moneyOut(range: DateRange, page: PageRequest, type?: string, status?: string) {
    const and: Prisma.PaymentWhereInput[] = [{ type: { in: type ? [type] : ['refund', 'duplicate_refund', ...PAYOUT_TYPES] } }];
    if (status === 'due') and.push({ status: { in: ['pending', 'approved', 'processing'] } });
    else if (status === 'failed') and.push({ status: 'failed' });
    else if (status === 'paid') and.push({ status: { in: RECEIVED_STATUSES }, OR: [{ paidAt: { gte: range.from, lte: range.to } }, { paidAt: null, updatedAt: { gte: range.from, lte: range.to } }] });
    else and.push({ OR: [{ status: { in: ['pending', 'approved', 'processing', 'failed'] } }, { createdAt: { gte: range.from, lte: range.to } }] });
    const where: Prisma.PaymentWhereInput = { AND: and };
    const [total, payments, refundsPaid, withCeo, payouts] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: page.skip,
        take: page.pageSize,
        include: {
          jobSeeker: { select: { id: true, code: true, name: true } },
          business: { select: { id: true, code: true, name: true } },
          referral: { select: { id: true, code: true, name: true } },
          placement: { select: { id: true, code: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { type: { in: ['refund', 'duplicate_refund'] }, status: { in: RECEIVED_STATUSES }, OR: [{ paidAt: { gte: range.from, lte: range.to } }, { paidAt: null, updatedAt: { gte: range.from, lte: range.to } }] },
        select: { amount: true },
      }),
      this.prisma.payment.findMany({ where: { type: 'refund', status: 'pending', ceoApprovalReason: { not: null } }, select: { amount: true } }),
      this.payouts(),
    ]);
    const approverIds = [...new Set(payments.map((p) => p.approvedByStaffId).filter((x): x is string => Boolean(x)))];
    const approvers = approverIds.length ? await this.prisma.staff.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true, role: true } }) : [];
    const approverById = new Map(approvers.map((a) => [a.id, a]));
    return {
      rows: payments.map((p) => ({
        id: p.id,
        code: p.code,
        type: p.type,
        amountPaise: p.amount,
        status: p.status,
        withCeo: p.type === 'refund' && p.status === 'pending' && Boolean(p.ceoApprovalReason),
        ceoApprovalReason: p.ceoApprovalReason,
        approvedBy: p.approvedByStaffId ? (approverById.get(p.approvedByStaffId) ?? null) : null,
        approvedAt: p.approvedAt?.toISOString() ?? null,
        paidAt: p.paidAt?.toISOString() ?? null,
        utr: p.bankUtr,
        createdAt: p.createdAt.toISOString(),
        to: p.referral ?? p.jobSeeker ?? p.business,
        toKind: p.referral ? 'referral' : p.jobSeeker ? 'job_seeker' : p.business ? 'business' : null,
        placement: p.placement,
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
      summary: {
        refundsPaidPaise: sumPaise(refundsPaid.map((r) => r.amount)),
        refundsWithCeoPaise: sumPaise(withCeo.map((r) => r.amount)),
        refundsWithCeoCount: withCeo.length,
        referralDuePaise: payouts.referralDuePaise,
        referralDueCount: payouts.referralDueCount,
        rewardDuePaise: payouts.rewardDuePaise,
        rewardDueCount: payouts.rewardDueCount,
        failedCount: payouts.failedCount,
      },
    };
  }

  /** GST & invoices (C-Payments-GST): one row per placement fee invoice in the period. */
  async gst(range: DateRange, page: PageRequest, search?: string) {
    const where: Prisma.PlacementWhereInput = {
      AND: [
        { paidAt: { gte: range.from, lte: range.to } },
        { invoiceCode: { not: null } },
        ...(search ? [{ OR: [{ invoiceCode: contains(search) }, { business: { name: contains(search) } }, { business: { gstNumber: contains(search) } }] }] : []),
      ],
    };
    const [total, placements, all, refunded] = await Promise.all([
      this.prisma.placement.count({ where }),
      this.prisma.placement.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: page.skip,
        take: page.pageSize,
        include: { business: { select: { id: true, code: true, name: true, gstNumber: true, billingEmail: true } }, payments: { where: { type: 'refund' }, select: { status: true } } },
      }),
      this.prisma.placement.findMany({ where: { paidAt: { gte: range.from, lte: range.to }, invoiceCode: { not: null } }, select: { gstAmount: true } }),
      // Every refund of a GST invoice gets a credit note (guide, tax handling): the GST on
      // placement fees refunded in the period comes off what is paid.
      this.prisma.payment.findMany({
        where: { type: 'refund', placementId: { not: null }, status: { in: RECEIVED_STATUSES }, OR: [{ paidAt: { gte: range.from, lte: range.to } }, { paidAt: null, updatedAt: { gte: range.from, lte: range.to } }] },
        select: { amount: true, placement: { select: { placementFee: true, gstAmount: true } } },
      }),
    ]);
    const collected = sumPaise(all.map((p) => p.gstAmount));
    // GST reversed in proportion to the share of the fee refunded (a full refund reverses all of it).
    const creditNoteGst = sumPaise(
      refunded.map((r) => (r.placement && r.placement.placementFee > 0 ? Math.round((r.placement.gstAmount * Math.min(r.amount, r.placement.placementFee)) / r.placement.placementFee) : 0)),
    );
    return {
      rows: placements.map((p) => ({
        id: p.id,
        code: p.code,
        invoiceCode: p.invoiceCode,
        business: { id: p.business.id, code: p.business.code, name: p.business.name },
        gstin: p.business.gstNumber,
        feePaise: p.placementFee,
        gstPaise: p.gstAmount,
        totalPaise: p.placementFee + p.gstAmount,
        paidAt: p.paidAt?.toISOString() ?? null,
        status: p.payments.some((x) => RECEIVED_STATUSES.includes(x.status)) ? 'credit_note' : 'paid',
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
      summary: {
        collectedPaise: collected,
        toPayPaise: collected - creditNoteGst,
        creditNotes: refunded.length,
        invoices: all.length,
        due: gstDueDates(range.to),
      },
    };
  }

  /**
   * Refund approvals (C-Refunds): only refunds above Finance's limit, outside
   * the rules, or sent by Finance (GET /payments/refunds/with-ceo), each with
   * the evidence and the software's check.
   */
  async refundsWithCeo(now: Date = new Date()) {
    const policy = await this.pricing.current();
    const refunds = await this.prisma.payment.findMany({
      where: { type: 'refund', status: 'pending', ceoApprovalReason: { not: null } },
      orderBy: { sentToCeoAt: 'asc' },
      include: {
        placement: {
          include: {
            business: { select: { id: true, code: true, name: true } },
            replacementCandidates: { select: { status: true, rejectionReason: true } },
            replacementClaims: { orderBy: { reportedAt: 'desc' }, take: 1 },
          },
        },
        jobSeeker: { select: { id: true, code: true, name: true, status: true, paymentReceivedAt: true, hitCount: true } },
      },
    });
    const seekerIds = refunds.map((r) => r.jobSeekerId).filter((x): x is string => Boolean(x));
    const [hits, interviews, sentBy] = await Promise.all([
      seekerIds.length
        ? this.prisma.jobSeekerHit.findMany({ where: { jobSeekerId: { in: seekerIds }, reversedAt: null, supersededAt: null }, select: { jobSeekerId: true, reason: true, recordedAt: true } })
        : Promise.resolve([]),
      seekerIds.length ? this.prisma.interview.findMany({ where: { jobSeekerId: { in: seekerIds } }, select: { jobSeekerId: true, status: true, offerSentAt: true } }) : Promise.resolve([]),
      this.prisma.staff.findMany({ where: { id: { in: refunds.map((r) => r.sentToCeoByStaffId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true, role: true } }),
    ]);
    const sentById = new Map(sentBy.map((s) => [s.id, s]));
    const items = refunds.map((r) => {
      const base = {
        id: r.id,
        code: r.code,
        amountPaise: r.amount,
        reason: r.ceoApprovalReason,
        outsideRules: r.outsideRules,
        note: r.approvalNote,
        sentAt: (r.sentToCeoAt ?? r.createdAt).toISOString(),
        waitingDays: daysSince(r.sentToCeoAt ?? r.createdAt, now),
        sentBy: r.sentToCeoByStaffId ? (sentById.get(r.sentToCeoByStaffId) ?? null) : null,
      };
      if (r.placement) {
        const p = r.placement;
        const claim = p.replacementClaims[0];
        const reportedAt = claim?.reportedAt ?? p.dropoutReportedAt;
        const check = evaluatePlacementRefundEligibility(
          {
            code: p.code,
            status: p.status,
            hasAcceptedReplacement: p.replacementCandidates.some((c) => c.status === 'accepted'),
            dropoutReportedAt: reportedAt,
            placementFee: p.placementFee,
            hasExistingRefund: false,
            searchDays: policy.replacementSearchDays,
            guaranteeEndedReason: p.guaranteeEndedReason,
          },
          now,
        );
        return {
          ...base,
          kind: 'business' as const,
          recordId: p.id,
          subject: { code: p.code, name: p.business.name, businessId: p.business.id },
          evidence: {
            reportedWithinDeadline: claim?.reportedWithinDeadline ?? null,
            feePaidInFull: claim?.feePaidInFull ?? Boolean(p.paidAt),
            replacementsOffered: p.replacementCandidates.length,
            replacementsRejected: p.replacementCandidates.filter((c) => c.status === 'rejected').length,
            searchDaysReached: reportedAt ? daysSince(reportedAt, now) >= policy.replacementSearchDays : false,
            searchDays: policy.replacementSearchDays,
            guaranteeEndedReason: p.guaranteeEndedReason,
          },
          check: { eligible: check.eligible, reason: check.ineligibleReason ?? null },
        };
      }
      const s = r.jobSeeker;
      const seekerHits = s ? hits.filter((h) => h.jobSeekerId === s.id) : [];
      const forfeiting = seekerHits.filter((h) => (REFUND_FORFEITING_HIT_REASONS as readonly string[]).includes(h.reason));
      const offers = s ? interviews.filter((i) => i.jobSeekerId === s.id && (!s.paymentReceivedAt || i.offerSentAt >= s.paymentReceivedAt) && i.status !== 'cancelled') : [];
      return {
        ...base,
        kind: 'job_seeker' as const,
        recordId: s?.id ?? null,
        subject: s ? { code: s.code, name: s.name } : null,
        evidence: {
          offersMade: offers.length,
          offersDeclined: offers.filter((o) => o.status === 'declined').length,
          hits: seekerHits.length,
          maxHits: policy.maxHits,
          forfeitingHitAt: forfeiting[0]?.recordedAt.toISOString() ?? null,
          forfeitingHitReason: forfeiting[0]?.reason ?? null,
          guaranteeOver: s?.paymentReceivedAt ? daysSince(s.paymentReceivedAt, now) >= policy.jobSeekerGuaranteeDays : false,
        },
        check: { eligible: forfeiting.length === 0 && !['placed', 'deactivated', 'closed'].includes(s?.status ?? ''), reason: forfeiting[0]?.reason ?? (s && ['placed', 'deactivated', 'closed'].includes(s.status) ? s.status : null) },
      };
    });
    const financeWithin = await this.prisma.payment.findMany({ where: { type: { in: ['refund', 'duplicate_refund'] }, status: { in: ['pending', 'approved', 'processing'] }, ceoApprovalReason: null }, select: { amount: true } });
    const business = items.filter((i) => i.kind === 'business');
    const seekers = items.filter((i) => i.kind === 'job_seeker');
    return {
      items,
      summary: {
        waitingCount: items.length,
        waitingPaise: sumPaise(items.map((i) => i.amountPaise)),
        businessCount: business.length,
        businessPaise: sumPaise(business.map((i) => i.amountPaise)),
        jobSeekerCount: seekers.length,
        jobSeekerPaise: sumPaise(seekers.map((i) => i.amountPaise)),
        financeWithinLimitsPaise: sumPaise(financeWithin.map((r) => r.amount)),
        financeLimitPaise: policy.financeBusinessRefundLimitPaise,
        oldestWaitingDays: items.length ? Math.max(...items.map((i) => i.waitingDays)) : null,
      },
    };
  }

  // ---------------------------------------------------------------- referral partners

  async referrals(range: Partial<DateRange>, page: PageRequest, filters: { search?: string; type?: string; payout?: string; checks?: string }) {
    const and: Prisma.ReferralWhereInput[] = [{ anonymisedAt: null }];
    if (filters.search) {
      const digits = phoneSearchDigits(filters.search);
      and.push({ OR: [{ name: contains(filters.search) }, { code: contains(filters.search) }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] });
    }
    if (filters.type) and.push({ type: filters.type });
    if (filters.payout === 'due') and.push({ payments: { some: { type: 'referral_payout', status: { in: PAYOUT_DUE_STATUSES } } } });
    if (filters.payout === 'failed') and.push({ payments: { some: { type: 'referral_payout', status: 'failed' } } });
    if (filters.payout === 'paid') and.push({ payments: { some: { type: 'referral_payout', status: { in: RECEIVED_STATUSES } } } });
    if (filters.checks === 'id_pending') and.push({ identityVerifications: { none: { status: 'verified' } } });
    const where: Prisma.ReferralWhereInput = { AND: and };
    const partners = await this.prisma.referral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        jobSeekers: { select: { id: true, createdAt: true, phoneVerified: true, paymentReceivedAt: true, placements: { where: { joinedDate: { not: null } }, select: { joinedDate: true } } } },
        payments: { where: { type: 'referral_payout' }, select: { amount: true, status: true } },
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, nameMatches: true } },
      },
    });
    const accounts = partners.length
      ? await this.prisma.payoutAccount.findMany({ where: { ownerType: 'referral', ownerId: { in: partners.map((p) => p.id) }, status: { not: 'superseded' } }, select: { ownerId: true, status: true, nameMatches: true, maskedValue: true } })
      : [];
    const accountBy = new Map(accounts.map((a) => [a.ownerId, a]));
    let rows = partners.map((p) => {
      const referred = p.jobSeekers.filter((j) => (range.from ? j.createdAt >= range.from : true) && (range.to ? j.createdAt <= range.to : true));
      const account = accountBy.get(p.id);
      const due = p.payments.filter((x) => PAYOUT_DUE_STATUSES.includes(x.status));
      const failed = p.payments.filter((x) => x.status === 'failed');
      const paid = p.payments.filter((x) => RECEIVED_STATUSES.includes(x.status));
      const nameMismatch = account?.nameMatches === false || p.identityVerifications[0]?.nameMatches === false;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        phone: p.phone,
        type: p.type,
        role: p.individualRole ?? p.partnerBusinessType,
        area: p.locality,
        referred: referred.length,
        registered: referred.filter((j) => j.paymentReceivedAt).length,
        joined: referred.filter((j) => j.placements.length > 0).length,
        earnedPaise: sumPaise([...paid, ...due].map((x) => x.amount)),
        payout: failed.length ? { state: 'failed', count: failed.length } : due.length ? { state: 'due', count: due.length } : paid.length ? { state: 'paid', count: paid.length } : { state: 'none', count: 0 },
        checks: nameMismatch ? 'name_mismatch' : p.identityVerifications[0]?.status !== 'verified' ? 'id_pending' : account?.status === 'verified' ? 'upi_verified' : account ? 'upi_pending' : 'no_upi',
        createdAt: p.createdAt.toISOString(),
      };
    });
    if (filters.checks === 'name_mismatch') rows = rows.filter((r) => r.checks === 'name_mismatch');
    const allPayouts = partners.flatMap((p) => p.payments);
    const due = allPayouts.filter((x) => PAYOUT_DUE_STATUSES.includes(x.status));
    const [fraud, totalPartners] = await Promise.all([
      this.prisma.reviewFlag.groupBy({ by: ['kind'], where: { kind: { in: ['payout_matches_staff', 'payout_shared_account', 'payout_name_mismatch'] }, status: 'open' }, _count: { _all: true } }),
      this.prisma.referral.groupBy({ by: ['type'], where: { anonymisedAt: null }, _count: { _all: true } }),
    ]);
    const fraudCount = (kind: string) => fraud.find((f) => f.kind === kind)?._count._all ?? 0;
    const sortedBest = [...rows].sort((a, b) => b.joined - a.joined || b.registered - a.registered).filter((r) => r.joined > 0).slice(0, 5);
    return {
      rows: rows.slice(page.skip, page.skip + page.pageSize),
      total: rows.length,
      page: page.page,
      pageSize: page.pageSize,
      summary: {
        partners: totalPartners.reduce((s, t) => s + t._count._all, 0),
        individual: totalPartners.find((t) => t.type === 'individual')?._count._all ?? 0,
        business: totalPartners.find((t) => t.type === 'business')?._count._all ?? 0,
        referredInRange: rows.reduce((s, r) => s + r.referred, 0),
        joinedInRange: rows.reduce((s, r) => s + r.joined, 0),
        payoutsDuePaise: sumPaise(due.map((x) => x.amount)),
        payoutsDueCount: due.length,
        payoutsFailed: allPayouts.filter((x) => x.status === 'failed').length,
      },
      best: sortedBest.map((r) => ({ id: r.id, name: r.name, joined: r.joined })),
      fraud: {
        matchesStaff: fraudCount('payout_matches_staff'),
        sharedAccount: fraudCount('payout_shared_account'),
        nameMismatch: fraudCount('payout_name_mismatch'),
      },
    };
  }

  async partner(id: string, now: Date = new Date()) {
    const p = await this.prisma.referral.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: {
        jobSeekers: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, code: true, name: true, status: true, paymentReceivedAt: true, placements: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, code: true, joinedDate: true, status: true } } },
        },
        payments: { where: { type: 'referral_payout' }, orderBy: { createdAt: 'desc' }, include: { placement: { select: { id: true, code: true, jobSeeker: { select: { name: true } } } } } },
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!p) throw new NotFoundException(`Referral partner '${id}' not found`);
    const policy = await this.pricing.current();
    const [account, consent, registeredBy] = await Promise.all([
      this.prisma.payoutAccount.findFirst({ where: { ownerType: 'referral', ownerId: p.id, status: { not: 'superseded' } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.consent.findFirst({ where: { subjectType: 'referral', subjectId: p.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.auditLog.findFirst({ where: { entityType: 'referral', entityCode: p.code }, orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } }),
    ]);
    const due = p.payments.filter((x) => PAYOUT_DUE_STATUSES.includes(x.status));
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      phone: p.phone,
      type: p.type,
      role: p.individualRole ?? p.partnerBusinessType,
      businessName: p.partnerBusinessName,
      area: p.locality,
      createdAt: p.createdAt.toISOString(),
      paused: p.pausedAt ? { at: p.pausedAt.toISOString(), reason: p.pauseReason } : null,
      registeredBy: registeredBy?.actor?.name ?? null,
      terms: consent ? { granted: consent.granted && !consent.withdrawnAt, at: consent.grantedAt?.toISOString() ?? null } : null,
      identity: p.identityVerifications[0] ? { status: p.identityVerifications[0].status, method: p.identityVerifications[0].method, nameMatches: p.identityVerifications[0].nameMatches } : null,
      payoutAccount: account ? { method: account.method, masked: account.maskedValue, status: account.status, nameMatches: account.nameMatches, activeFrom: account.activeFrom.toISOString(), cooling: account.activeFrom > now } : null,
      counts: {
        referred: p.jobSeekers.length,
        registered: p.jobSeekers.filter((j) => j.paymentReceivedAt).length,
        joined: p.jobSeekers.filter((j) => j.placements[0]?.joinedDate).length,
        earnedPaise: sumPaise(p.payments.filter((x) => !['failed', 'rejected', 'reversed'].includes(x.status)).map((x) => x.amount)),
        duePaise: sumPaise(due.map((x) => x.amount)),
        payoutPaise: policy.referralPayoutPaise,
      },
      payouts: p.payments.map((x) => ({
        id: x.id,
        code: x.code,
        at: x.createdAt.toISOString(),
        placement: x.placement ? { id: x.placement.id, code: x.placement.code, name: x.placement.jobSeeker.name } : null,
        amountPaise: x.amount,
        status: x.status,
        paidAt: x.paidAt?.toISOString() ?? null,
      })),
      referred: p.jobSeekers.map((j) => ({
        id: j.id,
        code: j.code,
        name: j.name,
        status: j.status,
        guaranteeDay: j.paymentReceivedAt && j.status === 'active' ? daysSince(j.paymentReceivedAt, now) + 1 : null,
        placement: j.placements[0] ? { id: j.placements[0].id, code: j.placements[0].code, joinedDate: j.placements[0].joinedDate?.toISOString() ?? null } : null,
      })),
    };
  }
}
