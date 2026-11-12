import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Db = {
  payment: { findFirst: (args: Prisma.PaymentFindFirstArgs) => Promise<{ id: string; code: string } | null> };
  bankCredit: { findFirst: (args: Prisma.BankCreditFindFirstArgs) => Promise<{ id: string; bankUtr: string; returnedUtr: string | null } | null> };
  expense: { findFirst: (args: Prisma.ExpenseFindFirstArgs) => Promise<{ code: string } | null> };
  payrollLine: { findFirst: (args: Prisma.PayrollLineFindFirstArgs) => Promise<{ staffCode: string } | null> };
};

/**
 * One bank or UPI reference (UTR) is one movement of money (Phase 22 Part B).
 * The one check every place that records a UTR uses: payments in and out
 * (Payment.bankUtr), bank credits and money returned (BankCredit.bankUtr /
 * returnedUtr), expenses paid from the bank, and salaries (PayrollLine.utr).
 * `allow` names the records that may already carry this UTR (a credit and the
 * payment it is matched to share the bank's UTR).
 */
export async function assertUtrUnused(
  db: unknown,
  utrValue: string,
  allow: { paymentId?: string; bankCreditId?: string } = {},
): Promise<void> {
  const utr = utrValue.trim();
  if (!utr) return;
  const d = db as Partial<Db>;
  // Every model is asked. Only under Jest (NODE_ENV=test) may a test double
  // that fakes some of them answer "none" for the rest; anywhere else a
  // missing model is a fault, so the check fails loudly instead of passing.
  const ask = <K extends keyof Db>(name: K): Db[K] | null => {
    if (d[name]?.findFirst) return d[name] as Db[K];
    if (process.env.NODE_ENV === 'test') return null;
    throw new Error(`UTR check: the database has no ${String(name)} model`);
  };
  const [paymentDb, creditDb, expenseDb, salaryDb] = [ask('payment'), ask('bankCredit'), ask('expense'), ask('payrollLine')];
  const [paymentHit, creditHit, expense, salary] = await Promise.all([
    paymentDb ? paymentDb.findFirst({ where: { bankUtr: utr, ...(allow.paymentId ? { NOT: { id: allow.paymentId } } : {}) }, select: { id: true, code: true } }) : null,
    creditDb
      ? creditDb.findFirst({
          where: { OR: [{ bankUtr: utr }, { returnedUtr: utr }], ...(allow.bankCreditId ? { NOT: { id: allow.bankCreditId } } : {}) },
          select: { id: true, bankUtr: true, returnedUtr: true },
        })
      : null,
    expenseDb ? expenseDb.findFirst({ where: { paymentReference: utr, status: 'paid', NOT: { paidFrom: 'cash' } }, select: { code: true } }) : null,
    salaryDb ? salaryDb.findFirst({ where: { utr }, select: { staffCode: true } }) : null,
  ]);
  // The records allowed to carry this UTR never count (checked again here, not only in the query).
  const payment = paymentHit && paymentHit.id !== allow.paymentId ? paymentHit : null;
  const credit = creditHit && creditHit.id !== allow.bankCreditId ? creditHit : null;
  const where = payment
    ? `payment ${payment.code}`
    : credit
      ? credit.returnedUtr === utr
        ? `money returned for credit ${credit.bankUtr}`
        : `bank credit ${credit.bankUtr}`
      : expense
        ? `expense ${expense.code}`
        : salary
          ? `the salary of ${salary.staffCode}`
          : null;
  if (where) throw utrUsed(utr, where);
}

export function utrUsed(utr: string, where?: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'utr_already_used',
    message: `UTR '${utr}' has already been used${where ? ` on ${where}` : ''}. Check the reference from the bank or UPI app.`,
  });
}

/** A unique-index clash on a UTR column (two saves racing) becomes the same 409. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
