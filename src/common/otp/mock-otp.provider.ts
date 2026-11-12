import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { nationalMobileDigits } from '../phone/indian-mobile';
import { OtpProvider, OtpSendOptions, OtpSendResult } from './otp.interface';
import { otpTestModeEnabled } from './otp-test-mode';

export interface OtpRecord {
  requestId: string;
  phone: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  verified: boolean;
  used: boolean;
  purpose: string;
  attempts: number;
  resendCount: number;
  lastSentAt: number;
}

const RESEND_WAIT_MS = 30_000;
const MAX_RESENDS = 3;
const MAX_WRONG_ATTEMPTS = 5;

/** The 10 national digits: every spelling of one mobile is the same OTP owner. */
function normalizePhone(phone: string): string {
  return nationalMobileDigits(phone);
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

  async sendOtp(phone: string, options?: OtpSendOptions): Promise<OtpSendResult> {
    const now = this.timeProvider();
    const purpose = options?.purpose ?? 'job_seeker';

    if (options?.requestId) {
      const record = this.records.get(options.requestId);
      if (!record || record.expiresAt < now || record.verified || record.used || record.attempts >= MAX_WRONG_ATTEMPTS) {
        throw new BadRequestException('OTP request is no longer active; request a new code');
      }
      if (normalizePhone(record.phone) !== normalizePhone(phone) || record.purpose !== purpose) {
        throw new BadRequestException('OTP resend must use the original phone number and purpose');
      }
      const resendAvailableAt = record.lastSentAt + RESEND_WAIT_MS;
      if (now < resendAvailableAt) {
        throw new BadRequestException(`Resend is available at ${new Date(resendAvailableAt).toISOString()}`);
      }
      if (record.resendCount >= MAX_RESENDS) {
        throw new BadRequestException('The maximum of 3 OTP resends has been reached');
      }
      record.resendCount += 1;
      record.lastSentAt = now;
      this.logger.log(`[MOCK OTP] Resent OTP to ******${normalizePhone(phone).slice(-4)} (requestId: ${record.requestId})`);
      this.logTestModeCode(record);
      return this.sendResult(record);
    }

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
      used: false,
      purpose,
      attempts: 0,
      resendCount: 0,
      lastSentAt: now,
    });

    this.logger.log(`[MOCK OTP] Sent OTP to ******${normalizePhone(phone).slice(-4)} (requestId: ${requestId})`);
    this.logTestModeCode(this.records.get(requestId)!);
    return this.sendResult(this.records.get(requestId)!);
  }

  async verifyOtp(requestId: string, code: string): Promise<boolean> {
    const record = this.records.get(requestId);
    if (!record) {
      return false;
    }

    const now = this.timeProvider();
    if (now > record.expiresAt || record.used || record.attempts >= MAX_WRONG_ATTEMPTS) {
      return false;
    }

    // A verified code cannot be reused
    if (record.verified) {
      return false;
    }

    if (record.code !== code) {
      record.attempts += 1;
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
    if (!record.verified || record.used || this.timeProvider() > record.expiresAt) {
      return false;
    }
    if (phone && normalizePhone(record.phone) !== normalizePhone(phone)) {
      return false;
    }
    return true;
  }

  async consumeVerified(requestId: string, phone: string): Promise<boolean> {
    if (!(await this.isVerified(requestId, phone))) return false;
    const record = this.records.get(requestId);
    if (!record || record.used) return false;
    record.used = true;
    return true;
  }

  async getPhoneLast4(requestId: string): Promise<string | null> {
    const record = this.records.get(requestId);
    return record ? normalizePhone(record.phone).slice(-4) : null;
  }

  getCode(requestId: string): string | undefined {
    return this.records.get(requestId)?.code;
  }

  clear(): void {
    this.records.clear();
  }

  private sendResult(record: OtpRecord): OtpSendResult {
    return {
      requestId: record.requestId,
      resendAvailableAt: new Date(record.lastSentAt + RESEND_WAIT_MS).toISOString(),
      resendsLeft: MAX_RESENDS - record.resendCount,
      // Test mode only: nobody can receive a pretend SMS, so the screen shows the code.
      ...(otpTestModeEnabled() ? { testModeCode: record.code } : {}),
    };
  }

  /** Test mode only: the code in the server log, so a tester can read it there too. */
  private logTestModeCode(record: OtpRecord): void {
    if (!otpTestModeEnabled()) return;
    this.logger.log(
      `[MOCK OTP] Test mode code for ******${normalizePhone(record.phone).slice(-4)}: ${record.code} (requestId: ${record.requestId})`,
    );
  }
}
