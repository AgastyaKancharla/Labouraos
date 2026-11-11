import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OtpProvider, OtpSendOptions, OtpSendResult } from './otp.interface';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { decryptCallRoutingPhone, encryptCallRoutingPhone } from '../../modules/staff/call-routing-key';

export interface RealOtpProviderOptions {
  apiKey?: string;
  senderId?: string; // DLT registered header (e.g., LABOUR)
  dltTemplateId?: string; // DLT registered template ID
  dltEntityId?: string; // DLT registered principal entity ID
  baseUrl?: string;
  timeProvider?: () => Date;
  fetchFn?: typeof fetch;
}

const RESEND_WAIT_MS = 30_000;
const MAX_RESENDS = 3;
const MAX_WRONG_ATTEMPTS = 5;

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
}

/**
 * Checks whether the given date/time falls inside TRAI commercial window:
 * 09:00–21:00 IST (UTC+05:30).
 */
export function isWithinTraiWindow(date: Date = new Date()): boolean {
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const totalUtcMinutes = utcHours * 60 + utcMinutes;

  // Add 330 minutes for IST (UTC+05:30), modulo 1440
  const istMinutes = (totalUtcMinutes + 330) % 1440;

  // 09:00 IST = 540 minutes, 21:00 IST = 1260 minutes
  return istMinutes >= 540 && istMinutes < 1260;
}

@Injectable()
export class RealOtpProvider implements OtpProvider {
  private readonly logger = new Logger(RealOtpProvider.name);
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly dltTemplateId: string;
  private readonly dltEntityId: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private timeProvider: () => Date;
  private prisma?: PrismaService;

