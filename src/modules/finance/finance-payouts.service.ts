import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Payment, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { PricingService } from '../pricing/pricing.service';
import { PaymentService } from '../payment/payment.service';
import { businessRefundNeedsCeo } from '../../common/money/approval-limits';
import { RECEIVED_STATUSES, contains, sumPaise } from '../ceo-portal/ceo-common';
import { financialYear, payoutState, tdsWarning } from './finance-rules';

export const PAYOUT_LIST_TYPES = ['referral_payout', 'joining_reward', 'refund', 'duplicate_refund'];
const OPEN_STATUSES = ['pending', 'approved', 'processing', 'failed'];

type PayoutPayment = Prisma.PaymentGetPayload<{
  include: {
    referral: { select: { id: true; code: true; name: true } };
    jobSeeker: { select: { id: true; code: true; name: true } };
    business: { select: { id: true; code: true; name: true } };
    placement: { select: { id: true; code: true; businessId: true; business: { select: { id: true; code: true; name: true } }; jobSeeker: { select: { name: true } } } };
  };
}>;

export interface PayInput {
  utr?: unknown;
  receiverNameShown?: unknown;
}

/** Who receives a payout, as recordPayout resolves it. */
function receiver(p: PayoutPayment): { ownerType: string; ownerId: string } {
  if (p.type === 'referral_payout') return { ownerType: 'referral', ownerId: p.referralId || p.subjectId };
  if (p.type === 'joining_reward') return { ownerType: 'job_seeker', ownerId: p.jobSeekerId || p.subjectId };
  if (p.jobSeekerId || p.subjectType === 'job_seeker') return { ownerType: 'job_seeker', ownerId: p.jobSeekerId || p.subjectId };
  return { ownerType: 'business', ownerId: p.businessId || p.placement?.businessId || p.subjectId };
}

/**
 * Payouts paid daily (FN-Payouts): referral payouts, joining rewards and the
 * refunds Finance may pay, each with whether it can be paid today. Paying runs
 * the existing approval checks (refund eligibility, limits, referral terms) and
 * records the UTR with the name the UPI app showed (PaymentService).
 */
