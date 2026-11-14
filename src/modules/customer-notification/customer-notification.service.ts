import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CUSTOMER_EVENTS,
  CUSTOMER_MESSAGE_SUBJECT,
  CustomerEventKind,
  CustomerNotificationCategory,
  CustomerNotificationPriority,
  PUSH_STATUS,
  pushableDevices,
} from './customer-notification.constants';
import { CustomerNotificationClock } from './customer-notification.clock';
import { CustomerNotificationSettingsService, ProfileSubject } from './customer-notification-settings.service';
import { renderWording, WordingVars } from './customer-notification.wording';
import { isQuietTime, quietEndsAt } from './quiet-hours';
import { CustomerPushKick } from './customer-push-kick';

/**
 * Who a notification is for. Other modules pass the record they work with;
 * this module finds the app accounts linked to it (CustomerProfile). A record
 * with no app account gets nothing and nothing fails.
 * - `businessId` without `branchId`: the business's owner-level people only.
 *   With `branchId`: those plus the managers of that branch.
 */
export type NotifyTarget =
  | { accountId: string; profileId?: string | null }
  | { jobSeekerId: string }
  | { businessId: string; branchId?: string | null }
  | { referralId: string };

export interface NotifyOptions {
  /** Sent in quiet hours and never held by the daily cap (an offer, "pay within 24 hours"). */
  urgent?: boolean;
  /** Goes out only with the promotions consent (Q22), whatever the event. */
  promotional?: boolean;
  /** The person just did this (a receipt): sent at once, not counted in the cap. */
  selfAction?: boolean;
  /**
   * One message per event: the same key (per account) never makes a second
   * inbox row, so a retried webhook or a double tap adds nothing.
   */
  dedupeKey?: string;
  /** Extra values for the app (never personal data); the profile id is added. */
  data?: Record<string, string | number | boolean | null>;
}

export type NotifySkipReason = 'no_consent' | 'switched_off' | 'duplicate';

export interface NotifyResult {
  /** Inbox rows written. */
  inbox: number;
  /** Pushes queued to go now. */
  queued: number;
  /** Pushes held until quiet hours end. */
  held: number;
  skipped: { accountId: string; reason: NotifySkipReason }[];
}

interface Recipient {
  accountId: string;
  language: string;
  profileId: string | null;
  subject: ProfileSubject | null;
}

const PROFILE_SELECT = {
  id: true,
  accountId: true,
  jobSeekerId: true,
  businessId: true,
  referralId: true,
  account: { select: { language: true } },
} as const;

/**
 * The service every other module calls to tell an app customer something
 * (docs/customer-app-api.md section 9): it writes the inbox row (in the
 * person's language), a MessageLog row (channel push or in_app), and leaves
 * the push for the background worker. Quiet hours, the daily cap, the three
 * switches and the promotions consent are applied here and in the worker.
 *
 * A push or in-app message is NEVER a contact attempt (C17): no ContactAttempt
 * is written and the MessageLog subject is the customer account, never the job
 * seeker, so the no-pickup hit rule, the offer follow-through check and the
 * call screens' attempt counts cannot see it. Hits and offers keep needing the
 * recorded calls plus SMS and WhatsApp, exactly as the guide says.
 */
@Injectable()
export class CustomerNotificationService {
  private readonly logger = new Logger(CustomerNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CustomerNotificationSettingsService,
    private readonly clock: CustomerNotificationClock,
    @Optional() private readonly kicker?: CustomerPushKick,
  ) {}

