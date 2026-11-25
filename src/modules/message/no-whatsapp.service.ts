import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { clearNoWhatsApp, markNoWhatsApp, noWhatsAppFor } from './no-whatsapp';

const KINDS = ['job_seeker', 'business', 'referral'] as const;
type Kind = (typeof KINDS)[number];

export interface NoWhatsAppView {
  noWhatsApp: boolean;
  /** meta: WhatsApp said the number cannot get messages; staff: an agent marked it. */
  source: 'meta' | 'staff' | null;
  since: string | null;
}

/**
 * "No WhatsApp" on a person's profile (Master Guide rev 211), call agent console
 * only: shows whether the person's number is marked, and lets the agent mark or
 * clear it. Stored per number (no-whatsapp.ts); every change is audited (never
 * the number).
 */
@Injectable()
export class NoWhatsAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async view(kind: unknown, id: unknown): Promise<NoWhatsAppView> {
    const record = await this.record(kind, id);
    const row = await noWhatsAppFor(this.prisma, record.phone);
    return { noWhatsApp: Boolean(row), source: (row?.source as 'meta' | 'staff' | undefined) ?? null, since: row?.createdAt.toISOString() ?? null };
  }

  async set(actor: { id: string }, kind: unknown, id: unknown, noWhatsApp: unknown): Promise<NoWhatsAppView> {
    if (typeof noWhatsApp !== 'boolean') throw new BadRequestException('noWhatsApp must be true or false');
    const record = await this.record(kind, id);
    if (!record.phone) throw new BadRequestException('This record has no mobile number');
    const before = Boolean(await noWhatsAppFor(this.prisma, record.phone));
    if (noWhatsApp) await markNoWhatsApp(this.prisma, record.phone, { source: 'staff', staffId: actor.id });
    else await clearNoWhatsApp(this.prisma, record.phone);
    if (before !== noWhatsApp) {
      await this.audit.log({
        actorId: actor.id,
        action: noWhatsApp ? 'contact.no_whatsapp_marked' : 'contact.no_whatsapp_cleared',
        entityType: record.kind,
        entityCode: record.code,
        before: { noWhatsApp: before },
        after: { noWhatsApp },
        changedFields: ['noWhatsApp'],
        city: record.city ?? 'Bengaluru',
      });
    }
    return this.view(record.kind, record.id);
  }

  private async record(kind: unknown, id: unknown): Promise<{ kind: Kind; id: string; code: string; phone: string | null; city: string | null }> {
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw new BadRequestException('kind must be job_seeker, business or referral');
    if (typeof id !== 'string' || !id.trim() || id.length > 64) throw new BadRequestException('id is required');
    const select = { id: true, code: true, phone: true, city: true } as const;
    const row = kind === 'job_seeker'
      ? await this.prisma.jobSeeker.findUnique({ where: { id }, select })
      : kind === 'business'
        ? await this.prisma.business.findUnique({ where: { id }, select })
        : await this.prisma.referral.findUnique({ where: { id }, select });
    if (!row) throw new NotFoundException('Record not found');
    return { kind: kind as Kind, id: row.id, code: row.code, phone: row.phone, city: row.city };
  }
}
