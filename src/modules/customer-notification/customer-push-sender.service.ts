import { Inject, Injectable, Logger } from '@nestjs/common';
import { CustomerInboxMessage } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canAdvanceMessageStatus } from '../message/message-status';
import {
  ANDROID_CHANNEL_BY_CATEGORY,
  CustomerNotificationCategory,
  PUSH_STATUS,
  pushableDevices,
} from './customer-notification.constants';
import { CustomerNotificationClock } from './customer-notification.clock';
import { CustomerNotificationSettingsService } from './customer-notification-settings.service';
import { CUSTOMER_PUSH_PROVIDER, CustomerPushProvider, PushMessage } from './push-provider';
import { istDayStart, isQuietTime, quietEndsAt } from './quiet-hours';

/** A ticket to check later against Expo's receipts. Kept in the BullMQ job, not the database. */
export interface PushTicketRef {
  ticketId: string;
  token: string;
  inboxId: string;
  messageLogId: string | null;
}

export interface SendDueResult {
  sent: number;
  failed: number;
  heldQuietHours: number;
  heldDailyCap: number;
  off: number;
  noDevice: number;
  retried: number;
  deadTokensRemoved: number;
  tickets: PushTicketRef[];
}

/** Pushes that keep failing to reach Expo stop being retried after this. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const DUE_BATCH = 500;

type DueRow = Pick<
  CustomerInboxMessage,
  'id' | 'accountId' | 'kind' | 'category' | 'priority' | 'title' | 'body' | 'deepLink' | 'data' | 'profileId' | 'pushStatus' | 'messageLogId' | 'createdAt'
>;

function isSelfAction(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && (data as Record<string, unknown>).trigger === 'self');
}

/**
 * The background worker's half (src/jobs/customer-push.job.ts): every minute,
 * and whenever a notification is queued, it sends the pushes that are due
 * through the push provider (Expo; mock on the test setup), applying quiet
 * hours (9 PM to 9 AM IST, non-urgent held until 9 AM) and the cap (3
 * non-urgent pushes a day per account; over the cap the message stays in the
 * inbox without a push). Tokens Expo reports as DeviceNotRegistered (the app
 * was uninstalled) are removed at once and after the receipt check.
 */
