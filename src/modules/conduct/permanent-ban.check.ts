import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ReviewFlagService } from '../review-flag/review-flag.service';

/**
 * D11 (Master Guide rev 176): a permanent ban (forged ID, fraud, theft or
 * violence) blocks registering again with the same phone or the same ID. Only
 * keyed hashes are kept — never a phone or ID number in the clear.
 */
export const BAN_CATEGORIES = ['forged_id', 'fraud', 'theft', 'violence'] as const;
export type BanCategory = (typeof BAN_CATEGORIES)[number];

export const BANNED_MESSAGE = 'This person is permanently banned from Laboura and cannot register again';

/**
 * Reads PERMANENT_BAN_HASH_KEY. Throws if it is missing or shorter than 32
 * characters, so the server refuses to start without it (ConductService checks
 * it on start). Phones and ID numbers are few enough to guess, so their hashes
 * are keyed (HMAC-SHA256): a copy of the table alone reveals nothing.
 */
/** The placeholder in .env.example (refused in production). */
export const EXAMPLE_BAN_HASH_KEY = 'dev_permanent_ban_hash_key_change_in_production';

export function getBanHashKey(): string {
  const secret = process.env.PERMANENT_BAN_HASH_KEY?.trim();
  if (!secret) {
    throw new Error('PERMANENT_BAN_HASH_KEY environment variable is missing or empty. Server cannot start without a secure secret.');
  }
  if (secret.length < 32) {
    throw new Error(`PERMANENT_BAN_HASH_KEY must be at least 32 characters long (received ${secret.length} characters).`);
  }
  // The example value from .env.example is public: never in production.
  if (process.env.NODE_ENV === 'production' && secret === EXAMPLE_BAN_HASH_KEY) {
    throw new Error('PERMANENT_BAN_HASH_KEY is still the example value from .env.example. Set a new random secret.');
  }
  return secret;
}

const sha = (value: string) => createHmac('sha256', getBanHashKey()).update(value, 'utf8').digest('hex');

/** The last 10 digits of an Indian mobile, hashed. */
export function phoneHash(phone: string): string {
  return sha(`phone:${phone.replace(/\D/g, '').slice(-10)}`);
}

/** Aadhaar QR: last 4 + date of birth + name on the card (the duplicate-person rule), hashed. */
export function aadhaarFingerprint(last4: string, dateOfBirth: string, nameOnId: string): string {
  return sha(`aadhaar:${last4}:${dateOfBirth}:${nameOnId.trim().toLowerCase().replace(/\s+/g, ' ')}`);
}

/** Another ID (PAN, driving licence, voter ID): type + last 4 + name, hashed. */
export function otherIdFingerprint(idType: string, last4: string, name: string): string {
  return sha(`${idType}:${last4.toUpperCase()}:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`);
}

/** A business's own registration number (GSTIN or PAN), hashed. */
export function businessIdFingerprint(kind: 'gstin' | 'pan', value: string): string {
  return sha(`${kind}:${value.trim().toUpperCase()}`);
}

type Client = PrismaService | Prisma.TransactionClient;

export async function findBan(prisma: Client, input: { phone?: string | null; idFingerprints?: string[] }) {
  const or: Prisma.PermanentBanWhereInput[] = [];
  if (input.phone) or.push({ phoneHash: phoneHash(input.phone) });
  const ids = (input.idFingerprints ?? []).filter(Boolean);
  if (ids.length) or.push({ idFingerprints: { hasSome: ids } });
  if (!or.length) return null;
  // A lifted ban (M7, rev 178) no longer blocks anyone.
  return prisma.permanentBan.findFirst({ where: { liftedAt: null, OR: or }, select: { id: true, subjectType: true, category: true } });
}

/** Refuses a registration (or an ID check) that matches a permanent ban. */
export async function assertNotBanned(prisma: Client, input: { phone?: string | null; idFingerprints?: string[] }): Promise<void> {
  if (!(prisma as { permanentBan?: unknown }).permanentBan) return; // unit-test doubles without the table
  const ban = await findBan(prisma, input);
  if (ban) throw new ForbiddenException(BANNED_MESSAGE);
}

