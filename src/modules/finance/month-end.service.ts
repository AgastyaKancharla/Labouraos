import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { RECEIVED_STATUSES, sumPaise } from '../ceo-portal/ceo-common';
import { istDay } from './finance-rules';
import { CsvValue, rupees, toCsv } from './finance-csv';
import { calendarDaysIn, isMonthKey, monthBounds, monthDays, monthEnded, monthLabel, nextMonth } from './payroll-rules';

const OUT_TYPES = ['refund', 'duplicate_refund', 'referral_payout', 'joining_reward'];
const OPEN_OUT_STATUSES = ['pending', 'approved', 'processing', 'failed'];

export interface ChecklistItem {
  key: 'bank_days_closed' | 'credits_matched' | 'payouts_done' | 'salaries_released' | 'expenses_with_bills';
  label: string;
  ok: boolean;
  detail: string;
  count: number;
  link: string;
}

export interface ReviewAction {
  id: string;
  subjectType: 'payment' | 'expense' | 'payroll_line' | 'bank_credit';
  subjectId: string;
  at: string;
  doneBy: { id: string | null; name: string | null; role: string | null };
  approvedByCeo: boolean;
  type: 'refund' | 'payout' | 'expense' | 'salary' | 'return';
  what: string;
  record: string;
  amountPaise: number;
  proof: string | null;
  mark: { mark: string; note: string | null; by: string | null } | null;
}

interface Actor {
  id: string;
  role: string;
}

/**
 * Month-end review (FN-Review, and the CEO's "Month-end review"; Phase 22
 * Part B). Everything Finance did in the month for the CEO to check, the
 * checklist (bank days closed, credits matched, payouts done, salaries
 * released, expenses with bills), and closing the month: after closing, the
 * month's money records can't be changed (MonthLockService); only the CEO
 * closes or reopens a month, with a reason, audited.
 */