  async notify(target: NotifyTarget, kind: CustomerEventKind, vars: WordingVars = {}, options: NotifyOptions = {}): Promise<NotifyResult> {
    const definition = CUSTOMER_EVENTS[kind];
    if (!definition) throw new Error(`Unknown customer notification ${String(kind)}`);
    const category: CustomerNotificationCategory = options.promotional ? 'promotions' : definition.category;
    const priority: CustomerNotificationPriority = options.urgent ? 'urgent' : definition.priority;
    const selfAction = options.selfAction ?? ('selfAction' in definition && definition.selfAction === true);
    // Fail before writing anything when a placeholder is missing.
    renderWording(kind, 'en', vars);

    const result: NotifyResult = { inbox: 0, queued: 0, held: 0, skipped: [] };
    const now = this.clock.now();
    for (const recipient of await this.recipients(target)) {
      const outcome = await this.deliverOne(recipient, kind, vars, { category, priority, selfAction, options, now });
      if (outcome === 'queued') {
        result.inbox += 1;
        result.queued += 1;
      } else if (outcome === 'held') {
        result.inbox += 1;
        result.held += 1;
      } else if (outcome === 'inbox') {
        result.inbox += 1;
      } else {
        result.skipped.push({ accountId: recipient.accountId, reason: outcome });
      }
    }
    if (result.queued > 0 && this.kicker) await this.kicker.kick();
    return result;
  }

  /**
   * The same, for calls from other modules' services: never throws, so a
   * notification problem can never fail a payment, an offer or an approval.
   */
  async notifySafely(target: NotifyTarget, kind: CustomerEventKind, vars: WordingVars = {}, options: NotifyOptions = {}): Promise<NotifyResult | null> {
    try {
      return await this.notify(target, kind, vars, options);
    } catch (error) {
      this.logger.warn(`Customer notification ${kind} not sent: ${(error as Error).message}`);
      return null;
    }
  }

  private async recipients(target: NotifyTarget): Promise<Recipient[]> {
    const activeAccount = { status: 'active' } as const;
    let profiles: Prisma.CustomerProfileGetPayload<{ select: typeof PROFILE_SELECT }>[] = [];
    if ('accountId' in target) {
      const account = await this.prisma.customerAccount.findFirst({
        where: { id: target.accountId, ...activeAccount },
        select: { id: true, language: true },
      });
      if (!account) return [];
      if (target.profileId) {
        const profile = await this.prisma.customerProfile.findFirst({
          where: { id: target.profileId, accountId: account.id, status: 'active' },
          select: PROFILE_SELECT,
        });
        if (profile) return [this.toRecipient(profile)];
      }
      return [{ accountId: account.id, language: account.language, profileId: null, subject: null }];
    }
    if ('jobSeekerId' in target) {
      profiles = await this.prisma.customerProfile.findMany({
        where: { jobSeekerId: target.jobSeekerId, status: 'active', account: activeAccount },
        select: PROFILE_SELECT,
      });
    } else if ('referralId' in target) {
      profiles = await this.prisma.customerProfile.findMany({
        where: { referralId: target.referralId, status: 'active', account: activeAccount },
        select: PROFILE_SELECT,
      });
    } else if ('businessId' in target) {
      profiles = await this.prisma.customerProfile.findMany({
        where: {
          businessId: target.businessId,
          status: 'active',
          account: activeAccount,
          OR: target.branchId ? [{ branchId: null }, { branchId: target.branchId }] : [{ branchId: null }],
        },
        select: PROFILE_SELECT,
      });
    }
    const seen = new Set<string>();
    return profiles
      .filter((p) => (seen.has(p.accountId) ? false : (seen.add(p.accountId), true)))
      .map((p) => this.toRecipient(p));
  }

  private toRecipient(profile: Prisma.CustomerProfileGetPayload<{ select: typeof PROFILE_SELECT }>): Recipient {
    const subject: ProfileSubject | null = profile.jobSeekerId
      ? { subjectType: 'job_seeker', subjectId: profile.jobSeekerId }
      : profile.businessId
        ? { subjectType: 'business', subjectId: profile.businessId }
        : profile.referralId
          ? { subjectType: 'referral', subjectId: profile.referralId }
          : null;
    return { accountId: profile.accountId, language: profile.account.language, profileId: profile.id, subject };
  }

