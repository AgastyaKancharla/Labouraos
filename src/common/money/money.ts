/**
 * Referral payout amount in paise: flat ₹200 (20000 paise) per placement.
 * Locked per AGENTS.md §6 and specs/phase-6.md Task 1.
 */
export const REFERRAL_PAYOUT_AMOUNT_PAISE = 20000;

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
 * Calculates 18% GST on amount in paise, rounded to nearest paisa.
 */
export function calculateGst(amountPaise: number): number {
  assertInteger(amountPaise, 'amountPaise');
  assertNonNegative(amountPaise, 'amountPaise');
  const result = Math.round((amountPaise * 18) / 100);
  assertInteger(result, 'result');
  return result;
}

/**
 * Calculates placement fee (50% of first month salary in paise).
 */
export function calculatePlacementFee(monthlySalaryPaise: number): number {
  assertInteger(monthlySalaryPaise, 'monthlySalaryPaise');
  assertNonNegative(monthlySalaryPaise, 'monthlySalaryPaise');
  const result = Math.round((monthlySalaryPaise * 50) / 100);
  assertInteger(result, 'result');
  return result;
}

/**
 * Calculates refund amount according to §6 flat rule (locked 2026-10-20):
 * Days < 15: 0 (not yet eligible, Laboura is still searching for a replacement)
 * Days >= 15: full amountPaise (100% flat refund, no tapering)
 */
export function calculateRefund(amountPaise: number, daysElapsed: number): number {
  assertInteger(amountPaise, 'amountPaise');
  assertNonNegative(amountPaise, 'amountPaise');
  assertInteger(daysElapsed, 'daysElapsed');
  assertNonNegative(daysElapsed, 'daysElapsed');

  let result = 0;
  if (daysElapsed < 15) {
    result = 0;
  } else {
    result = amountPaise;
  }

  assertInteger(result, 'result');
  return result;
}

/**
 * Calculates the 30-day refund guarantee deadline from payment receipt date.
 * deadline = paymentReceivedAt + 30 days
 */
export function refundGuaranteeDeadline(paymentReceivedAt: Date): Date {
  if (!(paymentReceivedAt instanceof Date) || isNaN(paymentReceivedAt.getTime())) {
    throw new TypeError('paymentReceivedAt must be a valid Date');
  }
  const msIn30Days = 30 * 24 * 60 * 60 * 1000;
  return new Date(paymentReceivedAt.getTime() + msIn30Days);
}

/**
 * Checks whether the given 'now' date is within the 30-day refund guarantee window.
 * Returns true if now <= refundGuaranteeDeadline(paymentReceivedAt).
 * Uses injectable time (now), never inline new Date() per AGENTS.md §9.
 */
export function isWithinRefundGuarantee(
  paymentReceivedAt: Date,
  now: Date,
  status?: string,
  hasOfferRejectedHit: boolean = false,
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
  const deadline = refundGuaranteeDeadline(paymentReceivedAt);
  return now.getTime() <= deadline.getTime();
}

/**
 * Replacement guarantee window: 60 days for business clients per AGENTS.md §6.
 */
export const REPLACEMENT_GUARANTEE_WINDOW_DAYS = 60;
export const REPLACEMENT_GUARANTEE_WINDOW_MS =
  REPLACEMENT_GUARANTEE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Calculates the 60-day replacement guarantee deadline from the employee's joined date.
 * deadline = joinedDate + 60 days (using millisecond arithmetic consistent with refundGuaranteeDeadline).
 */
export function replacementGuaranteeDeadline(joinedDate: Date): Date {
  if (!(joinedDate instanceof Date) || isNaN(joinedDate.getTime())) {
    throw new TypeError('joinedDate must be a valid Date');
  }
  return new Date(joinedDate.getTime() + REPLACEMENT_GUARANTEE_WINDOW_MS);
}

/**
 * Checks whether dropoutReportedAt falls within the 60-day replacement guarantee window.
 * Returns true if dropoutReportedAt <= replacementGuaranteeDeadline(joinedDate).
 * Uses injectable time, never new Date() inline per AGENTS.md §9.
 *
 * NOTE on Clock Pause: Placement.clockPaused and Placement.clockPausedAt govern the
 * 15-day free replacement search window AFTER a dropout is reported (upon 3rd candidate rejection).
 * Clock pause does NOT extend this initial 60-day guarantee window, which runs strictly from joinedDate.
 */
export function isWithinReplacementGuarantee(
  joinedDate: Date,
  dropoutReportedAt: Date,
): boolean {
  if (!(joinedDate instanceof Date) || isNaN(joinedDate.getTime())) {
    throw new TypeError('joinedDate must be a valid Date');
  }
  if (!(dropoutReportedAt instanceof Date) || isNaN(dropoutReportedAt.getTime())) {
    throw new TypeError('dropoutReportedAt must be a valid Date');
  }
  const deadline = replacementGuaranteeDeadline(joinedDate);
  return dropoutReportedAt.getTime() <= deadline.getTime();
}



