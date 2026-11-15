/**
 * Checks shared by the forms. They mirror the server's checks so people see
 * mistakes before sending; the server still decides.
 */

/** Indian mobile: exactly 10 digits, starting 6–9 (+91 is fixed in the box). */
export function isMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

/**
 * Names and localities may not start with "=" (read like a spreadsheet: full-width
 * signs, spaces and zero-width characters count): in a spreadsheet it runs as a
 * formula (the server refuses it too: TEXT_STARTS_WITH_SYMBOL). A leading + - @ is
 * fine: the server's CSV files make those safe.
 */
export function startsWithSymbol(value: string): boolean {
  const lead = value.normalize('NFKC').replace(/^[\s\u200b-\u200f\u2028-\u202f\u205f-\u206f\ufeff\u00ad\u180e]+/u, '');
  return lead.startsWith('=');
}

export function isPincode(value: string): boolean {
  return /^[1-9]\d{5}$/.test(value.trim());
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** GSTIN: 15 characters, state code + PAN + entity + Z + check. */
export function isGstin(value: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.trim().toUpperCase());
}

/** Whole years between a YYYY-MM-DD birthday and today's IST date key. */
export function ageOn(dateOfBirth: string, todayKey: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** Monthly equivalent used for the legal-minimum warning (26 working days). */
export function monthlyPaise(paise: number, period: 'monthly' | 'daily'): number {
  return period === 'daily' ? paise * 26 : paise;
}
