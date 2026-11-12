import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { monthLabel, nextMonth } from './payroll-rules';

/**
 * How far back frozen months are worked out again to find corrections: a
 * sheet of month N works out the approved months N−12 … N−1 again.
 */
export const CORRECTION_LOOKBACK_MONTHS = 12;

/** Sheets whose numbers are fixed (with the CEO, approved or paid). A returned sheet is prepared again. */
const FROZEN = ['with_ceo', 'approved', 'paid'];

type RunReader = Pick<PrismaClient, 'payrollRun'>;

/** yyyy-mm of a stored date (UTC midnight = the IST calendar day). */
export const monthOfDay = (date: Date): string => date.toISOString().slice(0, 7);

/** Every month from `from` to `to` (inclusive, yyyy-mm). */
export function monthsBetween(from: string, to: string): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out: string[] = [];
  for (let m = a; m <= b && out.length < 1200; m = nextMonth(m)) out.push(m);
  return out;
}

/**
 * The months among `months` whose sheet is frozen and that no sheet still to
 * be prepared will ever work out again: each of the next 12 months already
 * has a frozen sheet, so a change there would be silently ignored by payroll.
 */
export async function monthsBeyondCorrections(prisma: RunReader, months: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(months)].sort();
  if (!wanted.length) return [];
  const frozenHere = await prisma.payrollRun.findMany({ where: { month: { in: wanted }, status: { in: FROZEN } }, select: { month: true } });
  const out: string[] = [];
  for (const { month } of frozenHere.sort((x, y) => x.month.localeCompare(y.month))) {
    const later: string[] = [];
    for (let m = nextMonth(month); later.length < CORRECTION_LOOKBACK_MONTHS; m = nextMonth(m)) later.push(m);
    const frozenLater = await prisma.payrollRun.count({ where: { month: { in: later }, status: { in: FROZEN } } });
    if (frozenLater === later.length) out.push(month);
  }
  return out;
}

/**
 * Refuses a change dated in a month payroll will no longer work out again
 * (holidays, a day change, a joining date): today it would be silently
 * ignored, so a manual correction is raised instead.
 */
export async function assertPayrollCanCorrect(prisma: RunReader, months: readonly string[], what: string): Promise<void> {
  const beyond = await monthsBeyondCorrections(prisma, months);
  if (!beyond.length) return;
  const labels = beyond.map(monthLabel).join(', ');
  throw new BadRequestException(
    `${what} would change ${labels} pay, which is older than the ${CORRECTION_LOOKBACK_MONTHS} months payroll still works out again, so the change would never reach anyone's salary. Ask Finance to raise a manual correction instead.`,
  );
}
