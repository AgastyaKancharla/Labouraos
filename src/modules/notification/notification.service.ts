import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveEventsService } from '../../common/live/live-events.service';
import { getCalendarPartsInTimezone, localCalendarToUtc } from '../../common/time/period-boundary';
import {
  BELL_LATEST_LIMIT,
  INFORMATIONAL_KINDS,
  NOTIFICATION_KINDS,
  NotificationKind,
} from './notification.constants';
import { NotificationClock } from './notification-clock';

/** One notification someone should have open. */
export interface NotificationDraft {
  recipientStaffId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  subjectType: string;
  subjectId: string;
  /**
   * Informational notifications are sent once per recipient and subject: once
   * cleared (seen), a later sync does not bring them back.
   */
  once?: boolean;
}

/** Who cleared a notification and why. */
export interface ClearInfo {
  byStaffId?: string | null;
  reason: string;
}

export interface NotificationListQuery {
  status?: string;
  kind?: string;
  limit?: string;
  before?: string;
}

const STAFF_BRIEF = { select: { id: true, code: true, name: true, role: true } } as const;

type WithClearer = Notification & {
  clearedBy: { id: string; code: string; name: string; role: string } | null;
};

export function openKeyOf(draft: {
  recipientStaffId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
}): string {
  return `${draft.recipientStaffId}|${draft.kind}|${draft.subjectType}|${draft.subjectId}`;
}

