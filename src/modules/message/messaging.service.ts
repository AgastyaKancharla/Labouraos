import { OwnTeam } from '../../common/rbac/own-team';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { MessageLog } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from '../../common/whatsapp/whatsapp.interface';
import { canAdvanceMessageStatus } from './message-status';
import { dltTemplateId, SMS_PROVIDER, SmsProvider } from './sms.provider';
import { callStatusSignatureMatches } from '../call/call-signature';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { normaliseIndianMobile } from '../../common/phone/indian-mobile';
import { blocksFor, ContactBlockKind, phoneHash } from '../call/contact-block';
import { recordTestModeLink } from '../../common/test-mode-link';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { isNoWhatsAppError } from '../../common/whatsapp/real-whatsapp.provider';
import { addWorkingTime, inWorkingHours, isNoWhatsApp, markNoWhatsApp } from './no-whatsapp';

export interface SendMessageInput {
  channel: 'sms' | 'whatsapp';
  template: string;
  subjectType: string;
  subjectId: string;
  relatedType?: string | null;
  relatedId?: string | null;
  variables?: Record<string, string>;
  recipientPhone?: string;
  /**
   * A sent SMS or WhatsApp to a job seeker counts as the message leg of a
   * no-pickup day (the hit rule) unless this is false. Informational messages
   * (registration done, nudges, links, conversation replies) pass false: they
   * are not the "we tried to call you" notice.
   */
  contactAttempt?: boolean;
  /**
   * An agent answering someone who wrote to us first. Only then may a message
   * reach a person with a live "wrong number" or "do not call" block; every
   * automatic message is skipped (recorded with status `blocked`).
   */
  agentReply?: boolean;
}

/** Records a message can be about that carry a person's phone (and so a contact block). */
const PERSON_SUBJECTS = new Set(['job_seeker', 'business', 'referral']);

/** WhatsApp first, SMS when WhatsApp is not available or fails (21 Nov, rev 202). */
export interface PreferWhatsAppResult {
  /** The channel that carried it, or null when nothing went out. */
  channel: 'whatsapp' | 'sms' | null;
  status: 'sent' | 'failed' | 'blocked';
  whatsappMessageId: string | null;
  smsMessageId: string | null;
  /** The message-log row that carried it (else the last one tried), or null when nothing was logged. */
  id: string | null;
}

/**
 * The exceptions that always go on both WhatsApp and SMS (Master Guide rev 211):
 * interview offers and "we tried to call you". With the call they are the three
 * ways of reaching a job seeker, and the hit rule needs proof of all of them
 * (InterviewService.processDueReplies, the no-pickup evaluation). They never get
 * an SMS backup: the SMS already went.
 */
export const BOTH_CHANNEL_TEMPLATES = ['interview_offer', 'call_attempt_notice'] as const;

/** A WhatsApp with no "delivered" or "read" within this much working time (9 AM–9 PM) gets its SMS once. */
export const SMS_BACKUP_AFTER_MS = 60 * 60 * 1000;

/** Where a WhatsApp message's SMS backup stands (MessageLog.smsBackup). */
export const SMS_BACKUP = {
  pending: 'pending',
  sending: 'sending',
  sent: 'sent',
  notNeeded: 'not_needed',
  failed: 'failed',
  skipped: 'skipped',
} as const;

interface BackupPayload {
  v: Record<string, string>;
  p: string;
  a: boolean;
}

function backupKey(): Buffer {
  return createHash('sha256').update(`laboura:sms-backup:${process.env.JWT_SECRET ?? ''}`).digest();
}

/** The backup SMS's variables (they can carry live link tokens) are stored only sealed, never in the clear. */
export function sealBackupPayload(payload: BackupPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', backupKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function openBackupPayload(sealed: string | null | undefined): BackupPayload | null {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', backupKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as BackupPayload;
  } catch {
    return null;
  }
}

/** The ContactBlock kinds that stop messages to a person (src/modules/call/contact-block.ts). */
export const MESSAGE_BLOCKING_OUTCOMES = ['do_not_call', 'wrong_number'] as const;
export type MessageBlockKind = ContactBlockKind;