  constructor(options?: RealOtpProviderOptions) {
    this.apiKey =
      options?.apiKey ??
      process.env.SMS_API_KEY ??
      'dummy_sms_api_key';
    this.senderId =
      options?.senderId ??
      process.env.DLT_SENDER_ID ??
      'LABOUR';
    this.dltTemplateId =
      options?.dltTemplateId ??
      process.env.DLT_TEMPLATE_ID ??
      '1007123456789012345';
    this.dltEntityId =
      options?.dltEntityId ??
      process.env.DLT_ENTITY_ID ??
      '1001123456789012345';
    this.baseUrl = (
      options?.baseUrl ??
      process.env.SMS_API_URL ??
      'https://control.msg91.com/api/v5'
    ).replace(/\/$/, '');
    this.timeProvider = options?.timeProvider ?? (() => new Date());
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  setPrismaService(prisma: PrismaService): void {
    this.prisma = prisma;
  }

  setTimeProvider(timeProvider: () => Date): void {
    this.timeProvider = timeProvider;
  }

  getSenderId(): string {
    return this.senderId;
  }

  getDltTemplateId(): string {
    return this.dltTemplateId;
  }

  getDltEntityId(): string {
    return this.dltEntityId;
  }

  async sendOtp(phone: string, options?: OtpSendOptions): Promise<OtpSendResult> {
    const now = this.timeProvider();

    // Enforce 09:00–21:00 IST window per TRAI regulations and Phase 7 Task 1 acceptance
    if (!isWithinTraiWindow(now)) {
      throw new BadRequestException(
        'TRAI compliance: Commercial/OTP messages cannot be transmitted outside 09:00–21:00 IST',
      );
    }

    const cleanPhone = normalizePhone(phone);

    if (options?.requestId) {
      return this.resendOtp(options.requestId, cleanPhone, options.purpose ?? 'job_seeker', now);
    }

    const payload = {
      template_id: this.dltTemplateId,
      mobile: cleanPhone,
      sender: this.senderId,
      entity_id: this.dltEntityId,
      otp_expiry: 5,
    };

    try {
      const response = await this.fetchFn(`${this.baseUrl}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Real SMS vendor returned status ${response.status}: ${errorText}`,
        );
        throw new BadRequestException(`SMS vendor delivery failed: ${errorText}`);
      }

      const data = (await response.json()) as {
        request_id?: string;
        message?: string;
        type?: string;
      };

      const requestId =
        data.request_id ||
        `req_sms_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      if (!this.prisma) throw new Error('PrismaService is required for the real OTP provider');
      await this.prisma.otpSession.create({
        data: {
          requestId,
          phoneHash: createHash('sha256').update(cleanPhone).digest('hex'),
          phoneEncrypted: encryptCallRoutingPhone(cleanPhone),
          purpose: options?.purpose ?? 'job_seeker',
          verified: false,
          lastSentAt: now,
          expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
        },
      });

      return {
        requestId,
        resendAvailableAt: new Date(now.getTime() + RESEND_WAIT_MS).toISOString(),
        resendsLeft: MAX_RESENDS,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Network or delivery failure calling SMS vendor: ${message}`);
      throw new BadRequestException(`SMS vendor request failed: ${message}`);
    }
  }

  async verifyOtp(requestId: string, code: string): Promise<boolean> {
    const prisma = this.prisma;
    if (!prisma) return false;
    const session = await prisma.otpSession.findUnique({ where: { requestId } });
    if (!session) {
      return false;
    }

    if (session.verified || session.usedAt || session.expiresAt <= this.timeProvider() || session.attempts >= MAX_WRONG_ATTEMPTS) {
      // Reject reuse of already verified session
      return false;
    }

    try {
      const queryParams = new URLSearchParams({
        otp: code,
        mobile: decryptCallRoutingPhone(session.phoneEncrypted),
      });

      const response = await this.fetchFn(
        `${this.baseUrl}/otp/verify?${queryParams.toString()}`,
        {
          method: 'POST',
          headers: {
            authkey: this.apiKey,
          },
        },
      );

      if (!response.ok) {
        await prisma.otpSession.update({
          where: { requestId },
          data: { attempts: { increment: 1 } },
        });
        return false;
      }

      const data = (await response.json()) as {
        message?: string;
        type?: string;
      };

      if (data.type === 'success' || data.message === 'OTP verified success') {
        await prisma.otpSession.update({ where: { requestId }, data: { verified: true } });
        return true;
      }

      await prisma.otpSession.update({
        where: { requestId },
        data: { attempts: { increment: 1 } },
      });

      return false;
    } catch (err: unknown) {
      this.logger.error(`Error verifying OTP with vendor: ${String(err)}`);
      return false;
    }
  }

  async isVerified(requestId: string, phone?: string): Promise<boolean> {
    const prisma = this.prisma;
    if (!prisma) return false;
    const session = await prisma.otpSession.findUnique({ where: { requestId } });
    if (!session || !session.verified || session.usedAt || session.expiresAt <= this.timeProvider()) {
      return false;
    }
    if (phone) {
      const cleanPhone = normalizePhone(phone);
      return session.phoneHash === createHash('sha256').update(cleanPhone).digest('hex');
    }
    return true;
  }

  async consumeVerified(requestId: string, phone: string): Promise<boolean> {
    const prisma = this.prisma;
    if (!prisma) return false;
    const now = this.timeProvider();
    const cleanPhone = normalizePhone(phone);
    const result = await prisma.otpSession.updateMany({
      where: {
        requestId,
        phoneHash: createHash('sha256').update(cleanPhone).digest('hex'),
        verified: true,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    return result.count === 1;
  }

  async getPhoneLast4(requestId: string): Promise<string | null> {
    const prisma = this.prisma;
    if (!prisma) return null;
    const session = await prisma.otpSession.findUnique({ where: { requestId } });
    return session ? decryptCallRoutingPhone(session.phoneEncrypted).slice(-4) : null;
  }

  private async resendOtp(
    requestId: string,
    cleanPhone: string,
    purpose: string,
    now: Date,
  ): Promise<OtpSendResult> {
    const prisma = this.prisma;
    if (!prisma) throw new BadRequestException('PrismaService is required for the real OTP provider');
    const session = await prisma.otpSession.findUnique({ where: { requestId } });
    if (!session || session.expiresAt <= now || session.verified || session.usedAt || session.attempts >= MAX_WRONG_ATTEMPTS) {
      throw new BadRequestException('OTP request is no longer active; request a new code');
    }
    if (
      session.phoneHash !== createHash('sha256').update(cleanPhone).digest('hex') ||
      session.purpose !== purpose
    ) {
      throw new BadRequestException('OTP resend must use the original phone number and purpose');
    }
    const resendAvailableAt = new Date(session.lastSentAt.getTime() + RESEND_WAIT_MS);
    if (now < resendAvailableAt) {
      throw new BadRequestException(`Resend is available at ${resendAvailableAt.toISOString()}`);
    }
    if (session.resendCount >= MAX_RESENDS) {
      throw new BadRequestException('The maximum of 3 OTP resends has been reached');
    }

    const updated = await prisma.otpSession.updateMany({
      where: {
        requestId,
        verified: false,
        usedAt: null,
        attempts: { lt: MAX_WRONG_ATTEMPTS },
        resendCount: { lt: MAX_RESENDS },
        lastSentAt: { lte: new Date(now.getTime() - RESEND_WAIT_MS) },
      },
      data: { resendCount: { increment: 1 }, lastSentAt: now },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('OTP resend was already requested; wait 30 seconds before retrying');
    }

    const encoded = new URLSearchParams({
      request_id: requestId,
      mobile: `91${cleanPhone}`,
      retrytype: 'text',
    });
    try {
      const response = await this.fetchFn(`${this.baseUrl}/otp/retry?${encoded.toString()}`, {
        method: 'GET',
        headers: { authkey: this.apiKey },
      });
      if (!response.ok) {
        throw new BadRequestException(`SMS vendor resend failed: ${await response.text()}`);
      }
      return {
        requestId,
        resendAvailableAt: new Date(now.getTime() + RESEND_WAIT_MS).toISOString(),
        resendsLeft: MAX_RESENDS - session.resendCount - 1,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('SMS vendor resend request failed');
    }
  }
}
