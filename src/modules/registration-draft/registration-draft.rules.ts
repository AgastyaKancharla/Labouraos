import { Prisma } from '@prisma/client';
import { normaliseIndianMobile, parseIndianMobile } from '../../common/phone/indian-mobile';

/**
 * Unfinished registrations (Master Guide rev 204, 21 Nov) — the pure rules,
 * shared by the drafts service and the three create routes.
 */
export const DRAFT_KINDS = ['job_seeker', 'business', 'referral'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** Drafts (and an OTP check kept on one) last this long; the nightly cleanup deletes older ones. */
export const DRAFT_KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The biggest form saved (a whole registration form is a few kB). */
export const MAX_DRAFT_BYTES = 64 * 1024;

/**
 * What the create routes accept as `otpRequestId` for a resumed draft whose
 * mobile was checked by OTP: "draft:<kind>". It works only for the agent who
 * owns the draft, only for that number, and only once (the draft goes).
 */
export const DRAFT_OTP_PREFIX = 'draft:';

export function isDraftKind(value: unknown): value is DraftKind {
  return typeof value === 'string' && (DRAFT_KINDS as readonly string[]).includes(value);
}

export function draftOtpRequestId(kind: DraftKind): string {
  return `${DRAFT_OTP_PREFIX}${kind}`;
}

export function draftExpiryCutoff(now: Date): Date {
  return new Date(now.getTime() - DRAFT_KEEP_DAYS * DAY_MS);
}

/** Field names that hold an OTP code or request id (never kept), as the console strips them. */
const OTP_FIELD = /^otp|Otp|OTP|_otp|^code$|^verificationCode$|^requestId$/;
/** Pictures (an ID card or a selfie) are never kept in a draft. */
const IMAGE_FIELD = /photo|selfie|image|picture|idCard|aadhaar/i;

/**
 * Only what the form holds: no OTP codes or request ids, no pictures (no
 * `data:` URLs, no fields named for photos or ID cards), plain JSON only.
 */
export function cleanDraftData(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (depth > 8) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value as Prisma.InputJsonValue;
  if (typeof value === 'string') return /^data:/i.test(value.trim()) || value.length > 4000 ? null : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => cleanDraftData(item, depth + 1)) as Prisma.InputJsonValue;
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (OTP_FIELD.test(key) && (key !== 'code' || depth === 0)) continue;
      if (IMAGE_FIELD.test(key)) continue;
      out[key] = cleanDraftData(item, depth + 1);
    }
    return out as Prisma.InputJsonValue;
  }
  return null;
}

/** The canonical mobile, or null when the text is not a whole Indian mobile number. */
export function draftMobile(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? parseIndianMobile(value) : null;
}

/** Same number? (both canonical or typed any way). */
export function sameMobile(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normaliseIndianMobile(a) === normaliseIndianMobile(b);
}

/** Is the OTP check kept on a draft still good for this number? */
export function draftCheckHolds(
  draft: { verifiedPhone: string | null; verifiedAt: Date | null } | null,
  phone: string,
  now: Date,
): boolean {
  if (!draft || !draft.verifiedPhone || !draft.verifiedAt) return false;
  if (draft.verifiedAt < draftExpiryCutoff(now)) return false;
  return sameMobile(draft.verifiedPhone, phone);
}
