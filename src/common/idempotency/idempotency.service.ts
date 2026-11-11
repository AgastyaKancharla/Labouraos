import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Keys are what the field app's offline queue sends: its random item id. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
/** A queued item can wait on a phone for days without signal. */
export const IDEMPOTENCY_KEEP_DAYS = 7;
/** A first try still "processing" after this long crashed; a repeat may take over. */
export const IDEMPOTENCY_STALE_MS = 2 * 60 * 1000;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;

export type BeginResult =
  | { kind: 'new'; id: string }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'busy' }
  | { kind: 'mismatch' };

/**
 * Remembers the answer to every write sent with an Idempotency-Key, per staff
 * member, so the offline queue's retries never save a visit or photo twice
 * (AGENTS.md §2.7: a repeat must be a no-op).
 */
@Injectable()
export class IdempotencyService {
  private lastCleanup = 0;

  constructor(private readonly prisma: PrismaService) {}

  async begin(staffId: string, key: string, method: string, path: string, now = new Date()): Promise<BeginResult> {
    await this.cleanupIfDue(now);
    try {
      const row = await this.prisma.idempotencyRecord.create({ data: { staffId, key, method, path, createdAt: now } });
      return { kind: 'new', id: row.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { staffId_key: { staffId, key } } });
    if (!existing) return this.begin(staffId, key, method, path, now);
    if (existing.method !== method || existing.path !== path) return { kind: 'mismatch' };
    if (existing.state === 'done') {
      return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody ?? undefined };
    }
    if (now.getTime() - existing.createdAt.getTime() > IDEMPOTENCY_STALE_MS) {
      const taken = await this.prisma.idempotencyRecord.updateMany({
        where: { id: existing.id, state: 'processing', createdAt: existing.createdAt },
        data: { createdAt: now },
      });
      if (taken.count === 1) return { kind: 'new', id: existing.id };
    }
    return { kind: 'busy' };
  }

  async complete(id: string, status: number, body: unknown, now = new Date()): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id },
      data: {
        state: 'done',
        responseStatus: status,
        responseBody: body === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue),
        completedAt: now,
      },
    });
  }

  /** The first try failed: forget it so a retry runs again. */
  async abandon(id: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({ where: { id, state: 'processing' } });
  }

  private async cleanupIfDue(now: Date): Promise<void> {
    if (now.getTime() - this.lastCleanup < CLEANUP_EVERY_MS) return;
    this.lastCleanup = now.getTime();
    const cutoff = new Date(now.getTime() - IDEMPOTENCY_KEEP_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }
}
