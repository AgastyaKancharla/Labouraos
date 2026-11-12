import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { PricingService } from '../pricing/pricing.service';
import { MonthLockService } from '../month-lock/month-lock.service';
import { PayrollService } from './payroll.service';
import { assertUtrUnused } from '../../common/money/utr-registry';
import { HEARD_FROM_VALUES } from '../job-seeker/job-seeker.validator';
import { DateRange, RECEIVED_STATUSES, PAYOUT_TYPES, contains, sumPaise } from '../ceo-portal/ceo-common';
import {
  AUTO_EXPENSE_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAID_FROM,
  checkExpenseApproval,
  expenseNeedsCeo,
  initialExpenseStatus,
  isExpenseCategory,
  istMonth,
  monthsInRange,
  parsePaise,
  profitAndLoss,
} from './finance-rules';
import { BILL_CONTENT_TYPES, EXPENSE_BILL_STORAGE, ExpenseBillStorage, MAX_BILL_BYTES } from './expense-bill.storage';

export interface BillUpload {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
  size?: number;
}

export interface CreateExpenseInput {
  category?: unknown;
  supplier?: unknown;
  description?: unknown;
  adChannel?: unknown;
  amountPaise?: unknown;
  gstPaise?: unknown;
  billDate?: unknown;
  paidFrom?: unknown;
}

export interface PayExpenseInput {
  paidFrom?: unknown;
  reference?: unknown;
  paidAt?: unknown;
}

type Actor = { id: string; role: string; name: string };

const TO_PAY = ['waiting_finance', 'waiting_ceo', 'approved'];
const COUNTED = ['approved', 'paid'];

