import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { notificationLink } from '../notification/notification.constants';

export interface ResetApprover {
  id: string;
  name: string;
  role: string;
}

const HOW_WORDS: Record<string, string> = {
  temp_password: 'a new temporary password',
  full_reset: 'a full sign-in reset',
  reactivation: 'reactivation',
  break_glass: 'the server break-glass command',
  senior_code: 'a reset code from a senior',
};

/**
 * What follows every password reset (rev 174–175, rule 10), whichever way it
 * was done: the notice shown at the person's next sign-in ("Your password was
 * reset on … approved by …") and a bell to their boss and the CEO. Sessions
 * end and the audit row is written by the caller.
 */
@Injectable()
export class ResetAftermathService {
  private readonly logger = new Logger(ResetAftermathService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** The value stored in Staff.passwordResetNotice. */
  notice(approver: ResetApprover | null, how: string, at: Date): Prisma.InputJsonValue {
    return { at: at.toISOString(), byName: approver?.name ?? null, byRole: approver?.role ?? null, how };
  }

  /**
   * A bell to the person's boss (their Team Lead, else whoever they report to)
   * and every active CEO, never to the person themself. One per reset
   * (`subjectId` is the reset's own id), so a later reset rings again.
   */
  async ringBells(
    person: { id: string; code: string; name: string; teamLeadId: string | null; reportsToId: string | null },
    approver: ResetApprover | null,
    how: string,
    subjectId: string,
    at: Date,
  ): Promise<void> {
    try {
      const ceos = await this.prisma.staff.findMany({ where: { role: 'ceo', status: 'active' }, select: { id: true } });
      const bossId = person.teamLeadId ?? person.reportsToId;
      const ids = [...new Set([...(bossId ? [bossId] : []), ...ceos.map((c) => c.id)])].filter((id) => id !== person.id);
      if (!ids.length) return;
      const recipients = await this.prisma.staff.findMany({
        where: { id: { in: ids }, status: 'active' },
        select: { id: true, role: true },
      });
      const by = approver ? `${approver.name}` : 'the server command';
      for (const r of recipients) {
        await this.notifications.open(
          {
            recipientStaffId: r.id,
            kind: 'password_reset',
            title: `${person.name} (${person.code}): password reset`,
            body: `Done with ${HOW_WORDS[how] ?? how}, approved by ${by}. All their sessions were ended.`,
            link: notificationLink(r.role, 'password_reset'),
            subjectType: 'password_reset',
            subjectId,
            once: true,
          },
          at,
        );
      }
    } catch (error) {
      // The reset itself is done and audited; a bell is never worth undoing it.
      this.logger.warn(`Password reset bell not sent: ${(error as Error).message}`);
    }
  }
}
