import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_ERROR_CODES, CustomerApiError } from '../../common/customer-auth/customer-auth.errors';
import { nationalMobileDigits } from '../../common/phone/indian-mobile';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * OTP abuse limits for the public customer sign-in (proposal 7.6: bots can make
 * a public app send thousands of paid SMS). Counted in CustomerOtpAttempt by
 * hashes only, never the number or address itself.
 */
export const CUSTOMER_OTP_LIMITS = {
  perPhonePerHour: 5,
  perPhonePerDay: 10,
  perAddressPerHour: 20,
  perDevicePerHour: 10,
  wrongCodesPerPhonePerHour: 10,
} as const;

export interface OtpCaller {
  phone: string;
  ip?: string | null;
  installationId?: string | null;
}

function hashOf(kind: string, value: string | null | undefined): string | null {
  if (!value || !String(value).trim()) return null;
  return createHash('sha256').update(`laboura:customer-otp:${kind}:${String(value).trim()}`).digest('hex');
}

export function customerPhoneHash(phone: string): string {
  return hashOf('phone', nationalMobileDigits(phone))!;
}

function limitError(message: string, since: Date, windowMs: number, now: Date): CustomerApiError {
  const retryAfterSeconds = Math.max(1, Math.ceil((since.getTime() + windowMs - now.getTime()) / 1000));
  return new CustomerApiError(HttpStatus.TOO_MANY_REQUESTS, CUSTOMER_ERROR_CODES.OTP_LIMIT, message, { retryAfterSeconds });
}

@Injectable()
export class CustomerOtpLimiter {
  constructor(private readonly prisma: PrismaService) {}

  /** Checks every limit and records the send, under a lock per phone. Throws 429 OTP_LIMIT. */
  async claimSend(caller: OtpCaller, now: Date): Promise<void> {
    const phoneHash = customerPhoneHash(caller.phone);
    const ipHash = hashOf('ip', caller.ip);
    const deviceHash = hashOf('device', caller.installationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-otp:${phoneHash}`}))`);
      const hourAgo = new Date(now.getTime() - HOUR_MS);
      const dayAgo = new Date(now.getTime() - DAY_MS);
      const wrong = await tx.customerOtpAttempt.findMany({
        where: { kind: 'verify_failed', phoneHash, createdAt: { gt: hourAgo } },
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
      await tx.customerOtpAttempt.create({ data: { kind: 'send', phoneHash, ipHash, deviceHash, createdAt: now } });
      await tx.customerOtpAttempt.deleteMany({ where: { createdAt: { lt: dayAgo } } });
    });
  }

  /** Records a wrong code; returns how many wrong codes this number may still try this hour. */
  async recordWrongCode(caller: OtpCaller, now: Date): Promise<number> {
    const phoneHash = customerPhoneHash(caller.phone);
    await this.prisma.customerOtpAttempt.create({
      data: { kind: 'verify_failed', phoneHash, ipHash: hashOf('ip', caller.ip), deviceHash: hashOf('device', caller.installationId), createdAt: now },
    });
    const count = await this.prisma.customerOtpAttempt.count({
      where: { kind: 'verify_failed', phoneHash, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
    });
    return Math.max(0, CUSTOMER_OTP_LIMITS.wrongCodesPerPhonePerHour - count);
  }

  /** Refuses a verify when the number has had too many wrong codes this hour. */
  async assertCanVerify(caller: OtpCaller, now: Date): Promise<void> {
    const phoneHash = customerPhoneHash(caller.phone);
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const wrong = await this.prisma.customerOtpAttempt.findMany({
      where: { kind: 'verify_failed', phoneHash, createdAt: { gt: hourAgo } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
      take: CUSTOMER_OTP_LIMITS.wrongCodesPerPhonePerHour,
    });
    if (wrong.length >= CUSTOMER_OTP_LIMITS.wrongCodesPerPhonePerHour) {
      throw limitError('Too many wrong codes for this number. Try again later.', wrong[0]!.createdAt, HOUR_MS, now);
    }
  }
}
