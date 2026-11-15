import { Inject, Injectable, Logger } from '@nestjs/common';
import { CustomerInboxMessage } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
import { canAdvanceMessageStatus } from '../message/message-status';
import {
  ANDROID_CHANNEL_BY_CATEGORY,
  CustomerNotificationCategory,
  PUSH_STATUS,
  publicMessageData,
  pushableDevices,
} from './customer-notification.constants';
import { CustomerNotificationClock } from './customer-notification.clock';
import { CustomerNotificationSettingsService, ProfileSubject } from './customer-notification-settings.service';
import { pushWording } from './customer-notification.wording';
import { CUSTOMER_PUSH_PROVIDER, CustomerPushProvider, PushMessage } from './push-provider';
import { istDayStart, isQuietTime, quietEndsAt } from './quiet-hours';

/**
 * A ticket to check later against Expo's receipts. Kept in the BullMQ job, not
 * the database. It names the phone row, never the raw push token (privacy
 * review L3); `sentAt` lets the receipt check leave a token alone that the
 * phone replaced after this push.
 */
export interface PushTicketRef {
  ticketId: string;
  deviceId: string;
  inboxId: string;
  messageLogId: string | null;
  sentAt: string;
}

export interface SendDueResult {
  sent: number;
  failed: number;
  heldQuietHours: number;
  heldDailyCap: number;
  off: number;
  noDevice: number;
  cancelled: number;
  retried: number;
  deadTokensRemoved: number;
  tickets: PushTicketRef[];
}

export interface ReceiptCheckResult {
  ok: number;
  errors: number;
  deadTokensRemoved: number;
  /** Tickets Expo has no receipt for yet: asked for again later (bounded, see CustomerPushJob). */
  pending: PushTicketRef[];
}

/** Pushes that keep failing to reach Expo stop being retried after this. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const DUE_BATCH = 500;

type DueRow = Pick<
  CustomerInboxMessage,
  | 'id' | 'accountId' | 'kind' | 'category' | 'priority' | 'title' | 'body' | 'deepLink' | 'data' | 'language'
  | 'profileId' | 'pushStatus' | 'messageLogId' | 'createdAt'
>;

type Db = Pick<PrismaService, 'customerInboxMessage' | 'messageLog'>;

function isSelfAction(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && (data as Record<string, unknown>).trigger === 'self');
}

/** Errors from the push service: the code only, never its message (it can quote tokens; privacy review L6). */
function safeReason(error: unknown): string {
  const name = (error as Error)?.name;
  return name && name !== 'Error' ? name : 'request failed';
}

/**
 * The background worker's half (src/jobs/customer-push.job.ts): every minute,
 * and whenever a notification is queued, it sends the pushes that are due
 * through the push provider (Expo; mock on the test setup).
 *
 * Before anything goes out it checks again, for every message:
 * - the account is active; one being deleted or blocked gets no push and its
 *   phones' tokens are dropped (privacy review H2);
 * - the profile the message is about is still the account's
 *   (CustomerScopeService.stillMine: a corrected number or anonymisation
 *   cancels it; H1, L4);
 * - quiet hours (Q21, proposal 5.4): "nothing between 9 PM and 9 AM except
 *   OTPs and things the person just did themselves (e.g. a payment receipt);
 *   reminders due overnight wait until 9 AM". Urgent pushes (an offer) wait
 *   too; OTPs never come through here (they go by SMS);
 * - the switch: Service is on while a guarantee runs (H3); job updates and
 *   promotions need the consent still given (H4);
 * - the cap: 3 non-urgent pushes a day per account; urgent ones and receipts
 *   never count, and over the cap the message stays in the inbox without a
 *   push. The count and the claim happen under a per-account database lock, so
 *   two rounds at once (the worker and a second process) cannot both send the
 *   3rd (M1).
 *
 * Tokens Expo reports as DeviceNotRegistered (the app was uninstalled) are
 * removed at once and after the receipt check.
 */
