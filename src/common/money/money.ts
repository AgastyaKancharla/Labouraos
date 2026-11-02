function assertInteger(val: number, name: string): void {
  if (typeof val !== 'number' || !Number.isInteger(val)) {
    throw new TypeError(`${name} must be an integer; got ${val}`);
  }
}

function assertNonNegative(val: number, name: string): void {
  if (val < 0) {
    throw new RangeError(`${name} cannot be negative; got ${val}`);
  }
}

/**
 * Converts integer rupees to integer paise (₹1 = 100 paise).
 */
export function toPaise(rupees: number): number {
  assertInteger(rupees, 'rupees');
  assertNonNegative(rupees, 'rupees');
  const result = rupees * 100;
  assertInteger(result, 'result');
  return result;
}

/**
 * Converts integer paise to integer rupees, rounded to the nearest rupee.
 */
export function toRupees(amountPaise: number): number {
  assertInteger(amountPaise, 'amountPaise');
  assertNonNegative(amountPaise, 'amountPaise');
  const result = Math.round(amountPaise / 100);
  assertInteger(result, 'result');
  return result;
}

/**
 * Formats integer paise into an Indian Rupee string representation for display (e.g. ₹499 or ₹1,50,000).
 */
export function formatINR(amountPaise: number): string {
  assertInteger(amountPaise, 'amountPaise');
  assertNonNegative(amountPaise, 'amountPaise');
  const rupees = amountPaise / 100;
  const hasPaise = amountPaise % 100 !== 0;
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return formatter.format(rupees);
}

/**
 * Calculates GST on amount in paise, rounded to nearest paisa.
 * Percentage is provided by caller from PricingPolicy (Phase 9 Task 2).
 */
export function calculateGst(amountPaise: number, gstPercent: number): number {
  assertInteger(amountPaise, 'amountPaise');
  assertNonNegative(amountPaise, 'amountPaise');
  assertInteger(gstPercent, 'gstPercent');
  assertNonNegative(gstPercent, 'gstPercent');
  const result = Math.round((amountPaise * gstPercent) / 100);
  assertInteger(result, 'result');
  return result;
}

/**
 * Calculates placement fee based on first month salary in paise and fee percentage.
 * Percentage is provided by caller from PricingPolicy (Phase 9 Task 2).
 */
export function calculatePlacementFee(monthlySalaryPaise: number, feePercent: number): number {
  assertInteger(monthlySalaryPaise, 'monthlySalaryPaise');
  assertNonNegative(monthlySalaryPaise, 'monthlySalaryPaise');
  assertInteger(feePercent, 'feePercent');
  assertNonNegative(feePercent, 'feePercent');
  const result = Math.round((monthlySalaryPaise * feePercent) / 100);
  assertInteger(result, 'result');
  return result;
}

/**
 * Calculates refund amount according to §6 flat rule:
 * Days < searchDays: 0 (not yet eligible, Laboura is still searching for a replacement)
 * Days >= searchDays: full amountPaise (100% flat refund, no tapering)
 * searchDays is read from PricingPolicy (default 15).
 */
export function calculateRefund(amountPaise: number, daysElapsed: number, searchDays: number = 15): number {
  assertInteger(amountPaise, 'amountPaise');
  assertNonNegative(amountPaise, 'amountPaise');
  assertInteger(daysElapsed, 'daysElapsed');
  assertNonNegative(daysElapsed, 'daysElapsed');
  assertInteger(searchDays, 'searchDays');
  assertNonNegative(searchDays, 'searchDays');

  let result = 0;
  if (daysElapsed < searchDays) {
    result = 0;
  } else {
    result = amountPaise;
  }

  assertInteger(result, 'result');
  return result;
}

/**
 * Default guarantee constants (used as fallbacks when policy is omitted).
 */
export const REFUND_GUARANTEE_WINDOW_DAYS = 30;
export const REFUND_GUARANTEE_WINDOW_MS =
  REFUND_GUARANTEE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Calculates the refund guarantee deadline from payment receipt date.
 * deadline = paymentReceivedAt + guaranteeDays
 */
export function refundGuaranteeDeadline(paymentReceivedAt: Date, guaranteeDays: number = REFUND_GUARANTEE_WINDOW_DAYS): Date {
  if (!(paymentReceivedAt instanceof Date) || isNaN(paymentReceivedAt.getTime())) {
    throw new TypeError('paymentReceivedAt must be a valid Date');
  }
  return new Date(paymentReceivedAt.getTime() + guaranteeDays * 24 * 60 * 60 * 1000);
}

/**
 * Checks whether the given 'now' date is within the refund guarantee window.
 * Returns true if now <= refundGuaranteeDeadline(paymentReceivedAt, guaranteeDays).
 * Uses injectable time (now), never inline new Date() per AGENTS.md §9.
 */
export function isWithinRefundGuarantee(
  paymentReceivedAt: Date,
  now: Date,
  status?: string,
  hasOfferRejectedHit: boolean = false,
  guaranteeDays: number = REFUND_GUARANTEE_WINDOW_DAYS,
): boolean {
  if (status === 'deactivated' || status === 'placed' || hasOfferRejectedHit) {
    return false;
  }
  if (!(paymentReceivedAt instanceof Date) || isNaN(paymentReceivedAt.getTime())) {
    throw new TypeError('paymentReceivedAt must be a valid Date');
  }
  if (!(now instanceof Date) || isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  const deadline = refundGuaranteeDeadline(paymentReceivedAt, guaranteeDays);
  return now.getTime() <= deadline.getTime();
}

/**
 * Default replacement guarantee constants (used as fallbacks when policy is omitted).
 */
export const REPLACEMENT_GUARANTEE_WINDOW_DAYS = 60;
export const REPLACEMENT_GUARANTEE_WINDOW_MS =
  REPLACEMENT_GUARANTEE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Calculates the replacement guarantee deadline from the employee's joined date.
 * deadline = joinedDate + windowDays
 */
export function replacementGuaranteeDeadline(joinedDate: Date, windowDays: number = REPLACEMENT_GUARANTEE_WINDOW_DAYS): Date {
  if (!(joinedDate instanceof Date) || isNaN(joinedDate.getTime())) {
    throw new TypeError('joinedDate must be a valid Date');
  }
  return new Date(joinedDate.getTime() + windowDays * 24 * 60 * 60 * 1000);
}

/**
 * Checks whether dropoutReportedAt falls within the replacement guarantee window.
 * Returns true if dropoutReportedAt <= replacementGuaranteeDeadline(joinedDate, windowDays).
 * Uses injectable time, never new Date() inline per AGENTS.md §9.
 */
export function isWithinReplacementGuarantee(
  joinedDate: Date,
  dropoutReportedAt: Date,
  windowDays: number = REPLACEMENT_GUARANTEE_WINDOW_DAYS,
): boolean {
  if (!(joinedDate instanceof Date) || isNaN(joinedDate.getTime())) {
    throw new TypeError('joinedDate must be a valid Date');
  }
  if (!(dropoutReportedAt instanceof Date) || isNaN(dropoutReportedAt.getTime())) {
    throw new TypeError('dropoutReportedAt must be a valid Date');
  }
  const deadline = replacementGuaranteeDeadline(joinedDate, windowDays);
  return dropoutReportedAt.getTime() <= deadline.getTime();
}

/**
 * Free replacement search window: 15 days default from dropout report date.
 */
export const REPLACEMENT_SEARCH_WINDOW_DAYS = 15;
export const REPLACEMENT_SEARCH_WINDOW_MS =
  REPLACEMENT_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
