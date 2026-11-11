import type { Trade } from './api';

/**
 * Salary hints and warnings on the forms (guide: "Market salary ranges and
 * the guarantee" and "Legal minimum wage", decided 9 Nov). Pure, so the
 * rules are tested on their own. Amounts are integer paise.
 */
export type Period = 'monthly' | 'daily';

/** Above the top of the trade's usual monthly range → warn (CA08w). Daily pay is checked by the API on save. */
export function isAboveMarket(trade: Trade | undefined, minPaise: number | null, period: Period): boolean {
  if (!trade || minPaise === null || period !== 'monthly') return false;
  return minPaise > trade.salaryMaxPaise;
}

/** The salary the guarantee uses: the lower of his minimum and the top of the market range. */
export function guaranteeFloorPaise(trade: Trade | undefined, minPaise: number | null): number | null {
  if (minPaise === null) return null;
  if (!trade) return minPaise;
  return Math.min(minPaise, trade.salaryMaxPaise);
}

/** A monthly salary below the trade's legal minimum wage is allowed but warned (CA09, CA13 staff rows). */
export function isBelowLegalMinimum(trade: Trade | undefined, minPaise: number | null, period: Period): boolean {
  if (!trade || minPaise === null || period !== 'monthly') return false;
  return minPaise < trade.legalMinimumPaise;
}
