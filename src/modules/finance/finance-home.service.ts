import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { RECEIVED_STATUSES, istStartOfMonth, sumPaise } from '../ceo-portal/ceo-common';
import { MONEY_IN_TYPES, gstDueDates } from '../ceo-portal/ceo-money.service';
import { FinanceBooksService } from './finance-books.service';
import { FinancePayoutsService } from './finance-payouts.service';

const OUT_TYPES = ['refund', 'duplicate_refund', 'referral_payout', 'joining_reward'];

/** Money today (FN-Home) and the Finance sidebar counts, from the other Finance views. */
@Injectable()
export class FinanceHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly books: FinanceBooksService,
    private readonly payouts: FinancePayoutsService,
  ) {}

  /**
   * GST on last month's GST invoices: placement fees and paid no-bypass charges. A business refund returns the fee
   * only, and the GST on it stays owed until the CA answers (owner decision
   * 11 Nov), so refunds do not reduce it.
   */
  private async gstLastMonth(now: Date) {
    const thisMonth = istStartOfMonth(now);
    const lastMonth = istStartOfMonth(new Date(thisMonth.getTime() - 1));
    const to = new Date(thisMonth.getTime() - 1);
    const [invoices, bypassPaid] = await Promise.all([
      this.prisma.placement.findMany({ where: { paidAt: { gte: lastMonth, lte: to }, invoiceCode: { not: null } }, select: { gstAmount: true } }),
      // N4: paid no-bypass charges carry GST too, the same as on FN-Tax.
      this.prisma.payment.findMany({
        where: { type: 'bypass_charge', status: { in: RECEIVED_STATUSES }, OR: [{ confirmedAt: { gte: lastMonth, lte: to } }, { confirmedAt: null, paidAt: { gte: lastMonth, lte: to } }] },
        select: { id: true },
      }),
    ]);
    const charges = bypassPaid.length
      ? await this.prisma.bypassCharge.findMany({ where: { paymentId: { in: bypassPaid.map((p) => p.id) } }, select: { gstPaise: true } })
      : [];
    return { paise: sumPaise([...invoices.map((p) => p.gstAmount), ...charges.map((c) => c.gstPaise)]), month: lastMonth.toISOString(), due: gstDueDates(to) };
  }

  async home(now = new Date()) {
    const monthStart = istStartOfMonth(now);
    const policy = await this.pricing.current();
    const [received, paidOut, expensesPaid, payoutView, credits, overdueFees, bills, booksBalance, today, gst] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          status: { in: RECEIVED_STATUSES },
          // Every kind of money in the books counts, paid no-bypass charges included (as FN-Tax and the books).
          type: { in: MONEY_IN_TYPES },
          OR: [{ confirmedAt: { gte: monthStart, lte: now } }, { confirmedAt: null, paidAt: { gte: monthStart, lte: now } }],
        },
        select: { amount: true },
      }),
      this.prisma.payment.findMany({ where: { type: { in: OUT_TYPES }, status: { in: RECEIVED_STATUSES }, paidAt: { gte: monthStart, lte: now } }, select: { amount: true } }),
      this.prisma.expense.findMany({ where: { status: 'paid', paidAt: { gte: monthStart, lte: now } }, select: { amountPaise: true } }),
      this.payouts.list({}, now),
      this.prisma.bankCredit.findMany({ where: { status: 'unmatched' }, select: { amountPaise: true } }),
      this.prisma.placement.findMany({ where: { status: 'awaiting_payment', paymentDueAt: { lt: now } }, select: { placementFee: true, gstAmount: true } }),
      this.prisma.expense.findMany({ where: { status: { in: ['waiting_finance', 'approved'] } }, select: { amountPaise: true } }),
      this.books.booksBalance(now),
      this.books.today(now),
      this.gstLastMonth(now),
    ]);
    const refunds = payoutView.rows.filter((r) => (r.type === 'refund' || r.type === 'duplicate_refund') && r.state !== 'with_ceo' && r.state !== 'failed');
    const withCeo = payoutView.rows.filter((r) => r.state === 'with_ceo');
    const payoutsReady = payoutView.rows.filter((r) => r.state === 'ready' && (r.type === 'referral_payout' || r.type === 'joining_reward'));
    const failed = payoutView.rows.filter((r) => r.state === 'failed');
    return {
      stats: {
        receivedThisMonthPaise: sumPaise(received.map((p) => p.amount)),
        paidOutThisMonthPaise: sumPaise(paidOut.map((p) => p.amount)) + sumPaise(expensesPaid.map((e) => e.amountPaise)),
        booksBalancePaise: booksBalance,
        refundsToPayPaise: sumPaise(refunds.map((r) => r.amountPaise)),
        refundsToPayCount: refunds.length,
        gstLastMonthPaise: gst.paise,
        gstMonth: gst.month,
        gstDue: gst.due,
      },
      todo: {
        refundsWithinLimit: { count: refunds.length, paise: sumPaise(refunds.map((r) => r.amountPaise)) },
        refundsWithCeo: { count: withCeo.length, paise: sumPaise(withCeo.map((r) => r.amountPaise)) },
        paymentsToSort: { count: credits.length, paise: sumPaise(credits.map((c) => c.amountPaise)) },
        payoutsReady: { count: payoutsReady.length, paise: sumPaise(payoutsReady.map((r) => r.amountPaise)) },
        payoutsFailed: { count: failed.length, paise: sumPaise(failed.map((r) => r.amountPaise)) },
        feesOverdue: { count: overdueFees.length, paise: sumPaise(overdueFees.map((p) => p.placementFee + p.gstAmount)) },
        billsToPay: { count: bills.length, paise: sumPaise(bills.map((b) => b.amountPaise)) },
        tdsWarnings: payoutView.summary.tdsCount,
      },
      today: today.slice(0, 20),
      limits: {
        businessRefundLimitPaise: policy.financeBusinessRefundLimitPaise,
        expenseLimitPaise: policy.financeExpenseLimitPaise,
        referralTdsYearlyLimitPaise: policy.referralTdsYearlyLimitPaise,
      },
    };
  }

  /** Numbers for the Finance sidebar badges. */
  async counts(now = new Date()) {
    const [credits, unpaid, payoutView, expenses] = await Promise.all([
      this.prisma.bankCredit.count({ where: { status: 'unmatched' } }),
      this.prisma.placement.count({ where: { status: 'awaiting_payment', paymentDueAt: { lt: now } } }),
      this.payouts.list({}, now),
      this.prisma.expense.count({ where: { status: { in: ['waiting_finance', 'approved'] } } }),
    ]);
    return {
      bankCreditsUnmatched: credits,
      invoicesUnpaid: unpaid,
      payoutsDue: payoutView.rows.filter((r) => r.state === 'ready' || r.state === 'failed').length,
      expensesToApprove: expenses,
    };
  }
}