/**
 * Templates that still go to a blocked person (21 Nov review; owner to confirm).
 * - wrong number: nothing (it is someone else's phone). OTPs are sent by
 *   OtpService, never through MessagingService, so they are not stopped here.
 * - do not call: money records the person is owed (receipts, refund notices).
 */
export const MESSAGE_BLOCK_EXEMPT_TEMPLATES: Record<MessageBlockKind, readonly string[]> = {
  wrong_number: [],
  do_not_call: ['payment_receipt', 'refund_notice', 'refund_paid'],
};

/** SHA-256 of the 10 national digits (ContactBlock.phoneHash). */
export const contactPhoneHash = phoneHash;

export interface MessageActor {
  id: string;
  role: string;
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /**
   * The one sending rule (Master Guide rev 211): WhatsApp first, SMS as backup.
   * - Nothing goes to a person with a live "wrong number" or "do not call" block
   *   (contactBlocksFor), unless the template is exempt (MESSAGE_BLOCK_EXEMPT_TEMPLATES).
   * - A number marked "No WhatsApp" gets the SMS straight away.
   * - WhatsApp refuses it: the SMS goes at once; when Meta says the number cannot
   *   get WhatsApp (131026) the number is marked "No WhatsApp".
   * - WhatsApp takes it: if no "delivered" or "read" comes within 1 working hour
   *   (9 AM–9 PM), or a "failed" comes first, the SMS goes once
   *   (sweepSmsBackups / applyProviderStatus). Never both when it was delivered.
   * The both-channel exceptions (BOTH_CHANNEL_TEMPLATES) use sendBoth instead.
   */
  async sendPreferWhatsApp(input: Omit<SendMessageInput, 'channel'>, now: Date = new Date()): Promise<PreferWhatsAppResult> {
    if (!input.agentReply && (await this.messagingBlocked(input.subjectType, input.subjectId, input.template))) {
      return { channel: null, status: 'blocked', whatsappMessageId: null, smsMessageId: null, id: null };
    }
    const phone = normaliseIndianMobile(input.recipientPhone ?? (await this.phoneFor(input.subjectType, input.subjectId)));
    const withPhone = { ...input, ...(phone ? { recipientPhone: phone } : {}) };
    if (phone && (await isNoWhatsApp(this.prisma, phone))) {
      return this.smsOnly(withPhone, null);
    }
    // Every message goes through send() (one row per channel), so callers and tests see each send.
    const waRow = await this.send({ ...withPhone, channel: 'whatsapp' });
    if (waRow?.status === 'sent') {
      if (phone && waRow.id) {
        await this.prisma.messageLog.update({
          where: { id: waRow.id },
          data: {
            smsBackup: SMS_BACKUP.pending,
            smsBackupDueAt: addWorkingTime(now, SMS_BACKUP_AFTER_MS),
            smsBackupPayload: sealBackupPayload({ v: input.variables ?? {}, p: phone, a: input.contactAttempt !== false }),
          },
        });
      }
      return { channel: 'whatsapp', status: 'sent', whatsappMessageId: waRow.id, smsMessageId: null, id: waRow.id };
    }
    const errorCode = await this.errorCodeOf(waRow);
    if (phone && isNoWhatsAppError(errorCode)) {
      await markNoWhatsApp(this.prisma, phone, { source: 'meta', errorCode });
    }
    return this.smsOnly(withPhone, waRow?.id ?? null);
  }

  /**
   * "Send by SMS" (the small button beside "Send on WhatsApp"): the agent chose
   * SMS, so no WhatsApp is tried. Same blocks as every message.
   */
  async sendBySms(input: Omit<SendMessageInput, 'channel'>): Promise<PreferWhatsAppResult> {
    if (!input.agentReply && (await this.messagingBlocked(input.subjectType, input.subjectId, input.template))) {
      return { channel: null, status: 'blocked', whatsappMessageId: null, smsMessageId: null, id: null };
    }
    return this.smsOnly(input, null);
  }