@Injectable()
export class CustomerPushSenderService {
  private readonly logger = new Logger(CustomerPushSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CustomerNotificationSettingsService,
    private readonly clock: CustomerNotificationClock,
    @Inject(CUSTOMER_PUSH_PROVIDER) private readonly provider: CustomerPushProvider,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  async sendDue(now: Date = this.clock.now()): Promise<SendDueResult> {
    const result: SendDueResult = {
      sent: 0, failed: 0, heldQuietHours: 0, heldDailyCap: 0, off: 0, noDevice: 0, retried: 0, deadTokensRemoved: 0, tickets: [],
    };
    const rows: DueRow[] = await this.prisma.customerInboxMessage.findMany({
      where: {
        pushStatus: { in: [PUSH_STATUS.queued, PUSH_STATUS.heldQuietHours] },
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: DUE_BATCH,
      select: {
        id: true, accountId: true, kind: true, category: true, priority: true, title: true, body: true,
        deepLink: true, data: true, profileId: true, pushStatus: true, messageLogId: true, createdAt: true,
      },
    });
    if (rows.length === 0) return result;

    const byAccount = new Map<string, DueRow[]>();
    for (const row of rows) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);

    const outgoing: { row: DueRow; message: PushMessage; token: string }[] = [];
    const claimedRows: DueRow[] = [];
    for (const [accountId, accountRows] of byAccount) {
      const settings = await this.settings.getOrCreate(accountId);
      let sentToday = await this.nonUrgentSentToday(accountId, now);
      const tokens = (
        await this.prisma.customerDevice.findMany({ where: pushableDevices(accountId), select: { pushToken: true } })
      )
        .map((d) => d.pushToken)
        .filter((t): t is string => Boolean(t));
      for (const row of accountRows) {
        const nonUrgent = row.priority !== 'urgent' && !isSelfAction(row.data);
        if (nonUrgent && isQuietTime(now, settings.quietStart, settings.quietEnd)) {
          await this.prisma.customerInboxMessage.updateMany({
            where: { id: row.id, pushStatus: row.pushStatus },
            data: { pushStatus: PUSH_STATUS.heldQuietHours, scheduledFor: quietEndsAt(now, settings.quietEnd) },
          });
          result.heldQuietHours += 1;
          continue;
        }
        // A switch turned off after the message was queued: inbox only.
        const switchOn: Record<CustomerNotificationCategory, boolean> = {
          service: settings.service,
          job_updates: settings.jobUpdates,
          promotions: settings.promotions,
        };
        if (!switchOn[row.category as CustomerNotificationCategory]) {
          await this.inboxOnly(row, PUSH_STATUS.off, now);
          result.off += 1;
          continue;
        }
        if (tokens.length === 0) {
          await this.inboxOnly(row, PUSH_STATUS.none, now);
          result.noDevice += 1;
          continue;
        }
        if (nonUrgent && sentToday >= settings.dailyCap) {
          await this.inboxOnly(row, PUSH_STATUS.heldDailyCap, now);
          result.heldDailyCap += 1;
          continue;
        }
        const claimed = await this.prisma.customerInboxMessage.updateMany({
          where: { id: row.id, pushStatus: row.pushStatus },
          data: { pushStatus: PUSH_STATUS.sent, pushedAt: now, scheduledFor: null },
        });
        if (claimed.count !== 1) continue; // another round took it
        if (nonUrgent) sentToday += 1;
        claimedRows.push(row);
        for (const token of tokens) {
          outgoing.push({ row, token, message: this.toMessage(row, token) });
        }
      }
    }
    if (outgoing.length === 0) return result;

    let tickets;
    try {
      tickets = await this.provider.send(outgoing.map((o) => o.message));
    } catch (error) {
      this.logger.warn(`Push service unavailable, will retry: ${(error as Error).message}`);
      for (const row of claimedRows) {
        if (now.getTime() - row.createdAt.getTime() > GIVE_UP_AFTER_MS) {
          await this.markFailed(row, now);
          result.failed += 1;
        } else {
          await this.prisma.customerInboxMessage.updateMany({
            where: { id: row.id, pushStatus: PUSH_STATUS.sent },
            data: { pushStatus: PUSH_STATUS.queued, pushedAt: null, scheduledFor: new Date(now.getTime() + RETRY_AFTER_MS) },
          });
          result.retried += 1;
        }
      }
      return result;
    }

    const okTicketsByRow = new Map<string, string[]>();
    for (let i = 0; i < outgoing.length; i += 1) {
      const ticket = tickets[i];
      const { row, token } = outgoing[i];
      if (ticket?.status === 'ok') {
        okTicketsByRow.set(row.id, [...(okTicketsByRow.get(row.id) ?? []), ticket.id]);
        result.tickets.push({ ticketId: ticket.id, token, inboxId: row.id, messageLogId: row.messageLogId });
      } else if (ticket?.error === 'DeviceNotRegistered') {
        result.deadTokensRemoved += await this.removeToken(token, now);
      }
    }
    for (const row of claimedRows) {
      const ok = okTicketsByRow.get(row.id) ?? [];
      if (ok.length > 0) {
        if (row.messageLogId) {
          await this.prisma.messageLog.updateMany({
            where: { id: row.messageLogId, status: 'queued' },
            data: { status: 'sent', sentAt: now, providerMessageId: ok[0] },
          });
        }
        result.sent += 1;
      } else {
        await this.markFailed(row, now);
        result.failed += 1;
      }
    }
    return result;
  }

  /**
   * Expo's receipts, about 15 minutes after sending: removes tokens of phones
   * that uninstalled the app (DeviceNotRegistered) and updates the log.
   */
  async checkReceipts(refs: PushTicketRef[], now: Date = this.clock.now()): Promise<{ ok: number; errors: number; deadTokensRemoved: number }> {
    const out = { ok: 0, errors: 0, deadTokensRemoved: 0 };
    if (refs.length === 0) return out;
    const receipts = await this.provider.getReceipts(refs.map((r) => r.ticketId));
    const logOutcome = new Map<string, { ok: number; err: number }>();
    for (const ref of refs) {
      const receipt = receipts[ref.ticketId];
      if (!receipt) continue;
      const tally = logOutcome.get(ref.messageLogId ?? '') ?? { ok: 0, err: 0 };
      if (receipt.status === 'ok') {
        out.ok += 1;
        tally.ok += 1;
      } else {
        out.errors += 1;
        tally.err += 1;
        if (receipt.error === 'DeviceNotRegistered') out.deadTokensRemoved += await this.removeToken(ref.token, now);
        else this.logger.warn(`Push receipt error ${receipt.error ?? ''}: ${receipt.message}`);
      }
      logOutcome.set(ref.messageLogId ?? '', tally);
    }
    for (const [messageLogId, tally] of logOutcome) {
      if (!messageLogId) continue;
      const log = await this.prisma.messageLog.findUnique({ where: { id: messageLogId }, select: { status: true } });
      if (!log) continue;
      const next = tally.ok > 0 ? 'delivered' : 'failed';
      if (canAdvanceMessageStatus(log.status, next)) {
        await this.prisma.messageLog.update({
          where: { id: messageLogId },
          data: next === 'delivered' ? { status: next, deliveredAt: now } : { status: next, failedAt: now },
        });
      }
    }
    return out;
  }

  /** Removes a dead push token wherever it is (one token belongs to one phone). */
  async removeToken(token: string, now: Date = this.clock.now()): Promise<number> {
    const removed = await this.prisma.customerDevice.updateMany({
      where: { pushToken: token },
      data: { pushToken: null, pushTokenUpdatedAt: now },
    });
    return removed.count;
  }

  private async nonUrgentSentToday(accountId: string, now: Date): Promise<number> {
    const rows = await this.prisma.customerInboxMessage.findMany({
      where: { accountId, pushStatus: PUSH_STATUS.sent, priority: { not: 'urgent' }, pushedAt: { gte: istDayStart(now) } },
      select: { data: true },
    });
    return rows.filter((r) => !isSelfAction(r.data)).length;
  }

  private toMessage(row: DueRow, token: string): PushMessage {
    const extra = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
    return {
      to: token,
      title: row.title,
      body: row.body,
      data: { ...extra, messageId: row.id, kind: row.kind, category: row.category, deepLink: row.deepLink ?? '/inbox', profileId: row.profileId },
      channelId: ANDROID_CHANNEL_BY_CATEGORY[row.category as CustomerNotificationCategory] ?? 'service',
      priority: row.priority === 'urgent' ? 'high' : 'normal',
      sound: row.category === 'promotions' ? null : 'default',
    };
  }

  /** The message stays in the inbox; no push is sent for it. */
  private async inboxOnly(row: DueRow, pushStatus: string, now: Date): Promise<void> {
    await this.prisma.customerInboxMessage.updateMany({
      where: { id: row.id, pushStatus: row.pushStatus },
      data: { pushStatus, scheduledFor: null },
    });
    if (row.messageLogId) {
      await this.prisma.messageLog.updateMany({
        where: { id: row.messageLogId, status: 'queued' },
        data: { channel: 'in_app', status: 'sent', sentAt: now },
      });
    }
  }

  private async markFailed(row: DueRow, now: Date): Promise<void> {
    await this.prisma.customerInboxMessage.updateMany({
      where: { id: row.id },
      data: { pushStatus: PUSH_STATUS.failed, scheduledFor: null },
    });
    if (row.messageLogId) {
      await this.prisma.messageLog.updateMany({
        where: { id: row.messageLogId, status: { in: ['queued', 'sent'] } },
        data: { status: 'failed', failedAt: now },
      });
    }
  }
}
