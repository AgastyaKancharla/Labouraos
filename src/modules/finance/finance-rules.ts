import { safeLimitPaise } from '../../common/money/approval-limits';

/**
 * Pure rules of the Finance back office, Part A (specs/phase-22.md). Time is
 * always passed in and amounts are integer paise, so every rule is unit-tested
 * without a database.
 */

/** Expense categories (guide: Expenses, decided 9 Nov). Salaries, payouts, rewards and refunds are automatic. */
export const EXPENSE_CATEGORIES = [
  'rent',
  'calling',
  'sms_whatsapp',
  'id_checks',
  'hosting',
  'ads_marketing',
  'field_travel',
  'office_other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Automatic lines in the expenses view, read from payroll and payments, never entered. */
export const AUTO_EXPENSE_CATEGORIES = ['salaries', 'payouts_rewards'] as const;

/** Where Finance paid an expense from. */
export const PAID_FROM = ['bank_transfer', 'upi', 'card', 'cash'] as const;

export type ExpenseStatus = 'waiting_finance' | 'waiting_ceo' | 'approved' | 'paid' | 'rejected';

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

/** Expenses above Finance's limit in Settings need the CEO. A missing limit counts as zero. */
export function expenseNeedsCeo(amountPaise: number, limitPaise: number | null | undefined): boolean {
  return amountPaise > safeLimitPaise(limitPaise);
}

/**
 * The status a new expense starts in. The CEO entering it is the CEO's approval;
 * Finance's own entry still needs Finance's "Approve" (within the limit) or the
 * CEO's (above it).
 */
export function initialExpenseStatus(actorRole: string, amountPaise: number, limitPaise: number | null | undefined): ExpenseStatus {
  if (actorRole === 'ceo') return 'approved';
  return expenseNeedsCeo(amountPaise, limitPaise) ? 'waiting_ceo' : 'waiting_finance';
}

export type ExpenseApprovalCheck = { ok: true } | { ok: false; code: string; message: string };

/** Who may approve this expense now. "No bill, no payment": nothing is approved without the bill. */
export function checkExpenseApproval(input: {
  actorRole: string;
  status: string;
  amountPaise: number;
  limitPaise: number | null | undefined;
  hasBill: boolean;
}): ExpenseApprovalCheck {
  if (input.status !== 'waiting_finance' && input.status !== 'waiting_ceo') {
    return { ok: false, code: 'not_waiting', message: `This expense is ${input.status.replace('_', ' ')}, so there is nothing to approve.` };
  }
  if (!input.hasBill) {
    return { ok: false, code: 'no_bill', message: 'Attach the bill first. No bill, no payment.' };
  }
  if (input.actorRole === 'ceo') return { ok: true };
  if (input.actorRole !== 'finance') return { ok: false, code: 'forbidden', message: 'Only Finance or the CEO approves expenses.' };
  if (input.status === 'waiting_ceo' || expenseNeedsCeo(input.amountPaise, input.limitPaise)) {
    return {
      ok: false,
      code: 'needs_ceo',
      message: `This expense is above Finance's limit of ${rupees(safeLimitPaise(input.limitPaise))}, so the CEO approves it.`,
    };
  }
  return { ok: true };
}

function rupees(paise: number): string {
  return `₹${Math.floor(paise / 100).toLocaleString('en-IN')}${paise % 100 ? `.${String(paise % 100).padStart(2, '0')}` : ''}`;
}

/** Integer paise, positive, never a float. */
export function parsePaise(value: unknown, name: string, { allowZero = false } = {}): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || (!allowZero && n === 0)) {
    throw new Error(`${name} must be a ${allowZero ? 'whole' : 'positive whole'} number of paise`);
  }
  return n;
}

// ---------------------------------------------------------------- payouts

export type PayoutState =
  | 'ready'
  | 'waiting_48h'
  | 'no_details'
  | 'flagged'
  | 'with_ceo'
  | 'failed'
  | 'processing';

