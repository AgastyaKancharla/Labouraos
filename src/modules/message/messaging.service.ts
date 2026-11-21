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
import { isIndianMobile, nationalMobileDigits, normaliseIndianMobile } from '../../common/phone/indian-mobile';
import { createHash } from 'crypto';
import { recordTestModeLink } from '../../common/test-mode-link';

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
}

/** Call outcomes after which no message goes to that person (Builder B adds them, 21 Nov). */
export const MESSAGE_BLOCKING_OUTCOMES = ['do_not_call', 'wrong_number'] as const;
export type MessageBlockKind = (typeof MESSAGE_BLOCKING_OUTCOMES)[number];

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

/** SHA-256 of the 10 national digits (same as ContactBlock.phoneHash, src/modules/call/contact-block.ts). */
export function contactPhoneHash(phone: string | null | undefined): string {
  const raw = String(phone ?? '');
  const digits = isIndianMobile(raw) ? nationalMobileDigits(raw) : raw.replace(/\D/g, '').slice(-10);
  return createHash('sha256').update(digits).digest('hex');
}

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
   * Sends on WhatsApp and, when WhatsApp is not available or the send fails,
   * the same template by SMS (21 Nov, rev 202). Nothing goes to a person with a
   * live "wrong number" or "do not call" block (contactBlocksFor), unless the
   * template is exempt (MESSAGE_BLOCK_EXEMPT_TEMPLATES).
   */
  async sendPreferWhatsApp(input: Omit<SendMessageInput, 'channel'>): Promise<PreferWhatsAppResult> {
    if (!input.agentReply && (await this.messagingBlocked(input.subjectType, input.subjectId, input.template))) {
      return { channel: null, status: 'blocked', whatsappMessageId: null, smsMessageId: null };
    }
    const wa = await this.send({ ...input, channel: 'whatsapp' });
    if (wa.status === 'sent') {
      return { channel: 'whatsapp', status: 'sent', whatsappMessageId: wa.id, smsMessageId: null };
    }
    const sms = await this.send({ ...input, channel: 'sms' });
    return {
      channel: sms.status === 'sent' ? 'sms' : null,
      status: sms.status === 'sent' ? 'sent' : 'failed',
      whatsappMessageId: wa.id,
      smsMessageId: sms.id,
    };
  }

  /**
   * True when no message may go to this person: any call ended in "do not call",
   * or the latest call with an outcome ended in "wrong number" (a later answered
   * call with another outcome clears it).
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
   * The live "wrong number" / "do not call" blocks for one person.
   *
   * INTEGRATION POINT (Builder B, PR #166): once ContactBlock is on main this whole
   * body becomes `blocksFor(this.prisma, { subjectType, subjectId })` from
   * src/modules/call/contact-block.ts (messagesBlocked is "size > 0"). Until then:
   * - when the ContactBlock table exists (B's migration ran), the same rule as B's
   *   helper, read with SQL: live rows only (a lift ends a block), and a wrong
   *   number counts only while the record still has the number it was recorded on;
   * - otherwise the call outcomes: the latest call with an outcome decides, so a
   *   later answered call with another outcome lifts a wrong number or do not call.
   */
  async contactBlocksFor(subjectType: string, subjectId: string): Promise<Set<MessageBlockKind>> {
    const out = new Set<MessageBlockKind>();
    if (await this.contactBlockTablePresent()) {
      const rows = await this.prisma.$queryRaw<Array<{ kind: string; phoneHash: string }>>`
        SELECT "kind", "phoneHash" FROM "ContactBlock"
        WHERE "subjectType" = ${subjectType} AND "subjectId" = ${subjectId} AND "liftedAt" IS NULL`;
      for (const row of rows) {
        if (row.kind === 'wrong_number') {
          const phone = await this.phoneFor(subjectType, subjectId);
          if (contactPhoneHash(phone) !== row.phoneHash) continue;
        }
        if (row.kind === 'wrong_number' || row.kind === 'do_not_call') out.add(row.kind);
      }
      return out;
    }
    const latest = await this.prisma.callRecord.findFirst({
      where: { subjectType, subjectId, agentOutcome: { not: null } },
      orderBy: [{ agentOutcomeAt: 'desc' }, { createdAt: 'desc' }],
      select: { agentOutcome: true },
    });
    if (latest?.agentOutcome === 'wrong_number' || latest?.agentOutcome === 'do_not_call') out.add(latest.agentOutcome);
    return out;
  }

  private contactBlockTable: Promise<boolean> | null = null;

  private contactBlockTablePresent(): Promise<boolean> {
    if (!this.contactBlockTable) {
      this.contactBlockTable = this.prisma
        .$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('public."ContactBlock"') IS NOT NULL AS "present"`
        .then((rows) => Boolean(rows[0]?.present))
        .catch(() => false);
    }
    return this.contactBlockTable;
  }

  async send(input: SendMessageInput) {
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
      return this.toPublic(blocked);
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
      return this.mark(row.id, 'failed', null, attempt);
    }

    const variables = input.variables ?? {};
    try {
      if (input.channel === 'whatsapp') {
        const result = await this.whatsapp.sendTemplateMessage(phone, input.template, variables);
        if (result.status === 'failed') {
          return this.mark(row.id, 'failed', result.messageId || null, attempt);
        }
        return this.mark(row.id, 'sent', result.messageId || null, attempt);
      }
      const result = await this.sms.sendTemplate(
        phone,
        input.template,
        dltTemplateId(input.template),
        variables,
      );
      if (result.status === 'failed') {
        return this.mark(row.id, 'failed', result.messageId || null, attempt);
      }
      return this.mark(row.id, 'sent', result.messageId || null, attempt);
    } catch {
      return this.mark(row.id, 'failed', null, attempt);
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
   */
  async applyProviderStatus(providerMessageId: string, status: string): Promise<{ id: string; unchanged: boolean } | null> {
    if (!['delivered', 'read', 'failed'].includes(status)) return null;
    const existing = await this.prisma.messageLog.findUnique({ where: { providerMessageId } });
    if (!existing) {
      return null;
    }
    if (!canAdvanceMessageStatus(existing.status, status)) {
      return { id: existing.id, unchanged: true };
    }
    const now = new Date();
    await this.prisma.messageLog.update({
      where: { id: existing.id },
      data: {
        status,
        deliveredAt: status === 'delivered' || status === 'read' ? existing.deliveredAt ?? now : existing.deliveredAt,
        failedAt: status === 'failed' ? now : existing.failedAt,
      },
    });
    return { id: existing.id, unchanged: false };
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

  private async mark(id: string, status: 'sent' | 'failed', providerMessageId: string | null, recordAttempt = true) {
    const now = new Date();
    const row = await this.prisma.messageLog.update({
      where: { id },
      data: {
        status,
        providerMessageId,
        sentAt: status === 'sent' ? now : null,
        failedAt: status === 'failed' ? now : null,
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

  private async phoneFor(subjectType: string, subjectId: string): Promise<string | null> {
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