@Injectable()
export class MonthEndService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sources: NotificationSourcesService,
  ) {}

  private month(value: unknown): string {
    if (!isMonthKey(value)) throw new BadRequestException('month must look like 2026-10');
    return value;
  }

  async checklist(month: string, now = new Date()): Promise<ChecklistItem[]> {
    const { from, to } = monthBounds(month);
    const { first, last } = monthDays(month);
    const today = istDay(now);
    const allDays = Array.from({ length: calendarDaysIn(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    const expectedDays = allDays.filter((d) => d <= today);
    const ended = expectedDays.length === allDays.length;
    const [closes, unmatched, openOut, run, expenses] = await Promise.all([
      this.prisma.bankDayClose.findMany({ where: { day: { gte: first, lte: last } }, select: { day: true } }),
      this.prisma.bankCredit.count({ where: { status: 'unmatched', receivedAt: { gte: from, lte: to } } }),
      this.prisma.payment.findMany({ where: { type: { in: OUT_TYPES }, status: { in: OPEN_OUT_STATUSES }, createdAt: { lte: to } }, select: { status: true, ceoApprovalReason: true, outsideRules: true } }),
      this.prisma.payrollRun.findUnique({ where: { month }, select: { status: true, people: true, lines: { where: { status: 'unpaid' }, select: { id: true } } } }),
      this.prisma.expense.findMany({ where: { billDate: { gte: from, lte: to }, status: { not: 'rejected' } }, select: { status: true, billPath: true } }),
    ]);
    const closed = new Set(closes.map((c) => c.day));
    const missingDays = expectedDays.filter((d) => !closed.has(d));
    const withCeo = openOut.filter((p) => p.status === 'pending' && (p.ceoApprovalReason || p.outsideRules)).length;
    const noBill = expenses.filter((e) => !e.billPath).length;
    const waiting = expenses.filter((e) => ['waiting_finance', 'waiting_ceo', 'approved'].includes(e.status)).length;
    const unpaidSalaries = run?.lines.length ?? 0;
    return [
      {
        key: 'bank_days_closed',
        label: 'All bank days closed',
        ok: missingDays.length === 0 && ended,
        detail: missingDays.length ? `${missingDays.length} day${missingDays.length === 1 ? '' : 's'} not closed${missingDays.length <= 3 ? `: ${missingDays.join(', ')}` : ` (from ${missingDays[0]})`}` : ended ? 'Every day agrees with the bank' : 'The month has not ended yet',
        count: missingDays.length,
        link: 'bank',
      },
      {
        key: 'credits_matched',
        label: 'All credits matched',
        ok: unmatched === 0,
        detail: unmatched ? `${unmatched} credit${unmatched === 1 ? '' : 's'} not matched or returned` : 'Every credit is matched or returned',
        count: unmatched,
        link: 'money-in',
      },
      {
        key: 'payouts_done',
        label: 'Payouts and refunds done',
        ok: openOut.length === 0,
        detail: openOut.length ? `${openOut.length} still open${withCeo ? ` · ${withCeo} with the CEO` : ''}` : 'Everything owed by the month end is paid',
        count: openOut.length,
        link: 'payouts',
      },
      {
        key: 'salaries_released',
        label: 'Salaries released',
        ok: run?.status === 'paid',
        detail: !run
          ? 'The salary sheet is not prepared yet'
          : run.status === 'paid'
            ? `All ${run.people} paid`
            : run.status === 'approved'
              ? `${unpaidSalaries} of ${run.people} still to pay`
              : run.status === 'with_ceo'
                ? 'Waiting for the CEO to approve the total'
                : 'Sent back by the CEO',
        count: run?.status === 'paid' ? 0 : run ? Math.max(1, unpaidSalaries) : 1,
        link: `salaries?month=${month}`,
      },
      {
        key: 'expenses_with_bills',
        label: 'Expenses with bills',
        ok: noBill === 0 && waiting === 0,
        detail: noBill || waiting ? [noBill ? `${noBill} without a bill` : '', waiting ? `${waiting} waiting to be approved or paid` : ''].filter(Boolean).join(' · ') : 'Every expense has its bill and is settled',
        count: noBill + waiting,
        link: 'expenses',
      },
    ];
  }

  /** Every money action in the month, with who did it, the proof and the CEO's mark. */
  async actions(month: string): Promise<ReviewAction[]> {
    const { from, to } = monthBounds(month);
    const [payments, expenses, lines, returns, marks] = await Promise.all([
      this.prisma.payment.findMany({
        where: { type: { in: OUT_TYPES }, status: { in: RECEIVED_STATUSES }, paidAt: { gte: from, lte: to } },
        select: { id: true, code: true, type: true, amount: true, paidAt: true, bankUtr: true, paidByStaffId: true, approvedByStaffId: true, jobSeekerId: true, jobSeeker: { select: { code: true } }, referral: { select: { code: true } }, placement: { select: { code: true } } },
      }),
      this.prisma.expense.findMany({
        where: { OR: [{ paidAt: { gte: from, lte: to } }, { approvedAt: { gte: from, lte: to } }] },
        select: { id: true, code: true, supplier: true, description: true, amountPaise: true, status: true, paidAt: true, paidByStaffId: true, approvedAt: true, approvedByStaffId: true, paymentReference: true, billPath: true },
      }),
      this.prisma.payrollLine.findMany({ where: { status: 'paid', paidAt: { gte: from, lte: to } }, select: { id: true, staffCode: true, name: true, netPaise: true, paidAt: true, paidByStaffId: true, utr: true, run: { select: { month: true, approvedByStaffId: true } } } }),
      this.prisma.bankCredit.findMany({ where: { status: 'returned', returnedAt: { gte: from, lte: to } }, select: { id: true, bankUtr: true, amountPaise: true, returnedAt: true, returnedByStaffId: true, returnedUtr: true } }),
      this.prisma.monthReviewMark.findMany({ where: { month } }),
    ]);
    const ids = [
      ...payments.flatMap((p) => [p.paidByStaffId, p.approvedByStaffId]),
      ...expenses.flatMap((e) => [e.paidByStaffId, e.approvedByStaffId]),
      ...lines.flatMap((l) => [l.paidByStaffId, l.run.approvedByStaffId]),
      ...returns.map((r) => r.returnedByStaffId),
      ...marks.map((m) => m.byStaffId),
    ].filter((id): id is string => Boolean(id));
    const staff = ids.length ? await this.prisma.staff.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, role: true } }) : [];
    const who = new Map(staff.map((s) => [s.id, s]));
    const person = (id: string | null | undefined) => ({ id: id ?? null, name: id ? (who.get(id)?.name ?? null) : null, role: id ? (who.get(id)?.role ?? null) : null });
    const isCeo = (id: string | null | undefined) => Boolean(id && who.get(id)?.role === 'ceo');
    const markBy = new Map(marks.map((m) => [`${m.subjectType}:${m.subjectId}`, { mark: m.mark, note: m.note, by: who.get(m.byStaffId)?.name ?? null }]));
    const out: ReviewAction[] = [];
    for (const p of payments) {
      const isRefund = p.type === 'refund' || p.type === 'duplicate_refund';
      const business = isRefund && !p.jobSeekerId;
      out.push({
        id: `payment:${p.id}`,
        subjectType: 'payment',
        subjectId: p.id,
        at: p.paidAt!.toISOString(),
        doneBy: person(p.paidByStaffId ?? p.approvedByStaffId),
        approvedByCeo: isCeo(p.approvedByStaffId),
        type: isRefund ? 'refund' : 'payout',
        what: business ? 'Business refund paid' : isRefund ? 'Refund paid' : p.type === 'referral_payout' ? 'Referral payout sent' : 'Joining reward sent',
        record: p.placement?.code ?? p.jobSeeker?.code ?? p.referral?.code ?? p.code,
        amountPaise: p.amount,
        proof: p.bankUtr ? `UTR ${p.bankUtr}` : null,
        mark: markBy.get(`payment:${p.id}`) ?? null,
      });
    }
    for (const e of expenses) {
      const paidIn = e.paidAt && e.paidAt >= from && e.paidAt <= to;
      out.push({
        id: `expense:${e.id}`,
        subjectType: 'expense',
        subjectId: e.id,
        at: (paidIn ? e.paidAt! : e.approvedAt!).toISOString(),
        doneBy: person(paidIn ? e.paidByStaffId : e.approvedByStaffId),
        approvedByCeo: isCeo(e.approvedByStaffId),
        type: 'expense',
        what: paidIn ? 'Expense paid' : 'Expense approved',
        record: `${e.code} · ${e.supplier}`,
        amountPaise: e.amountPaise,
        proof: [e.billPath ? 'Bill' : 'No bill', e.paymentReference ? `Ref ${e.paymentReference}` : ''].filter(Boolean).join(' · '),
        mark: markBy.get(`expense:${e.id}`) ?? null,
      });
    }
    for (const l of lines) {
      out.push({
        id: `payroll_line:${l.id}`,
        subjectType: 'payroll_line',
        subjectId: l.id,
        at: l.paidAt!.toISOString(),
        doneBy: person(l.paidByStaffId),
        approvedByCeo: isCeo(l.run.approvedByStaffId),
        type: 'salary',
        what: `Salary paid · ${monthLabel(l.run.month)}`,
        record: `${l.staffCode} · ${l.name}`,
        amountPaise: l.netPaise,
        proof: l.utr ? `UTR ${l.utr}` : null,
        mark: markBy.get(`payroll_line:${l.id}`) ?? null,
      });
    }
    for (const r of returns) {
      out.push({
        id: `bank_credit:${r.id}`,
        subjectType: 'bank_credit',
        subjectId: r.id,
        at: r.returnedAt!.toISOString(),
        doneBy: person(r.returnedByStaffId),
        approvedByCeo: false,
        type: 'return',
        what: 'Unclaimed money returned',
        record: `Credit ${r.bankUtr}`,
        amountPaise: r.amountPaise,
        proof: r.returnedUtr ? `UTR ${r.returnedUtr}` : null,
        mark: markBy.get(`bank_credit:${r.id}`) ?? null,
      });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at));
  }

  /** The Month-end review page. */
  async review(monthValue: unknown, now = new Date()) {
    const month = this.month(monthValue);
    const [checklist, actions, close] = await Promise.all([this.checklist(month, now), this.actions(month), this.prisma.monthClose.findUnique({ where: { month } })]);
    const people = close ? await this.prisma.staff.findMany({ where: { id: { in: [close.closedByStaffId, close.reopenedByStaffId].filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }) : [];
    const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
    const status = close?.status === 'closed' ? 'closed' : close?.status === 'reopened' ? 'reopened' : monthEnded(month, now) ? 'open' : 'running';
    return {
      month,
      label: monthLabel(month),
      status,
      canClose: status === 'open' || status === 'reopened',
      allChecked: checklist.every((c) => c.ok),
      close: close
        ? {
            closedBy: name(close.closedByStaffId),
            closedAt: close.closedAt.toISOString(),
            note: close.closeNote,
            reopenedBy: name(close.reopenedByStaffId),
            reopenedAt: close.reopenedAt?.toISOString() ?? null,
            reopenReason: close.reopenReason,
          }
        : null,
      checklist,
      summary: {
        actions: actions.length,
        byFinanceWithinLimits: actions.filter((a) => a.doneBy.role === 'finance' && !a.approvedByCeo).length,
        approvedByCeo: actions.filter((a) => a.approvedByCeo || a.doneBy.role === 'ceo').length,
        flagged: actions.filter((a) => a.mark?.mark === 'flagged').length,
        moneyOutPaise: sumPaise(actions.map((a) => a.amountPaise)),
      },
      actions,
      nextMonth: nextMonth(month),
    };
  }

  /** The CEO's "Looks right" or "Flag" (with a note) on one action. */
  async mark(monthValue: unknown, input: { subjectType?: unknown; subjectId?: unknown; mark?: unknown; note?: unknown }, actor: Actor) {
    const month = this.month(monthValue);
    if (actor.role !== 'ceo') throw new ForbiddenException('The CEO reviews the month');
    const subjectType = typeof input.subjectType === 'string' ? input.subjectType : '';
    const subjectId = typeof input.subjectId === 'string' ? input.subjectId : '';
    if (!['payment', 'expense', 'payroll_line', 'bank_credit'].includes(subjectType) || !subjectId) throw new BadRequestException('Say which action is marked');
    const mark = input.mark === 'ok' || input.mark === 'flagged' ? input.mark : null;
    if (!mark) throw new BadRequestException("mark is 'ok' or 'flagged'");
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;
    if (mark === 'flagged' && !note) throw new BadRequestException('Write what looks wrong');
    const close = await this.prisma.monthClose.findUnique({ where: { month } });
    if (close?.status === 'closed') throw new ForbiddenException(`${monthLabel(month)} is closed. Reopen it to change the review.`);
    const actions = await this.actions(month);
    if (!actions.some((a) => a.subjectType === subjectType && a.subjectId === subjectId)) throw new NotFoundException('That action is not in this month');
    const saved = await this.prisma.monthReviewMark.upsert({
      where: { month_subjectType_subjectId: { month, subjectType, subjectId } },
      create: { month, subjectType, subjectId, mark, note, byStaffId: actor.id },
      update: { mark, note, byStaffId: actor.id },
    });
    await this.audit.log({ actorId: actor.id, action: `month_review.${mark}`, entityType: 'MonthReviewMark', entityCode: `${month}:${subjectType}:${subjectId}`, after: { mark }, changedFields: ['mark'], reason: note ?? undefined });
    return saved;
  }

  /** The CEO closes the month. Unticked checklist items need a written note. */
  async close(monthValue: unknown, noteValue: unknown, actor: Actor, now = new Date()) {
    const month = this.month(monthValue);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO closes a month');
    if (!monthEnded(month, now)) throw new BadRequestException(`${monthLabel(month)} has not ended yet`);
    const existing = await this.prisma.monthClose.findUnique({ where: { month } });
    if (existing?.status === 'closed') throw new ConflictException(`${monthLabel(month)} is already closed`);
    const note = typeof noteValue === 'string' && noteValue.trim() ? noteValue.trim().slice(0, 500) : null;
    const checklist = await this.checklist(month, now);
    const open = checklist.filter((c) => !c.ok);
    if (open.length && !note) {
      throw new BadRequestException(`Not everything is done: ${open.map((c) => `${c.label.toLowerCase()} (${c.detail})`).join('; ')}. Finish them, or write why the month closes anyway.`);
    }
    const data = { status: 'closed', closedByStaffId: actor.id, closedAt: now, closeNote: note, checklist: checklist as unknown as Prisma.InputJsonValue };
    const saved = existing
      ? await this.prisma.monthClose.update({ where: { month }, data })
      : await this.prisma.monthClose.create({ data: { month, ...data } });
    await this.audit.log({
      actorId: actor.id,
      action: 'month.closed',
      entityType: 'MonthClose',
      entityCode: month,
      before: existing ? { status: existing.status } : undefined,
      after: { status: 'closed', openItems: open.map((c) => c.key) },
      changedFields: ['status'],
      reason: note ?? undefined,
    });
    await this.sources.safely('payroll', () => this.sources.syncPayroll(now));
    return saved;
  }

  /** Only the CEO reopens a closed month, with a reason. */
  async reopen(monthValue: unknown, reasonValue: unknown, actor: Actor, now = new Date()) {
    const month = this.month(monthValue);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO reopens a month');
    const reason = typeof reasonValue === 'string' ? reasonValue.trim().slice(0, 500) : '';
    if (!reason) throw new BadRequestException('Write why the month is reopened');
    const existing = await this.prisma.monthClose.findUnique({ where: { month } });
    if (!existing || existing.status !== 'closed') throw new BadRequestException(`${monthLabel(month)} is not closed`);
    const saved = await this.prisma.monthClose.update({ where: { month }, data: { status: 'reopened', reopenedByStaffId: actor.id, reopenedAt: now, reopenReason: reason } });
    await this.audit.log({ actorId: actor.id, action: 'month.reopened', entityType: 'MonthClose', entityCode: month, before: { status: 'closed' }, after: { status: 'reopened' }, changedFields: ['status'], reason });
    await this.sources.safely('payroll', () => this.sources.syncPayroll(now));
    return saved;
  }

  async reviewCsv(monthValue: unknown, now = new Date()): Promise<{ filename: string; csv: string }> {
    const view = await this.review(monthValue, now);
    const rows: CsvValue[][] = view.actions.map((a) => [a.at.slice(0, 10), a.doneBy.name ?? '', a.doneBy.role ?? '', a.what, a.record, rupees(a.amountPaise), a.proof ?? '', a.approvedByCeo ? 'Approved by the CEO' : 'Within Finance limits', a.mark ? (a.mark.mark === 'ok' ? 'Looks right' : `Flagged: ${a.mark.note ?? ''}`) : '']);
    for (const c of view.checklist) rows.push(['', '', '', `Checklist: ${c.label}`, c.ok ? 'Done' : 'Not done', '', c.detail, '', '']);
    return { filename: `month-end-review-${view.month}.csv`, csv: toCsv(['Date', 'Done by', 'Role', 'What', 'Record', 'Amount (Rs)', 'Proof', 'Approval', 'CEO review'], rows) };
  }
}
