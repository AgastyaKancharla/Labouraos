import { BadRequestException, Logger } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { nationalMobileDigits } from '../phone/indian-mobile';
import { WhatsAppProvider } from '../whatsapp/whatsapp.interface';
import { isNoWhatsAppError } from '../whatsapp/real-whatsapp.provider';
import { decryptCallRoutingPhone, encryptCallRoutingPhone } from '../../modules/staff/call-routing-key';
import { isNoWhatsApp, markNoWhatsApp } from '../../modules/message/no-whatsapp';
import { OtpProvider, OtpSendOptions, OtpSendResult } from './otp.interface';
import { otpTestModeEnabled } from './otp-test-mode';

/** Request ids of codes this provider made (WhatsApp first); any other id belongs to the SMS sender. */
export const WHATSAPP_OTP_PREFIX = 'wa_otp_';
export const WHATSAPP_OTP_TEMPLATE = 'verification_code';
const TTL_MS = 5 * 60 * 1000;
const RESEND_WAIT_MS = 30_000;
const MAX_RESENDS = 3;
const MAX_WRONG_ATTEMPTS = 5;

function tenDigits(phone: string): string {
  return nationalMobileDigits(phone);
}

function phoneHashOf(phone: string): string {
  return createHash('sha256').update(tenDigits(phone)).digest('hex');
}

function codeKey(): Buffer {
  return createHash('sha256').update(`laboura:whatsapp-otp:${process.env.JWT_SECRET ?? ''}`).digest();
}

/** The stored form of a WhatsApp code: an HMAC bound to its request. The code itself is never stored or logged. */
export function whatsappCodeHash(requestId: string, code: string): string {
  return createHmac('sha256', codeKey()).update(`${requestId}:${code}`).digest('hex');
}

/**
 * Login and confirmation codes, WhatsApp first (Master Guide rev 211).
 *
 * Who owns which code:
 * - A code sent on WhatsApp (the `verification_code` Authentication template,
 *   copy-code button) is made here: 6 random digits, kept only as an HMAC in
 *   OtpSession (channel `whatsapp`), request id `wa_otp_…`.
 * - A code sent by SMS is the SMS sender's own (`inner`): the mock sender's, or
 *   the real OTP vendor's, which makes and checks its own code (the server never
 *   sees it).
 * - "Send by SMS" on a WhatsApp code (the code screens offer it after 30
 *   seconds) asks the SMS sender for its code and links that request to ours
 *   (`smsRequestId`), so the screen keeps its request id and either code is
 *   accepted — with the same 5 minutes, 5 wrong tries (shared), 30-second resend
 *   wait and 3 resends.
 * - A number marked "No WhatsApp", a WhatsApp send Meta refuses, or `channel:
 *   'sms'` on a fresh send: the SMS sender's request is used as it is.
 * - Meta reporting a WhatsApp code "failed" later (onWhatsAppFailed): its SMS
 *   goes at once, linked the same way.
 *
 * Used only while WHATSAPP_PROVIDER_MODE is live (OtpModule); with a pretend
 * WhatsApp every code goes by the SMS sender as before.
 */
export class WhatsAppFirstOtpProvider implements OtpProvider {
  private readonly logger = new Logger(WhatsAppFirstOtpProvider.name);

