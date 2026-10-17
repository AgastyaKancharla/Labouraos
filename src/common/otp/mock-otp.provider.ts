import { Injectable, Logger } from '@nestjs/common';
import { OtpProvider } from './otp.interface';

export interface OtpRecord {
  requestId: string;
  phone: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  verified: boolean;
}

@Injectable()
export class MockOtpProvider implements OtpProvider {
  private readonly logger = new Logger(MockOtpProvider.name);
  private records = new Map<string, OtpRecord>();
  private defaultTtlMs: number;
  private timeProvider: () => number;

  constructor(options?: { ttlMs?: number; timeProvider?: () => number }) {
    const envTtl = process.env.OTP_TTL_SECONDS
      ? parseInt(process.env.OTP_TTL_SECONDS, 10) * 1000
      : undefined;
    this.defaultTtlMs = options?.ttlMs ?? envTtl ?? 300 * 1000; // 5 minutes default
    this.timeProvider = options?.timeProvider ?? (() => Date.now());
  }

  setTimeProvider(timeProvider: () => number): void {
    this.timeProvider = timeProvider;
  }

  setTtlMs(ttlMs: number): void {
    this.defaultTtlMs = ttlMs;
  }

  async sendOtp(phone: string): Promise<{ requestId: string }> {
    const now = this.timeProvider();
    const requestId = `otp_${Math.random().toString(36).substring(2, 10)}_${now}`;
    // 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    this.records.set(requestId, {
      requestId,
      phone,
      code,
      createdAt: now,
      expiresAt: now + this.defaultTtlMs,
      verified: false,
    });

    this.logger.log(`[MOCK OTP] Sent OTP to ${phone}: ${code} (requestId: ${requestId})`);
    return { requestId };
  }

  async verifyOtp(requestId: string, code: string): Promise<boolean> {
    const record = this.records.get(requestId);
    if (!record) {
      return false;
    }

    const now = this.timeProvider();
    if (now > record.expiresAt) {
      return false;
    }

    // A verified code cannot be reused
    if (record.verified) {
      return false;
    }

    if (record.code !== code) {
      return false;
    }

    record.verified = true;
    return true;
  }

  async isVerified(requestId: string, phone?: string): Promise<boolean> {
    const record = this.records.get(requestId);
    if (!record) {
      return false;
    }
    if (!record.verified) {
      return false;
    }
    if (phone && record.phone !== phone) {
      return false;
    }
    return true;
  }

  getCode(requestId: string): string | undefined {
    return this.records.get(requestId)?.code;
  }

  clear(): void {
    this.records.clear();
  }
}