/**
 * Whether Finance can pay a payout today (guide: paid daily, once due and after
 * any 48-hour wait). `activeFrom` is when the receiver's payout details may be
 * paid (change time + the cooling hours in Settings).
 */
export function payoutState(input: {
  status: string;
  withCeo: boolean;
  account: { status: string; activeFrom: Date } | null;
  now: Date;
}): { state: PayoutState; payableAt: Date | null } {
  if (input.status === 'failed') return { state: 'failed', payableAt: null };
  if (input.status === 'processing') return { state: 'processing', payableAt: null };
  if (input.withCeo) return { state: 'with_ceo', payableAt: null };
  if (!input.account || input.account.status === 'superseded') return { state: 'no_details', payableAt: null };
  if (input.account.status === 'flagged') return { state: 'flagged', payableAt: null };
  if (input.account.activeFrom.getTime() > input.now.getTime()) return { state: 'waiting_48h', payableAt: input.account.activeFrom };
  return { state: 'ready', payableAt: null };
}

/** The Indian financial year (1 April – 31 March, IST) an instant falls in, as UTC bounds. */
export function financialYear(now: Date): { from: Date; to: Date; label: string } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  const from = new Date(Date.UTC(y, 3, 1) - IST_OFFSET_MS);
  const to = new Date(Date.UTC(y + 1, 3, 1) - IST_OFFSET_MS - 1);
  return { from, to, label: `${y}-${String((y + 1) % 100).padStart(2, '0')}` };
}

/**
 * Referral payouts are commission: warn before a partner's yearly total crosses
 * the TDS limit (guide, tax handling — to confirm with the CA). Returns null when
 * this payout keeps the partner at or under the limit.
 */
export function tdsWarning(paidThisYearPaise: number, thisPayoutPaise: number, limitPaise: number | null | undefined) {
  const limit = safeLimitPaise(limitPaise);
  if (!limit) return null;
  const after = paidThisYearPaise + thisPayoutPaise;
  if (after <= limit) return null;
  return { paidThisYearPaise, afterPaise: after, limitPaise: limit, alreadyOver: paidThisYearPaise > limit };
}

// ---------------------------------------------------------------- money in

export type MoneyInStatus =
  | 'matched_auto'
  | 'matched_finance'
  | 'tds_recorded'
  | 'less'
  | 'wrong_amount'
  | 'not_matched'
  | 'duplicate'
  | 'returned'
  | 'ignored';

/** What a bank credit's row says on Money in. */
export function moneyInStatus(input: {
  creditStatus: string;
  source: string;
  matchedType: string | null;
  confirmedBy: string | null;
  hasTds: boolean;
  flagReason: string | null;
}): MoneyInStatus {
  if (input.creditStatus === 'returned') return 'returned';
  if (input.creditStatus === 'ignored') return 'ignored';
  if (input.creditStatus === 'matched') {
    if (input.matchedType === 'duplicate_refund') return 'duplicate';
    if (input.hasTds) return 'tds_recorded';
    return input.confirmedBy === 'bank_feed' ? 'matched_auto' : 'matched_finance';
  }
  if (input.flagReason === 'short_possible_tds') return 'less';
  if (input.flagReason === 'amount_mismatch') return 'wrong_amount';
  return 'not_matched';
}

/** Statuses that need Finance ("Need you" on Money in). */
export const MONEY_IN_NEEDS_YOU: readonly MoneyInStatus[] = ['less', 'wrong_amount', 'not_matched'];

/**
 * Why a waiting payment might be what an unclaimed credit paid for (Match a
 * payment). Higher score first; only payments of exactly the credit's amount,
 * or a placement fee the credit is short of, are offered.
 */
