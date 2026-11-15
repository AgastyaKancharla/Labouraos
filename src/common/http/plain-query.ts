import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Security IN-2: a query string must never reach Prisma as an object.
 * With an extended query parser `?status[not]=x` becomes `{ status: { not: 'x' } }`,
 * and `where.status = query.status` turns it into a Prisma operator.
 *
 * - The API's Express app uses the `simple` query parser (no nested objects;
 *   case-sensitive-routing.ts sets it explicitly).
 * - This global guard refuses (400) any query value that is an object, or an
 *   array holding anything but text, whatever parser is in use.
 * - Filters copied into a Prisma `where` go through `queryText`, which accepts
 *   one piece of text only.
 */
export function assertPlainQuery(query: unknown): void {
  if (!query || typeof query !== 'object') return;
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || typeof value === 'string') continue;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) continue;
    throw new BadRequestException(`Query parameter "${key}" must be plain text`);
  }
}

@Injectable()
export class PlainQueryGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    assertPlainQuery(context.switchToHttp().getRequest<{ query?: unknown }>().query);
    return true;
  }
}

/** One piece of text from the query string for a Prisma filter; anything else is 400. */
export function queryText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException(`Query parameter "${name}" must be a single value`);
  return value;
}
