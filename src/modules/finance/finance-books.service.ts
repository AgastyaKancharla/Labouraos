import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { DateRange, RECEIVED_STATUSES, contains, daysSince, sumPaise } from '../ceo-portal/ceo-common';
import { invoicePath } from '../placement/invoice-link';
import { receiptToken } from '../payment/receipt-link';
import { MonthLockService } from '../month-lock/month-lock.service';
import { assertUtrUnused, isUniqueViolation, utrUsed } from '../../common/money/utr-registry';
import { MONEY_IN_NEEDS_YOU, MoneyInStatus, bankDay, istDay, istDayBounds, matchHints, moneyInStatus, parsePaise } from './finance-rules';

const OUT_TYPES = ['refund', 'duplicate_refund', 'referral_payout', 'joining_reward'];
const MAX_BANK_DAYS = 62;

interface FlagInfo {
  reason: string | null;
  paymentId: string | null;
  expectedPaise: number | null;
  shortByPaise: number | null;
}

/** Open payment-mismatch flags, keyed by the bank credit they are about. */
function flagsByCredit(flags: { subjectType: string; subjectId: string; details: Prisma.JsonValue }[]): Map<string, FlagInfo> {
  const map = new Map<string, FlagInfo>();
  for (const f of flags) {
    const d = (f.details ?? {}) as Record<string, unknown>;
    const creditId = f.subjectType === 'bank_credit' ? f.subjectId : typeof d.bankCreditId === 'string' ? d.bankCreditId : null;
    if (!creditId) continue;
    map.set(creditId, {
      reason: typeof d.reason === 'string' ? d.reason : null,
      paymentId: f.subjectType === 'payment' ? f.subjectId : null,
      expectedPaise: typeof d.expectedAmountPaise === 'number' ? d.expectedAmountPaise : null,
      shortByPaise: typeof d.shortByPaise === 'number' ? d.shortByPaise : null,
    });
  }
  return map;
}

function receiptPath(paymentId: string): string {
  return `/payments/${encodeURIComponent(paymentId)}/receipt?token=${receiptToken(paymentId)}`;
}

/**
 * Money in, Match a payment, Bank and Invoices (FN-MoneyIn, FN-Match, FN-Bank,
 * FN-Invoices). Matching itself is PaymentService.confirmPaymentWithBankCredit
 * (POST /payments/:id/confirm), which also records a TDS-short placement fee.
 */