  /** WhatsApp first (sendPreferWhatsApp), or SMS only when the agent picked "Send by SMS". */
  async sendOn(channel: 'whatsapp' | 'sms' | undefined, input: Omit<SendMessageInput, 'channel'>): Promise<PreferWhatsAppResult> {
    return channel === 'sms' ? this.sendBySms(input) : this.sendPreferWhatsApp(input);
  }

  /**
   * The both-channel exceptions (BOTH_CHANNEL_TEMPLATES): WhatsApp and SMS
   * together, no backup. A number Meta says cannot get WhatsApp is still marked
   * "No WhatsApp" (the WhatsApp leg is tried anyway: the proof rules count it).
   */
  async sendBoth(input: Omit<SendMessageInput, 'channel'>): Promise<{ sms: ReturnType<MessagingService['toPublic']>; whatsapp: ReturnType<MessagingService['toPublic']> }> {
    const phone = input.recipientPhone ?? undefined;
    const [sms, whatsapp] = await Promise.all([
      this.send({ ...input, channel: 'sms' }),
      this.send({ ...input, channel: 'whatsapp' }),
    ]);
    const errorCode = await this.errorCodeOf(whatsapp);
    if (isNoWhatsAppError(errorCode)) {
      const target = normaliseIndianMobile(phone ?? (await this.phoneFor(input.subjectType, input.subjectId)));
      if (target) await markNoWhatsApp(this.prisma, target, { source: 'meta', errorCode });
    }
    return { sms, whatsapp };
  }

  /** Meta's error code on a failed WhatsApp row (null for anything else). */
  private async errorCodeOf(row: { id?: string | null; status?: string } | null | undefined): Promise<string | null> {
    if (!row?.id || row.status !== 'failed') return null;
    const stored = await this.prisma.messageLog.findUnique({ where: { id: row.id }, select: { errorCode: true } });
    return stored?.errorCode ?? null;
  }

  private async smsOnly(input: Omit<SendMessageInput, 'channel'>, whatsappMessageId: string | null): Promise<PreferWhatsAppResult> {
    const sms = await this.send({ ...input, channel: 'sms' });
    const status = sms?.status === 'sent' ? 'sent' : sms?.status === 'blocked' ? 'blocked' : 'failed';
    return {
      channel: status === 'sent' ? 'sms' : null,
      status,
      whatsappMessageId,
      smsMessageId: sms?.id ?? null,
      id: sms?.id ?? null,
    };
  }

  /**
   * True when no message may go to this person: a live "wrong number" or "do not
   * call" block (messagesBlocked in src/modules/call/contact-block.ts), unless the
   * template is exempt from that kind of block (MESSAGE_BLOCK_EXEMPT_TEMPLATES).
   */
  async messagingBlocked(subjectType: string | null | undefined, subjectId: string | null | undefined, template?: string): Promise<boolean> {
    if (!subjectType || !subjectId || !PERSON_SUBJECTS.has(subjectType)) return false;
    const blocks = await this.contactBlocksFor(subjectType, subjectId);
    for (const kind of blocks) {
      if (!template || !MESSAGE_BLOCK_EXEMPT_TEMPLATES[kind].includes(template)) return true;
    }
    return false;
  }

  /**
   * The live "wrong number" / "do not call" blocks for one person: Builder B's
   * ContactBlock rows (src/modules/call/contact-block.ts). A lift ends a block,
   * and a wrong number counts only while the record still has the number it was
   * recorded on.
   */
  async contactBlocksFor(subjectType: string, subjectId: string): Promise<Set<MessageBlockKind>> {
    return blocksFor(this.prisma, { subjectType, subjectId });
  }

  async send(input: SendMessageInput) {
    return (await this.deliver(input)).row;
  }

