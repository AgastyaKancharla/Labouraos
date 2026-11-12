import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { RECEIVED_STATUSES, sumPaise } from '../ceo-portal/ceo-common';
import { financialYear, istDay } from './finance-rules';
import { CsvValue, rupees, toCsv } from './finance-csv';
import { invoiceGstSplit } from '../placement/invoice-gst-split';
import { filingDates, isMonthKey, monthBounds, monthLabel } from './payroll-rules';

const OUT_TYPES = ['refund', 'duplicate_refund', 'referral_payout', 'joining_reward'];
/**
 * A business refund returns the fee only (owner decision 11 Nov): the GST on
 * it stays owed until the CA answers, so it never reduces the GST to pay and
 * no credit note goes into the GST data.
 */
function refundedFee(amount: number, placement: { placementFee: number } | null): number {
  if (!placement || placement.placementFee <= 0) return 0;
  return Math.min(amount, placement.placementFee);
}

/**
 * Tax (FN-Tax) and the downloads for the CA (FN-Reports; Phase 22 Part B).
 * GST collected and payable each month from the placement invoices (a
 * business refund returns the fee only and its GST stays owed until the CA
 * answers);
 * TDS businesses deducted from our fees (PR #94); referral commission totals
 * against the TDS limit (warning only — the CA confirms); filing dates as
 * reminders. CEO and Finance only.
 */
