import { HttpException, HttpStatus } from '@nestjs/common';
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

/**
 * Records one full-number search (only the last 4 digits are kept) and refuses
 * it with 429 when the staff member already ran FULL_NUMBER_SEARCHES_PER_HOUR
 * in the last hour.
 */
export async function recordFullNumberSearch(
  prisma: PrismaService,
  audit: AuditService,
  actor: { id: string; role?: string },
  screen: string,
  phone: string,
  now: Date = new Date(),
): Promise<void> {
  const recent = await prisma.auditLog.count({
    where: { actorId: actor.id, action: FULL_NUMBER_SEARCH_ACTION, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
  });
  if (recent >= FULL_NUMBER_SEARCHES_PER_HOUR) {
    throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message: FULL_NUMBER_SEARCH_LIMIT_MESSAGE }, HttpStatus.TOO_MANY_REQUESTS);
  }
  await audit.log({
    actorId: actor.id,
    action: FULL_NUMBER_SEARCH_ACTION,
    entityType: 'search',
    entityCode: screen,
    after: { phoneLast4: phoneLast4(phone), screen, role: actor.role ?? null },
    changedFields: [],
    city: 'Bengaluru',
  });
}