  private async deliverOne(
    recipient: Recipient,
    kind: CustomerEventKind,
    vars: WordingVars,
    ctx: {
      category: CustomerNotificationCategory;
      priority: CustomerNotificationPriority;
      selfAction: boolean;
      options: NotifyOptions;
      now: Date;
    },
  ): Promise<'queued' | 'held' | 'inbox' | NotifySkipReason> {
    const { category, priority, selfAction, options, now } = ctx;
    const settings = await this.settings.getOrCreate(recipient.accountId);

    // Job updates and promotions are sent only with the switch on AND, for a
    // job seeker, the matching consent still given (Q22).
    if (category === 'promotions' || category === 'job_updates') {
      const switchOn = category === 'promotions' ? settings.promotions : settings.jobUpdates;
      if (!switchOn) return 'switched_off';
      const purpose = category;
      const subjects = recipient.subject ? [recipient.subject] : await this.settings.subjectsOf(recipient.accountId);
      for (const subject of subjects.filter((s) => s.subjectType === 'job_seeker')) {
        const live = await this.settings.liveConsents(subject);
        if (!live.has(purpose)) return 'no_consent';
      }
    }

    const dedupeKey = options.dedupeKey ? `${options.dedupeKey}:${recipient.accountId}` : null;
    if (dedupeKey) {
      const existing = await this.prisma.customerInboxMessage.findUnique({ where: { dedupeKey }, select: { id: true } });
      if (existing) return 'duplicate';
    }

    const wording = renderWording(kind, recipient.language, vars);
    const pushable = await this.prisma.customerDevice.count({
      where: pushableDevices(recipient.accountId),
    });

    let pushStatus: string;
    let scheduledFor: Date | null = null;
    if (category === 'service' && !settings.service) {
      pushStatus = PUSH_STATUS.off;
    } else if (pushable === 0) {
      pushStatus = PUSH_STATUS.none;
    } else if (priority === 'urgent' || selfAction) {
      pushStatus = PUSH_STATUS.queued;
      scheduledFor = now;
    } else if (isQuietTime(now, settings.quietStart, settings.quietEnd)) {
      // Reminders due overnight wait until 9 AM (proposal 5.4).
      pushStatus = PUSH_STATUS.heldQuietHours;
      scheduledFor = quietEndsAt(now, settings.quietEnd);
    } else {
      pushStatus = PUSH_STATUS.queued;
      scheduledFor = now;
    }
    const willPush = pushStatus === PUSH_STATUS.queued || pushStatus === PUSH_STATUS.heldQuietHours;

    const data: Record<string, unknown> = { ...(options.data ?? {}) };
    if (recipient.profileId) data.profileId = recipient.profileId;
    if (selfAction) data.trigger = 'self';

    try {
      await this.prisma.$transaction(async (tx) => {
        const log = await tx.messageLog.create({
          data: {
            channel: willPush ? 'push' : 'in_app',
            template: kind,
            subjectType: CUSTOMER_MESSAGE_SUBJECT,
            subjectId: recipient.accountId,
            relatedType: recipient.subject?.subjectType ?? null,
            relatedId: recipient.subject?.subjectId ?? null,
            status: willPush ? 'queued' : 'sent',
            sentAt: willPush ? null : now,
          },
        });
        await tx.customerInboxMessage.create({
          data: {
            accountId: recipient.accountId,
            profileId: recipient.profileId,
            kind,
            category,
            priority,
            title: wording.title,
            body: wording.body,
            deepLink: CUSTOMER_EVENTS[kind].deepLink,
            data: data as Prisma.InputJsonValue,
            language: wording.language,
            dedupeKey,
            messageLogId: log.id,
            pushStatus,
            scheduledFor,
          },
        });
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return 'duplicate';
      throw error;
    }
    if (pushStatus === PUSH_STATUS.queued) return 'queued';
    if (pushStatus === PUSH_STATUS.heldQuietHours) return 'held';
    return 'inbox';
  }
}