function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name} is required`);
  const t = value.trim();
  if (t.length > max) throw new BadRequestException(`${name} must be at most ${max} characters`);
  return t;
}

function paise(value: unknown, name: string, allowZero = false): number {
  try {
    return parsePaise(value, name, { allowZero });
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

function pastDate(value: unknown, name: string, now: Date): Date {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${name} is required`);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be a valid date`);
  if (d.getTime() > now.getTime() + 60_000) throw new BadRequestException(`${name} cannot be in the future`);
  return d;
}

/**
 * Expenses & bills (FN-Expenses, C-Expenses). Finance or the CEO records each
 * bill with the bill attached; Finance approves up to its limit in Settings, the
 * CEO above it. Automatic lines (payouts, rewards, refunds) are read from the
 * payments already recorded, so nothing is entered twice.
 */
@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
    private readonly pricing: PricingService,
    @Inject(EXPENSE_BILL_STORAGE) private readonly bills: ExpenseBillStorage,
    @Optional() private readonly locks?: MonthLockService,
    @Optional() private readonly payroll?: PayrollService,
  ) {}

  /** A closed month's expenses can't be changed (Month-end review). */
  private async assertMonthOpen(date: Date): Promise<void> {
    if (this.locks) await this.locks.assertOpenOn(date, 'its expenses');
  }

  private async actor(actorId: string): Promise<Actor> {
    const staff = await this.prisma.staff.findUnique({ where: { id: actorId }, select: { id: true, role: true, name: true } });
    if (!staff || !['ceo', 'finance'].includes(staff.role)) throw new ForbiddenException('Only Finance or the CEO handles expenses');
    return staff;
  }

  private async load(id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { OR: [{ id }, { code: id }] } });
    if (!expense) throw new NotFoundException(`Expense '${id}' not found`);
    return expense;
  }

  private validateBill(bill: BillUpload | undefined): BillUpload | undefined {
    if (!bill) return undefined;
    if (!BILL_CONTENT_TYPES[bill.mimetype]) throw new BadRequestException('The bill must be a photo (JPG, PNG, WEBP, HEIC) or a PDF');
    if ((bill.size ?? bill.buffer.length) > MAX_BILL_BYTES) throw new BadRequestException('The bill must be 10 MB or smaller');
    if (!bill.buffer.length) throw new BadRequestException('The bill file is empty');
    return bill;
  }

  private async storeBill(expenseId: string, bill: BillUpload) {
    const path = `expense-bills/${expenseId}/${randomUUID()}.${BILL_CONTENT_TYPES[bill.mimetype]}`;
    await this.bills.put(path, bill.buffer, bill.mimetype);
    const fileName = (bill.originalname ?? '').replace(/[^\w.\- ]+/g, '').slice(0, 120) || `bill.${BILL_CONTENT_TYPES[bill.mimetype]}`;
    return { billPath: path, billFileName: fileName, billContentType: bill.mimetype };
  }

  async create(input: CreateExpenseInput, bill: BillUpload | undefined, actorId: string, now = new Date()) {
    const actor = await this.actor(actorId);
    if (!isExpenseCategory(input.category)) {
      throw new BadRequestException(`category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`);
    }
    const supplier = text(input.supplier, 'supplier', 120);
    const description = text(input.description, 'description', 300);
    const amountPaise = paise(input.amountPaise, 'amountPaise');
    const gstPaise = input.gstPaise === undefined || input.gstPaise === null || input.gstPaise === '' ? 0 : paise(input.gstPaise, 'gstPaise', true);
    if (gstPaise >= amountPaise) throw new BadRequestException('GST must be less than the amount');
    const billDate = pastDate(input.billDate, 'billDate', now);
    await this.assertMonthOpen(billDate);
    let adChannel: string | null = null;
    if (input.category === 'ads_marketing') {
      if (typeof input.adChannel !== 'string' || !(HEARD_FROM_VALUES as readonly string[]).includes(input.adChannel)) {
        throw new BadRequestException(`Ads and marketing are tagged to a channel: ${HEARD_FROM_VALUES.join(', ')}`);
      }
      adChannel = input.adChannel;
    }
    const paidFrom = input.paidFrom === undefined || input.paidFrom === null || input.paidFrom === '' ? null : this.paidFrom(input.paidFrom);
    const file = this.validateBill(bill);
    const policy = await this.pricing.current();
    const status = initialExpenseStatus(actor.role, amountPaise, policy.financeExpenseLimitPaise);
    const id = randomUUID();
    const stored = file ? await this.storeBill(id, file) : {};
    const code = await this.ids.generateCode('expense');
    const expense = await this.prisma.expense.create({
      data: {
        id,
        code,
        category: input.category,
        supplier,
        description,
        adChannel,
        amountPaise,
        gstPaise,
        billDate,
        paidFrom,
        ...stored,
        status,
        needsCeo: expenseNeedsCeo(amountPaise, policy.financeExpenseLimitPaise),
        enteredByStaffId: actor.id,
        ...(actor.role === 'ceo' ? { approvedByStaffId: actor.id, approvedAt: now } : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'expense.recorded',
      entityType: 'Expense',
      entityCode: code,
      after: {
        category: expense.category,
        supplier,
        amountPaise,
        gstPaise,
        billDate: billDate.toISOString(),
        status,
        hasBill: Boolean(file),
        financeLimitPaise: policy.financeExpenseLimitPaise,
        enteredByRole: actor.role,
      },
      changedFields: ['category', 'supplier', 'amountPaise', 'status'],
      reason: actor.role === 'ceo' ? 'Entered by the CEO (approved)' : status === 'waiting_ceo' ? 'Above Finance limit: waits for the CEO' : 'Within Finance limit',
    });
    return this.toRow(expense, new Map([[actor.id, actor]]), policy.financeExpenseLimitPaise);
  }

  private paidFrom(value: unknown): string {
    if (typeof value !== 'string' || !(PAID_FROM as readonly string[]).includes(value)) {
      throw new BadRequestException(`paidFrom must be one of: ${PAID_FROM.join(', ')}`);
    }
    return value;
  }

  async attachBill(id: string, bill: BillUpload | undefined, actorId: string) {
    const actor = await this.actor(actorId);
    const file = this.validateBill(bill);
    if (!file) throw new BadRequestException('Choose the bill to attach');
    const expense = await this.load(id);
    await this.assertMonthOpen(expense.billDate);
    if (expense.status === 'rejected') throw new BadRequestException('This expense was rejected');
    const stored = await this.storeBill(expense.id, file);
    const updated = await this.prisma.expense.update({ where: { id: expense.id }, data: stored });
    await this.audit.log({
      actorId: actor.id,
      action: 'expense.bill_attached',
      entityType: 'Expense',
      entityCode: expense.code,
      before: { hasBill: Boolean(expense.billPath) },
      after: { hasBill: true, billContentType: file.mimetype },
      changedFields: ['billPath'],
    });
    const policy = await this.pricing.current();
    return this.toRow(updated, await this.names([updated]), policy.financeExpenseLimitPaise);
  }

  async bill(id: string) {
    const expense = await this.load(id);
    if (!expense.billPath) throw new NotFoundException('No bill is attached to this expense');
    const body = await this.bills.get(expense.billPath);
    if (!body) throw new NotFoundException('The bill file could not be found');
    return { body, contentType: expense.billContentType ?? 'application/octet-stream', fileName: expense.billFileName ?? `${expense.code}` };
  }

  async approve(id: string, actorId: string, pay: PayExpenseInput | undefined, now = new Date()) {
    const actor = await this.actor(actorId);
    const expense = await this.load(id);
    await this.assertMonthOpen(expense.billDate);
    const policy = await this.pricing.current();
    const check = checkExpenseApproval({
      actorRole: actor.role,
      status: expense.status,
      amountPaise: expense.amountPaise,
      limitPaise: policy.financeExpenseLimitPaise,
      hasBill: Boolean(expense.billPath),
    });
    if (!check.ok) {
      if (check.code === 'needs_ceo' || check.code === 'forbidden') {
        throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: check.code, message: check.message });
      }
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: check.code, message: check.message });
    }
    const payment = pay ? this.payInput(pay, now) : null;
    if (payment) await this.checkPayment(payment);
    const claimed = await this.prisma.expense.updateMany({
      where: { id: expense.id, status: expense.status },
      data: {
        status: payment ? 'paid' : 'approved',
        approvedByStaffId: actor.id,
        approvedAt: now,
        ...(payment ? { paidByStaffId: actor.id, paidAt: payment.paidAt, paymentReference: payment.reference, paidFrom: payment.paidFrom } : {}),
      },
    });
    if (claimed.count !== 1) throw new BadRequestException(`Expense ${expense.code} has already been decided`);
    await this.audit.log({
      actorId: actor.id,
      action: payment ? 'expense.approved_and_paid' : 'expense.approved',
      entityType: 'Expense',
      entityCode: expense.code,
      before: { status: expense.status },
      after: {
        status: payment ? 'paid' : 'approved',
        approvedByRole: actor.role,
        amountPaise: expense.amountPaise,
        financeLimitPaise: policy.financeExpenseLimitPaise,
        ...(payment ? { paidFrom: payment.paidFrom, paymentReference: payment.reference, paidAt: payment.paidAt.toISOString() } : {}),
      },
      changedFields: ['status', 'approvedByStaffId', 'approvedAt', ...(payment ? ['paidAt', 'paymentReference', 'paidFrom'] : [])],
      reason: actor.role === 'ceo' ? 'Approved by the CEO' : 'Approved by Finance within its limit',
    });
    const updated = await this.prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    return this.toRow(updated, await this.names([updated]), policy.financeExpenseLimitPaise);
  }

  /** The payment date's month is open, and a bank or UPI reference is not already used anywhere. */
  private async checkPayment(payment: { paidFrom: string; reference: string; paidAt: Date }) {
    await this.assertMonthOpen(payment.paidAt);
    if (payment.paidFrom !== 'cash') await assertUtrUnused(this.prisma, payment.reference);
  }

  private payInput(input: PayExpenseInput, now: Date) {
    const paidFrom = this.paidFrom(input.paidFrom);
    const reference = text(input.reference, 'reference (UTR, UPI or card reference, or cash voucher number)', 60);
    const paidAt = input.paidAt ? pastDate(input.paidAt, 'paidAt', now) : now;
    return { paidFrom, reference, paidAt };
  }

  async pay(id: string, actorId: string, input: PayExpenseInput, now = new Date()) {
    const actor = await this.actor(actorId);
    const expense = await this.load(id);
    if (expense.status !== 'approved') {
      throw new BadRequestException(
        expense.status === 'waiting_ceo'
          ? 'The CEO has not approved this expense yet'
          : expense.status === 'waiting_finance'
            ? 'Approve this expense first'
            : `This expense is ${expense.status}`,
      );
    }
    if (!expense.billPath) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'no_bill', message: 'Attach the bill first. No bill, no payment.' });
    const payment = this.payInput(input, now);
    await this.assertMonthOpen(expense.billDate);
    await this.checkPayment(payment);
    const claimed = await this.prisma.expense.updateMany({
      where: { id: expense.id, status: 'approved' },
      data: { status: 'paid', paidByStaffId: actor.id, paidAt: payment.paidAt, paymentReference: payment.reference, paidFrom: payment.paidFrom },
    });
    if (claimed.count !== 1) throw new BadRequestException(`Expense ${expense.code} has already been paid`);
    await this.audit.log({
      actorId: actor.id,
      action: 'expense.paid',
      entityType: 'Expense',
      entityCode: expense.code,
      before: { status: 'approved' },
      after: { status: 'paid', paidFrom: payment.paidFrom, paymentReference: payment.reference, paidAt: payment.paidAt.toISOString(), amountPaise: expense.amountPaise },
      changedFields: ['status', 'paidAt', 'paymentReference', 'paidFrom', 'paidByStaffId'],
      reason: 'Expense paid and recorded',
    });
    const policy = await this.pricing.current();
    const updated = await this.prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    return this.toRow(updated, await this.names([updated]), policy.financeExpenseLimitPaise);
  }

  async reject(id: string, actorId: string, reason: unknown, now = new Date()) {
    const actor = await this.actor(actorId);
    const why = text(reason, 'reason', 300);
    const expense = await this.load(id);
    await this.assertMonthOpen(expense.billDate);
    if (!['waiting_finance', 'waiting_ceo'].includes(expense.status)) throw new BadRequestException(`This expense is ${expense.status}, so it cannot be rejected`);
    if (expense.status === 'waiting_ceo' && actor.role !== 'ceo') {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'needs_ceo', message: 'This expense is waiting for the CEO, so only the CEO can reject it' });
    }
    const claimed = await this.prisma.expense.updateMany({
      where: { id: expense.id, status: expense.status },
      data: { status: 'rejected', rejectedByStaffId: actor.id, rejectedAt: now, rejectionReason: why },
    });
    if (claimed.count !== 1) throw new BadRequestException(`Expense ${expense.code} has already been decided`);
    await this.audit.log({
      actorId: actor.id,
      action: 'expense.rejected',
      entityType: 'Expense',
      entityCode: expense.code,
      before: { status: expense.status },
      after: { status: 'rejected', rejectedByRole: actor.role, amountPaise: expense.amountPaise },
      changedFields: ['status', 'rejectedByStaffId', 'rejectedAt', 'rejectionReason'],
      reason: why,
    });
    const policy = await this.pricing.current();
    const updated = await this.prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    return this.toRow(updated, await this.names([updated]), policy.financeExpenseLimitPaise);
  }

  private async names(expenses: { enteredByStaffId: string; approvedByStaffId: string | null; rejectedByStaffId: string | null; paidByStaffId: string | null }[]) {
    const ids = [...new Set(expenses.flatMap((e) => [e.enteredByStaffId, e.approvedByStaffId, e.rejectedByStaffId, e.paidByStaffId]).filter((x): x is string => Boolean(x)))];
    const staff = ids.length ? await this.prisma.staff.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true } }) : [];
    return new Map(staff.map((s) => [s.id, s]));
  }

  private toRow(
    e: Prisma.ExpenseGetPayload<object>,
    names: Map<string, { id: string; name: string; role: string }>,
    limitPaise: number,
  ) {
    const who = (id: string | null) => (id ? (names.get(id) ? { name: names.get(id)!.name, role: names.get(id)!.role } : null) : null);
    return {
      id: e.id,
      code: e.code,
      kind: 'manual' as const,
      category: e.category,
      supplier: e.supplier,
      description: e.description,
      adChannel: e.adChannel,
      amountPaise: e.amountPaise,
      gstPaise: e.gstPaise,
      billDate: e.billDate.toISOString(),
      paidFrom: e.paidFrom,
      hasBill: Boolean(e.billPath),
      billFileName: e.billFileName,
      status: e.status,
      needsCeo: e.needsCeo,
      withinFinanceLimit: !expenseNeedsCeo(e.amountPaise, limitPaise),
      enteredBy: who(e.enteredByStaffId),
      approvedBy: who(e.approvedByStaffId),
      approvedAt: e.approvedAt?.toISOString() ?? null,
      rejectedBy: who(e.rejectedByStaffId),
      rejectionReason: e.rejectionReason,
      paidBy: who(e.paidByStaffId),
      paidAt: e.paidAt?.toISOString() ?? null,
      paymentReference: e.paymentReference,
      createdAt: e.createdAt.toISOString(),
    };
  }

  /** Payouts and rewards paid in a period: automatic expense lines. */
  private async autoPayouts(range: DateRange) {
    return this.prisma.payment.findMany({
      where: { type: { in: PAYOUT_TYPES }, status: { in: RECEIVED_STATUSES }, paidAt: { gte: range.from, lte: range.to } },
      orderBy: { paidAt: 'desc' },
      include: { referral: { select: { code: true } }, jobSeeker: { select: { code: true } }, placement: { select: { code: true } } },
    });
  }

  /** Refunds paid in a period: shown against revenue, not as a cost. */
  private async refundsPaid(range: DateRange) {
    return this.prisma.payment.findMany({
      where: { type: 'refund', status: { in: RECEIVED_STATUSES }, paidAt: { gte: range.from, lte: range.to } },
      orderBy: { paidAt: 'desc' },
      include: { jobSeeker: { select: { code: true } }, placement: { select: { code: true } } },
    });
  }

  async list(range: DateRange, filters: { category?: string; status?: string; search?: string }) {
    const policy = await this.pricing.current();
    const and: Prisma.ExpenseWhereInput[] = [];
    // Bills still to pay show whatever their date; the rest by bill date.
    if (filters.status === 'to_pay') and.push({ status: { in: TO_PAY } });
    else {
      and.push({ OR: [{ billDate: { gte: range.from, lte: range.to } }, { status: { in: TO_PAY } }] });
      if (filters.status) and.push({ status: filters.status });
    }
    if (filters.category) and.push({ category: filters.category });
    if (filters.search) and.push({ OR: [{ supplier: contains(filters.search) }, { description: contains(filters.search) }, { code: contains(filters.search) }] });
    const [expenses, payouts, refunds, budgets, toPay] = await Promise.all([
      this.prisma.expense.findMany({ where: { AND: and }, orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }], take: 2000 }),
      filters.category && filters.category !== 'payouts_rewards' ? Promise.resolve([]) : this.autoPayouts(range),
      this.refundsPaid(range),
      this.prisma.expenseBudget.findMany({ where: { month: { in: monthsInRange(range.from, range.to) } } }),
      this.prisma.expense.findMany({ where: { status: { in: TO_PAY } }, select: { status: true, amountPaise: true } }),
    ]);
    const names = await this.names(expenses);
    const rows = expenses.map((e) => this.toRow(e, names, policy.financeExpenseLimitPaise));
    const inPeriod = rows.filter((r) => COUNTED.includes(r.status) && r.billDate >= range.from.toISOString() && r.billDate <= range.to.toISOString());
    const autoRows = payouts.map((p) => ({
      id: p.id,
      code: p.code,
      kind: 'auto' as const,
      category: 'payouts_rewards',
      what: p.type === 'referral_payout' ? `Referral payout · ${p.referral?.code ?? ''}` : `Joining reward · ${p.placement?.code ?? p.jobSeeker?.code ?? ''}`,
      amountPaise: p.amount,
      paidAt: p.paidAt?.toISOString() ?? null,
      utr: p.bankUtr,
    }));
    return {
      rows,
      auto: autoRows,
      refundsAgainstRevenue: {
        count: refunds.length,
        paise: sumPaise(refunds.map((r) => r.amount)),
      },
      summary: {
        spentPaise: sumPaise(inPeriod.map((r) => r.amountPaise)) + sumPaise(autoRows.map((r) => r.amountPaise)),
        billsPaise: sumPaise(inPeriod.map((r) => r.amountPaise)),
        autoPaise: sumPaise(autoRows.map((r) => r.amountPaise)),
        budgetPaise: sumPaise(budgets.map((b) => b.amountPaise)),
        toPayCount: toPay.length,
        dueNowPaise: sumPaise(toPay.filter((e) => e.status !== 'waiting_ceo').map((e) => e.amountPaise)),
        waitingCeoCount: toPay.filter((e) => e.status === 'waiting_ceo').length,
        waitingCeoPaise: sumPaise(toPay.filter((e) => e.status === 'waiting_ceo').map((e) => e.amountPaise)),
        limitPaise: policy.financeExpenseLimitPaise,
      },
      categories: EXPENSE_CATEGORIES,
      channels: HEARD_FROM_VALUES,
    };
  }

  async setBudgets(input: { month?: unknown; budgets?: unknown }, actorId: string) {
    const actor = await this.actor(actorId);
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO sets budgets');
    if (typeof input.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new BadRequestException('month must be yyyy-mm');
    if (!input.budgets || typeof input.budgets !== 'object' || Array.isArray(input.budgets)) throw new BadRequestException('budgets must map a category to an amount in paise');
    const allowed = [...EXPENSE_CATEGORIES, ...AUTO_EXPENSE_CATEGORIES] as readonly string[];
    const entries = Object.entries(input.budgets as Record<string, unknown>);
    if (!entries.length) throw new BadRequestException('Give at least one budget');
    const clean = entries.map(([category, value]) => {
      if (!allowed.includes(category)) throw new BadRequestException(`Unknown category '${category}'`);
      return { category, amountPaise: paise(value, `budget for ${category}`, true) };
    });
    const month = input.month;
    const before = await this.prisma.expenseBudget.findMany({ where: { month } });
    await this.prisma.$transaction(
      clean.map((b) =>
        this.prisma.expenseBudget.upsert({
          where: { month_category: { month, category: b.category } },
          create: { month, category: b.category, amountPaise: b.amountPaise, setByStaffId: actor.id },
          update: { amountPaise: b.amountPaise, setByStaffId: actor.id },
        }),
      ),
    );
    await this.audit.log({
      actorId: actor.id,
      action: 'expense_budget.set',
      entityType: 'ExpenseBudget',
      entityCode: month,
      before: Object.fromEntries(before.map((b) => [b.category, b.amountPaise])),
      after: Object.fromEntries(clean.map((b) => [b.category, b.amountPaise])),
      changedFields: clean.map((b) => b.category),
    });
    return this.prisma.expenseBudget.findMany({ where: { month }, orderBy: { category: 'asc' } });
  }

  /**
   * Profit and loss for a period (C-Expenses): net revenue (₹499s + placement
   * fees without GST − refunds paid) minus expenses (bills by bill date, approved
   * or paid, plus payouts and rewards paid). Salaries join from payroll.
   */
  async profit(range: DateRange) {
    const [received, refunds, bills, payouts, budgets, placementsPaid, payroll] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          status: { in: RECEIVED_STATUSES },
          type: { in: ['activation', 'reactivation', 'placement_fee'] },
          OR: [{ confirmedAt: { gte: range.from, lte: range.to } }, { confirmedAt: null, paidAt: { gte: range.from, lte: range.to } }],
        },
        select: { type: true, amount: true, placement: { select: { placementFee: true, gstAmount: true } } },
      }),
      this.refundsPaid(range),
      this.prisma.expense.findMany({ where: { status: { in: COUNTED }, billDate: { gte: range.from, lte: range.to } } }),
      this.autoPayouts(range),
      this.prisma.expenseBudget.findMany({ where: { month: { in: monthsInRange(range.from, range.to) } } }),
      this.prisma.placement.findMany({ where: { paidAt: { gte: range.from, lte: range.to } }, select: { id: true, jobSeeker: { select: { heardFrom: true } } } }),
      this.payroll ? this.payroll.salariesInRange(range.from, range.to) : Promise.resolve({ totalPaise: 0, months: [], pendingMonths: [] as string[] }),
    ]);
    const activation = received.filter((p) => p.type !== 'placement_fee');
    const fees = received.filter((p) => p.type === 'placement_fee');
    const activationPaise = sumPaise(activation.map((p) => p.amount));
    const placementFeePaise = sumPaise(fees.map((p) => p.placement?.placementFee ?? p.amount));
    const gstCollectedPaise = sumPaise(fees.map((p) => (p.placement ? p.amount - p.placement.placementFee : 0)));
    const refundsPaise = sumPaise(refunds.map((r) => r.amount));
    const billsPaise = sumPaise(bills.map((b) => b.amountPaise));
    const payoutsPaise = sumPaise(payouts.map((p) => p.amount));
    // Salaries come from payroll (Phase 22 Part B): each month the CEO approved,
    // counted in the period that holds the month's last day.
    const salariesPaise = payroll.totalPaise;
    const expensesPaise = billsPaise + payoutsPaise + salariesPaise;
    const placements = fees.length;
    const pnl = profitAndLoss({ activationPaise, placementFeePaise, refundsPaise, expensesPaise, placements });
    const budgetBy = new Map<string, number>();
    for (const b of budgets) budgetBy.set(b.category, (budgetBy.get(b.category) ?? 0) + b.amountPaise);
    const actualBy = new Map<string, number>();
    for (const b of bills) actualBy.set(b.category, (actualBy.get(b.category) ?? 0) + b.amountPaise);
    actualBy.set('payouts_rewards', payoutsPaise);
    actualBy.set('salaries', salariesPaise);
    const categories = ['salaries', ...EXPENSE_CATEGORIES, 'payouts_rewards'].map((category) => ({
      category,
      added: category === 'salaries' || category === 'payouts_rewards' ? 'auto' : 'bill',
      budgetPaise: budgetBy.get(category) ?? 0,
      actualPaise: actualBy.get(category) ?? 0,
    }));
    const channelSpend = new Map<string, number>();
    for (const b of bills.filter((x) => x.category === 'ads_marketing')) channelSpend.set(b.adChannel ?? 'other', (channelSpend.get(b.adChannel ?? 'other') ?? 0) + b.amountPaise);
    // Referral partners cost what they are paid.
    const referralPaid = sumPaise(payouts.filter((p) => p.type === 'referral_payout').map((p) => p.amount));
    if (referralPaid) channelSpend.set('referral_partner', (channelSpend.get('referral_partner') ?? 0) + referralPaid);
    const placedBy = new Map<string, number>();
    for (const p of placementsPaid) {
      const ch = p.jobSeeker?.heardFrom ?? 'other';
      placedBy.set(ch, (placedBy.get(ch) ?? 0) + 1);
    }
    const channels = HEARD_FROM_VALUES.map((channel) => {
      const spentPaise = channelSpend.get(channel) ?? 0;
      const placed = placedBy.get(channel) ?? 0;
      return { channel, spentPaise, placed, perPlacementPaise: placed > 0 ? Math.round(spentPaise / placed / 100) * 100 : null };
    }).filter((c) => c.spentPaise > 0 || c.placed > 0);
    const policy = await this.pricing.current();
    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString(), month: istMonth(range.to) },
      revenue: {
        activationPaise,
        activationCount: activation.length,
        placementFeePaise,
        placementCount: placements,
        refundsPaise,
        refundsCount: refunds.length,
        netRevenuePaise: pnl.netRevenuePaise,
        gstCollectedPaise,
      },
      expenses: { billsPaise, payoutsPaise, salariesPaise, salariesFromPayroll: true, salaryMonths: payroll.months, salaryMonthsPending: payroll.pendingMonths, totalPaise: expensesPaise },
      profitPaise: pnl.profitPaise,
      costPerPlacementPaise: pnl.costPerPlacementPaise,
      breakEvenPlacements: pnl.breakEvenPlacements,
      placements,
      categories,
      budgetTotalPaise: sumPaise(categories.map((c) => c.budgetPaise)),
      channels,
      limitPaise: policy.financeExpenseLimitPaise,
    };
  }
}
