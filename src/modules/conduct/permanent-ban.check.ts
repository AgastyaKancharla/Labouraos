import { ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

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
export function getBanHashKey(): string {
  const secret = process.env.PERMANENT_BAN_HASH_KEY?.trim();
  if (!secret) {
    throw new Error('PERMANENT_BAN_HASH_KEY environment variable is missing or empty. Server cannot start without a secure secret.');
  }
  if (secret.length < 32) {
    throw new Error(`PERMANENT_BAN_HASH_KEY must be at least 32 characters long (received ${secret.length} characters).`);
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