export function matchHints(input: {
  creditPaise: number;
  creditAt: Date;
  payerName: string | null;
  remark: string | null;
  payment: { expectedPaise: number; type: string; reference: string | null; createdAt: Date; payerHint: string | null; names: string[] };
}): { score: number; reasons: string[]; shortByPaise: number } | null {
  const { payment } = input;
  const shortBy = payment.expectedPaise - input.creditPaise;
  const exact = shortBy === 0;
  const short = payment.type === 'placement_fee' && shortBy > 0;
  if (!exact && !short) return null;
  const reasons: string[] = [];
  let score = exact ? 50 : 20;
  reasons.push(exact ? 'Same amount' : `Placement fee ${rupees(shortBy)} more than received (TDS?)`);
  const remark = (input.remark ?? '').toUpperCase();
  if (payment.reference && remark.includes(payment.reference.toUpperCase())) {
    score += 40;
    reasons.push('Reference in the bank note');
  }
  const payer = firstWord(input.payerName);
  if (payer && payment.names.some((n) => firstWord(n) === payer)) {
    score += 20;
    reasons.push('Same first name');
  }
  if (payment.payerHint && remark.includes(payment.payerHint.toUpperCase())) {
    score += 10;
    reasons.push('UTR the payer typed matches');
  }
  const minutes = Math.round((input.creditAt.getTime() - payment.createdAt.getTime()) / 60000);
  if (minutes >= 0 && minutes <= 24 * 60) {
    score += minutes <= 60 ? 15 : 5;
    reasons.push(minutes < 60 ? `${minutes} min after the link was sent` : `${Math.round(minutes / 60)} h after the link was sent`);
  }
  return { score, reasons, shortByPaise: Math.max(0, shortBy) };
}

function firstWord(name: string | null | undefined): string | null {
  const w = (name ?? '').trim().split(/\s+/)[0]?.toLowerCase();
  return w && w.length >= 2 ? w : null;
}

// ---------------------------------------------------------------- bank

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The IST calendar day (yyyy-mm-dd) an instant falls on. */
export function istDay(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 IST of a day key as a UTC instant, and the last millisecond of that day. */
export function istDayBounds(day: string): { from: Date; to: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(`${day}T00:00:00.000Z`).getTime())) {
    throw new Error('day must be yyyy-mm-dd');
  }
  const from = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000 - 1) };
}

/** One day of the bank account: opening + in − out = closing in our books, against the bank's own closing. */
export function bankDay(openingPaise: number, inPaise: number, outPaise: number, bankClosingPaise: number | null) {
  const booksClosingPaise = openingPaise + inPaise - outPaise;
  return {
    openingPaise,
    inPaise,
    outPaise,
    booksClosingPaise,
    bankClosingPaise,
    differencePaise: bankClosingPaise === null ? null : bankClosingPaise - booksClosingPaise,
  };
}

// ---------------------------------------------------------------- profit

/**
 * Revenue minus expenses for a period (C-Expenses). Refunds come off revenue
 * (guide: shown against revenue, not as a cost); GST collected is owed to the
 * government, never income.
 */
export function profitAndLoss(input: {
  activationPaise: number;
  placementFeePaise: number;
  refundsPaise: number;
  expensesPaise: number;
  placements: number;
}) {
  const netRevenuePaise = input.activationPaise + input.placementFeePaise - input.refundsPaise;
  const profitPaise = netRevenuePaise - input.expensesPaise;
  const averageFeePaise = input.placements > 0 ? Math.round(input.placementFeePaise / input.placements) : 0;
  return {
    netRevenuePaise,
    expensesPaise: input.expensesPaise,
    profitPaise,
    costPerPlacementPaise: input.placements > 0 ? Math.round(input.expensesPaise / input.placements) : null,
    // Placements needed for fees alone to cover the period's expenses, at the period's average fee.
    breakEvenPlacements: averageFeePaise > 0 ? Math.ceil(input.expensesPaise / averageFeePaise) : null,
  };
}

/** IST month key (yyyy-mm) a date falls in. */
export function istMonth(date: Date): string {
  return istDay(date).slice(0, 7);
}

/** Every IST month key touched by a period, oldest first. */
export function monthsInRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  let [y, m] = istMonth(from).split('-').map(Number);
  const [ty, tm] = istMonth(to).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}
