import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';

/**
 * Codes sent from the public pages (registration link, payment-only link,
 * business agreement, owner's interview result, referral terms) cost an SMS
 * each, and anyone holding a link can press "Send code". So the server, not
 * the page, limits them:
 *
 * - at most one code every 30 seconds per link, and per phone number across links;
 * - at most 4 codes (the first and 3 resends) per link in 24 hours.
 *
 * Beyond that the answer is 429 with when to try again.
 */
export const PUBLIC_OTP_RESEND_SECONDS = 30;
export const PUBLIC_OTP_MAX_SENDS_PER_DAY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function publicOtpPhoneHash(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return createHash('sha256').update(`laboura:public-otp:${national}`).digest('hex');
}

export class PublicOtpLimitError extends HttpException {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class PublicOtpLimiter {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Checks the limits for this link (by its token hash) and phone, and records
   * the send if allowed — under a lock, so a burst of taps can't slip through.
   * Call it just before handing the code to the SMS provider.
   */
  async claimSend(linkKey: string, phone: string, now: Date = new Date()): Promise<void> {
    const phoneHash = publicOtpPhoneHash(phone);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`public-otp:${phoneHash}`}))`);
      const dayAgo = new Date(now.getTime() - DAY_MS);
      const [linkSends, lastForPhone] = await Promise.all([
        tx.publicOtpSend.findMany({
          where: { linkKey, sentAt: { gt: dayAgo } },
          orderBy: { sentAt: 'asc' },
          select: { sentAt: true },
        }),
        tx.publicOtpSend.findFirst({
          where: { phoneHash, sentAt: { gt: dayAgo } },
          orderBy: { sentAt: 'desc' },
          select: { sentAt: true },
        }),
      ]);
      if (linkSends.length >= PUBLIC_OTP_MAX_SENDS_PER_DAY) {
        const retry = Math.ceil((linkSends[0]!.sentAt.getTime() + DAY_MS - now.getTime()) / 1000);
        throw new PublicOtpLimitError(
          'Too many codes for this link: at most 4 in 24 hours. Ask your Laboura agent for help, or try again later.',
          Math.max(1, retry),
        );
      }
      const latest = [linkSends[linkSends.length - 1]?.sentAt, lastForPhone?.sentAt]
        .filter((d): d is Date => Boolean(d))
        .reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);
      if (latest) {
        const waitMs = latest.getTime() + PUBLIC_OTP_RESEND_SECONDS * 1000 - now.getTime();
        if (waitMs > 0) {
          const seconds = Math.ceil(waitMs / 1000);
          throw new PublicOtpLimitError(`A code was just sent. Wait ${seconds} seconds before asking for another.`, seconds);
        }
      }
      await tx.publicOtpSend.create({ data: { linkKey, phoneHash, sentAt: now } });
      await tx.publicOtpSend.deleteMany({ where: { phoneHash, sentAt: { lt: dayAgo } } });
    });
  }
}