  /** One message on one channel, with Meta's error code when WhatsApp refused it. */
  private async deliver(input: SendMessageInput): Promise<{ row: ReturnType<MessagingService['toPublic']>; errorCode: string | null }> {
    // Wrong number / do not call (rev 202): no automatic message reaches the person.
    if (!input.agentReply && (await this.messagingBlocked(input.subjectType, input.subjectId, input.template))) {
      const blocked = await this.prisma.messageLog.create({
        data: {
          channel: input.channel,
          template: input.template,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          relatedType: input.relatedType ?? null,
          relatedId: input.relatedId ?? null,
          status: 'blocked',
        },
      });
      return { row: this.toPublic(blocked), errorCode: null };
    }
    // Test site only (pretend SMS): the request that sent a link answers with it (DEPLOY.md F12).
    recordTestModeLink(input.template, input.variables?.link);
    const row = await this.prisma.messageLog.create({
      data: {
        channel: input.channel,
        template: input.template,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        status: 'queued',
      },
    });

    // Sent to the one stored format (+91 and 10 digits); a WhatsApp send then carries the country code.
    const phone = normaliseIndianMobile(input.recipientPhone ?? await this.phoneFor(input.subjectType, input.subjectId));
    const attempt = input.contactAttempt !== false;
    if (!phone) {
      return { row: await this.mark(row.id, 'failed', null, attempt), errorCode: null };
    }

    const variables = input.variables ?? {};
    try {
      if (input.channel === 'whatsapp') {
        const result = await this.whatsapp.sendTemplateMessage(phone, input.template, variables);
        if (result.status === 'failed') {
          const errorCode = result.errorCode ?? null;
          return { row: await this.mark(row.id, 'failed', result.messageId || null, attempt, errorCode), errorCode };
        }
        return { row: await this.mark(row.id, 'sent', result.messageId || null, attempt), errorCode: null };
      }
      const result = await this.sms.sendTemplate(
        phone,
        input.template,
        dltTemplateId(input.template),
        variables,
      );
      if (result.status === 'failed') {
        return { row: await this.mark(row.id, 'failed', result.messageId || null, attempt), errorCode: null };
      }
      return { row: await this.mark(row.id, 'sent', result.messageId || null, attempt), errorCode: null };
    } catch {
      return { row: await this.mark(row.id, 'failed', null, attempt), errorCode: null };
    }
  }

