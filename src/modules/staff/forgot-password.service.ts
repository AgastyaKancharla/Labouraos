import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EMAIL_PROVIDER, EmailProvider, emailTestModeEnabled } from '../../common/email/email.provider';
import { hashInviteToken, staffInviteLink } from './staff.service';

/** Management only (guide, Passwords and email): agents and Team Leads are reset by their Team Lead, a Manager or the CEO. */
export const FORGOT_PASSWORD_ROLES = ['ceo', 'manager', 'finance'];
/** The emailed link works once, for this long. */
export const FORGOT_PASSWORD_TTL_MS = 60 * 60 * 1000;
/** At most this many emailed links per account per hour; more asks send nothing. */
export const FORGOT_PASSWORD_PER_HOUR = 3;
/** Shared addresses are never used to log in or reset passwords (guide). */
export const SHARED_MAILBOXES = ['support', 'careers', 'business', 'accounts'];

/** The one answer, whether or not the address belongs to anyone. */
export const FORGOT_PASSWORD_ANSWER =
  'If that is the company email of a CEO, Manager or Finance account, a link to set a new password is on its way. It works once, for 1 hour. Your authenticator code is still needed to sign in.';

export interface ForgotPasswordAnswer {
  message: string;
  /** Test mode only, the same for every address: where the tester finds the link. */
  testModeNote?: string;
}

/**
 * "Forgot password" for the CEO, Managers and Finance (guide: a link to their
 * individual company email; the authenticator is still needed after it). The
 * link is the same one-time, expiring reset as a Team Lead's or the CEO's
 * Reset (StaffPasswordReset, the invite page): the old password keeps working
 * until it is used, a newer link replaces an older one, using it ends every
 * session. The answer never says whether the address exists: the reply is
 * always the same and the work runs after the reply is sent.
 */
@Injectable()
export class ForgotPasswordService {
  private readonly logger = new Logger(ForgotPasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  request(rawEmail: unknown, now: Date = new Date()): { answer: ForgotPasswordAnswer; done: Promise<'sent' | 'skipped'> } {
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const done = this.process(email, now).catch((error: unknown) => {
      this.logger.warn(`Forgot password could not be handled: ${(error as Error).message}`);
      return 'skipped' as const;
    });
    const answer: ForgotPasswordAnswer = { message: FORGOT_PASSWORD_ANSWER };
    if (emailTestModeEnabled()) answer.testModeNote = 'Test mode: no email is really sent. The link is written to the server log.';
    return { answer, done };
  }

  private async process(email: string, now: Date): Promise<'sent' | 'skipped'> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'skipped';
    if (SHARED_MAILBOXES.includes(email.split('@')[0])) return 'skipped';
    const staff = await this.prisma.staff.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, role: { in: FORGOT_PASSWORD_ROLES }, status: 'active' },
      select: { id: true, code: true, email: true },
    });
    if (!staff?.email) return 'skipped';
    const recent = await this.prisma.staffPasswordReset.count({
      where: { staffId: staff.id, issuedByStaffId: staff.id, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
    });
    if (recent >= FORGOT_PASSWORD_PER_HOUR) {
      await this.audit.log({ actorId: staff.id, action: 'staff.password_reset_email_limited', entityType: 'staff', entityCode: staff.code, after: { lastHour: recent } });
      return 'skipped';
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + FORGOT_PASSWORD_TTL_MS);
    const reset = await this.prisma.$transaction(async (tx) => {
      const replaced = await tx.staffPasswordReset.updateMany({ where: { staffId: staff.id, usedAt: null, cancelledAt: null }, data: { cancelledAt: now } });
      const created = await tx.staffPasswordReset.create({
        data: { staffId: staff.id, issuedByStaffId: staff.id, tokenHash: hashInviteToken(token), expiresAt, createdAt: now },
        select: { id: true },
      });
      return { id: created.id, replaced: replaced.count };
    });
    const link = staffInviteLink(token);
    const result = await this.email.send({
      to: staff.email,
      subject: 'Laboura: set a new password',
      text: [
        'Someone asked to reset the password of your Laboura account.',
        `Open this link to set a new password: ${link}`,
        'It works once, for 1 hour. Your old password keeps working until you use it.',
        'You still need your authenticator code to sign in.',
        'If it was not you, ignore this email and tell the CEO.',
      ].join('\n\n'),
      link,
    });
    await this.audit.log({
      actorId: staff.id,
      action: 'staff.password_reset_emailed',
      entityType: 'staff',
      entityCode: staff.code,
      after: { passwordResetId: reset.id, expiresAt: expiresAt.toISOString(), replacedEarlierResets: reset.replaced, emailStatus: result.status },
    });
    return result.status === 'sent' ? 'sent' : 'skipped';
  }
}
