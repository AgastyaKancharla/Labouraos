import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
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
 *   With `branchId`: those plus the managers of that branch. Money events
 *   (`businessOwnersOnly` in CUSTOMER_EVENTS) reach owners with no branch limit only.
 * Every profile is checked with CustomerScopeService.stillMine first: one whose
 * mobile was corrected, or that was anonymised, gets nothing (privacy review H1).
 */
export type NotifyTarget =
  | { accountId: string; profileId?: string | null }
  | { jobSeekerId: string }
  | { businessId: string; branchId?: string | null }
  | { referralId: string };

export interface NotifyOptions {
  /** Never held by the daily cap (an offer, "pay within 24 hours"). Still waits for 9 AM in quiet hours (Q21). */
  urgent?: boolean;
  /** Goes out only with the promotions consent (Q22), whatever the event. */
  promotional?: boolean;
  /**
   * The person just did this themselves (a receipt), e.g. a card payment the
   * gateway confirmed. Only for events that can be receipts, and only when the
   * event reaches exactly one account (the payer; privacy review M3): sent at
   * once even at night, not counted in the cap. A payment Finance or the bank
   * feed confirmed is not the person's own action and waits for 9 AM.
   */
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
    private readonly scope: CustomerScopeService,
    @Optional() private readonly kicker?: CustomerPushKick,
  ) {}

  async notify(target: NotifyTarget, kind: CustomerEventKind, vars: WordingVars = {}, options: NotifyOptions = {}): Promise<NotifyResult> {
    const definition = CUSTOMER_EVENTS[kind];
    if (!definition) throw new Error(`Unknown customer notification ${String(kind)}`);
    const category: CustomerNotificationCategory = options.promotional ? 'promotions' : definition.category;
    const priority: CustomerNotificationPriority = options.urgent ? 'urgent' : definition.priority;
    // Fail before writing anything when a placeholder is missing.
    renderWording(kind, 'en', vars);

    const result: NotifyResult = { inbox: 0, queued: 0, held: 0, skipped: [] };
    const now = this.clock.now();
    const ownersOnly = 'businessOwnersOnly' in definition && definition.businessOwnersOnly === true;
    const recipients = await this.recipients(target, ownersOnly);
    // A receipt goes out at night only to the one person who did it. With
    // several recipients the payer is not known, so nobody skips quiet hours.
    const selfAction = options.selfAction === true && 'selfAction' in definition && definition.selfAction === true && recipients.length === 1;
    for (const recipient of recipients) {
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

  private async recipients(target: NotifyTarget, ownersOnly: boolean): Promise<Recipient[]> {
    const activeAccount = { status: 'active' } as const;
    let profiles: Prisma.CustomerProfileGetPayload<{ select: typeof PROFILE_SELECT }>[] = [];
    if ('accountId' in target) {
      const account = await this.prisma.customerAccount.findFirst({
        where: { id: target.accountId, ...activeAccount },
        select: { id: true, language: true },
      });
      if (!account) return [];
      if (!target.profileId) return [{ accountId: account.id, language: account.language, profileId: null, subject: null }];
      // A message about one profile goes only while that profile is still the account's.
      const profile = await this.prisma.customerProfile.findFirst({
        where: { id: target.profileId, accountId: account.id, status: 'active' },
        select: PROFILE_SELECT,
      });
      if (!profile || !(await this.scope.stillMine(account.id, [profile.id])).has(profile.id)) return [];
      return [this.toRecipient(profile)];
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
        where: ownersOnly
          ? { businessId: target.businessId, status: 'active', account: activeAccount, role: 'owner', branchId: null }
          : {
              businessId: target.businessId,
              status: 'active',
              account: activeAccount,
              OR: target.branchId ? [{ branchId: null }, { branchId: target.branchId }] : [{ branchId: null }],
            },
        select: PROFILE_SELECT,
      });
    }
    // Still the account's? (number corrected or record anonymised: revoked, nothing sent.)
    const byAccount = new Map<string, string[]>();
    for (const p of profiles) byAccount.set(p.accountId, [...(byAccount.get(p.accountId) ?? []), p.id]);
    const valid = new Set<string>();
    for (const [accountId, ids] of byAccount) {
      for (const id of await this.scope.stillMine(accountId, ids)) valid.add(id);
    }
    const seen = new Set<string>();
    return profiles
      .filter((p) => valid.has(p.id))
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

    // Job updates and promotions are sent only with the switch on AND the
    // matching consent still given for every record it is about, whatever its
    // kind (Q22; privacy review H4). The worker checks the consent again.
    if (category === 'promotions' || category === 'job_updates') {
      const switchOn = category === 'promotions' ? settings.promotions : settings.jobUpdates;
      if (!switchOn) return 'switched_off';
      if (!(await this.settings.consentGiven(recipient.accountId, recipient.subject, category))) return 'no_consent';
    }

    const dedupeKey = options.dedupeKey ? `${options.dedupeKey}:${recipient.accountId}` : null;
    if (dedupeKey) {
      const existing = await this.prisma.customerInboxMessage.findUnique({ where: { dedupeKey }, select: { id: true } });
      if (existing) return 'duplicate';
    }

    const wording = renderWording(kind, recipient.language, vars);
    const pushable = await this.prisma.customerDevice.count({
      where: pushableDevices(recipient.accountId, now),
    });

    let pushStatus: string;
    let scheduledFor: Date | null = null;
    // Service is on while a guarantee runs, even if switched off before it started (H3).
    if (category === 'service' && !(await this.settings.serviceOn(recipient.accountId, settings, now))) {
      pushStatus = PUSH_STATUS.off;
    } else if (pushable === 0) {
      pushStatus = PUSH_STATUS.none;
    } else if (selfAction) {
      // Something the person just did themselves (a payment receipt): at once, even at night.
      pushStatus = PUSH_STATUS.queued;
      scheduledFor = now;
    } else if (isQuietTime(now, settings.quietStart, settings.quietEnd)) {
      // Q21 (proposal 5.4): "nothing between 9 PM and 9 AM except OTPs and things
      // the person just did themselves (e.g. a payment receipt); reminders due
      // overnight wait until 9 AM". Urgent ones (an offer) wait too.
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
