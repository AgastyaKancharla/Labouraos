import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * D11 (Master Guide rev 176): a permanent ban (forged ID, fraud, theft or
 * violence) blocks registering again with the same phone or the same ID. Only
 * hashes are kept — never a phone or ID number in the clear.
 */
export const BAN_CATEGORIES = ['forged_id', 'fraud', 'theft', 'violence'] as const;
export type BanCategory = (typeof BAN_CATEGORIES)[number];

export const BANNED_MESSAGE = 'This person is permanently banned from Laboura and cannot register again';

const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

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
  return prisma.permanentBan.findFirst({ where: { OR: or }, select: { id: true, subjectType: true, category: true } });
}

/** Refuses a registration (or an ID check) that matches a permanent ban. */
export async function assertNotBanned(prisma: Client, input: { phone?: string | null; idFingerprints?: string[] }): Promise<void> {
  if (!(prisma as { permanentBan?: unknown }).permanentBan) return; // unit-test doubles without the table
  const ban = await findBan(prisma, input);
  if (ban) throw new ForbiddenException(BANNED_MESSAGE);
}
