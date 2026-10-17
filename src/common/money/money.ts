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
 * Calculates refund amount according to §6 ladder:
 * Days 0-15: 100%
 * Days 16-30: 50%
 * Days 31-45: 25%
 * Days 46+: 0%
 */
export function calculateRefund(amountPaise: number, daysElapsed: number): number {
  assertInteger(amountPaise, 'amountPaise');
  assertNonNegative(amountPaise, 'amountPaise');
  assertInteger(daysElapsed, 'daysElapsed');
  assertNonNegative(daysElapsed, 'daysElapsed');

  let result = 0;
  if (daysElapsed <= 15) {
    result = amountPaise;
  } else if (daysElapsed <= 30) {
    result = Math.round((amountPaise * 50) / 100);
  } else if (daysElapsed <= 45) {
    result = Math.round((amountPaise * 25) / 100);
  } else {
    result = 0;
  }

  assertInteger(result, 'result');
  return result;
}
