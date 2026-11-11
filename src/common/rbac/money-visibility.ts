/**
 * Managers see no money at all (Master Guide, "CEO and founders vs. Manager",
 * reconfirmed 11 Nov): no rupee or paise figure in any answer the software
 * gives a Manager. Counts, rates, targets and trends stay.
 *
 * Endpoints that are only about money (payments, refunds due, pricing,
 * invoices) refuse a Manager outright. Every other answer a Manager receives
 * passes through `stripMoney`, which removes every money field and hides any
 * rupee amount written inside text.
 */

/** Roles that never receive a money figure. */
export const MONEY_BLIND_ROLES: ReadonlySet<string> = new Set(['manager']);

const MONEY_KEY_SUFFIXES = [
  'paise',
  'rupees',
  'inr',
  'amount',
  'salary',
  'fee',
  'fees',
  'revenue',
];

/**
 * True for a key that holds a money figure. Money in this codebase is named
 * `...Paise`, `...Rupees`, `...INR`, `amount`, `...Amount`, `...Salary`
 * (stored in paise), `placementFee` or `...Revenue`.
 */
export function isMoneyKey(key: string): boolean {
  const lower = key.toLowerCase();
  return MONEY_KEY_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

const RUPEE_TEXT = /₹\s?\d[\d,]*(?:\.\d+)?/g;
export const HIDDEN_AMOUNT_TEXT = '₹ (hidden)';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Returns a copy of `data` with every money field removed and rupee text hidden. */
export function stripMoney<T>(data: T, seen = new WeakSet<object>()): T {
  if (typeof data === 'string') {
    return data.replace(RUPEE_TEXT, HIDDEN_AMOUNT_TEXT) as unknown as T;
  }
  if (Array.isArray(data)) {
    if (seen.has(data)) {
      return data;
    }
    seen.add(data);
    return data.map((item) => stripMoney(item, seen)) as unknown as T;
  }
  if (!isPlainObject(data)) {
    return data;
  }
  if (seen.has(data)) {
    return data;
  }
  seen.add(data);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (isMoneyKey(key)) {
      continue;
    }
    out[key] = stripMoney(value, seen);
  }
  return out as unknown as T;
}

export function seesMoney(role: string | undefined | null): boolean {
  return !role || !MONEY_BLIND_ROLES.has(role);
}