/**
 * The bells. Everything goes through a few primitives:
 * - `open` adds a notification unless the same one (recipient, kind, subject)
 *   is already open — the unique `openKey` makes duplicates impossible even
 *   when two requests race;
 * - `clear` closes the open ones for a subject and records who did the work;
 * - `syncSubject` / `reconcileKind` make the open set match what should be
 *   open, so a notification clears by itself when its work is done.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: NotificationClock,
    @Optional() private readonly live?: LiveEventsService,
  ) {}

  /**
   * Tells the recipients' open screens that their bell changed (live channel).
   * Only reaches screens served by this process; the bell's 30-second poll
   * covers changes made by the background worker.
   */
  private ping(recipients: Iterable<string>, kind: string, change: 'opened' | 'cleared'): void {
    if (!this.live) return;
    for (const staffId of new Set(recipients)) {
      try {
        this.live.publish(staffId, 'notification', { kind, change });
      } catch {
        // The live channel is a nicety; the poll still brings the change.
      }
    }
  }

  now(): Date {
    return this.clock.now();
  }

  async open(draft: NotificationDraft, now: Date = this.clock.now()): Promise<Notification | null> {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(draft.kind)) {
      throw new BadRequestException(`Unknown notification kind '${draft.kind}'`);
    }
    const openKey = openKeyOf(draft);
    const existing = await this.prisma.notification.findUnique({ where: { openKey } });
    if (existing) {
      return this.refresh(existing, draft);
    }
    if (draft.once) {
      const before = await this.prisma.notification.findFirst({
        where: {
          recipientStaffId: draft.recipientStaffId,
          kind: draft.kind,
          subjectType: draft.subjectType,
          subjectId: draft.subjectId,
        },
      });
      if (before) return null;
    }
    try {
      const created = await this.prisma.notification.create({
        data: {
          recipientStaffId: draft.recipientStaffId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body ?? null,
          link: draft.link ?? null,
          subjectType: draft.subjectType,
          subjectId: draft.subjectId,
          openKey,
          createdAt: now,
        },
      });
      this.ping([created.recipientStaffId], created.kind, 'opened');
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Someone else opened the same one a moment ago.
        return this.prisma.notification.findUnique({ where: { openKey } });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        // The recipient's account was removed while the bell was being worked out.
        return null;
      }
      throw error;
    }
  }

  /** Keeps an open notification's words current (e.g. "12 days left" → "11 days left"). */
  private async refresh(existing: Notification, draft: NotificationDraft): Promise<Notification> {
    const body = draft.body ?? null;
    const link = draft.link ?? null;
    if (existing.title === draft.title && existing.body === body && existing.link === link) {
      return existing;
    }
    return this.prisma.notification.update({
      where: { id: existing.id },
      data: { title: draft.title, body, link },
    });
  }

  /** Clears the open notifications for a subject (optionally one kind / one recipient). */
  async clear(
    where: { kind?: NotificationKind; subjectType: string; subjectId: string; recipientStaffId?: string },
    info: ClearInfo,
    now: Date = this.clock.now(),
  ): Promise<number> {
    const scope: Prisma.NotificationWhereInput = {
      clearedAt: null,
      subjectType: where.subjectType,
      subjectId: where.subjectId,
      ...(where.kind ? { kind: where.kind } : {}),
      ...(where.recipientStaffId ? { recipientStaffId: where.recipientStaffId } : {}),
    };
    const open = await this.prisma.notification.findMany({
      where: scope,
      select: { id: true, recipientStaffId: true, kind: true },
    });
    if (open.length === 0) return 0;
    const result = await this.prisma.notification.updateMany({
      where: { id: { in: open.map((row) => row.id) }, clearedAt: null },
      data: this.clearData(info, now),
    });
    for (const row of open) this.ping([row.recipientStaffId], row.kind, 'cleared');
    return result.count;
  }

  private clearData(info: ClearInfo, now: Date) {
    return {
      clearedAt: now,
      clearedByStaffId: info.byStaffId ?? null,
      clearedReason: info.reason,
      openKey: null,
    };
  }

  /**
   * Makes the open notifications of one kind about one subject exactly
   * `drafts`: opens the missing ones and clears the rest with `info`.
   */
  async syncSubject(
    kind: NotificationKind,
    subjectType: string,
    subjectId: string,
    drafts: NotificationDraft[],
    info: ClearInfo,
    now: Date = this.clock.now(),
  ): Promise<void> {
    const wanted = new Set(drafts.map((draft) => openKeyOf(draft)));
    const open = await this.prisma.notification.findMany({
      where: { kind, subjectType, subjectId, clearedAt: null },
      select: { id: true, openKey: true, recipientStaffId: true },
    });
    const stale = open.filter((row) => !row.openKey || !wanted.has(row.openKey));
    if (stale.length > 0) {
      await this.prisma.notification.updateMany({
        where: { id: { in: stale.map((row) => row.id) }, clearedAt: null },
        data: this.clearData(info, now),
      });
      this.ping(stale.map((row) => row.recipientStaffId), kind, 'cleared');
    }
    for (const draft of drafts) {
      await this.open(draft, now);
    }
  }

  /**
   * Makes every open notification of `kind` match `drafts` (the whole list
   * of what should be open now). Each one that should no longer be open is
   * cleared with what `clearInfo` says about it.
   */
  async reconcileKind(
    kind: NotificationKind,
    drafts: NotificationDraft[],
    clearInfo: (row: Notification) => ClearInfo | Promise<ClearInfo>,
    now: Date = this.clock.now(),
  ): Promise<{ opened: number; cleared: number }> {
    const wanted = new Map(drafts.map((draft) => [openKeyOf(draft), draft]));
    const open = await this.prisma.notification.findMany({ where: { kind, clearedAt: null } });
    let cleared = 0;
    const openKeys = new Set<string>();
    for (const row of open) {
      if (row.openKey && wanted.has(row.openKey)) {
        openKeys.add(row.openKey);
        await this.refresh(row, wanted.get(row.openKey)!);
        continue;
      }
      const info = await clearInfo(row);
      const done = await this.prisma.notification.updateMany({
        where: { id: row.id, clearedAt: null },
        data: this.clearData(info, now),
      });
      if (done.count > 0) this.ping([row.recipientStaffId], kind, 'cleared');
      cleared += done.count;
    }
    let opened = 0;
    for (const [key, draft] of wanted) {
      if (openKeys.has(key)) continue;
      const created = await this.open(draft, now);
      if (created) opened += 1;
    }
    return { opened, cleared };
  }

  // ------------------------------------------------------------------ reads

  /** The bell: open count, the latest 20 open, and what was done today. */
  async bell(staffId: string, now: Date = this.clock.now()) {
    const since = this.startOfIstDay(now);
    const [openCount, unseenCount, latest, doneToday] = await Promise.all([
      this.prisma.notification.count({ where: { recipientStaffId: staffId, clearedAt: null } }),
      this.prisma.notification.count({
        where: { recipientStaffId: staffId, clearedAt: null, seenAt: null },
      }),
      this.prisma.notification.findMany({
        where: { recipientStaffId: staffId, clearedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: BELL_LATEST_LIMIT,
        include: { clearedBy: STAFF_BRIEF },
      }),
      this.prisma.notification.findMany({
        where: { recipientStaffId: staffId, clearedAt: { gte: since } },
        orderBy: [{ clearedAt: 'desc' }, { id: 'asc' }],
        take: 50,
        include: { clearedBy: STAFF_BRIEF },
      }),
    ]);
    return {
      openCount,
      unseenCount,
      latest: latest.map((row) => this.view(row)),
      doneToday: doneToday.map((row) => this.view(row)),
      asOf: now.toISOString(),
    };
  }

  /** The Notifications page: everything for the caller, newest first, with filters. */
  async list(staffId: string, query: NotificationListQuery = {}, now: Date = this.clock.now()) {
    const status = query.status ?? 'all';
    if (!['open', 'cleared', 'all'].includes(status)) {
      throw new BadRequestException("status is 'open', 'cleared' or 'all'");
    }
    if (query.kind && !(NOTIFICATION_KINDS as readonly string[]).includes(query.kind)) {
      throw new BadRequestException(`Unknown notification kind '${query.kind}'`);
    }
    const limit = query.limit === undefined || query.limit === '' ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new BadRequestException('limit is a whole number from 1 to 200');
    }
    let before: Date | null = null;
    if (query.before) {
      before = new Date(query.before);
      if (Number.isNaN(before.getTime())) throw new BadRequestException('before is a date and time');
    }
    const where: Prisma.NotificationWhereInput = {
      recipientStaffId: staffId,
      ...(status === 'open' ? { clearedAt: null } : {}),
      ...(status === 'cleared' ? { clearedAt: { not: null } } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(before ? { createdAt: { lt: before } } : {}),
    };
    const [openCount, unseenCount, total, rows] = await Promise.all([
      this.prisma.notification.count({ where: { recipientStaffId: staffId, clearedAt: null } }),
      this.prisma.notification.count({
        where: { recipientStaffId: staffId, clearedAt: null, seenAt: null },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        include: { clearedBy: STAFF_BRIEF },
      }),
    ]);
    return {
      openCount,
      unseenCount,
      total,
      items: rows.map((row) => this.view(row)),
      asOf: now.toISOString(),
    };
  }

  /**
   * Marks the caller's notifications as seen: the given ids, or every open one.
   * Seen is not cleared — except for informational kinds, where reading is the work.
   */
  async markSeen(staffId: string, ids: string[] | undefined, now: Date = this.clock.now()) {
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) {
      throw new BadRequestException('ids is a list of notification ids');
    }
    const scope: Prisma.NotificationWhereInput = {
      recipientStaffId: staffId,
      ...(ids ? { id: { in: ids } } : { clearedAt: null }),
    };
    const seen = await this.prisma.notification.updateMany({
      where: { ...scope, seenAt: null },
      data: { seenAt: now },
    });
    const cleared = await this.prisma.notification.updateMany({
      where: { ...scope, clearedAt: null, kind: { in: [...INFORMATIONAL_KINDS] } },
      data: this.clearData({ byStaffId: staffId, reason: 'seen' }, now),
    });
    return { seen: seen.count, cleared: cleared.count };
  }

  async markOneSeen(staffId: string, id: string, now: Date = this.clock.now()) {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    // Someone else's notification is "not found", never "forbidden": its id says nothing.
    if (!row || row.recipientStaffId !== staffId) {
      throw new NotFoundException('Notification not found');
    }
    await this.markSeen(staffId, [id], now);
    const fresh = await this.prisma.notification.findUniqueOrThrow({
      where: { id },
      include: { clearedBy: STAFF_BRIEF },
    });
    return this.view(fresh);
  }

  private view(row: WithClearer) {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      status: row.clearedAt ? 'cleared' : 'open',
      seen: Boolean(row.seenAt),
      createdAt: row.createdAt.toISOString(),
      seenAt: row.seenAt?.toISOString() ?? null,
      clearedAt: row.clearedAt?.toISOString() ?? null,
      clearedReason: row.clearedReason,
      clearedBy: row.clearedBy
        ? { id: row.clearedBy.id, code: row.clearedBy.code, name: row.clearedBy.name, role: row.clearedBy.role }
        : null,
    };
  }

  private startOfIstDay(now: Date): Date {
    const parts = getCalendarPartsInTimezone(now);
    return localCalendarToUtc(parts.year, parts.month, parts.day, 0, 0);
  }
}
