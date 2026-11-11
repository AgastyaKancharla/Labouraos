import { BadRequestException } from '@nestjs/common';

/**
 * One stored format for every Indian mobile number (Master Guide, Forms:
 * "+91 fixed, exactly 10 digits"): `+91` followed by 10 digits that start
 * with 6, 7, 8 or 9, for example `+919876543210`.
 *
 * Every write and every lookup by phone goes through this file, so a number
 * typed as `9876543210`, `+91 98765 43210`, `919876543210` or `09876543210`
 * is the same person everywhere: duplicate checks, OTP, click-to-call,
 * search by last 4 digits and masking.
 */
export const INDIAN_MOBILE_MESSAGE = 'Enter a 10-digit mobile number';

const SEPARATORS = /[\s-]+/g;
const INDIAN_MOBILE = /^(?:\+91|91|0)?([6-9]\d{9})$/;

/** The canonical `+91XXXXXXXXXX` form, or null when the value is not an Indian mobile. */
export function parseIndianMobile(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const compact = String(value).replace(SEPARATORS, '');
  const match = INDIAN_MOBILE.exec(compact);
  return match ? `+91${match[1]}` : null;
}

export function isIndianMobile(value: unknown): boolean {
  return parseIndianMobile(value) !== null;
}

/**
 * The canonical form of a number someone typed. Anything else is refused
 * with a 400 that names the field.
 */
export function requireIndianMobile(value: unknown, field = 'phone'): string {
  const canonical = parseIndianMobile(value);
  if (!canonical) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: INDIAN_MOBILE_MESSAGE,
      field,
    });
  }
  return canonical;
}

/**
 * For optional number fields (WhatsApp numbers, extra contacts): undefined
 * stays undefined (field not sent), null or blank becomes null (cleared),
 * anything else must be a valid mobile.
 */
export function optionalIndianMobile(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return requireIndianMobile(value, field);
}

/**
 * For numbers that did not come from a form (stored rows, provider webhooks):
 * the canonical form when it parses, otherwise the trimmed value unchanged,
 * so a landline or an anonymised placeholder is never rejected or rewritten.
 */
export function normaliseIndianMobile(value: string): string;
export function normaliseIndianMobile(value: string | null | undefined): string | null;
export function normaliseIndianMobile(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return parseIndianMobile(value) ?? value.trim();
}

/** The 10 national digits (what the OTP hash uses), or the bare digits when it does not parse. The vendor gets vendorMobileNumber(). */
export function nationalMobileDigits(value: string): string {
  const canonical = parseIndianMobile(value);
  return canonical ? canonical.slice(3) : String(value ?? '').replace(/\D/g, '');
}

/**
 * The number as the SMS/OTP vendor (MSG91, API v5) expects it: country code
 * and the 10 digits, no plus and no spaces — `919876543210`. Anything that is
 * not an Indian mobile is refused, so a bad number never reaches the vendor.
 */
export function vendorMobileNumber(value: string): string {
  const canonical = parseIndianMobile(value);
  if (!canonical) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: INDIAN_MOBILE_MESSAGE,
      field: 'phone',
    });
  }
  return canonical.slice(1);
}

/** True when both values are the same Indian mobile, whatever spelling each uses. */
export function sameIndianMobile(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = parseIndianMobile(a);
  const right = parseIndianMobile(b);
  if (left && right) return left === right;
  return a.trim() === b.trim();
}

/**
 * Values to match in a `where: { phone: { in: ... } }` lookup: the canonical
 * form first, plus the older spellings of the same number. The migration
 * normalises every row it can; the extra spellings only find a row it had to
 * leave alone (two spellings of one number on two rows), so a duplicate check
 * still answers "Already registered — open it".
 */
export function mobileLookupValues(value: string): string[] {
  const canonical = parseIndianMobile(value);
  if (!canonical) {
    const trimmed = String(value ?? '').trim();
    return trimmed ? [trimmed] : [];
  }
  const ten = canonical.slice(3);
  return [canonical, ten, `91${ten}`, `0${ten}`];
}

/** Last 4 digits for masking and search, whatever the spelling. */
export function phoneLast4(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '').slice(-4);
}

/**
 * What a search box typed as a phone means. A full number (any accepted
 * spelling) matches exactly; 4 to 9 bare digits match the end of the number
 * ("last 4 digits"). Anything else is not a phone search.
 */
export function phoneSearchTerm(
  query: string,
): { kind: 'exact'; values: string[] } | { kind: 'suffix'; digits: string } | null {
  const q = String(query ?? '').trim();
  if (!q) return null;
  if (isIndianMobile(q)) return { kind: 'exact', values: mobileLookupValues(q) };
  const compact = q.replace(SEPARATORS, '');
  if (/^\d{4,9}$/.test(compact)) return { kind: 'suffix', digits: compact };
  return null;
}

/**
 * Digits for a "phone contains" search box: a full number in any spelling
 * becomes its 10 national digits (so "09876543210" finds +919876543210);
 * anything else keeps its bare digits (last 4, partial numbers).
 */
export function phoneSearchDigits(query: string): string {
  const canonical = parseIndianMobile(query);
  return canonical ? canonical.slice(3) : String(query ?? '').replace(/\D/g, '');
}
