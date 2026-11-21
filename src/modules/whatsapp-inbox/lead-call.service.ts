import { BadRequestException, ForbiddenException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IdService } from '../../common/id/id.service';
import { codedError } from '../../common/http/coded-error';
import { mobileLookupValues, normaliseIndianMobile, phoneLast4 } from '../../common/phone/indian-mobile';
import { TELEPHONY_PROVIDER, TelephonyProvider } from '../telephony/telephony.interface';
import { decryptCallRoutingPhone } from '../staff/call-routing-key';
import { CALL_ANNOUNCEMENT } from '../call/call-announcement';
import { isWithinClockWindow } from '../call/call-window';
import { PricingService } from '../pricing/pricing.service';
import { AttendanceService } from '../attendance/attendance.service';
import { MessagingService } from '../message/messaging.service';
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';

export interface LeadCallActor {
  id: string;
  role: string;
}

/** How long a registration prefill reference stays usable. */
export const PREFILL_TTL_MS = 30 * 60 * 1000;

function prefillKey(): Buffer {
  return createHash('sha256').update(`laboura:registration-prefill:${process.env.JWT_SECRET ?? ''}`).digest();
}

/**
 * A registration prefill reference (21 Nov review S1): the lead's number,
 * encrypted for the agent it was issued to and valid 30 minutes, so the full
 * number never reaches the browser. The server resolves it back to the number.
 */
export function issueRegistrationPrefill(phone: string, staffId: string, now: Date): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', prefillKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ p: phone, s: staffId, e: now.getTime() + PREFILL_TTL_MS }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** The number behind a prefill reference, only for the agent it was issued to and only while valid; else null. */
export function resolveRegistrationPrefill(ref: unknown, staffId: string, now: Date): string | null {
  if (typeof ref !== 'string' || ref.length < 40 || ref.length > 400) return null;
  try {
    const raw = Buffer.from(ref, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', prefillKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const parsed = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as { p: string; s: string; e: number };
    if (parsed.s !== staffId || parsed.e < now.getTime()) return null;
    return parsed.p;
  } catch {
    return null;
  }
}

/**
 * Calls a number the agent may not see (21 Nov review S1): a WhatsApp
 * conversation with a new person, or a referral partner's lead. The same
 * checks and the same calling system as any click-to-call (calling hours, the
 * agent's calling phone, Available, the recorded-call announcement), through
 * the telephony provider the call module uses; the call record has no person
 * yet and points at the conversation or lead. Nobody with a live "do not call"
 * on this number is rung.
 */
@Injectable()
export class LeadCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ids: IdService,
    private readonly pricing: PricingService,
    private readonly attendance: AttendanceService,
    private readonly messaging: MessagingService,
    private readonly clock: WhatsAppInboxClock,
    @Inject(TELEPHONY_PROVIDER) private readonly telephony: TelephonyProvider,
  ) {}

  /** Any record on this number with a live do not call (the number, not only a linked record). */
  async doNotCallOnNumber(phone: string): Promise<boolean> {
    for (const s of await this.subjectsOnNumber(phone)) {
      if ((await this.messaging.contactBlocksFor(s.type, s.id)).has('do_not_call')) return true;
    }
    return false;
  }

  /** Any live block (wrong number or do not call) on any record with this number. */
  async messagesBlockedOnNumber(phone: string): Promise<boolean> {
    for (const s of await this.subjectsOnNumber(phone)) {
      if ((await this.messaging.contactBlocksFor(s.type, s.id)).size > 0) return true;
    }
    return false;
  }

  private async subjectsOnNumber(phone: string): Promise<Array<{ type: string; id: string }>> {
    const values = mobileLookupValues(phone);
    if (values.length === 0) return [];
    const [seekers, businesses, partners] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { OR: [{ phone: { in: values } }, { whatsappPhone: { in: values } }] }, select: { id: true } }),
      this.prisma.business.findMany({ where: { OR: [{ phone: { in: values } }, { contactWhatsAppPhone: { in: values } }] }, select: { id: true } }),
      this.prisma.referral.findMany({ where: { OR: [{ phone: { in: values } }, { whatsappPhone: { in: values } }] }, select: { id: true } }),
    ]);
    return [
      ...seekers.map((r) => ({ type: 'job_seeker', id: r.id })),
      ...businesses.map((r) => ({ type: 'business', id: r.id })),
      ...partners.map((r) => ({ type: 'referral', id: r.id })),
    ];
  }

  async call(actor: LeadCallActor, phone: string, related: { type: 'whatsapp_conversation' | 'referral_lead'; id: string }) {
    if (actor.role !== 'call_agent') throw new ForbiddenException('Calls from this list are placed by call agents');
    const customerPhone = normaliseIndianMobile(phone);
    if (!customerPhone) throw new BadRequestException('There is no number to call');
    if (await this.doNotCallOnNumber(customerPhone)) {
      throw codedError(HttpStatus.FORBIDDEN, 'DO_NOT_CALL', 'This number asked not to be called (do not call). A Team Lead can lift it.');
    }
    const now = this.clock.now();
    const policy = await this.pricing.current();
    if (!isWithinClockWindow(now, policy.callingHoursStart, policy.callingHoursEnd)) {
      throw new BadRequestException(`Calls are only placed between ${policy.callingHoursStart} and ${policy.callingHoursEnd} IST`);
    }
    const caller = await this.prisma.staff.findUnique({ where: { id: actor.id }, select: { callRoutingPhone: true } });
    if (!caller?.callRoutingPhone) {
      throw new BadRequestException('Set the phone the calling system rings before placing a call: Home → "Your calling phone"');
    }
    const agentPhone = normaliseIndianMobile(decryptCallRoutingPhone(caller.callRoutingPhone));
    if (!(await this.attendance.isAvailable(actor.id))) {
      throw new BadRequestException('Calls are placed only while you are Available');
    }
    const code = await this.ids.generateCode('call');
    const created = await this.prisma.callRecord.create({
      data: {
        code,
        provider: this.telephony.getCapacity().vendor,
        providerCallId: `pending-${code}`,
        direction: 'outbound',
        staffId: actor.id,
        subjectType: null,
        subjectId: null,
        purpose: 'general',
        relatedType: related.type,
        relatedId: related.id,
        providerStatus: 'initiated',
        answered: false,
        announcementPlayed: true,
      },
    });
    const result = await this.telephony.initiateOutboundCall({
      agentPhone,
      customerPhone,
      recordCall: true,
      ringAgentFirst: true,
      announcement: CALL_ANNOUNCEMENT,
      metadata: { callRecordId: created.id },
    });
    if (result.callId && result.callId !== created.providerCallId) {
      await this.prisma.callRecord.update({ where: { id: created.id }, data: { providerCallId: result.callId } });
    }
    await this.audit.log({
      actorId: actor.id,
      action: `${related.type}.call_placed`,
      entityType: related.type,
      entityCode: related.id,
      after: { callRecordId: created.id, phoneLast4: phoneLast4(customerPhone) },
    });
    return { callRecordId: created.id, callCode: code };
  }
}
