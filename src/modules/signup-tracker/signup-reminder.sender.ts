import { Injectable } from '@nestjs/common';
import { CustomerNotificationService } from '../customer-notification/customer-notification.service';
import { SignupReminder, SignupReminderSender } from './signup-reminder.port';

/**
 * Sends the sign-up reminders for real (21 Nov fixes: "reminders are actually
 * sent"): the customer app inbox plus a push, through the customer
 * notification service, which applies quiet hours, the daily cap and the
 * person's switches. Never a contact attempt (C17). WhatsApp comes later
 * (Builder D's outbound event messages).
 */
@Injectable()
export class CustomerSignupReminderSender implements SignupReminderSender {
  constructor(private readonly notifications: CustomerNotificationService) {}

  async sendSignupReminder(reminder: SignupReminder): Promise<void> {
    await this.notifications.notify(
      { accountId: reminder.accountId, profileId: reminder.profileId },
      'signup_reminder',
      { stepsLeft: String(Math.max(1, reminder.missing.length)) },
      { dedupeKey: reminder.dedupeKey, data: { trackerId: reminder.trackerId, stage: reminder.stage } },
    );
  }
}
