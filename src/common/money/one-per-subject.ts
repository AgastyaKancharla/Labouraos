import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUniqueViolation } from './utr-registry';

/**
 * H2 (security check, 12 Nov): refunds, referral payouts and joining rewards
 * were created by "look for one, then create", so two requests at the same
 * moment (a double tap, a retry, two job runs) both passed the look and both
 * created a row. Every such create now runs inside a transaction that first
 * takes a Postgres advisory lock on the subject and looks again, and the
 * database itself refuses a second live row (partial unique indexes, migration
 * 20261119200000).
 */

/**
 * Statuses of a refund or payout that still counts: everything except turned
 * down (rejected) or cancelled. A payout the bank refused (failed) is retried,
 * never created again, so it still counts.
 */
export const LIVE_PAYOUT_STATUSES = ['pending', 'approved', 'processing', 'completed', 'succeeded', 'failed'] as const;

type Locker = { $executeRaw?: (query: Prisma.Sql) => Promise<unknown> };

/**
 * Takes a transaction-scoped advisory lock on `key` (released at commit or
 * rollback), so only one request at a time decides for that subject. Only a
 * Jest test double without raw SQL may skip it; anywhere else a missing
 * `$executeRaw` is a fault and fails loudly.
 */
export async function lockSubject(tx: unknown, key: string): Promise<void> {
  const db = tx as Locker;
  if (typeof db.$executeRaw !== 'function') {
    if (process.env.NODE_ENV === 'test') return;
    throw new Error('lockSubject needs a Prisma transaction client');
  }
  await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

/** The 409 answer when a second refund or payout for the same subject is asked for. */
export function alreadyExists(
  what: string,
  existing: { id: string; code: string; status?: string } | null,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'already_exists',
    message: existing
      ? `${what} already exists: ${existing.code}${existing.status ? ` (${existing.status})` : ''}. Nothing new was created.`
      : `${what} already exists. Nothing new was created.`,
    paymentId: existing?.id ?? null,
    paymentCode: existing?.code ?? null,
  });
}

/** True when the database refused a second live row (one of the partial unique indexes). */
export function isDuplicatePayout(error: unknown): boolean {
  return isUniqueViolation(error);
}