@Injectable()
export class FinanceTaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  private month(value: unknown): string {
    if (!isMonthKey(value)) throw new BadRequestException('month must look like 2026-10');
    return value;
  }

  private async invoicesIn(month: string) {
    const { from, to } = monthBounds(month);
    return this.prisma.placement.findMany({
      where: { paidAt: { gte: from, lte: to }, invoiceCode: { not: null } },
      select: { id: true, code: true, invoiceCode: true, paidAt: true, placementFee: true, gstAmount: true, gstPercentAtCreation: true, business: { select: { code: true, name: true, legalName: true, gstNumber: true, gstLegalName: true } } },
      orderBy: { paidAt: 'asc' },
    });
  }

  private async invoiceRefundsIn(month: string) {
    const { from, to } = monthBounds(month);
    return this.prisma.payment.findMany({
      where: { type: 'refund', placementId: { not: null }, status: { in: RECEIVED_STATUSES }, paidAt: { gte: from, lte: to } },
      select: { id: true, code: true, amount: true, paidAt: true, placement: { select: { code: true, invoiceCode: true, placementFee: true, gstAmount: true, business: { select: { name: true, legalName: true, gstNumber: true, gstLegalName: true } } } } },
      orderBy: { paidAt: 'asc' },
    });
  }

  async tax(monthValue: unknown, now = new Date()) {
    const month = this.month(monthValue);
    const { from, to } = monthBounds(month);
    const policy = await this.pricing.current();
    const [invoices, refunds, receipts, tds, fyPayouts, openPayouts] = await Promise.all([
      this.invoicesIn(month),
      this.invoiceRefundsIn(month),
      this.prisma.payment.count({ where: { type: { in: ['activation', 'reactivation'] }, status: { in: RECEIVED_STATUSES }, OR: [{ confirmedAt: { gte: from, lte: to } }, { confirmedAt: null, paidAt: { gte: from, lte: to } }] } }),
      this.prisma.tdsReceivable.findMany({
        where: { OR: [{ recordedAt: { gte: from, lte: to } }, { status: 'certificate_due', recordedAt: { lte: to } }] },
        select: { id: true, amountPaise: true, sectionNote: true, status: true, recordedAt: true, placement: { select: { code: true, invoiceCode: true, business: { select: { name: true } } } } },
        orderBy: { recordedAt: 'asc' },
      }),
      (() => {
        const fy = financialYear(to);
        return this.prisma.payment.groupBy({ by: ['referralId'], where: { type: 'referral_payout', status: { in: RECEIVED_STATUSES }, referralId: { not: null }, paidAt: { gte: fy.from, lte: to } }, _sum: { amount: true }, _count: { _all: true } });
      })(),
      this.prisma.payment.groupBy({ by: ['referralId'], where: { type: 'referral_payout', status: { in: ['pending', 'approved', 'processing'] }, referralId: { not: null } }, _sum: { amount: true } }),
    ]);
    const fy = financialYear(to);
    const invoiceFee = sumPaise(invoices.map((i) => i.placementFee));
    const invoiceGst = sumPaise(invoices.map((i) => i.gstAmount));
    const refundFee = sumPaise(refunds.map((r) => refundedFee(r.amount, r.placement)));
    const partnerIds = [...new Set([...fyPayouts, ...openPayouts].map((g) => g.referralId).filter((x): x is string => Boolean(x)))];
    const partners = partnerIds.length ? await this.prisma.referral.findMany({ where: { id: { in: partnerIds } }, select: { id: true, code: true, name: true } }) : [];
    const limit = policy.referralTdsYearlyLimitPaise;
    const nextPayout = policy.referralPayoutPaise;
    const referralRows = partnerIds
      .map((id) => {
        const paid = fyPayouts.find((g) => g.referralId === id)?._sum.amount ?? 0;
        const pending = openPayouts.find((g) => g.referralId === id)?._sum.amount ?? 0;
        const partner = partners.find((p) => p.id === id);
        const status = paid > limit ? 'over' : paid + Math.max(pending, nextPayout) > limit ? 'crosses_next' : 'below';
        return { referralId: id, code: partner?.code ?? null, name: partner?.name ?? null, paidThisYearPaise: paid, pendingPaise: pending, payouts: fyPayouts.find((g) => g.referralId === id)?._count._all ?? 0, status };
      })
      .filter((r) => r.paidThisYearPaise > 0 || r.pendingPaise > 0)
      .sort((a, b) => b.paidThisYearPaise + b.pendingPaise - (a.paidThisYearPaise + a.pendingPaise));
    const dates = filingDates(month);
    const today = istDay(now);
    const reminder = (key: string, label: string, due: string, what: string) => ({ key, label, due, what, daysLeft: Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) });
    return {
      month,
      label: monthLabel(month),
      gst: {
        invoices: { count: invoices.length, feePaise: invoiceFee, gstPaise: invoiceGst },
        // Business refunds this month: fee only; their GST is still owed (no credit note until the CA answers).
        creditNotes: { count: refunds.length, feePaise: refundFee, gstPaise: 0 },
        receipts: { count: receipts },
        payablePaise: invoiceGst,
        ratePercent: policy.gstPercent,
        companyGstin: policy.companyGstin,
      },
      dates: [
        reminder('gstr1', 'GSTR-1 (sales)', dates.gstr1, invoices.length ? 'Invoice data ready' : 'No invoices this month — file a nil return'),
        reminder('gstr3b', 'GSTR-3B (pay GST)', dates.gstr3b, `Pay ${rupees(invoiceGst)} GST`),
        reminder('tds_pay', 'TDS we took', dates.tdsPay, 'Nothing deducted yet (the CA confirms the referral TDS rule)'),
        reminder('tds_return', 'TDS returns', dates.tdsReturn, 'Every quarter · the CA'),
      ],
      tdsReceivable: tds.map((t) => ({ id: t.id, business: t.placement?.business?.name ?? null, placementCode: t.placement?.code ?? null, invoiceCode: t.placement?.invoiceCode ?? null, amountPaise: t.amountPaise, note: t.sectionNote, status: t.status, recordedAt: t.recordedAt.toISOString() })),
      tdsReceivableTotalPaise: sumPaise(tds.map((t) => t.amountPaise)),
      referralTds: { financialYear: fy.label, limitPaise: limit, nextPayoutPaise: nextPayout, rows: referralRows },
      notes: {
        gst: '₹499 registration fees carry no GST · monthly filing assumed — the CA may choose quarterly · a business refund returns the fee only — its GST stays owed until the CA answers (no credit note yet)',
        referral: `Referral payouts are commission: Finance is warned before a partner crosses ${rupees(limit)} in a financial year · deducting TDS waits for the CA`,
      },
    };
  }

  /**
   * GST data in the GSTR-1 layout: one row per invoice, with exactly the
   * CGST/SGST/IGST split printed on the stored invoice (invoiceGstSplit).
   * Fee-only business refunds are not credit notes, so none are listed.
   */
  async gstr1Csv(monthValue: unknown): Promise<{ filename: string; csv: string }> {
    const month = this.month(monthValue);
    const [invoices, policy] = await Promise.all([this.invoicesIn(month), this.pricing.current()]);
    const header = ['Section', 'GSTIN of recipient', 'Receiver name', 'Invoice number', 'Date', 'Value (Rs)', 'Place of supply', 'Reverse charge', 'Rate %', 'Taxable value (Rs)', 'IGST (Rs)', 'CGST (Rs)', 'SGST (Rs)', 'SAC (CA to confirm)', 'Placement'];
    const rows: CsvValue[][] = invoices.map((i) => {
      const gstin = i.business?.gstNumber ?? null;
      const t = invoiceGstSplit(i.gstAmount, i.gstPercentAtCreation ?? policy.gstPercent);
      return [gstin ? 'B2B' : 'B2C', gstin ?? '', i.business?.gstLegalName ?? i.business?.legalName ?? i.business?.name ?? '', i.invoiceCode ?? '', istDay(i.paidAt!), rupees(i.placementFee + i.gstAmount), '29-Karnataka', 'N', i.gstPercentAtCreation ?? policy.gstPercent, rupees(i.placementFee), rupees(t.igstAmountPaise), rupees(t.cgstAmountPaise), rupees(t.sgstAmountPaise), '998512', i.code];
    });
    return { filename: `gstr1-data-${month}.csv`, csv: toCsv(header, rows) };
  }

  /** TDS registers: TDS businesses took from our fees, and referral commission against the TDS limit (financial year of the month). */
  async tdsCsv(monthValue: unknown): Promise<{ filename: string; csv: string }> {
    const month = this.month(monthValue);
    const { to } = monthBounds(month);
    const fy = financialYear(to);
    const policy = await this.pricing.current();
    const [taken, payouts] = await Promise.all([
      this.prisma.tdsReceivable.findMany({
        where: { recordedAt: { gte: fy.from, lte: to } },
        select: { amountPaise: true, sectionNote: true, status: true, recordedAt: true, payment: { select: { amount: true, bankUtr: true } }, placement: { select: { code: true, invoiceCode: true, placementFee: true, gstAmount: true, business: { select: { name: true, gstNumber: true } } } } },
        orderBy: { recordedAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: { type: 'referral_payout', status: { in: RECEIVED_STATUSES }, paidAt: { gte: fy.from, lte: to } },
        select: { amount: true, paidAt: true, bankUtr: true, code: true, referral: { select: { code: true, name: true } } },
        orderBy: { paidAt: 'asc' },
      }),
    ]);
    const header = ['Register', 'Date', 'Party', 'GSTIN', 'Invoice / payout', 'Amount (Rs)', 'TDS (Rs)', 'Section / note', 'Status', 'Running total this year (Rs)', 'UTR'];
    const rows: CsvValue[][] = taken.map((t) => [
      'TDS taken by businesses from our fees', istDay(t.recordedAt), t.placement?.business?.name ?? '', t.placement?.business?.gstNumber ?? '', t.placement?.invoiceCode ?? t.placement?.code ?? '',
      rupees((t.placement?.placementFee ?? 0) + (t.placement?.gstAmount ?? 0)), rupees(t.amountPaise), t.sectionNote, t.status === 'certificate_received' ? 'Certificate received' : 'Certificate due', '', t.payment?.bankUtr ?? '',
    ]);
    const running = new Map<string, number>();
    for (const p of payouts) {
      const key = p.referral?.code ?? p.code;
      const total = (running.get(key) ?? 0) + p.amount;
      running.set(key, total);
      rows.push(['Referral commission (TDS by us — CA to confirm)', istDay(p.paidAt!), `${p.referral?.code ?? ''} ${p.referral?.name ?? ''}`.trim(), '', p.code, rupees(p.amount), '0.00', `Limit ${rupees(policy.referralTdsYearlyLimitPaise)} a year`, total > policy.referralTdsYearlyLimitPaise ? 'Over the limit — ask the CA' : 'Below the limit', rupees(total), p.bankUtr ?? '']);
    }
    return { filename: `tds-registers-${fy.label}-to-${month}.csv`, csv: toCsv(header, rows) };
  }

  /** Tax summary for the CA ("Download for the CA" on Tax): the month's GST lines and TDS. */
  async taxCsv(monthValue: unknown, now = new Date()): Promise<{ filename: string; csv: string }> {
    const view = await this.tax(monthValue, now);
    const rows: CsvValue[][] = [
      ['GST', 'Placement invoices', view.gst.invoices.count, rupees(view.gst.invoices.feePaise), rupees(view.gst.invoices.gstPaise)],
      ['GST', 'Business refunds (fee only — GST stays owed until the CA answers)', view.gst.creditNotes.count, rupees(-view.gst.creditNotes.feePaise), '0.00'],
      ['GST', 'GST to pay', '', '', rupees(view.gst.payablePaise)],
      ['GST', '₹499 registration receipts (no GST)', view.gst.receipts.count, '', '0.00'],
      ...view.tdsReceivable.map((t) => ['TDS taken by businesses', `${t.business ?? ''} · ${t.invoiceCode ?? t.placementCode ?? ''}`, 1, '', rupees(t.amountPaise)] as CsvValue[]),
      ...view.referralTds.rows.map((r) => ['Referral commission this year', `${r.code ?? ''} ${r.name ?? ''}`.trim(), r.payouts, rupees(r.paidThisYearPaise), r.status] as CsvValue[]),
      ...view.dates.map((d) => ['Due date', d.label, '', d.due, d.what] as CsvValue[]),
    ];
    return { filename: `tax-${view.month}.csv`, csv: toCsv(['Area', 'What', 'Count', 'Value (Rs)', 'Tax (Rs) / status'], rows) };
  }

  /** The books for a month: every rupee in and out, with invoice, receipt and UTR. */
  async booksCsv(monthValue: unknown): Promise<{ filename: string; csv: string }> {
    const month = this.month(monthValue);
    const { from, to } = monthBounds(month);
    const [received, out, expenses, salaries, returns, unmatched, matchedLater] = await Promise.all([
      this.prisma.payment.findMany({
        where: { type: { in: ['activation', 'reactivation', 'placement_fee'] }, status: { in: RECEIVED_STATUSES }, OR: [{ confirmedAt: { gte: from, lte: to } }, { confirmedAt: null, paidAt: { gte: from, lte: to } }] },
        select: { code: true, type: true, amount: true, confirmedAt: true, paidAt: true, bankUtr: true, method: true, jobSeeker: { select: { code: true, name: true } }, placement: { select: { code: true, invoiceCode: true, placementFee: true, gstAmount: true, business: { select: { name: true } } } }, tdsReceivable: { select: { amountPaise: true } } },
      }),
      this.prisma.payment.findMany({
        where: { type: { in: OUT_TYPES }, status: { in: RECEIVED_STATUSES }, paidAt: { gte: from, lte: to } },
        select: { code: true, type: true, amount: true, paidAt: true, bankUtr: true, jobSeeker: { select: { code: true, name: true } }, referral: { select: { code: true, name: true } }, placement: { select: { code: true, invoiceCode: true, business: { select: { name: true } } } } },
      }),
      this.prisma.expense.findMany({ where: { status: 'paid', paidAt: { gte: from, lte: to } }, select: { code: true, category: true, supplier: true, description: true, amountPaise: true, gstPaise: true, paidAt: true, paidFrom: true, paymentReference: true } }),
      this.prisma.payrollLine.findMany({ where: { status: 'paid', paidAt: { gte: from, lte: to } }, select: { staffCode: true, name: true, netPaise: true, paidAt: true, utr: true, paidFrom: true, run: { select: { month: true } } } }),
      this.prisma.bankCredit.findMany({ where: { status: 'returned', returnedAt: { gte: from, lte: to } }, select: { bankUtr: true, amountPaise: true, returnedAt: true, returnedUtr: true, payerName: true } }),
      this.prisma.bankCredit.findMany({ where: { status: 'unmatched', receivedAt: { gte: from, lte: to } }, select: { bankUtr: true, amountPaise: true, receivedAt: true, payerName: true } }),
      // In the bank this month, matched after the month closed and booked in a later month: still shown here, marked.
      this.prisma.bankCredit.findMany({
        where: { status: 'matched', receivedAt: { gte: from, lte: to }, matchedPayment: { confirmedAt: { gt: to } } },
        select: { bankUtr: true, amountPaise: true, receivedAt: true, payerName: true, matchedPayment: { select: { code: true, confirmedAt: true } } },
      }),
    ]);
    type Row = { at: Date; cells: CsvValue[] };
    const lines: Row[] = [];
    for (const p of received) {
      const at = p.confirmedAt ?? p.paidAt!;
      const isFee = p.type === 'placement_fee';
      const gst = isFee && p.placement ? p.placement.gstAmount : 0;
      const party = isFee ? (p.placement?.business?.name ?? '') : `${p.jobSeeker?.code ?? ''} ${p.jobSeeker?.name ?? ''}`.trim();
      lines.push({ at, cells: [istDay(at), 'In', isFee ? 'Placement fee' : 'Registration fee', party, isFee ? (p.placement?.invoiceCode ?? '') : p.code, rupees(p.amount), rupees(gst), rupees(p.tdsReceivable?.amountPaise ?? 0), p.bankUtr ?? '', p.method === 'gateway_card' ? 'Card' : 'UPI'] });
    }
    for (const p of out) {
      const what = p.type === 'referral_payout' ? 'Referral payout' : p.type === 'joining_reward' ? 'Joining reward' : p.placement ? 'Business refund' : 'Registration refund';
      const party = p.referral ? `${p.referral.code} ${p.referral.name}` : p.placement ? (p.placement.business?.name ?? p.placement.code) : `${p.jobSeeker?.code ?? ''} ${p.jobSeeker?.name ?? ''}`.trim();
      lines.push({ at: p.paidAt!, cells: [istDay(p.paidAt!), 'Out', what, party, p.placement?.invoiceCode ? `${p.code} (against ${p.placement.invoiceCode})` : p.code, rupees(-p.amount), '', '', p.bankUtr ?? '', 'UPI'] });
    }
    for (const e of expenses) lines.push({ at: e.paidAt!, cells: [istDay(e.paidAt!), 'Out', `Expense · ${e.category}`, e.supplier, e.code, rupees(-e.amountPaise), rupees(e.gstPaise), '', e.paymentReference ?? '', e.paidFrom ?? ''] });
    for (const l of salaries) lines.push({ at: l.paidAt!, cells: [istDay(l.paidAt!), 'Out', `Salary · ${monthLabel(l.run.month)}`, `${l.staffCode} ${l.name}`, '', rupees(-l.netPaise), '', '', l.utr ?? '', l.paidFrom ?? ''] });
    for (const r of returns) lines.push({ at: r.returnedAt!, cells: [istDay(r.returnedAt!), 'Out', 'Unclaimed money returned', r.payerName ?? '', `Credit ${r.bankUtr}`, rupees(-r.amountPaise), '', '', r.returnedUtr ?? '', 'UPI'] });
    for (const c of matchedLater) {
      const booked = monthLabel(istDay(c.matchedPayment!.confirmedAt!).slice(0, 7));
      lines.push({ at: c.receivedAt, cells: [istDay(c.receivedAt), 'In', `Matched later, booked in ${booked}`, c.payerName ?? '', c.matchedPayment?.code ?? '', rupees(c.amountPaise), '', '', c.bankUtr, 'UPI'] });
    }
    for (const u of unmatched) lines.push({ at: u.receivedAt, cells: [istDay(u.receivedAt), 'In', 'Not matched yet', u.payerName ?? '', '', rupees(u.amountPaise), '', '', u.bankUtr, 'UPI'] });
    lines.sort((a, b) => a.at.getTime() - b.at.getTime());
    return {
      filename: `books-${month}.csv`,
      csv: toCsv(['Date', 'In / out', 'What', 'Party', 'Invoice / receipt / code', 'Amount (Rs)', 'GST (Rs)', 'TDS (Rs)', 'UTR / reference', 'Paid by'], lines.map((l) => l.cells)),
    };
  }
}