@Injectable()
export class CustomerPushSenderService {
  private readonly logger = new Logger(CustomerPushSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CustomerNotificationSettingsService,
    private readonly clock: CustomerNotificationClock,
    @Inject(CUSTOMER_PUSH_PROVIDER) private readonly provider: CustomerPushProvider,
    private readonly scope: CustomerScopeService,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  async sendDue(now: Date = this.clock.now()): Promise<SendDueResult> {
    const result: SendDueResult = {
      sent: 0, failed: 0, heldQuietHours: 0, heldDailyCap: 0, off: 0, noDevice: 0, cancelled: 0, retried: 0, deadTokensRemoved: 0, tickets: [],
    };
    const rows: DueRow[] = await this.prisma.customerInboxMessage.findMany({
      where: {
        pushStatus: { in: [PUSH_STATUS.queued, PUSH_STATUS.heldQuietHours] },
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: DUE_BATCH,
      select: {
        id: true, accountId: true, kind: true, category: true, priority: true, title: true, body: true, deepLink: true,
        data: true, language: true, profileId: true, pushStatus: true, messageLogId: true, createdAt: true,
      },
    });
    if (rows.length === 0) return result;

    const byAccount = new Map<string, DueRow[]>();
    for (const row of rows) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);

    const outgoing: { row: DueRow; message: PushMessage; deviceId: string; token: string }[] = [];
    const claimedRows: DueRow[] = [];
    for (const [accountId, accountRows] of byAccount) {
      const account = await this.prisma.customerAccount.findUnique({ where: { id: accountId }, select: { status: true } });
      if (account?.status !== 'active') {
        // Being deleted, blocked or gone: no push at all, and its phones lose their tokens (H2).
        await this.prisma.customerDevice.updateMany({ where: { accountId, pushToken: { not: null } }, data: { pushToken: null, pushTokenUpdatedAt: now } });
        for (const row of accountRows) await this.inboxOnly(this.prisma, row, PUSH_STATUS.none, now);
        result.noDevice += accountRows.length;
        continue;
      }
      const settings = await this.settings.getOrCreate(accountId);
      const profileIds = [...new Set(accountRows.map((r) => r.profileId).filter((id): id is string => Boolean(id)))];
      const stillMine = profileIds.length ? await this.scope.stillMine(accountId, profileIds) : new Set<string>();
      const subjects = await this.subjectsByProfile(profileIds);
      let serviceOn: boolean | null = null;
      const devices = (
        await this.prisma.customerDevice.findMany({ where: pushableDevices(accountId, now), select: { id: true, pushToken: true } })
      ).filter((d): d is { id: string; pushToken: string } => Boolean(d.pushToken));

      const candidates: DueRow[] = [];
      for (const row of accountRows) {
        if (row.profileId && !stillMine.has(row.profileId)) {
          await this.cancel(row, now);
          result.cancelled += 1;
          continue;
        }
        // Only what the person just did goes out between 9 PM and 9 AM; urgent ones wait too.
        if (!isSelfAction(row.data) && isQuietTime(now, settings.quietStart, settings.quietEnd)) {
          await this.prisma.customerInboxMessage.updateMany({
            where: { id: row.id, pushStatus: row.pushStatus },
            data: { pushStatus: PUSH_STATUS.heldQuietHours, scheduledFor: quietEndsAt(now, settings.quietEnd) },
          });
          result.heldQuietHours += 1;
          continue;
        }
        // A switch turned off after the message was queued: inbox only.
        const category = row.category as CustomerNotificationCategory;
        let switchOn: boolean;
        if (category === 'service') {
          serviceOn ??= await this.settings.serviceOn(accountId, settings, now);
          switchOn = serviceOn;
        } else {
          switchOn = category === 'promotions' ? settings.promotions : settings.jobUpdates;
        }
        if (!switchOn) {
          await this.inboxOnly(this.prisma, row, PUSH_STATUS.off, now);
          result.off += 1;
          continue;
        }
        // The consent may have been withdrawn since the message was written (H4).
        if (category === 'promotions' || category === 'job_updates') {
          const subject = row.profileId ? (subjects.get(row.profileId) ?? null) : null;
          if (!(await this.settings.consentGiven(accountId, subject, category))) {
            await this.cancel(row, now);
            result.cancelled += 1;
            continue;
          }
        }
        if (devices.length === 0) {
          await this.inboxOnly(this.prisma, row, PUSH_STATUS.none, now);
          result.noDevice += 1;
          continue;
        }
        candidates.push(row);
      }
      if (candidates.length === 0) continue;

      // The cap is counted and the rows claimed under one lock per account, so
      // two rounds running at once (two processes) cannot both send the 3rd (M1).
      const claimed = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-push:${accountId}`}))`;
        let sentToday = await this.nonUrgentSentToday(tx, accountId, now);
        const mine: DueRow[] = [];
        for (const row of candidates) {
          const nonUrgent = row.priority !== 'urgent' && !isSelfAction(row.data);
          if (nonUrgent && sentToday >= settings.dailyCap) {
            if (await this.inboxOnly(tx, row, PUSH_STATUS.heldDailyCap, now)) result.heldDailyCap += 1;
            continue;
          }
          const taken = await tx.customerInboxMessage.updateMany({
            where: { id: row.id, pushStatus: row.pushStatus },
            data: { pushStatus: PUSH_STATUS.sent, pushedAt: now, scheduledFor: null },
          });
          if (taken.count !== 1) continue; // another round took it
          if (nonUrgent) sentToday += 1;
          mine.push(row);
        }
        return mine;
      });
      for (const row of claimed) {
        claimedRows.push(row);
        for (const device of devices) {
          outgoing.push({ row, deviceId: device.id, token: device.pushToken, message: this.toMessage(row, device.pushToken) });
        }
      }
    }
    if (outgoing.length === 0) return result;

