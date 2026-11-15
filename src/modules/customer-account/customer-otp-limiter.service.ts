import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { getJwtSecret } from '../../common/auth/jwt-secret';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { nationalMobileDigits } from '../../common/phone/indian-mobile';
import { AlertService } from '../../common/observability/alert.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * OTP abuse limits for the public customer sign-in (proposal 7.6; security
 * review M5, H2; INF-4). Counted in CustomerOtpAttempt by hashes only, never
 * the number or address itself. Many phones can share one carrier address
 * (carrier NAT), so an address that asks for many different numbers is first
 * asked for the human check (after CUSTOMER_OTP_ADDRESS_PHONES_BEFORE_CHECK
 * numbers in an hour) and only then capped (20 codes an hour).
 */
export const CUSTOMER_OTP_LIMITS = {
  perPhonePerHour: 5,
  perPhonePerDay: 10,
  /** INF-4: was 60; the human check by address now takes most of the load. */
  perAddressPerHour: 20,
  perDevicePerHour: 10,
  /** Wrong codes for one phone from one installation: someone else cannot lock a person's number (N4). */
  wrongCodesPerPhonePerHour: 10,
  wrongCodesPerAddressPerHour: 50,
  wrongCodesPerDevicePerHour: 20,
  /** From this many codes in an hour (phone or installation), a human check is asked for. */
  humanCheckAfter: 3,
} as const;

/**
 * All customer OTP codes in 24 hours across the system. Above it the service
 * degrades instead of stopping (INF-4): every code needs the human check
 * (known customers included, and they still get codes) and the CEO is alerted.
 */
export const CUSTOMER_OTP_DAILY_LIMIT_ENV = 'CUSTOMER_OTP_DAILY_LIMIT';
const DEFAULT_DAILY_LIMIT = 3000;

/** INF-4: different phone numbers one address may ask codes for in an hour before the human check. */
export const CUSTOMER_OTP_ADDRESS_PHONES_ENV = 'CUSTOMER_OTP_ADDRESS_PHONES_BEFORE_CHECK';
const DEFAULT_ADDRESS_PHONES_BEFORE_CHECK = 3;

/** Why a human check is asked for (null: not needed). */
export type HumanCheckReason = 'phone' | 'installation' | 'address' | 'daily_limit';

export interface OtpCaller {
  phone: string;
  ip?: string | null;
  installationId?: string | null;
}

/**
 * Keyed hashes (HMAC with a key derived from the server's JWT_SECRET), so a
 * leaked table of phone or address hashes cannot be reversed by trying every
 * mobile number. Old plain hashes simply age out of the hourly and daily windows.
 */
let hashKey: Buffer | null = null;
function key(): Buffer {
  if (!hashKey) hashKey = createHmac('sha256', getJwtSecret()).update('laboura:customer-otp-hash:v1').digest();
  return hashKey;
}

export function hashOf(kind: string, value: string | null | undefined): string | null {
  if (!value || !String(value).trim()) return null;
  return createHmac('sha256', key()).update(`${kind}:${String(value).trim()}`).digest('hex');
}

export function customerPhoneHash(phone: string): string {
  return hashOf('phone', nationalMobileDigits(phone))!;
}

function limitError(message: string, since: Date, windowMs: number, now: Date): CustomerApiError {
  const retryAfterSeconds = Math.max(1, Math.ceil((since.getTime() + windowMs - now.getTime()) / 1000));
  return new CustomerApiError(HttpStatus.TOO_MANY_REQUESTS, CUSTOMER_ERROR_CODES.OTP_LIMIT, message, { retryAfterSeconds });
}

export interface SendBinding {
  requestId: string;
  purpose: string;
  phoneHash: string | null;
  deviceHash: string | null;
  accountId: string | null;
}