@Injectable()
export class FinanceBooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly locks?: MonthLockService,
  ) {}

  // ------------------------------------------------------------ money in

  async moneyIn(range: DateRange, filters: { status?: string; type?: string; search?: string }, now = new Date()) {
    const creditWhere: Prisma.BankCreditWhereInput = {
      AND: [
        { OR: [{ receivedAt: { gte: range.from, lte: range.to } }, { status: 'unmatched' }] },
        ...(filters.search
          ? [
              {
                OR: [
                  { bankUtr: contains(filters.search) },
                  { payerName: contains(filters.search) },
                  { payerVpaMasked: contains(filters.search) },
                  { remark: contains(filters.search) },
                  { matchedPayment: { OR: [{ code: contains(filters.search) }, { jobSeeker: { name: contains(filters.search) } }, { jobSeeker: { code: contains(filters.search) } }, { business: { name: contains(filters.search) } }, { placement: { invoiceCode: contains(filters.search) } }] } },
                ],
              },
            ]
          : []),
      ],
    };
    const [credits, cards, flags, tdsMonth] = await Promise.all([
      this.prisma.bankCredit.findMany({
        where: creditWhere,
        orderBy: { receivedAt: 'desc' },
        take: 2000,
        include: {
          matchedPayment: {
            include: {
              jobSeeker: { select: { id: true, code: true, name: true } },
              business: { select: { id: true, code: true, name: true } },
              placement: { select: { id: true, code: true, invoiceCode: true, business: { select: { id: true, code: true, name: true } } } },
            },
          },
          tdsReceivable: true,
        },
      }),
      this.prisma.payment.findMany({
        where: {
          confirmedBy: 'gateway',
          status: { in: RECEIVED_STATUSES },
          type: { in: ['activation', 'reactivation', 'placement_fee'] },
          confirmedAt: { gte: range.from, lte: range.to },
          ...(filters.search ? { OR: [{ code: contains(filters.search) }, { gatewayReference: contains(filters.search) }, { jobSeeker: { name: contains(filters.search) } }, { business: { name: contains(filters.search) } }] } : {}),
        },
        include: {
          jobSeeker: { select: { id: true, code: true, name: true } },
          business: { select: { id: true, code: true, name: true } },
          placement: { select: { id: true, code: true, invoiceCode: true, business: { select: { id: true, code: true, name: true } } } },
        },
        take: 2000,
      }),
      this.prisma.reviewFlag.findMany({ where: { kind: 'payment_mismatch', status: 'open' }, select: { subjectType: true, subjectId: true, details: true } }),
      this.prisma.tdsReceivable.findMany({ where: { recordedAt: { gte: istDayBounds(`${istDay(now).slice(0, 8)}01`).from } }, select: { amountPaise: true } }),
    ]);
    const flagMap = flagsByCredit(flags);
    const expectedIds = [...new Set([...flagMap.values()].map((f) => f.paymentId).filter((x): x is string => Boolean(x)))];
    const expected = expectedIds.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: expectedIds } },
          include: {
            jobSeeker: { select: { id: true, code: true, name: true } },
            business: { select: { id: true, code: true, name: true } },
            placement: { select: { id: true, code: true, invoiceCode: true, business: { select: { id: true, code: true, name: true } } } },
          },
        })
      : [];
    const expectedById = new Map(expected.map((p) => [p.id, p]));
    type P = (typeof expected)[number];
    const forOf = (p: P | null | undefined) =>
      p
        ? {
            paymentId: p.id,
            paymentCode: p.code,
            type: p.type,
            invoiceCode: p.placement?.invoiceCode ?? null,
            placementCode: p.placement?.code ?? null,
            who: p.jobSeeker ? { code: p.jobSeeker.code, name: p.jobSeeker.name } : (p.business ?? p.placement?.business) ? { code: (p.business ?? p.placement?.business)!.code, name: (p.business ?? p.placement?.business)!.name } : null,
          }
        : null;
    const creditRows = credits.map((c) => {
      const flag = flagMap.get(c.id) ?? null;
      const pay = c.matchedPayment ?? (flag?.paymentId ? expectedById.get(flag.paymentId) : undefined) ?? null;
      const status = moneyInStatus({
        creditStatus: c.status,
        source: c.source,
        matchedType: c.matchedPayment?.type ?? null,
        confirmedBy: c.matchedPayment?.confirmedBy ?? null,
        hasTds: Boolean(c.tdsReceivable),
        flagReason: flag?.reason ?? null,
      });
      const expectedPaise = c.matchedPayment ? (c.matchedPayment.expectedAmountPaise ?? c.matchedPayment.amount) : (flag?.expectedPaise ?? (pay ? (pay.expectedAmountPaise ?? pay.amount) : null));
      return {
        id: c.id,
        kind: 'bank_credit' as const,
        at: c.receivedAt.toISOString(),
        utr: c.bankUtr,
        payerName: c.payerName,
        payerVpaMasked: c.payerVpaMasked,
        remark: c.remark,
        source: c.source,
        for: forOf(pay),
        expectedPaise: c.matchedPayment?.type === 'duplicate_refund' ? null : expectedPaise,
        receivedPaise: c.amountPaise,
        status,
        flagReason: flag?.reason ?? null,
        shortByPaise: expectedPaise !== null && expectedPaise > c.amountPaise ? expectedPaise - c.amountPaise : null,
        tds: c.tdsReceivable ? { id: c.tdsReceivable.id, amountPaise: c.tdsReceivable.amountPaise, status: c.tdsReceivable.status } : null,
        returnedUtr: c.returnedUtr,
        ignoredReason: c.ignoredReason,
        duplicateRefund: c.matchedPayment?.type === 'duplicate_refund' ? { paymentId: c.matchedPayment.id, status: c.matchedPayment.status } : null,
      };
    });
    const cardRows = cards.map((p) => ({
      id: p.id,
      kind: 'card' as const,
      at: (p.confirmedAt ?? p.createdAt).toISOString(),
      utr: p.gatewayReference,
      payerName: null,
      payerVpaMasked: null,
      remark: null,
      source: 'gateway',
      for: forOf(p),
      expectedPaise: p.expectedAmountPaise ?? p.amount,
      receivedPaise: p.amount,
      status: 'matched_auto' as MoneyInStatus,
      flagReason: null,
      shortByPaise: null,
      tds: null,
      returnedUtr: null,
      ignoredReason: null,
      duplicateRefund: null,
    }));
    const all = [...creditRows, ...cardRows].sort((a, b) => b.at.localeCompare(a.at));
    const inRange = all.filter((r) => r.at >= range.from.toISOString() && r.at <= range.to.toISOString());
    const rows = all.filter((r) => {
      if (filters.type === 'placement_fee' && r.for?.type !== 'placement_fee') return false;
      if (filters.type === 'activation' && !['activation', 'reactivation'].includes(r.for?.type ?? '')) return false;
      if (!filters.status) return true;
      if (filters.status === 'needs') return MONEY_IN_NEEDS_YOU.includes(r.status);
      if (filters.status === 'matched') return ['matched_auto', 'matched_finance', 'tds_recorded'].includes(r.status);
      return r.status === filters.status;
    });
    return {
      rows,
      summary: {
        receivedPaise: sumPaise(inRange.filter((r) => !['returned'].includes(r.status)).map((r) => r.receivedPaise)),
        receivedCount: inRange.length,
        matchedAutoCount: inRange.filter((r) => r.status === 'matched_auto').length,
        needYouCount: all.filter((r) => MONEY_IN_NEEDS_YOU.includes(r.status)).length,
        tdsThisMonthPaise: sumPaise(tdsMonth.map((t) => t.amountPaise)),
      },
    };
  }

  /** Possible matches for an unclaimed credit (FN-Match): waiting payments of the same amount, best first. */
  async matches(creditId: string) {
    const credit = await this.prisma.bankCredit.findUnique({ where: { id: creditId } });
    if (!credit) throw new NotFoundException(`Bank credit '${creditId}' not found`);
    const since = new Date(credit.receivedAt.getTime() - 30 * 24 * 3600 * 1000);
    const waiting = credit.status === 'unmatched'
      ? await this.prisma.payment.findMany({
          where: {
            status: 'pending',
            type: { in: ['activation', 'reactivation', 'placement_fee'] },
            createdAt: { gte: since, lte: new Date(credit.receivedAt.getTime() + 60_000) },
            OR: [{ amount: { gte: credit.amountPaise } }, { expectedAmountPaise: { gte: credit.amountPaise } }],
          },
          take: 500,
          orderBy: { createdAt: 'desc' },
          include: {
            jobSeeker: { select: { id: true, code: true, name: true } },
            business: { select: { id: true, code: true, name: true } },
            placement: { select: { id: true, code: true, invoiceCode: true, business: { select: { id: true, code: true, name: true } } } },
          },
        })
      : [];
    const candidates = waiting
      .map((p) => {
        const business = p.business ?? p.placement?.business ?? null;
        const hints = matchHints({
          creditPaise: credit.amountPaise,
          creditAt: credit.receivedAt,
          payerName: credit.payerName,
          remark: credit.remark,
          payment: {
            expectedPaise: p.expectedAmountPaise ?? p.amount,
            type: p.type,
            reference: p.upiReference,
            createdAt: p.createdAt,
            payerHint: p.payerUtrHint,
            names: [p.jobSeeker?.name, business?.name].filter((x): x is string => Boolean(x)),
          },
        });
        if (!hints) return null;
        return {
          paymentId: p.id,
          paymentCode: p.code,
          type: p.type,
          who: p.jobSeeker ? { code: p.jobSeeker.code, name: p.jobSeeker.name } : business ? { code: business.code, name: business.name } : null,
          invoiceCode: p.placement?.invoiceCode ?? null,
          placementCode: p.placement?.code ?? null,
          linkSentAt: p.createdAt.toISOString(),
          expectedPaise: p.expectedAmountPaise ?? p.amount,
          reference: p.upiReference,
          ...hints,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return {
      credit: {
        id: credit.id,
        utr: credit.bankUtr,
        amountPaise: credit.amountPaise,
        at: credit.receivedAt.toISOString(),
        payerName: credit.payerName,
        payerVpaMasked: credit.payerVpaMasked,
        remark: credit.remark,
        status: credit.status,
        returnedUtr: credit.returnedUtr,
      },
      candidates,
    };
  }

  /** "Return the money": unclaimed money goes back to the same UPI ID, with the UTR recorded. */
  async returnCredit(creditId: string, input: { utr?: unknown; reason?: unknown }, actorId: string, now = new Date()) {
    const utr = typeof input.utr === 'string' ? input.utr.trim() : '';
    if (!utr) throw new BadRequestException('Type the UTR of the money sent back');
    const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : 'Nothing matches: returned to the payer';
    await this.assertMoneyRole(actorId);
    const credit = await this.prisma.bankCredit.findUnique({ where: { id: creditId } });
    if (!credit) throw new NotFoundException(`Bank credit '${creditId}' not found`);
    if (credit.status !== 'unmatched') throw new BadRequestException(`This credit is ${credit.status}; only an unmatched credit is returned`);
    // A closed month never changes: its credits are not returned from here.
    if (this.locks) await this.locks.assertOpenOn(credit.receivedAt, 'its bank credits');
    await assertUtrUnused(this.prisma, utr);
    const claimed = await this.prisma.bankCredit
      .updateMany({
        where: { id: credit.id, status: 'unmatched' },
        data: { status: 'returned', returnedUtr: utr, returnedAt: now, returnedByStaffId: actorId, ignoredReason: reason },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw utrUsed(utr);
        throw error;
      });
    if (claimed.count !== 1) throw new BadRequestException('This credit changed meanwhile; reload');
    await this.prisma.reviewFlag.updateMany({
      where: { kind: 'payment_mismatch', status: 'open', subjectType: 'bank_credit', subjectId: credit.id },
      data: { status: 'resolved', resolution: `Returned to the payer, UTR ${utr}`, resolvedAt: now, resolvedByStaffId: actorId },
    });
    await this.audit.log({
      actorId,
      action: 'bank_credit.returned',
      entityType: 'BankCredit',
      entityCode: credit.bankUtr,
      before: { status: credit.status },
      after: { status: 'returned', returnedUtr: utr, amountPaise: credit.amountPaise },
      changedFields: ['status', 'returnedUtr', 'returnedAt', 'returnedByStaffId'],
      reason,
    });
    return this.prisma.bankCredit.findUniqueOrThrow({ where: { id: credit.id } });
  }

  // ------------------------------------------------------------ bank

  /** Every movement through the bank in our books between two instants. */
  private async movements(from: Date, to: Date) {
    const [credits, outs, expenses, returns, salaries] = await Promise.all([
      this.prisma.bankCredit.findMany({
        where: { receivedAt: { gte: from, lte: to } },
        include: { matchedPayment: { select: { id: true, code: true, type: true, jobSeeker: { select: { code: true, name: true } }, business: { select: { name: true } }, placement: { select: { code: true, invoiceCode: true, business: { select: { name: true } } } } } }, tdsReceivable: { select: { id: true } } },
      }),
      this.prisma.payment.findMany({
        where: { type: { in: OUT_TYPES }, status: { in: RECEIVED_STATUSES }, paidAt: { gte: from, lte: to } },
        select: { id: true, code: true, type: true, amount: true, paidAt: true, bankUtr: true, referral: { select: { code: true, name: true } }, jobSeeker: { select: { code: true, name: true } }, business: { select: { name: true } }, placement: { select: { code: true } } },
      }),
      this.prisma.expense.findMany({ where: { status: 'paid', paidAt: { gte: from, lte: to }, NOT: { paidFrom: 'cash' } } }),
      this.prisma.bankCredit.findMany({ where: { status: 'returned', returnedAt: { gte: from, lte: to } } }),
      // Salaries paid from the company account (Phase 22 Part B).
      this.prisma.payrollLine.findMany({ where: { status: 'paid', paidAt: { gte: from, lte: to }, netPaise: { gt: 0 }, NOT: { paidFrom: 'cash' } }, select: { id: true, staffCode: true, name: true, netPaise: true, paidAt: true, utr: true, run: { select: { month: true } } } }),
    ]);
    type Line = { id: string; at: string; direction: 'credit' | 'debit'; amountPaise: number; what: string; status: string; reference: string | null; source: string };
    const lines: Line[] = [
      ...credits.map((c) => {
        const p = c.matchedPayment;
        const who = p ? (p.jobSeeker ? `${p.jobSeeker.code} · ${p.jobSeeker.name}` : (p.business?.name ?? p.placement?.business?.name ?? p.code)) : (c.payerName ?? 'Unknown payer');
        return {
          id: `bc-${c.id}`,
          at: c.receivedAt.toISOString(),
          direction: 'credit' as const,
          amountPaise: c.amountPaise,
          what: p?.placement?.invoiceCode ? `${who} · ${p.placement.invoiceCode}` : who,
          status: c.status === 'matched' ? (c.tdsReceivable ? 'matched_tds' : 'matched') : c.status === 'unmatched' ? 'unknown' : c.status,
          reference: c.bankUtr,
          source: 'bank_credit',
        };
      }),
      ...outs.map((p) => ({
        id: `pay-${p.id}`,
        at: p.paidAt!.toISOString(),
        direction: 'debit' as const,
        amountPaise: p.amount,
        what: `${p.type === 'referral_payout' ? 'Referral payout' : p.type === 'joining_reward' ? 'Joining reward' : 'Refund'} · ${p.referral?.code ?? p.jobSeeker?.code ?? p.placement?.code ?? p.business?.name ?? p.code}`,
        status: 'matched',
        reference: p.bankUtr,
        source: 'payment',
      })),
      ...expenses.map((e) => ({
        id: `exp-${e.id}`,
        at: e.paidAt!.toISOString(),
        direction: 'debit' as const,
        amountPaise: e.amountPaise,
        what: `${e.supplier} · ${e.description}`,
        status: 'matched',
        reference: e.paymentReference,
        source: 'expense',
      })),
      ...returns.map((c) => ({
        id: `ret-${c.id}`,
        at: c.returnedAt!.toISOString(),
        direction: 'debit' as const,
        amountPaise: c.amountPaise,
        what: `Returned to ${c.payerVpaMasked ?? c.payerName ?? 'the payer'}`,
        status: 'matched',
        reference: c.returnedUtr,
        source: 'return',
      })),
      ...salaries.map((l) => ({
        id: `sal-${l.id}`,
        at: l.paidAt!.toISOString(),
        direction: 'debit' as const,
        amountPaise: l.netPaise,
        what: `Salary ${l.run.month} · ${l.staffCode} ${l.name}`,
        status: 'matched',
        reference: l.utr,
        source: 'salary',
      })),
    ];
    return lines.sort((a, b) => b.at.localeCompare(a.at));
  }

  private sumDay(lines: { at: string; direction: string; amountPaise: number }[], day: string) {
    const ofDay = lines.filter((l) => istDay(new Date(l.at)) === day);
    return {
      inPaise: sumPaise(ofDay.filter((l) => l.direction === 'credit').map((l) => l.amountPaise)),
      outPaise: sumPaise(ofDay.filter((l) => l.direction === 'debit').map((l) => l.amountPaise)),
    };
  }

  /**
   * Daily reconciliation (FN-Bank): for each IST day, opening, money in, money
   * out and our closing balance, against the bank's closing balance typed in
   * from the statement when the day is closed.
   */
  async bank(range: DateRange, now = new Date()) {
    const fromDay = istDay(range.from);
    const toDay = istDay(range.to > now ? now : range.to);
    const lastCloseBefore = await this.prisma.bankDayClose.findFirst({ where: { day: { lt: fromDay } }, orderBy: { day: 'desc' } });
    const start = lastCloseBefore ? new Date(istDayBounds(lastCloseBefore.day).to.getTime() + 1) : new Date(0);
    const end = istDayBounds(toDay).to;
    const lines = await this.movements(start, end);
    const closes = await this.prisma.bankDayClose.findMany({ where: { day: { gte: fromDay, lte: toDay } } });
    const closeBy = new Map(closes.map((c) => [c.day, c]));
    const closerIds = [...new Set(closes.map((c) => c.closedByStaffId))];
    const closers = closerIds.length ? await this.prisma.staff.findMany({ where: { id: { in: closerIds } }, select: { id: true, name: true } }) : [];
    const closerName = new Map(closers.map((s) => [s.id, s.name]));
    const rangeStart = istDayBounds(fromDay).from;
    const before = lines.filter((l) => new Date(l.at) < rangeStart);
    let opening = (lastCloseBefore?.bankClosingPaise ?? 0) + sumPaise(before.filter((l) => l.direction === 'credit').map((l) => l.amountPaise)) - sumPaise(before.filter((l) => l.direction === 'debit').map((l) => l.amountPaise));
    const dayRows: Array<ReturnType<typeof bankDay> & { day: string; unmatched: number; closed: null | { bankClosingPaise: number; differencePaise: number; note: string | null; closedBy: string | null; closedAt: string } }> = [];
    let cursor = fromDay;
    let guard = 0;
    while (cursor <= toDay && guard < MAX_BANK_DAYS) {
      const { inPaise, outPaise } = this.sumDay(lines, cursor);
      const close = closeBy.get(cursor);
      const d = bankDay(opening, inPaise, outPaise, close?.bankClosingPaise ?? null);
      dayRows.push({
        ...d,
        day: cursor,
        unmatched: lines.filter((l) => istDay(new Date(l.at)) === cursor && l.status === 'unknown').length,
        closed: close ? { bankClosingPaise: close.bankClosingPaise, differencePaise: close.differencePaise, note: close.note, closedBy: closerName.get(close.closedByStaffId) ?? null, closedAt: close.closedAt.toISOString() } : null,
      });
      // A closed day carries the bank's own closing balance forward.
      opening = close ? close.bankClosingPaise : d.booksClosingPaise;
      cursor = istDay(new Date(istDayBounds(cursor).to.getTime() + 1));
      guard += 1;
    }
    const lastClosed = await this.prisma.bankDayClose.findFirst({ orderBy: { day: 'desc' } });
    const booksNow = await this.booksBalance(now);
    const inRangeLines = lines.filter((l) => new Date(l.at) >= rangeStart && new Date(l.at) <= end);
    return {
      lines: inRangeLines,
      days: dayRows.reverse(),
      summary: {
        booksBalancePaise: booksNow,
        lastClosedDay: lastClosed?.day ?? null,
        lastBankClosingPaise: lastClosed?.bankClosingPaise ?? null,
        linesToSort: await this.prisma.bankCredit.count({ where: { status: 'unmatched' } }),
      },
    };
  }

  /** Balance in our books now: the last closed day's bank balance plus everything since. */
  async booksBalance(now = new Date()): Promise<number> {
    const last = await this.prisma.bankDayClose.findFirst({ orderBy: { day: 'desc' } });
    const start = last ? new Date(istDayBounds(last.day).to.getTime() + 1) : new Date(0);
    const lines = await this.movements(start, now);
    return (last?.bankClosingPaise ?? 0) + sumPaise(lines.filter((l) => l.direction === 'credit').map((l) => l.amountPaise)) - sumPaise(lines.filter((l) => l.direction === 'debit').map((l) => l.amountPaise));
  }

  /** Today's movements (Money today: "Money moving today"). */
  async today(now = new Date()) {
    const { from } = istDayBounds(istDay(now));
    return this.movements(from, now);
  }

  /** Close one IST day: every line matched, and the bank's closing balance agrees (or a written reason). */
  async closeDay(input: { day?: unknown; bankClosingPaise?: unknown; note?: unknown }, actorId: string, now = new Date()) {
    await this.assertMoneyRole(actorId);
    if (typeof input.day !== 'string') throw new BadRequestException('day must be yyyy-mm-dd');
    let bounds: { from: Date; to: Date };
    try {
      bounds = istDayBounds(input.day);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const day = input.day;
    if (day > istDay(now)) throw new BadRequestException('A day in the future cannot be closed');
    if (this.locks) await this.locks.assertOpen(day.slice(0, 7), 'its bank days');
    let bankClosingPaise: number;
    try {
      bankClosingPaise = parsePaise(input.bankClosingPaise, 'bankClosingPaise', { allowZero: true });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;
    if (await this.prisma.bankDayClose.findUnique({ where: { day } })) throw new ConflictException(`${day} is already closed`);
    const later = await this.prisma.bankDayClose.findFirst({ where: { day: { gt: day } }, select: { day: true } });
    if (later) throw new BadRequestException(`${later.day} is already closed, so earlier days cannot be closed now`);
    const unmatched = await this.prisma.bankCredit.count({ where: { status: 'unmatched', receivedAt: { gte: bounds.from, lte: bounds.to } } });
    if (unmatched > 0) throw new BadRequestException(`${unmatched} credit${unmatched === 1 ? '' : 's'} on ${day} still need${unmatched === 1 ? 's' : ''} matching or returning before the day is closed`);
    const view = await this.bank({ from: bounds.from, to: bounds.to }, now);
    const row = view.days.find((d) => d.day === day);
    if (!row) throw new BadRequestException('Could not work out that day');
    const differencePaise = bankClosingPaise - row.booksClosingPaise;
    if (differencePaise !== 0 && !note) {
      throw new BadRequestException(`The bank says ${bankClosingPaise} paise but our books say ${row.booksClosingPaise} paise. Record the missing line (for example bank charges as an expense) or write why they differ.`);
    }
    const closed = await this.prisma.bankDayClose.create({
      data: {
        day,
        openingPaise: row.openingPaise,
        inPaise: row.inPaise,
        outPaise: row.outPaise,
        booksClosingPaise: row.booksClosingPaise,
        bankClosingPaise,
        differencePaise,
        note,
        closedByStaffId: actorId,
        closedAt: now,
      },
    });
    await this.audit.log({
      actorId,
      action: 'bank_day.closed',
      entityType: 'BankDayClose',
      entityCode: day,
      after: { openingPaise: row.openingPaise, inPaise: row.inPaise, outPaise: row.outPaise, booksClosingPaise: row.booksClosingPaise, bankClosingPaise, differencePaise },
      changedFields: ['bankClosingPaise'],
      reason: note,
    });
    return closed;
  }

  // ------------------------------------------------------------ invoices

  async invoices(range: DateRange, filters: { status?: string; type?: string; search?: string }, now = new Date()) {
    const s = filters.search;
    const [paid, waiting, receipts, flags] = await Promise.all([
      filters.type === 'activation'
        ? Promise.resolve([])
        : this.prisma.placement.findMany({
            where: {
              invoiceCode: { not: null },
              paidAt: { gte: range.from, lte: range.to },
              ...(s ? { OR: [{ invoiceCode: contains(s) }, { code: contains(s) }, { business: { name: contains(s) } }] } : {}),
            },
            orderBy: { paidAt: 'desc' },
            take: 2000,
            include: { business: { select: { id: true, code: true, name: true } }, vacancy: { select: { id: true } }, tdsReceivables: true, payments: { where: { type: 'placement_fee' }, select: { id: true, amount: true, status: true } } },
          }),
      filters.type === 'activation'
        ? Promise.resolve([])
        : this.prisma.placement.findMany({
            where: { status: 'awaiting_payment', ...(s ? { OR: [{ code: contains(s) }, { business: { name: contains(s) } }] } : {}) },
            orderBy: { selectedAt: 'asc' },
            take: 2000,
            include: { business: { select: { id: true, code: true, name: true } }, payments: { where: { type: 'placement_fee' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, amount: true, status: true } } },
          }),
      filters.type === 'placement_fee'
        ? Promise.resolve([])
        : this.prisma.payment.findMany({
            where: {
              type: { in: ['activation', 'reactivation'] },
              status: { in: RECEIVED_STATUSES },
              OR: [{ confirmedAt: { gte: range.from, lte: range.to } }, { confirmedAt: null, paidAt: { gte: range.from, lte: range.to } }],
              ...(s ? { AND: [{ OR: [{ code: contains(s) }, { jobSeeker: { name: contains(s) } }, { jobSeeker: { code: contains(s) } }] }] } : {}),
            },
            orderBy: { confirmedAt: 'desc' },
            take: 2000,
            include: { jobSeeker: { select: { id: true, code: true, name: true } } },
          }),
      this.prisma.reviewFlag.findMany({ where: { kind: 'payment_mismatch', status: 'open', subjectType: 'payment' }, select: { subjectId: true, details: true } }),
    ]);
    const flagByPayment = new Map(flags.map((f) => [f.subjectId, (f.details ?? {}) as Record<string, unknown>]));
    const rows = [
      ...paid.map((p) => {
        const tds = p.tdsReceivables[0] ?? null;
        return {
          id: p.id,
          kind: 'invoice' as const,
          number: p.invoiceCode,
          to: { code: p.business.code, name: p.business.name },
          forWhat: { type: 'placement_fee', placementCode: p.code, placementId: p.id },
          feePaise: p.placementFee,
          gstPaise: p.gstAmount,
          totalPaise: p.placementFee + p.gstAmount,
          date: p.paidAt!.toISOString(),
          status: tds ? (tds.status === 'certificate_received' ? 'tds_received' : 'tds_due') : 'paid',
          waitingDays: null as number | null,
          tds: tds ? { id: tds.id, amountPaise: tds.amountPaise, status: tds.status, note: tds.sectionNote } : null,
          shortByPaise: null as number | null,
          paymentId: p.payments[0]?.id ?? null,
          downloadPath: invoicePath(p.id),
        };
      }),
      ...waiting.map((p) => {
        const pay = p.payments[0] ?? null;
        const flag = pay ? flagByPayment.get(pay.id) : undefined;
        const since = p.selectedAt ?? p.createdAt;
        return {
          id: p.id,
          kind: 'invoice' as const,
          number: null,
          to: { code: p.business.code, name: p.business.name },
          forWhat: { type: 'placement_fee', placementCode: p.code, placementId: p.id },
          feePaise: p.placementFee,
          gstPaise: p.gstAmount,
          totalPaise: p.placementFee + p.gstAmount,
          date: since.toISOString(),
          status: flag ? 'less' : p.paymentDueAt && p.paymentDueAt < now ? 'overdue' : 'waiting',
          waitingDays: daysSince(since, now),
          tds: null,
          shortByPaise: flag && typeof flag.shortByPaise === 'number' ? flag.shortByPaise : flag && typeof flag.expectedAmountPaise === 'number' && typeof flag.receivedAmountPaise === 'number' ? flag.expectedAmountPaise - flag.receivedAmountPaise : null,
          paymentId: pay?.id ?? null,
          downloadPath: null,
        };
      }),
      ...receipts.map((p) => ({
        id: p.id,
        kind: 'receipt' as const,
        number: p.code,
        to: p.jobSeeker ? { code: p.jobSeeker.code, name: p.jobSeeker.name } : null,
        forWhat: { type: 'activation', placementCode: null, placementId: null },
        feePaise: p.amount,
        gstPaise: 0,
        totalPaise: p.amount,
        date: (p.confirmedAt ?? p.paidAt ?? p.createdAt).toISOString(),
        status: 'receipt',
        waitingDays: null,
        tds: null,
        shortByPaise: null,
        paymentId: p.id,
        downloadPath: receiptPath(p.id),
      })),
    ];
    const filtered = rows.filter((r) => {
      if (!filters.status) return true;
      if (filters.status === 'unpaid') return ['waiting', 'overdue', 'less'].includes(r.status);
      if (filters.status === 'paid') return ['paid', 'tds_received', 'receipt'].includes(r.status);
      return r.status === filters.status;
    });
    const placementInvoices = rows.filter((r) => r.kind === 'invoice' && r.number);
    const unpaid = rows.filter((r) => ['waiting', 'overdue', 'less'].includes(r.status));
    return {
      rows: filtered,
      summary: {
        invoiceCount: placementInvoices.length,
        invoicedPaise: sumPaise(placementInvoices.map((r) => r.totalPaise)),
        overdueCount: unpaid.filter((r) => r.status === 'overdue').length,
        unpaidCount: unpaid.length,
        unpaidPaise: sumPaise(unpaid.map((r) => r.totalPaise)),
        receiptCount: rows.filter((r) => r.kind === 'receipt').length,
      },
    };
  }

  /** "Mark certificate received" for TDS a business deducted. */
  async certificateReceived(id: string, actorId: string) {
    await this.assertMoneyRole(actorId);
    const tds = await this.prisma.tdsReceivable.findUnique({ where: { id }, include: { payment: { select: { code: true } } } });
    if (!tds) throw new NotFoundException(`TDS record '${id}' not found`);
    if (tds.status === 'certificate_received') throw new BadRequestException('The certificate is already marked received');
    const updated = await this.prisma.tdsReceivable.update({ where: { id }, data: { status: 'certificate_received' } });
    await this.audit.log({
      actorId,
      action: 'tds.certificate_received',
      entityType: 'TdsReceivable',
      entityCode: tds.payment.code,
      before: { status: tds.status },
      after: { status: 'certificate_received', amountPaise: tds.amountPaise },
      changedFields: ['status'],
    });
    return updated;
  }

  private async assertMoneyRole(actorId: string) {
    const staff = await this.prisma.staff.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!staff || !['ceo', 'finance'].includes(staff.role)) throw new ForbiddenException('Only Finance or the CEO handles the books');
  }
}
