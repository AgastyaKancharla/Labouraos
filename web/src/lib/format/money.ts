/**
 * Money helpers. Every amount in Laboura is an integer number of paise
 * (₹499 = 49900) — AGENTS.md §2 rule 1. These helpers never use floating
 * point arithmetic on money: rupees and paise are split with integer maths
 * and grouped as strings.
 */

function assertPaise(value: number, name = 'amountPaise'): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be an integer number of paise; got ${String(value)}`);
  }
}

/** Indian digit grouping for a string of digits: "412600" → "4,12,600". */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return `${groups.join(',')},${last3}`;
}

export interface FormatInrOptions {
  /** Always show two paise digits (₹499.00). Default: only when non-zero. */
  alwaysShowPaise?: boolean;
  /** Prefix positive amounts with "+". */
  signed?: boolean;
}

/**
 * ₹ with Indian grouping: 41260000 → "₹4,12,600"; 49950 → "₹499.50";
 * -1193500 → "− ₹11,935" (the designs use a spaced minus sign).
 */
export function formatINR(amountPaise: number, options: FormatInrOptions = {}): string {
  assertPaise(amountPaise);
  const negative = amountPaise < 0;
  const abs = Math.abs(amountPaise);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const showPaise = options.alwaysShowPaise || paise !== 0;
  const body = `₹${groupIndian(String(rupees))}${showPaise ? `.${String(paise).padStart(2, '0')}` : ''}`;
  if (negative) return `− ${body}`;
  if (options.signed && amountPaise > 0) return `+ ${body}`;
  return body;
}

/**
 * Short form used on tiles and charts: ₹5.37L, ₹1.2Cr, ₹60,133 below a lakh.
 * Two decimals, truncated (never rounded up, so a tile never overstates).
 */
export function formatINRCompact(amountPaise: number): string {
  assertPaise(amountPaise);
  const negative = amountPaise < 0;
  const rupees = Math.floor(Math.abs(amountPaise) / 100);
  const sign = negative ? '− ' : '';
  const LAKH = 100_000;
  const CRORE = 10_000_000;
  const short = (whole: number, unit: number, suffix: string) => {
    const hundredths = Math.floor((whole * 100) / unit); // integer maths
    const intPart = Math.floor(hundredths / 100);
    const frac = hundredths % 100;
    const fracStr = frac === 0 ? '' : `.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
    return `${sign}₹${groupIndian(String(intPart))}${fracStr}${suffix}`;
  };
  if (rupees >= CRORE) return short(rupees, CRORE, 'Cr');
  if (rupees >= LAKH) return short(rupees, LAKH, 'L');
  return `${sign}₹${groupIndian(String(rupees))}`;
}

/**
 * Parses what a person typed in a money box into paise, without floats.
 * Accepts "4,12,600", "412600", "499.5", "499.50". Returns null for anything
 * else (letters, more than two paise digits, negative numbers, empty).
 */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Paise → the editable text of a money box: 41260050 → "4,12,600.50". */
export function paiseToRupeesInput(amountPaise: number): string {
  assertPaise(amountPaise);
  const abs = Math.abs(amountPaise);
  const rupees = groupIndian(String(Math.floor(abs / 100)));
  const paise = abs % 100;
  return paise === 0 ? rupees : `${rupees}.${String(paise).padStart(2, '0')}`;
}

/** Sum a list of paise amounts, refusing anything that is not an integer. */
export function sumPaise(values: readonly number[]): number {
  return values.reduce((total, v) => {
    assertPaise(v, 'value');
    return total + v;
  }, 0);
}