/** H2 (rev 181): what the person sees while a possible match with a banned person is checked — never the word "ban". */
export const UNDER_REVIEW_MESSAGE = 'Your details are being checked by our team. We will call you soon.';
export const POSSIBLE_BAN_FLAG = 'possible_banned_person';

/**
 * H2: the live ban, if any, whose other-ID fingerprints include this one — unless a Manager or the CEO
 * already decided this profile is "not the same person" as that ban.
 */
export async function otherIdBanMatch(prisma: Client, subject: { type: string; id: string }, fingerprint: string) {
  if (!(prisma as { permanentBan?: unknown }).permanentBan) return null; // unit-test doubles without the table
  // Every live ban with this fingerprint (Fable final check): one already decided "not the same" must
  // not hide another ban on the same ID.
  const bans = await prisma.permanentBan.findMany({ where: { liftedAt: null, idFingerprints: { hasSome: [fingerprint] } }, select: { id: true, subjectCode: true }, orderBy: { createdAt: 'asc' } });
  if (!bans.length) return null;
  const decided = await prisma.reviewFlag.findMany({ where: { kind: POSSIBLE_BAN_FLAG, subjectType: subject.type, subjectId: subject.id, status: { not: 'open' } }, select: { details: true } });
  const notSame = new Set(
    decided
      .map((f) => (f.details ?? {}) as { banId?: string; decision?: string })
      .filter((d) => d.decision === 'not_same' && d.banId)
      .map((d) => d.banId as string),
  );
  return bans.find((ban) => !notSame.has(ban.id)) ?? null;
}

/** H2: an open "possibly the same person as a banned person" item for this profile. */
export async function openBanReview(prisma: Client, subjectType: string, subjectId: string) {
  if (typeof (prisma as { reviewFlag?: { findFirst?: unknown } }).reviewFlag?.findFirst !== 'function') return null; // unit-test doubles
  return prisma.reviewFlag.findFirst({ where: { kind: POSSIBLE_BAN_FLAG, subjectType, subjectId, status: 'open' }, select: { id: true, raisedAt: true } });
}

/** H2: the ID check and the ₹499 wait while such an item is open (a neutral "under review" message, code UNDER_REVIEW). */
export async function assertNoOpenBanReview(prisma: Client, subjectType: string, subjectId: string): Promise<void> {
  if (await openBanReview(prisma, subjectType, subjectId)) {
    throw new ConflictException({ statusCode: 409, code: 'UNDER_REVIEW', message: UNDER_REVIEW_MESSAGE });
  }
}

/**
 * H2: raises the "possibly the same person as a banned person" item for a profile — at most one open
 * per profile (Fable final check): the check and the insert run in one transaction under a lock for
 * that profile, so two ID checks at the same moment never raise two items. Null when one is already open.
 */
export async function raisePossibleBanReview(
  prisma: PrismaService,
  flags: Pick<ReviewFlagService, 'raise' | 'refreshBell'> | undefined,
  input: { subjectType: string; subjectId: string; details: Record<string, unknown> },
): Promise<{ id: string } | null> {
  if (!flags) return null;
  const raise = async (tx: Client) => {
    if (await openBanReview(tx, input.subjectType, input.subjectId)) return null;
    const params = { kind: 'possible_banned_person' as const, subjectType: input.subjectType, subjectId: input.subjectId, owner: { role: 'manager' as const }, details: input.details };
    return tx === prisma ? flags.raise(params) : flags.raise(params, { tx: tx as Prisma.TransactionClient });
  };
  if (typeof (prisma as { $transaction?: unknown }).$transaction !== 'function') return raise(prisma); // unit-test doubles
  const flag = await prisma.$transaction(async (tx) => {
    if (tx.$executeRaw) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`possible-ban:${input.subjectType}:${input.subjectId}`}))`);
    return raise(tx);
  });
  if (flag) await flags.refreshBell(flag.id);
  return flag;
}