    // Accepted trade-off: a crash between the claim above and Expo's answer
    // leaves the row "sent" without a push. The message is still in the inbox,
    // and sending it again could repeat a push Expo already took.
    let tickets;
    try {
      tickets = await this.provider.send(outgoing.map((o) => o.message));
    } catch (error) {
      this.logger.warn(`Push service unavailable, will retry: ${safeReason(error)}`);
      tickets = outgoing.map(() => ({ status: 'unsent' as const, reason: 'unavailable' }));
    }

    const okTicketsByRow = new Map<string, string[]>();
    const unsentRows = new Set<string>();
    for (let i = 0; i < outgoing.length; i += 1) {
      const ticket = tickets[i];
      const { row, token, deviceId } = outgoing[i];
      if (ticket?.status === 'ok') {
        okTicketsByRow.set(row.id, [...(okTicketsByRow.get(row.id) ?? []), ticket.id]);
        result.tickets.push({ ticketId: ticket.id, deviceId, inboxId: row.id, messageLogId: row.messageLogId, sentAt: now.toISOString() });
      } else if (ticket?.status === 'error' && ticket.error === 'DeviceNotRegistered') {
        result.deadTokensRemoved += await this.removeToken(token, now);
      } else if (!ticket || ticket.status === 'unsent') {
        unsentRows.add(row.id);
      }
    }
    for (const row of claimedRows) {
      const ok = okTicketsByRow.get(row.id) ?? [];
      if (ok.length > 0) {
        // Expo took it for at least one phone: never sent again (M2).
        if (row.messageLogId) {
          await this.prisma.messageLog.updateMany({
            where: { id: row.messageLogId, status: 'queued' },
            data: { status: 'sent', sentAt: now, providerMessageId: ok[0] },
          });
        }
        result.sent += 1;
      } else if (unsentRows.has(row.id) && now.getTime() - row.createdAt.getTime() <= GIVE_UP_AFTER_MS) {
        await this.prisma.customerInboxMessage.updateMany({
          where: { id: row.id, pushStatus: PUSH_STATUS.sent },
          data: { pushStatus: PUSH_STATUS.queued, pushedAt: null, scheduledFor: new Date(now.getTime() + RETRY_AFTER_MS) },
        });
        result.retried += 1;
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
   * Tickets Expo has no receipt for yet come back as `pending`.
   */
  async checkReceipts(refs: PushTicketRef[], now: Date = this.clock.now()): Promise<ReceiptCheckResult> {
    const out: ReceiptCheckResult = { ok: 0, errors: 0, deadTokensRemoved: 0, pending: [] };
    if (refs.length === 0) return out;
    const receipts = await this.provider.getReceipts(refs.map((r) => r.ticketId));
    const logOutcome = new Map<string, { ok: number; err: number }>();
    for (const ref of refs) {
      const receipt = receipts[ref.ticketId];
      if (!receipt) {
        out.pending.push(ref);
        continue;
      }
      const tally = logOutcome.get(ref.messageLogId ?? '') ?? { ok: 0, err: 0 };
      if (receipt.status === 'ok') {
        out.ok += 1;
        tally.ok += 1;
      } else {
        out.errors += 1;
        tally.err += 1;
        if (receipt.error === 'DeviceNotRegistered') out.deadTokensRemoved += await this.removeDeviceToken(ref, now);
        else this.logger.warn(`Push receipt error ${receipt.error ?? 'unknown'}`);
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

  /** The receipt check's version: by phone row, and only if the phone has not saved a new token since the push. */
  private async removeDeviceToken(ref: PushTicketRef, now: Date): Promise<number> {
    const sentAt = new Date(ref.sentAt);
    const removed = await this.prisma.customerDevice.updateMany({
      where: {
        id: ref.deviceId,
        pushToken: { not: null },
        ...(Number.isNaN(sentAt.getTime()) ? {} : { OR: [{ pushTokenUpdatedAt: null }, { pushTokenUpdatedAt: { lte: sentAt } }] }),
      },
      data: { pushToken: null, pushTokenUpdatedAt: now },
    });
    return removed.count;
  }

  private async subjectsByProfile(profileIds: string[]): Promise<Map<string, ProfileSubject>> {
    const out = new Map<string, ProfileSubject>();
    if (profileIds.length === 0) return out;
    const profiles = await this.prisma.customerProfile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, jobSeekerId: true, businessId: true, referralId: true },
    });
    for (const p of profiles) {
      if (p.jobSeekerId) out.set(p.id, { subjectType: 'job_seeker', subjectId: p.jobSeekerId });
      else if (p.businessId) out.set(p.id, { subjectType: 'business', subjectId: p.businessId });
      else if (p.referralId) out.set(p.id, { subjectType: 'referral', subjectId: p.referralId });
    }
    return out;
  }

  private async nonUrgentSentToday(db: Db, accountId: string, now: Date): Promise<number> {
    const rows = await db.customerInboxMessage.findMany({
      where: { accountId, pushStatus: PUSH_STATUS.sent, priority: { not: 'urgent' }, pushedAt: { gte: istDayStart(now) } },
      select: { data: true },
    });
    return rows.filter((r) => !isSelfAction(r.data)).length;
  }

  private toMessage(row: DueRow, token: string): PushMessage {
    // Internal keys (trigger…) never leave the server (L5); a referral push names nobody on the lock screen (L1).
    const text = pushWording(row.kind, row.language, { title: row.title, body: row.body });
    return {
      to: token,
      title: text.title,
      body: text.body,
      data: {
        ...publicMessageData(row.data),
        messageId: row.id, kind: row.kind, category: row.category, deepLink: row.deepLink ?? '/inbox', profileId: row.profileId,
      },
      channelId: ANDROID_CHANNEL_BY_CATEGORY[row.category as CustomerNotificationCategory] ?? 'service',
      priority: row.priority === 'urgent' ? 'high' : 'normal',
      sound: row.category === 'promotions' ? null : 'default',
    };
  }

  /** The message stays in the inbox; no push is sent for it. True when this round changed it. */
  private async inboxOnly(db: Db, row: DueRow, pushStatus: string, now: Date): Promise<boolean> {
    const changed = await db.customerInboxMessage.updateMany({
      where: { id: row.id, pushStatus: row.pushStatus },
      data: { pushStatus, scheduledFor: null },
    });
    if (changed.count === 1 && row.messageLogId) {
      await db.messageLog.updateMany({
        where: { id: row.messageLogId, status: 'queued' },
        data: { channel: 'in_app', status: 'sent', sentAt: now },
      });
    }
    return changed.count === 1;
  }

  /** Not pushed and hidden from the inbox (profile no longer the account's, or consent withdrawn). */
  private async cancel(row: DueRow, now: Date): Promise<void> {
    const changed = await this.prisma.customerInboxMessage.updateMany({
      where: { id: row.id, pushStatus: row.pushStatus },
      data: { pushStatus: PUSH_STATUS.cancelled, scheduledFor: null },
    });
    if (changed.count === 1 && row.messageLogId) {
      await this.prisma.messageLog.updateMany({
        where: { id: row.messageLogId, status: 'queued' },
        data: { status: 'failed', failedAt: now },
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