  constructor(
    private readonly inner: OtpProvider,
    private readonly whatsapp: WhatsAppProvider,
    private readonly prisma: PrismaService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The SMS sender behind it (the mock or the real OTP vendor). */
  get smsSender(): OtpProvider {
    return this.inner;
  }

  async sendOtp(phone: string, options?: OtpSendOptions): Promise<OtpSendResult> {
    const purpose = options?.purpose ?? 'job_seeker';
    if (options?.requestId?.startsWith(WHATSAPP_OTP_PREFIX)) {
      return this.resend(options.requestId, phone, purpose, options.channel);
    }
    if (options?.requestId) return this.inner.sendOtp(phone, { purpose, requestId: options.requestId });
    if (options?.channel === 'sms' || (await isNoWhatsApp(this.prisma, phone))) {
      return this.inner.sendOtp(phone, { purpose });
    }
    return this.sendNew(phone, purpose);
  }

  private async sendNew(phone: string, purpose: string): Promise<OtpSendResult> {
    const now = this.now();
    const requestId = `${WHATSAPP_OTP_PREFIX}${randomBytes(12).toString('hex')}`;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpSession.create({
      data: {
        requestId,
        phoneHash: phoneHashOf(phone),
        phoneEncrypted: encryptCallRoutingPhone(tenDigits(phone)),
        purpose,
        channel: 'whatsapp',
        codeHash: whatsappCodeHash(requestId, code),
        verified: false,
        lastSentAt: now,
        expiresAt: new Date(now.getTime() + TTL_MS),
      },
    });
    const sent = await this.sendOnWhatsApp(requestId, phone, code);
    if (!sent) {
      // WhatsApp did not take it: the SMS sender's own code instead.
      await this.prisma.otpSession.deleteMany({ where: { requestId } });
      return this.inner.sendOtp(phone, { purpose });
    }
    return this.result(requestId, now, MAX_RESENDS, code, 'whatsapp');
  }

  /** True when WhatsApp took the code; a 131026 refusal marks the number "No WhatsApp". */
  private async sendOnWhatsApp(requestId: string, phone: string, code: string): Promise<boolean> {
    try {
      const res = await this.whatsapp.sendTemplateMessage(phone, WHATSAPP_OTP_TEMPLATE, { code });
      if (res.status !== 'sent') {
        if (isNoWhatsAppError(res.errorCode)) await markNoWhatsApp(this.prisma, phone, { source: 'meta', errorCode: res.errorCode });
        return false;
      }
      if (res.messageId) {
        await this.prisma.otpSession.update({ where: { requestId }, data: { whatsappMessageId: res.messageId } });
      }
      return true;
    } catch (err: unknown) {
      this.logger.warn(`WhatsApp code not sent: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async resend(requestId: string, phone: string, purpose: string, channel: OtpSendOptions['channel']): Promise<OtpSendResult> {
    const now = this.now();
    const session = await this.prisma.otpSession.findUnique({ where: { requestId } });
    if (!session || session.expiresAt <= now || session.verified || session.usedAt || session.attempts >= MAX_WRONG_ATTEMPTS) {
      throw new BadRequestException('OTP request is no longer active; request a new code');
    }
    if (session.phoneHash !== phoneHashOf(phone) || session.purpose !== purpose) {
      throw new BadRequestException('OTP resend must use the original phone number and purpose');
    }
    const resendAvailableAt = new Date(session.lastSentAt.getTime() + RESEND_WAIT_MS);
    if (now < resendAvailableAt) {
      throw new BadRequestException(`Resend is available at ${resendAvailableAt.toISOString()}`);
    }
    if (session.resendCount >= MAX_RESENDS) {
      throw new BadRequestException('The maximum of 3 OTP resends has been reached');
    }
    const claimed = await this.prisma.otpSession.updateMany({
      where: {
        requestId,
        verified: false,
        usedAt: null,
        attempts: { lt: MAX_WRONG_ATTEMPTS },
        resendCount: { lt: MAX_RESENDS },
        lastSentAt: { lte: new Date(now.getTime() - RESEND_WAIT_MS) },
      },
      data: { resendCount: { increment: 1 }, lastSentAt: now, expiresAt: new Date(now.getTime() + TTL_MS) },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('OTP resend was already requested; wait 30 seconds before retrying');
    }
    const resendsLeft = MAX_RESENDS - session.resendCount - 1;
    if (channel !== 'sms' && !(await isNoWhatsApp(this.prisma, phone))) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.otpSession.update({ where: { requestId }, data: { codeHash: whatsappCodeHash(requestId, code) } });
      if (await this.sendOnWhatsApp(requestId, phone, code)) return this.result(requestId, now, resendsLeft, code, 'whatsapp');
    }
    const sms = await this.smsFor(session.smsRequestId, phone, purpose);
    await this.prisma.otpSession.update({ where: { requestId }, data: { smsRequestId: sms.requestId } });
    return this.result(requestId, now, resendsLeft, sms.testModeCode, 'sms');
  }

  /** The SMS sender's code for this request: a resend of its own request when it is still open, else a fresh one. */
  private async smsFor(smsRequestId: string | null, phone: string, purpose: string): Promise<OtpSendResult> {
    if (smsRequestId) {
      try {
        return await this.inner.sendOtp(phone, { purpose, requestId: smsRequestId });
      } catch {
        // Its own request ended or is still in its wait: a fresh one.
      }
    }
    return this.inner.sendOtp(phone, { purpose });
  }

  private result(requestId: string, sentAt: Date, resendsLeft: number, testCode: string | undefined, sentBy: 'whatsapp' | 'sms'): OtpSendResult {
    return {
      requestId,
      sentBy,
      resendAvailableAt: new Date(sentAt.getTime() + RESEND_WAIT_MS).toISOString(),
      resendsLeft,
      // Test mode only (OTP and SMS pretend, rev 211): the screen shows the code even with a live WhatsApp.
      ...(testCode && otpTestModeEnabled() ? { testModeCode: testCode } : {}),
    };
  }

  async verifyOtp(requestId: string, code: string): Promise<boolean> {
    if (typeof requestId !== 'string' || !requestId.startsWith(WHATSAPP_OTP_PREFIX)) return this.inner.verifyOtp(requestId, code);
    if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) return false;
    const now = this.now();
    const session = await this.prisma.otpSession.findUnique({ where: { requestId } });
    if (!session || session.verified || session.usedAt || session.expiresAt <= now || session.attempts >= MAX_WRONG_ATTEMPTS) return false;
    // Every try is counted before the comparison (never more than 5).
    const tried = await this.prisma.otpSession.updateMany({
      where: { requestId, verified: false, usedAt: null, attempts: { lt: MAX_WRONG_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (tried.count !== 1) return false;
    let ok = false;
    if (session.codeHash) {
      const given = Buffer.from(whatsappCodeHash(requestId, code), 'hex');
      const stored = Buffer.from(session.codeHash, 'hex');
      ok = given.length === stored.length && timingSafeEqual(given, stored);
    }
    if (!ok && session.smsRequestId) ok = await this.inner.verifyOtp(session.smsRequestId, code);
    if (!ok) return false;
    await this.prisma.otpSession.update({ where: { requestId }, data: { verified: true } });
    return true;
  }

  async isVerified(requestId: string, phone?: string, purpose?: string): Promise<boolean> {
    if (!requestId?.startsWith(WHATSAPP_OTP_PREFIX)) return this.inner.isVerified ? this.inner.isVerified(requestId, phone, purpose) : false;
    const session = await this.prisma.otpSession.findUnique({ where: { requestId } });
    if (!session || !session.verified || session.usedAt || session.expiresAt <= this.now()) return false;
    if (purpose !== undefined && session.purpose !== purpose) return false;
    if (phone && session.phoneHash !== phoneHashOf(phone)) return false;
    return true;
  }

  async consumeVerified(requestId: string, phone: string, purpose?: string): Promise<boolean> {
    if (!requestId?.startsWith(WHATSAPP_OTP_PREFIX)) return this.inner.consumeVerified ? this.inner.consumeVerified(requestId, phone, purpose) : false;
    const now = this.now();
    const { count } = await this.prisma.otpSession.updateMany({
      where: {
        requestId,
        ...(purpose !== undefined ? { purpose } : {}),
        phoneHash: phoneHashOf(phone),
        verified: true,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    return count === 1;
  }

  async getPurpose(requestId: string): Promise<string | null> {
    if (!requestId?.startsWith(WHATSAPP_OTP_PREFIX)) return this.inner.getPurpose ? this.inner.getPurpose(requestId) : null;
    const session = await this.prisma.otpSession.findUnique({ where: { requestId }, select: { purpose: true } });
    return session?.purpose ?? null;
  }

  async getPhoneLast4(requestId: string): Promise<string | null> {
    if (!requestId?.startsWith(WHATSAPP_OTP_PREFIX)) return this.inner.getPhoneLast4 ? this.inner.getPhoneLast4(requestId) : null;
    const session = await this.prisma.otpSession.findUnique({ where: { requestId }, select: { phoneEncrypted: true } });
    return session ? decryptCallRoutingPhone(session.phoneEncrypted).slice(-4) : null;
  }

  /**
   * Meta reported a WhatsApp code "failed" (the webhook): the code goes by SMS
   * now (the SMS sender's code, linked to the same request) and, for 131026, the
   * number is marked "No WhatsApp". False when the message was not a code.
   */
  async onWhatsAppFailed(providerMessageId: string, errorCode: string | null): Promise<boolean> {
    const session = await this.prisma.otpSession.findUnique({ where: { whatsappMessageId: providerMessageId } });
    if (!session) return false;
    const phone = decryptCallRoutingPhone(session.phoneEncrypted);
    if (isNoWhatsAppError(errorCode)) await markNoWhatsApp(this.prisma, phone, { source: 'meta', errorCode });
    if (session.verified || session.usedAt || session.expiresAt <= this.now() || session.smsRequestId) return true;
    const sms = await this.inner.sendOtp(phone, { purpose: session.purpose });
    await this.prisma.otpSession.updateMany({ where: { requestId: session.requestId, smsRequestId: null }, data: { smsRequestId: sms.requestId } });
    return true;
  }
}
