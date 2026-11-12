import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { RefundService } from '../refund/refund.service';
import { businessRefundNeedsCeo } from '../../common/money/approval-limits';
import { RECEIVED_STATUSES, istStartOfMonth, sumPaise } from '../ceo-portal/ceo-common';

const OPEN_REFUND_STATUSES = ['pending', 'approved', 'processing', 'failed'];
const CEO_REASON_TEXT: Record<string, string> = {
  above_finance_limit: 'Over your limit · needs the CEO',
  goodwill: 'Outside the rules · needs the CEO',
  sent_by_finance: 'Needs the CEO · sent by you',
};

export interface RefundRow {
  ref: string;
  kind: 'job_seeker' | 'business';
  subject: { id: string | null; code: string | null; name: string | null };
  placement: { id: string; code: string } | null;
  amountPaise: number;
  why: string;
  check: { eligible: boolean; text: string };
  approval: 'within_limit' | 'needs_ceo' | 'with_ceo';
  approvalText: string;
  state: 'due' | 'to_pay' | 'with_ceo' | 'failed' | 'processing';
  paymentId: string | null;
  paymentCode: string | null;
  jobSeekerId: string | null;
  placementId: string | null;
  daysOwed: number | null;
  since: string | null;
}

/**
 * Finance's refund queue (FN-Refunds) and one refund (FN-Refund), Phase 22
 * Part B. A read over what already exists: refunds the system marks due
 * (RefundService — the same rules as the approve endpoints), refunds already
 * raised that Finance may pay, and those with the CEO. Approving and paying
 * use the existing endpoints (POST /job-seekers/:id/refund, POST
 * /placements/:id/refund, POST /finance/payouts/:id/pay), so every limit and
 * check runs there. CEO and Finance only.
 */
