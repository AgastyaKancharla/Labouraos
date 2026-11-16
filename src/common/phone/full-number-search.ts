import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { phoneLast4 } from './indian-mobile';

/**
 * Security AC-2: a staff search by a full mobile number answers "is this
 * number one of ours, and who is it" — so each one is audited and limited per
 * staff member. The limit is counted from the audit rows themselves (the same
 * on every app instance, survives restarts, no Redis connection).
 */
export const FULL_NUMBER_SEARCH_ACTION = 'search.full_number';
/** Full-number searches one staff member may run in a rolling hour. */
export const FULL_NUMBER_SEARCHES_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

export const FULL_NUMBER_SEARCH_LIMIT_MESSAGE =
  'Too many searches by full mobile number in the last hour. Search by name, ID or the last 4 digits, or try again later.';

function tooMany(): HttpException {
  return new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message: FULL_NUMBER_SEARCH_LIMIT_MESSAGE }, HttpStatus.TOO_MANY_REQUESTS);
}

async function recentCount(client: Prisma.TransactionClient | PrismaService, actorId: string, now: Date): Promise<number> {
  return client.auditLog.count({
    where: { actorId, action: FULL_NUMBER_SEARCH_ACTION, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
  });
}

/**
 * Security L1: refuses with 429 when the staff member has used up the hour's
 * full-number lookups, without recording one. Called before a lookup whose
 * answer is only counted when it finds a record (the create routes), so that at
 * the limit a number that is ours and one that is not get the same answer.
 */
export async function assertFullNumberSearchAllowed(prisma: PrismaService, actorId: string, now: Date = new Date()): Promise<void> {
  if ((await recentCount(prisma, actorId, now)) >= FULL_NUMBER_SEARCHES_PER_HOUR) throw tooMany();
}

/**
 * Records one full-number search (only the last 4 digits are kept) and refuses
 * it with 429 when the staff member already ran FULL_NUMBER_SEARCHES_PER_HOUR
 * in the last hour. Security L2: the count and the insert run in one
 * transaction under a per-staff advisory lock, so parallel requests cannot all
 * read 29 and all pass.
 */
export async function recordFullNumberSearch(
  prisma: PrismaService,
  audit: AuditService,
  actor: { id: string; role?: string },
  screen: string,
  phone: string,
  now: Date = new Date(),
): Promise<void> {
  // The audit code and device read through the pool: worked out before the transaction, so
  // requests waiting on the lock never hold a connection while needing another.
  const prepared = await audit.prepare();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`full-number-search:${actor.id}`}))`);
    if ((await recentCount(tx, actor.id, now)) >= FULL_NUMBER_SEARCHES_PER_HOUR) throw tooMany();
    await audit.log(
      {
        actorId: actor.id,
        action: FULL_NUMBER_SEARCH_ACTION,
        entityType: 'search',
        entityCode: screen,
        after: { phoneLast4: phoneLast4(phone), screen, role: actor.role ?? null },
        changedFields: [],
        city: 'Bengaluru',
      },
      tx,
      prepared,
    );
  });
}