@Injectable()
export class FinancePayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
    private readonly payments: PaymentService,
  ) {}

  async list(filters: { status?: string; who?: string; search?: string }, now = new Date()) {
    const policy = await this.pricing.current();
    const and: Prisma.PaymentWhereInput[] = [{ type: { in: PAYOUT_LIST_TYPES } }, { status: { in: OPEN_STATUSES } }];
    if (filters.who === 'referral') and.push({ type: 'referral_payout' });
    if (filters.who === 'job_seeker') and.push({ OR: [{ type: 'joining_reward' }, { type: { in: ['refund', 'duplicate_refund'] }, jobSeekerId: { not: null } }] });
    if (filters.who === 'business') and.push({ type: 'refund', jobSeekerId: null });
    if (filters.search) {
      and.push({
        OR: [
          { code: contains(filters.search) },
          { referral: { OR: [{ name: contains(filters.search) }, { code: contains(filters.search) }] } },
          { jobSeeker: { OR: [{ name: contains(filters.search) }, { code: contains(filters.search) }] } },
          { business: { OR: [{ name: contains(filters.search) }, { code: contains(filters.search) }] } },
          { placement: { code: contains(filters.search) } },
        ],
      });
    }
    const payments: PayoutPayment[] = await this.prisma.payment.findMany({
      where: { AND: and },
      orderBy: { createdAt: 'asc' },
      take: 2000,
      include: {
        referral: { select: { id: true, code: true, name: true } },
        jobSeeker: { select: { id: true, code: true, name: true } },
        business: { select: { id: true, code: true, name: true } },
        placement: { select: { id: true, code: true, businessId: true, business: { select: { id: true, code: true, name: true } }, jobSeeker: { select: { name: true } } } },
      },
    });
    const owners = payments.map(receiver);
    const accounts = owners.length
      ? await this.prisma.payoutAccount.findMany({
          where: { OR: owners.map((o) => ({ ownerType: o.ownerType, ownerId: o.ownerId })), status: { not: 'superseded' } },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const accountFor = (o: { ownerType: string; ownerId: string }, p: PayoutPayment) =>
      (p.payoutAccountId ? accounts.find((a) => a.id === p.payoutAccountId) : undefined) ??
      accounts.find((a) => a.ownerType === o.ownerType && a.ownerId === o.ownerId) ??
      null;
    const fy = financialYear(now);
    const partnerIds = [...new Set(payments.filter((p) => p.type === 'referral_payout').map((p) => p.referralId || p.subjectId))];
    const paidThisYear = partnerIds.length
      ? await this.prisma.payment.groupBy({
          by: ['referralId'],
          where: { type: 'referral_payout', status: { in: RECEIVED_STATUSES }, referralId: { in: partnerIds }, paidAt: { gte: fy.from, lte: fy.to } },
          _sum: { amount: true },
        })
      : [];
    const paidBy = new Map(paidThisYear.map((g) => [g.referralId, g._sum.amount ?? 0]));
    const rows = payments.map((p) => {
      const owner = receiver(p);
      const account = accountFor(owner, p);
      const isBusinessRefund = p.type === 'refund' && owner.ownerType === 'business';
      const ceoReason =
        p.type === 'refund' && p.status === 'pending'
          ? (p.ceoApprovalReason ??
            (isBusinessRefund ? businessRefundNeedsCeo({ actorRole: 'finance', amountPaise: p.amount, limitPaise: policy.financeBusinessRefundLimitPaise, outsideRules: p.outsideRules }) : p.outsideRules ? 'goodwill' : null))
          : null;
      const state = payoutState({ status: p.status, withCeo: Boolean(ceoReason), account: account ? { status: account.status, activeFrom: account.activeFrom } : null, now });
      const tds = p.type === 'referral_payout' ? tdsWarning(paidBy.get(p.referralId || p.subjectId) ?? 0, p.amount, policy.referralTdsYearlyLimitPaise) : null;
      const to =
        p.type === 'referral_payout'
          ? { kind: 'referral', code: p.referral?.code ?? null, name: p.referral?.name ?? null }
          : owner.ownerType === 'job_seeker'
            ? { kind: 'job_seeker', code: p.jobSeeker?.code ?? null, name: p.jobSeeker?.name ?? null }
            : { kind: 'business', code: (p.business ?? p.placement?.business)?.code ?? null, name: (p.business ?? p.placement?.business)?.name ?? null };
      return {
        id: p.id,
        code: p.code,
        type: p.type,
        to,
        placement: p.placement ? { id: p.placement.id, code: p.placement.code, workerName: p.placement.jobSeeker?.name ?? null } : null,
        amountPaise: p.amount,
        status: p.status,
        state: state.state,
        payableAt: state.payableAt?.toISOString() ?? null,
        ceoReason,
        account: account ? { method: account.method, masked: account.maskedValue, status: account.status, verifiedName: account.verifiedName, nameMatches: account.nameMatches } : null,
        failureReason: p.payoutFailureReason,
        failedAt: p.payoutFailedAt?.toISOString() ?? null,
        tds,
        createdAt: p.createdAt.toISOString(),
      };
    });
    const filtered = rows.filter((r) => {
      if (!filters.status) return true;
      if (filters.status === 'tds') return Boolean(r.tds);
      if (filters.status === 'waiting') return ['waiting_48h', 'no_details', 'flagged', 'with_ceo', 'processing'].includes(r.state);
      return r.state === filters.status;
    });
    const due = rows.filter((r) => r.state !== 'failed' && r.state !== 'with_ceo');
    const ready = rows.filter((r) => r.state === 'ready');
    return {
      rows: filtered,
      summary: {
        referralDuePaise: sumPaise(due.filter((r) => r.type === 'referral_payout').map((r) => r.amountPaise)),
        referralDueCount: due.filter((r) => r.type === 'referral_payout').length,
        rewardDuePaise: sumPaise(due.filter((r) => r.type === 'joining_reward').map((r) => r.amountPaise)),
        rewardDueCount: due.filter((r) => r.type === 'joining_reward').length,
        refundsDuePaise: sumPaise(due.filter((r) => r.type === 'refund' || r.type === 'duplicate_refund').map((r) => r.amountPaise)),
        refundsDueCount: due.filter((r) => r.type === 'refund' || r.type === 'duplicate_refund').length,
        failedCount: rows.filter((r) => r.state === 'failed').length,
        tdsCount: rows.filter((r) => r.tds).length,
        readyCount: ready.length,
        readyPaise: sumPaise(ready.map((r) => r.amountPaise)),
        tdsLimitPaise: policy.referralTdsYearlyLimitPaise,
        businessRefundLimitPaise: policy.financeBusinessRefundLimitPaise,
        financialYear: fy.label,
      },
    };
  }

  private async load(id: string): Promise<Payment> {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p || !PAYOUT_LIST_TYPES.includes(p.type)) throw new NotFoundException(`Payout '${id}' not found`);
    return p;
  }

  /**
   * "Pay and record": approve if it is still owed (the approval checks run
   * there), then record the UTR. A pending payout that the approval refuses is
   * left exactly as it was.
   */
  async pay(id: string, input: PayInput, actorId: string, now = new Date()) {
    const utr = typeof input.utr === 'string' ? input.utr.trim() : '';
    const name = typeof input.receiverNameShown === 'string' ? input.receiverNameShown.trim() : '';
    if (!utr) throw new BadRequestException('Type the UTR from the bank or UPI app');
    if (!name) throw new BadRequestException('Type the receiver name the UPI app showed');
    const payment = await this.load(id);
    if (payment.status === 'failed') throw new BadRequestException('This payout failed at the bank. Retry it first, after checking the details.');
    // Check the receiver's details first, so a payout that cannot go today is left
    // exactly as it was (not approved half-way).
    const owner = receiver(payment as PayoutPayment);
    const account =
      (payment.payoutAccountId ? await this.prisma.payoutAccount.findUnique({ where: { id: payment.payoutAccountId } }) : null) ??
      (await this.prisma.payoutAccount.findFirst({ where: { ownerType: owner.ownerType, ownerId: owner.ownerId, status: { not: 'superseded' } }, orderBy: { createdAt: 'desc' } }));
    const state = payoutState({ status: payment.status, withCeo: false, account: account ? { status: account.status, activeFrom: account.activeFrom } : null, now });
    if (state.state === 'waiting_48h') {
      throw new BadRequestException(`The payout details changed recently: this can be paid after the 48-hour wait, from ${state.payableAt!.toISOString()}`);
    }
    if (state.state === 'no_details') throw new BadRequestException('The receiver has no payout details yet. Send the details link first.');
    if (state.state === 'flagged') throw new BadRequestException('The payout details are flagged. Sort out the flag first.');
    if (payment.status === 'pending') {
      await this.payments.approvePayment(payment.id, actorId, now);
    } else if (payment.status !== 'approved') {
      throw new BadRequestException(`This payout is ${payment.status}, so it cannot be paid`);
    }
    return this.payments.recordPayout(payment.id, actorId, { bankUtr: utr, receiverNameShown: name }, now);
  }

  /** "Pay all ready": each payout has its own UTR; one failure never stops the rest. */
  async payAll(items: unknown, actorId: string, now = new Date()) {
    if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('Send the payouts to pay, each with its UTR');
    if (items.length > 200) throw new BadRequestException('Pay at most 200 payouts at once');
    const results: { id: string; ok: boolean; code?: string; message?: string }[] = [];
    for (const raw of items) {
      const item = (raw ?? {}) as { id?: unknown; utr?: unknown; receiverNameShown?: unknown };
      const id = typeof item.id === 'string' ? item.id : '';
      try {
        const paid = await this.pay(id, item, actorId, now);
        results.push({ id, ok: true, code: paid.code });
      } catch (e) {
        const message = e instanceof HttpException ? this.messageOf(e) : 'Could not record this payout';
        results.push({ id, ok: false, message });
      }
    }
    return { paid: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  private messageOf(e: HttpException): string {
    const body = e.getResponse();
    if (typeof body === 'string') return body;
    const m = (body as { message?: unknown }).message;
    return Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : e.message;
  }

  /** The bank refused a payout Finance sent (account closed, name mismatch…). */
  async markFailed(id: string, reason: unknown, actorId: string, now = new Date()) {
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (!why) throw new BadRequestException('Write what the bank said');
    const payment = await this.load(id);
    if (!['approved', 'processing'].includes(payment.status)) {
      throw new BadRequestException(`Only a payout being paid can fail at the bank (this one is ${payment.status})`);
    }
    await this.assertMoneyRole(actorId);
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: { status: 'failed', payoutFailureReason: why, payoutFailedAt: now },
    });
    if (claimed.count !== 1) throw new BadRequestException(`Payout ${payment.code} changed meanwhile; reload`);
    await recordStatusChange(this.prisma, { subjectType: 'payment', subjectId: payment.id, fromStatus: payment.status, toStatus: 'failed', changedByStaffId: actorId, reason: 'payout_failed_at_bank', changedAt: now });
    await this.audit.log({
      actorId,
      action: 'payout.failed_at_bank',
      entityType: 'payment',
      entityCode: payment.code,
      before: { status: payment.status },
      after: { status: 'failed', amount: payment.amount },
      changedFields: ['status', 'payoutFailureReason', 'payoutFailedAt'],
      reason: why,
    });
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  /**
   * Retry a failed payout: it goes back to approved, ready to pay again. The
   * payout details (and any 48-hour wait after they change) are checked again
   * when it is paid.
   */
  async retry(id: string, actorId: string, now = new Date()) {
    const payment = await this.load(id);
    if (payment.status !== 'failed') throw new BadRequestException(`Only a failed payout can be retried (this one is ${payment.status})`);
    if (payment.bankUtr) throw new BadRequestException('This payout already has a UTR recorded; check the bank before paying again');
    await this.assertMoneyRole(actorId);
    const claimed = await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'failed' }, data: { status: 'approved' } });
    if (claimed.count !== 1) throw new BadRequestException(`Payout ${payment.code} changed meanwhile; reload`);
    await recordStatusChange(this.prisma, { subjectType: 'payment', subjectId: payment.id, fromStatus: 'failed', toStatus: 'approved', changedByStaffId: actorId, reason: 'payout_retry', changedAt: now });
    await this.audit.log({
      actorId,
      action: 'payout.retry',
      entityType: 'payment',
      entityCode: payment.code,
      before: { status: 'failed', payoutFailureReason: payment.payoutFailureReason },
      after: { status: 'approved', amount: payment.amount },
      changedFields: ['status'],
      reason: 'Failed payout put back to pay again',
    });
    return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  private async assertMoneyRole(actorId: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!staff || !['ceo', 'finance'].includes(staff.role)) throw new ForbiddenException('Only Finance or the CEO pays money out');
  }
}