@Injectable()
export class CustomerOtpLimiter {
  private readonly logger = new Logger(CustomerOtpLimiter.name);
  private alertedDay: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
  ) {}

  private dailyLimit(): number {
    const raw = Number(process.env.CUSTOMER_OTP_DAILY_LIMIT);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_LIMIT;
  }

  private addressPhonesBeforeCheck(): number {
    const raw = Number(process.env.CUSTOMER_OTP_ADDRESS_PHONES_BEFORE_CHECK);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_ADDRESS_PHONES_BEFORE_CHECK;
  }

  /**
   * Why this send needs a human check, or null:
   *   - the phone or the installation already had 3 codes this hour;
   *   - the address already asked for codes for N other numbers this hour (INF-4);
   *   - the system-wide daily breaker is open: everyone is asked (INF-4).
   */
  async humanCheckReason(caller: OtpCaller, now: Date): Promise<HumanCheckReason | null> {
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const phoneHash = customerPhoneHash(caller.phone);
    const deviceHash = hashOf('device', caller.installationId);
    const ipHash = hashOf('ip', caller.ip);
    const otherPhones = this.addressPhonesBeforeCheck();
    const [byPhone, byDevice, addressPhones, total] = await Promise.all([
      this.prisma.customerOtpAttempt.count({ where: { kind: 'send', phoneHash, createdAt: { gt: hourAgo } } }),
      deviceHash ? this.prisma.customerOtpAttempt.count({ where: { kind: 'send', deviceHash, createdAt: { gt: hourAgo } } }) : 0,
      ipHash
        ? this.prisma.customerOtpAttempt.findMany({
          where: { kind: 'send', ipHash, createdAt: { gt: hourAgo }, phoneHash: { not: phoneHash } },
          distinct: ['phoneHash'],
          select: { phoneHash: true },
          take: otherPhones,
        })
        : [],
      this.prisma.customerOtpAttempt.count({ where: { kind: 'send', createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    if (total >= this.dailyLimit()) {
      await this.alertOnce(now, total);
      return 'daily_limit';
    }
    if (byPhone >= CUSTOMER_OTP_LIMITS.humanCheckAfter) return 'phone';
    if (byDevice >= CUSTOMER_OTP_LIMITS.humanCheckAfter) return 'installation';
    if (addressPhones.length >= otherPhones) return 'address';
    return null;
  }

  /** True when this send needs a human check (humanCheckReason). */
  async needsHumanCheck(caller: OtpCaller, now: Date): Promise<boolean> {
    return (await this.humanCheckReason(caller, now)) !== null;
  }

  /**
   * Checks every limit and records the send (returns its row id, to bind the
   * request id once the provider answers), under a lock per phone. Throws 429
   * OTP_LIMIT. The system-wide daily breaker no longer stops sending (INF-4):
   * above it humanCheckReason asks everyone for the human check instead.
   */
  async claimSend(caller: OtpCaller, now: Date): Promise<string> {
    const phoneHash = customerPhoneHash(caller.phone);
    const ipHash = hashOf('ip', caller.ip);
    const deviceHash = hashOf('device', caller.installationId);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-otp:${phoneHash}`}))`);
      const hourAgo = new Date(now.getTime() - HOUR_MS);
      const wrong = await tx.customerOtpAttempt.findMany({
        where: { kind: 'verify_failed', phoneHash, deviceHash, createdAt: { gt: hourAgo } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      if (wrong.length >= CUSTOMER_OTP_LIMITS.wrongCodesPerPhonePerHour) {
        throw limitError('Too many wrong codes for this number. Try again later.', wrong[0]!.createdAt, HOUR_MS, now);
      }
      const phoneDay = await tx.customerOtpAttempt.findMany({
        where: { kind: 'send', phoneHash, createdAt: { gt: dayAgo } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      if (phoneDay.length >= CUSTOMER_OTP_LIMITS.perPhonePerDay) {
        throw limitError('Too many codes for this number today. Try again later.', phoneDay[0]!.createdAt, DAY_MS, now);
      }
      const phoneHour = phoneDay.filter((row) => row.createdAt > hourAgo);
      if (phoneHour.length >= CUSTOMER_OTP_LIMITS.perPhonePerHour) {
        throw limitError('Too many codes for this number. Try again later.', phoneHour[0]!.createdAt, HOUR_MS, now);
      }
      for (const [hash, field, limit] of [
        [ipHash, 'ipHash', CUSTOMER_OTP_LIMITS.perAddressPerHour],
        [deviceHash, 'deviceHash', CUSTOMER_OTP_LIMITS.perDevicePerHour],
      ] as const) {
        if (!hash) continue;
        const rows = await tx.customerOtpAttempt.findMany({
          where: { kind: 'send', [field]: hash, createdAt: { gt: hourAgo } },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
          take: limit,
        });
        if (rows.length >= limit) {
          throw limitError('Too many codes from this phone or connection. Try again later.', rows[0]!.createdAt, HOUR_MS, now);
        }
      }
      const row = await tx.customerOtpAttempt.create({ data: { kind: 'send', phoneHash, ipHash, deviceHash, createdAt: now }, select: { id: true } });
      await tx.customerOtpAttempt.deleteMany({ where: { createdAt: { lt: dayAgo } } });
      return row.id;
    });
  }

  /** The provider could not send: the attempt does not count against the person's limits. */
  async releaseSend(rowId: string): Promise<void> {
    await this.prisma.customerOtpAttempt.deleteMany({ where: { id: rowId, kind: 'send' } });
  }

  /** Binds a recorded send to the request id the provider gave, its purpose and the asking account. */
  async bindSend(rowId: string, binding: { requestId: string; purpose: string; accountId: string | null }): Promise<void> {
    await this.prisma.customerOtpAttempt.update({ where: { id: rowId }, data: binding });
  }

  /** The newest customer send for this request id (null: not a customer code). */
  async sendFor(requestId: string): Promise<SendBinding | null> {
    const row = await this.prisma.customerOtpAttempt.findFirst({
      where: { kind: 'send', requestId },
      orderBy: { createdAt: 'desc' },
      select: { requestId: true, purpose: true, phoneHash: true, deviceHash: true, accountId: true },
    });
    return row && row.requestId && row.purpose ? (row as SendBinding) : null;
  }

  /**
   * Records a wrong code. `countPhone` false (the request was for another phone
   * or another flow): only the address and installation are charged, so nobody
   * can lock someone else's number by guessing (H2). Returns tries left this hour.
   */
  async recordWrongCode(caller: OtpCaller, now: Date, countPhone = true): Promise<number> {
    const phoneHash = countPhone ? customerPhoneHash(caller.phone) : null;
    await this.prisma.customerOtpAttempt.create({
      data: { kind: 'verify_failed', phoneHash, ipHash: hashOf('ip', caller.ip), deviceHash: hashOf('device', caller.installationId), createdAt: now },
    });
    if (!phoneHash) return 0;
    const count = await this.prisma.customerOtpAttempt.count({
      where: { kind: 'verify_failed', phoneHash, deviceHash: hashOf('device', caller.installationId), createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
    });
    return Math.max(0, CUSTOMER_OTP_LIMITS.wrongCodesPerPhonePerHour - count);
  }

  /** Refuses a verify after too many wrong codes for this phone, address or installation this hour. */
  async assertCanVerify(caller: OtpCaller, now: Date): Promise<void> {
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const deviceHash = hashOf('device', caller.installationId);
    for (const [where, limit] of [
      // Per phone *and* installation: an attacker's wrong codes never lock the owner's phone (N4).
      [{ phoneHash: customerPhoneHash(caller.phone), deviceHash }, CUSTOMER_OTP_LIMITS.wrongCodesPerPhonePerHour],
      [{ ipHash: hashOf('ip', caller.ip) }, CUSTOMER_OTP_LIMITS.wrongCodesPerAddressPerHour],
      [{ deviceHash }, CUSTOMER_OTP_LIMITS.wrongCodesPerDevicePerHour],
    ] as const) {
      if (Object.values(where).some((value) => !value)) continue;
      const wrong = await this.prisma.customerOtpAttempt.findMany({
        where: { kind: 'verify_failed', ...where, createdAt: { gt: hourAgo } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
        take: limit,
      });
      if (wrong.length >= limit) {
        throw limitError('Too many wrong codes. Try again later.', wrong[0]!.createdAt, HOUR_MS, now);
      }
    }
  }

  private async alertOnce(now: Date, total: number): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    if (this.alertedDay === day) return;
    this.alertedDay = day;
    this.logger.error(`Customer OTP daily limit reached: ${total} codes in 24 hours; human check asked of everyone`);
    try {
      await this.alerts.sendAlert({
        title: 'Customer app sign-in codes: human check for everyone',
        message: `More than ${this.dailyLimit()} sign-in codes were asked for in 24 hours (${total}). Until the count drops, every code needs the "are you a person" check (known customers still get codes). Check for abuse before raising CUSTOMER_OTP_DAILY_LIMIT.`,
        severity: 'critical',
        metadata: { total, limit: this.dailyLimit() },
      });
    } catch {
      // The alert is best effort; the human check for everyone already protects the SMS budget.
    }
  }
}
