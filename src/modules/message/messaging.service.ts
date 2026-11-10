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

export interface SendMessageInput {
  channel: 'sms' | 'whatsapp';
  template: string;
  subjectType: string;
  subjectId: string;
  relatedType?: string | null;
  relatedId?: string | null;
  variables?: Record<string, string>;
  recipientPhone?: string;
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

  async send(input: SendMessageInput) {
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

    const phone = input.recipientPhone ?? await this.phoneFor(input.subjectType, input.subjectId);
    if (!phone) {
      return this.mark(row.id, 'failed', null);
    }

    const variables = input.variables ?? {};
    try {
      if (input.channel === 'whatsapp') {
        const result = await this.whatsapp.sendTemplateMessage(phone, input.template, variables);
        if (result.status === 'failed') {
          return this.mark(row.id, 'failed', result.messageId || null);
        }
        return this.mark(row.id, 'sent', result.messageId || null);
      }
      const result = await this.sms.sendTemplate(
        phone,
        input.template,
        dltTemplateId(input.template),
        variables,
      );
      if (result.status === 'failed') {
        return this.mark(row.id, 'failed', result.messageId || null);
      }
      return this.mark(row.id, 'sent', result.messageId || null);
    } catch {
      return this.mark(row.id, 'failed', null);
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
    const existing = await this.prisma.messageLog.findUnique({ where: { providerMessageId } });
    if (!existing) {
      throw new NotFoundException('Message not found');
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

  private async mark(id: string, status: 'sent' | 'failed', providerMessageId: string | null) {
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
    if (status === 'sent' && row.subjectType === 'job_seeker' && row.subjectId) {
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
    const agent = await this.prisma.staff.findUnique({
      where: { id: agentId },
      select: { teamLeadId: true },
    });
    return agent?.teamLeadId === actor.id;
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
