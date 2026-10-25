import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OtpProvider } from './otp.interface';

export interface RealOtpProviderOptions {
  apiKey?: string;
  senderId?: string; // DLT registered header (e.g., LABOUR)
  dltTemplateId?: string; // DLT registered template ID
  dltEntityId?: string; // DLT registered principal entity ID
  baseUrl?: string;
  timeProvider?: () => Date;
  fetchFn?: typeof fetch;
}

export interface RealOtpSession {
  requestId: string;
  phone: string;
  verified: boolean;
  createdAt: number;
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
  private sessions = new Map<string, RealOtpSession>();

  constructor(options?: RealOtpProviderOptions) {
    this.apiKey =
      options?.apiKey ??
      process.env.SMS_API_KEY ??
      process.env.OTP_API_KEY ??
      'dummy_sms_api_key';
    this.senderId =
      options?.senderId ??
      process.env.DLT_SENDER_ID ??
      process.env.SMS_SENDER_ID ??
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

  async sendOtp(phone: string): Promise<{ requestId: string }> {
    const now = this.timeProvider();

    // Enforce 09:00–21:00 IST window per TRAI regulations and Phase 7 Task 1 acceptance
    if (!isWithinTraiWindow(now)) {
      throw new BadRequestException(
        'TRAI compliance: Commercial/OTP messages cannot be transmitted outside 09:00–21:00 IST',
      );
    }

    const cleanPhone = phone.startsWith('+91')
      ? phone.slice(3)
      : phone.replace(/\D/g, '');

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

      this.sessions.set(requestId, {
        requestId,
        phone: cleanPhone,
        verified: false,
        createdAt: now.getTime(),
      });

      return { requestId };
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
    const session = this.sessions.get(requestId);
    if (!session) {
      return false;
    }

    if (session.verified) {
      // Reject reuse of already verified session
      return false;
    }

    try {
      const queryParams = new URLSearchParams({
        otp: code,
        mobile: session.phone,
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
        return false;
      }

      const data = (await response.json()) as {
        message?: string;
        type?: string;
      };

      if (data.type === 'success' || data.message === 'OTP verified success') {
        session.verified = true;
        return true;
      }

      return false;
    } catch (err: unknown) {
      this.logger.error(`Error verifying OTP with vendor: ${String(err)}`);
      return false;
    }
  }

  async isVerified(requestId: string, phone?: string): Promise<boolean> {
    const session = this.sessions.get(requestId);
    if (!session || !session.verified) {
      return false;
    }
    if (phone) {
      const cleanPhone = phone.startsWith('+91')
        ? phone.slice(3)
        : phone.replace(/\D/g, '');
      return session.phone === cleanPhone;
    }
    return true;
  }
}