@Injectable()
export class FinanceRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly refunds: RefundService,
  ) {}

  async list(actorId: string, filters: { who?: string; approval?: string; search?: string }, now = new Date()) {
    const policy = await this.pricing.current();
    const limit = policy.financeBusinessRefundLimitPaise;
    const [due, open, paid] = await Promise.all([
      this.refunds.getRefundsDue(actorId, now),
      this.prisma.payment.findMany({
        where: { type: { in: ['refund', 'duplicate_refund'] }, status: { in: OPEN_REFUND_STATUSES } },
        include: { jobSeeker: { select: { id: true, code: true, name: true } }, placement: { select: { id: true, code: true, business: { select: { id: true, code: true, name: true } } } }, business: { select: { id: true, code: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.payment.findMany({ where: { type: { in: ['refund', 'duplicate_refund'] }, status: { in: RECEIVED_STATUSES }, paidAt: { gte: istStartOfMonth(now), lte: now } }, select: { amount: true } }),
    ]);
    const rows: RefundRow[] = [];
    for (const d of due) {
      if (d.type === 'job_seeker') {
        rows.push({
          ref: `js-${d.id}`,
          kind: 'job_seeker',
          subject: { id: d.id, code: d.code, name: d.name ?? d.jobSeeker?.name ?? null },
          placement: null,
          amountPaise: d.amount,
          why: `${policy.jobSeekerGuaranteeDays}-day guarantee ran out`,
          check: { eligible: true, text: 'Eligible · checked by the system' },
          approval: 'within_limit',
          approvalText: 'Within your limit',
          state: 'due',
          paymentId: null,
          paymentCode: null,
          jobSeekerId: d.id,
          placementId: null,
          daysOwed: d.daysOwed,
          since: d.dueSince,
        });
      } else {
        const needs = businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: d.amount, limitPaise: limit });
        rows.push({
          ref: `pl-${d.id}`,
          kind: 'business',
          subject: { id: null, code: d.code, name: d.businessName ?? d.placement?.businessName ?? null },
          placement: { id: d.id, code: d.code },
          amountPaise: d.amount,
          why: `no replacement in ${policy.replacementSearchDays} days`,
          check: { eligible: true, text: 'Eligible · checked by the system' },
          approval: needs ? 'needs_ceo' : 'within_limit',
          approvalText: needs ? CEO_REASON_TEXT.above_finance_limit : 'Within your limit',
          state: 'due',
          paymentId: null,
          paymentCode: null,
          jobSeekerId: null,
          placementId: d.id,
          daysOwed: d.daysOwed,
          since: d.dueSince,
        });
      }
    }
    for (const p of open) {
      const business = !p.jobSeekerId && Boolean(p.placementId || p.businessId);
      // Same rule as Payouts: a pending business refund over Finance's limit is
      // the CEO's even before anyone sent it (businessRefundNeedsCeo).
      const ceoReason =
        p.status === 'pending'
          ? (p.ceoApprovalReason ??
            (business ? businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: p.amount, limitPaise: limit, outsideRules: p.outsideRules }) : p.outsideRules ? 'goodwill' : null))
          : null;
      const withCeo = Boolean(ceoReason);
      const biz = p.business ?? p.placement?.business ?? null;
      const state: RefundRow['state'] = withCeo ? 'with_ceo' : p.status === 'failed' ? 'failed' : p.status === 'processing' ? 'processing' : 'to_pay';
      rows.push({
        ref: `pay-${p.id}`,
        kind: business ? 'business' : 'job_seeker',
        subject: business ? { id: biz?.id ?? null, code: biz?.code ?? null, name: biz?.name ?? null } : { id: p.jobSeeker?.id ?? null, code: p.jobSeeker?.code ?? null, name: p.jobSeeker?.name ?? null },
        placement: p.placement ? { id: p.placement.id, code: p.placement.code } : null,
        amountPaise: p.amount,
        why: p.type === 'duplicate_refund' ? 'paid ₹499 twice' : p.outsideRules ? 'outside the rules (goodwill)' : business ? `no replacement in ${policy.replacementSearchDays} days` : `${policy.jobSeekerGuaranteeDays}-day guarantee ran out`,
        check: p.outsideRules ? { eligible: false, text: 'Outside the rules' } : { eligible: true, text: p.status === 'approved' ? 'Approved · ready to pay' : 'Eligible · checked by the system' },
        approval: withCeo ? 'with_ceo' : 'within_limit',
        approvalText: withCeo ? (CEO_REASON_TEXT[ceoReason ?? 'goodwill'] ?? 'Needs the CEO') : p.status === 'approved' && p.approvedByStaffId ? 'Approved' : 'Within your limit',
        state,
        paymentId: p.id,
        paymentCode: p.code,
        jobSeekerId: p.jobSeekerId,
        placementId: p.placementId,
        daysOwed: null,
        since: (p.sentToCeoAt ?? p.approvedAt ?? p.createdAt).toISOString(),
      });
    }
    const q = filters.search?.toLowerCase();
    const filtered = rows.filter((r) => {
      if (filters.who === 'job_seeker' && r.kind !== 'job_seeker') return false;
      if (filters.who === 'business' && r.kind !== 'business') return false;
      if (filters.approval === 'within_limit' && r.approval !== 'within_limit') return false;
      if (filters.approval === 'needs_ceo' && r.approval === 'within_limit') return false;
      if (q && ![r.subject.code, r.subject.name, r.placement?.code, r.paymentCode].some((v) => v?.toLowerCase().includes(q))) return false;
      return true;
    });
    const within = rows.filter((r) => r.approval === 'within_limit' && r.state !== 'failed');
    const withCeo = rows.filter((r) => r.approval !== 'within_limit');
    return {
      rows: filtered,
      summary: {
        withinLimitCount: within.length,
        toPayPaise: sumPaise(within.map((r) => r.amountPaise)),
        withCeoCount: withCeo.length,
        withCeoPaise: sumPaise(withCeo.map((r) => r.amountPaise)),
        paidThisMonthPaise: sumPaise(paid.map((p) => p.amount)),
        paidThisMonthCount: paid.length,
        businessRefundLimitPaise: limit,
      },
    };
  }

  /** One refund with every check the system did, ready to pay. `ref` is js-<id>, pl-<id> or pay-<id>. */
  async detail(actorId: string, ref: string, now = new Date()) {
    const match = /^(js|pl|pay)-([0-9a-f-]{36})$/i.exec(ref);
    if (!match) throw new BadRequestException('Unknown refund');
    const [, kind, id] = match;
    const policy = await this.pricing.current();
    const limit = policy.financeBusinessRefundLimitPaise;
    const list = await this.list(actorId, {}, now);
    // A refund already paid or decided is not in the queue: it still shows, read-only (row = null).
    const row = list.rows.find((r) => r.ref === ref) ?? null;
    const payment = kind === 'pay' ? await this.prisma.payment.findUnique({ where: { id } }) : null;
    if (kind === 'pay' && (!payment || !['refund', 'duplicate_refund'].includes(payment.type))) throw new NotFoundException('Refund not found');
    const placementId = kind === 'pl' ? id : (payment?.placementId ?? null);
    const jobSeekerId = kind === 'js' ? id : (payment?.jobSeekerId ?? null);
    const decided = payment ? { status: payment.status, paidAt: payment.paidAt?.toISOString() ?? null, utr: payment.bankUtr, approvedAt: payment.approvedAt?.toISOString() ?? null } : null;

    if (placementId && !jobSeekerId) {
      const placement = await this.prisma.placement.findUnique({
        where: { id: placementId },
        select: {
          id: true, code: true, placementFee: true, gstAmount: true, paidAt: true, joinedDate: true, dropoutReportedAt: true, rootPlacementId: true, status: true,
          business: { select: { id: true, code: true, name: true } },
          jobSeeker: { select: { name: true } },
          vacancy: { select: { tradeSkill: true } },
        },
      });
      if (!placement) throw new NotFoundException('Placement not found');
      const rootId = placement.rootPlacementId ?? placement.id;
      const [claim, candidates, bypass, account] = await Promise.all([
        this.prisma.replacementClaim.findFirst({ where: { placement: { OR: [{ id: rootId }, { rootPlacementId: rootId }] }, decision: 'accepted' }, orderBy: { decidedAt: 'desc' }, include: { decidedByStaff: { select: { name: true, role: true } } } }),
        this.prisma.replacementCandidate.findMany({ where: { placement: { OR: [{ id: rootId }, { rootPlacementId: rootId }] } }, select: { status: true, rejectionReason: true } }),
        this.prisma.reviewFlag.count({ where: { kind: 'bypass_suspected', status: 'open', subjectType: 'business', subjectId: placement.business.id } }),
        this.prisma.payoutAccount.findFirst({ where: { ownerType: 'business', ownerId: placement.business.id, status: { not: 'superseded' } }, orderBy: { createdAt: 'desc' }, select: { method: true, maskedValue: true, verifiedName: true, status: true } }),
      ]);
      const amount = row?.amountPaise ?? payment?.amount ?? placement.placementFee;
      const searchEnds = (claim?.reportedAt ?? placement.dropoutReportedAt) ? new Date((claim?.reportedAt ?? placement.dropoutReportedAt)!.getTime() + policy.replacementSearchDays * 86_400_000) : null;
      const shown = candidates.length;
      const refused = candidates.filter((c) => c.status === 'rejected').length;
      const withinLimit = amount <= limit;
      const checks = [
        { ok: claim?.reportedWithinDeadline ?? false, text: `Reported within ${policy.claimReportDays} days of the worker leaving` },
        { ok: claim?.feePaidInFull ?? Boolean(placement.paidAt), text: 'Fee paid in full' },
        { ok: Boolean(searchEnds && searchEnds <= now) && !candidates.some((c) => c.status === 'accepted'), text: `${policy.replacementSearchDays}-day search ended · ${shown} candidate${shown === 1 ? '' : 's'} shown${refused ? `, ${refused} refused by the owner` : ''}` },
        { ok: bypass === 0, text: bypass ? 'A bypass flag is open on this business' : 'No bypass flag on this business' },
        { ok: withinLimit, text: withinLimit ? `${this.rupees(amount)} is within your ${this.rupees(limit)} limit` : `${this.rupees(amount)} is over your ${this.rupees(limit)} limit · the CEO approves` },
      ];
      return {
        ref,
        kind: 'business' as const,
        row,
        decided,
        business: placement.business,
        placement: { id: placement.id, code: placement.code, role: placement.vacancy?.tradeSkill ?? null, workerName: placement.jobSeeker?.name ?? null, joinedDate: placement.joinedDate?.toISOString() ?? null, dropoutReportedAt: placement.dropoutReportedAt?.toISOString() ?? null, status: placement.status },
        fee: { feePaise: placement.placementFee, gstPaise: placement.gstAmount, totalPaise: placement.placementFee + placement.gstAmount },
        why: claim ? `Claim accepted by ${claim.decidedByStaff?.name ?? 'the Team Lead'} · ${policy.replacementSearchDays}-day replacement search ended with no one accepted` : `${policy.replacementSearchDays}-day replacement search ended with no one accepted`,
        amountPaise: amount,
        percent: placement.placementFee > 0 ? Math.round((amount * 100) / placement.placementFee) : null,
        checks,
        payTo: account ? { method: account.method, masked: account.maskedValue, verifiedName: account.verifiedName, status: account.status } : null,
        withinLimit,
        limitPaise: limit,
      };
    }

    if (!jobSeekerId) throw new NotFoundException('Refund not found');
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId }, select: { id: true, code: true, name: true, status: true, paymentReceivedAt: true } });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    const [hits, account] = await Promise.all([
      this.prisma.jobSeekerHit.findMany({ where: { jobSeekerId, reversedAt: null, supersededAt: null }, select: { reason: true } }),
      this.prisma.payoutAccount.findFirst({ where: { ownerType: 'job_seeker', ownerId: jobSeekerId, status: { not: 'superseded' } }, orderBy: { createdAt: 'desc' }, select: { method: true, maskedValue: true, verifiedName: true, status: true } }),
    ]);
    const forfeiting = hits.filter((h) => ['offer_declined', 'offer_no_reply', 'interview_no_show', 'offer_rejected'].includes(h.reason)).length;
    const ends = seeker.paymentReceivedAt ? new Date(seeker.paymentReceivedAt.getTime() + policy.jobSeekerGuaranteeDays * 86_400_000) : null;
    const amount = row?.amountPaise ?? payment?.amount ?? policy.activationFeePaise;
    return {
      ref,
      kind: 'job_seeker' as const,
      row,
      decided,
      jobSeeker: { id: seeker.id, code: seeker.code, name: seeker.name, status: seeker.status },
      why: payment?.type === 'duplicate_refund' ? 'Paid ₹499 twice' : `${policy.jobSeekerGuaranteeDays}-day guarantee ran out without a suitable offer`,
      amountPaise: amount,
      checks: [
        { ok: Boolean(seeker.paymentReceivedAt), text: seeker.paymentReceivedAt ? `Paid ${this.rupees(policy.activationFeePaise)} on ${seeker.paymentReceivedAt.toISOString().slice(0, 10)}` : 'No registration payment found' },
        { ok: Boolean(ends && ends <= now), text: ends ? `${policy.jobSeekerGuaranteeDays} days ended on ${ends.toISOString().slice(0, 10)}` : 'Guarantee not started' },
        { ok: forfeiting === 0, text: forfeiting ? `${forfeiting} suitable offer${forfeiting === 1 ? '' : 's'} turned down or missed` : 'No suitable offer turned down' },
        { ok: hits.length < policy.maxHits && seeker.status !== 'deactivated', text: `Not deactivated (${hits.length} of ${policy.maxHits} hits)` },
        { ok: seeker.status !== 'placed', text: seeker.status === 'placed' ? 'Placed in a job' : 'Not placed' },
      ],
      payTo: account ? { method: account.method, masked: account.maskedValue, verifiedName: account.verifiedName, status: account.status } : null,
      withinLimit: true,
      limitPaise: limit,
    };
  }

  private rupees(paise: number): string {
    return `₹${Math.floor(paise / 100).toLocaleString('en-IN')}`;
  }
}