  async applyDelivery(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = process.env.MESSAGE_WEBHOOK_SECRET ?? '';
    if (!callStatusSignatureMatches(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid message status signature');
    }
    let payload: { providerMessageId?: unknown; status?: unknown };
    try {
      payload = JSON.parse(rawBody!.toString('utf8')) as { providerMessageId?: unknown; status?: unknown };
    } catch {
      throw new UnauthorizedException('Invalid message status signature');
    }
    const providerMessageId = typeof payload.providerMessageId === 'string' ? payload.providerMessageId : '';
    const status = typeof payload.status === 'string' ? payload.status : '';
    if (!providerMessageId || !['delivered', 'read', 'failed'].includes(status)) {
      throw new UnauthorizedException('Invalid message status signature');
    }
    const result = await this.applyProviderStatus(providerMessageId, status);
    if (!result) {
      throw new NotFoundException('Message not found');
    }
    return result;
  }

  /**
   * Moves a sent message forward (delivered, read) or fails it, by the
   * provider's message id. Null when no message has that id. The caller has
   * already checked who sent it (signature). Used by the generic status webhook
   * and by the WhatsApp Cloud API webhook (statuses).
   *
   * WhatsApp first (rev 211): "delivered" or "read" means the SMS backup is not
   * needed; "failed" sends the backup SMS at once (between 9 AM and 9 PM; else at
   * 9 AM), and Meta's 131026 marks the number "No WhatsApp". A repeated status
   * changes nothing. `backupHandled` is true when this message has an SMS backup
   * of its own (so the caller sends no other fallback).
   */
  async applyProviderStatus(
    providerMessageId: string,
    status: string,
    errorCode?: string | null,
    now: Date = new Date(),
  ): Promise<{ id: string; unchanged: boolean; backupHandled?: boolean } | null> {
    if (!['delivered', 'read', 'failed'].includes(status)) return null;
    const existing = await this.prisma.messageLog.findUnique({ where: { providerMessageId } });
    if (!existing) {
      return null;
    }
    const backupHandled = existing.smsBackup !== null && existing.smsBackup !== undefined;
    if (!canAdvanceMessageStatus(existing.status, status)) {
      return { id: existing.id, unchanged: true, backupHandled };
    }
    await this.prisma.messageLog.update({
      where: { id: existing.id },
      data: {
        status,
        deliveredAt: status === 'delivered' || status === 'read' ? existing.deliveredAt ?? now : existing.deliveredAt,
        failedAt: status === 'failed' ? now : existing.failedAt,
        errorCode: status === 'failed' && errorCode ? String(errorCode) : existing.errorCode,
      },
    });
    if (status === 'delivered' || status === 'read') {
      await this.prisma.messageLog.updateMany({
        where: { id: existing.id, smsBackup: SMS_BACKUP.pending },
        data: { smsBackup: SMS_BACKUP.notNeeded, smsBackupPayload: null },
      });
    }
    if (status === 'failed' && existing.channel === 'whatsapp') {
      if (isNoWhatsAppError(errorCode)) {
        const phone = openBackupPayload(existing.smsBackupPayload)?.p
          ?? normaliseIndianMobile(await this.phoneFor(existing.subjectType, existing.subjectId));
        if (phone) await markNoWhatsApp(this.prisma, phone, { source: 'meta', errorCode: String(errorCode) });
      }
      if (existing.smsBackup === SMS_BACKUP.pending) {
        if (inWorkingHours(now)) {
          await this.runSmsBackup(existing.id);
        } else {
          // Quiet hours: the SMS goes at 9 AM (the sweep picks it up).
          await this.prisma.messageLog.updateMany({
            where: { id: existing.id, smsBackup: SMS_BACKUP.pending },
            data: { smsBackupDueAt: addWorkingTime(now, 0) },
          });
        }
      }
    }
    return { id: existing.id, unchanged: false, backupHandled };
  }

  /**
   * Sends the SMS backups that are due (WhatsApp first, rev 211): every WhatsApp
   * still not delivered or read 1 working hour after it went. Runs every 2
   * minutes with the WhatsApp sweep; only between 9 AM and 9 PM. Each backup is
   * claimed before it is sent, so two runs never send it twice.
   */
  async sweepSmsBackups(now: Date = new Date(), limit = 200): Promise<{ sent: number; failed: number }> {
    if (!inWorkingHours(now)) return { sent: 0, failed: 0 };
    const due = await this.prisma.messageLog.findMany({
      where: { smsBackup: SMS_BACKUP.pending, smsBackupDueAt: { lte: now } },
      orderBy: { smsBackupDueAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let sent = 0;
    let failed = 0;
    for (const row of due) {
      const outcome = await this.runSmsBackup(row.id);
      if (outcome === 'sent') sent += 1;
      else if (outcome) failed += 1;
    }
    return { sent, failed };
  }

  /** Sends one SMS backup, once: null when it was not (or no longer) waiting. */
  private async runSmsBackup(messageLogId: string): Promise<'sent' | 'failed' | 'skipped' | null> {
    // The claim also checks the WhatsApp was not delivered meanwhile: never both when it was delivered.
    const claimed = await this.prisma.messageLog.updateMany({
      where: { id: messageLogId, smsBackup: SMS_BACKUP.pending, status: { notIn: ['delivered', 'read'] } },
      data: { smsBackup: SMS_BACKUP.sending },
    });
    if (claimed.count !== 1) return null;
    const row = await this.prisma.messageLog.findUnique({ where: { id: messageLogId } });
    const payload = openBackupPayload(row?.smsBackupPayload);
    if (!row || !payload) {
      await this.prisma.messageLog.update({ where: { id: messageLogId }, data: { smsBackup: SMS_BACKUP.failed, smsBackupPayload: null } });
      return 'failed';
    }
    const sms = await this.send({
      channel: 'sms',
      template: row.template,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      variables: payload.v,
      recipientPhone: payload.p,
      contactAttempt: payload.a,
    });
    const outcome = sms.status === 'sent' ? 'sent' : sms.status === 'blocked' ? 'skipped' : 'failed';
    await this.prisma.messageLog.update({
      where: { id: messageLogId },
      data: { smsBackup: SMS_BACKUP[outcome === 'sent' ? 'sent' : outcome === 'skipped' ? 'skipped' : 'failed'], smsBackupMessageLogId: sms.id, smsBackupPayload: null },
    });
    return outcome;
  }

  async list(actor: MessageActor, subjectType: string, subjectId: string) {
    if (!(await this.canRead(actor, subjectType, subjectId))) {
      throw new ForbiddenException('You cannot view these messages');
    }
    const rows = await this.prisma.messageLog.findMany({
      where: { subjectType, subjectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toPublic(row));
  }

  private async mark(id: string, status: 'sent' | 'failed', providerMessageId: string | null, recordAttempt = true, errorCode: string | null = null) {
    const now = new Date();
    const row = await this.prisma.messageLog.update({
      where: { id },
      data: {
        status,
        providerMessageId,
        sentAt: status === 'sent' ? now : null,
        failedAt: status === 'failed' ? now : null,
        errorCode,
      },
    });
    if (recordAttempt && status === 'sent' && row.subjectType === 'job_seeker' && row.subjectId) {
      await this.recordContactAttempt(row);
    }
    return this.toPublic(row);
  }

  private async recordContactAttempt(row: MessageLog) {
    const existing = await this.prisma.contactAttempt.findUnique({
      where: { messageLogId: row.id },
    });
    if (existing) {
      return;
    }
    const attemptedAt = row.sentAt ?? new Date();
    const parts = getCalendarPartsInTimezone(attemptedAt, 'Asia/Kolkata');
    const timeOfDay = parts.hour < 12 ? 'am' : 'pm';
    try {
      await this.prisma.contactAttempt.create({
        data: {
          jobSeekerId: row.subjectId,
          channel: row.channel,
          outcome: 'no_pickup',
          attemptedAt,
          timeOfDay,
          messageLogId: row.id,
        },
      });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== 'P2002') {
        throw err;
      }
    }
  }

  private toPublic(row: MessageLog) {
    return {
      id: row.id,
      channel: row.channel,
      template: row.template,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      providerMessageId: row.providerMessageId,
      status: row.status,
      sentAt: row.sentAt,
      deliveredAt: row.deliveredAt,
      failedAt: row.failedAt,
    };
  }

  /** The record's own phone (job seeker, business owner, referral partner). */
  async phoneFor(subjectType: string, subjectId: string): Promise<string | null> {
    if (subjectType === 'job_seeker') {
      const row = await this.prisma.jobSeeker.findUnique({ where: { id: subjectId }, select: { phone: true } });
      return row?.phone ?? null;
    }
    if (subjectType === 'business') {
      const row = await this.prisma.business.findUnique({ where: { id: subjectId }, select: { phone: true } });
      return row?.phone ?? null;
    }
    if (subjectType === 'referral') {
      const row = await this.prisma.referral.findUnique({ where: { id: subjectId }, select: { phone: true } });
      return row?.phone ?? null;
    }
    return null;
  }

  private async canRead(actor: MessageActor, subjectType: string, subjectId: string): Promise<boolean> {
    if (actor.role === 'ceo' || actor.role === 'manager') {
      return true;
    }
    if (actor.role !== 'team_lead') {
      return false;
    }
    const agentId = await this.responsibleAgentId(subjectType, subjectId);
    if (!agentId) {
      return false;
    }
    if (agentId === actor.id) {
      return true;
    }
    // The shared own-team definition (OwnTeam).
    return new OwnTeam(this.prisma).includes(actor.id, agentId);
  }

  private async responsibleAgentId(subjectType: string, subjectId: string): Promise<string | null> {
    if (subjectType === 'job_seeker') {
      const row = await this.prisma.jobSeeker.findUnique({
        where: { id: subjectId },
        select: { registeredByStaffId: true },
      });
      return row?.registeredByStaffId ?? null;
    }
    return null;
  }
}
