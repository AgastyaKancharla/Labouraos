/**
 * How the tracker asks the customer notification service (Agent C,
 * src/modules/customer-notification/) to send a sign-up reminder. The tracker
 * decides WHEN (the timing rules); the notification service owns the wording,
 * the three languages, quiet hours, the daily cap, the inbox copy and the push.
 *
 * To connect it, the notification module provides and exports this token:
 *   `{ provide: SIGNUP_REMINDER_SENDER, useExisting: CustomerNotificationService }`
 * and the service implements `SignupReminderSender`. Until it does, the
 * tracker still records each reminder as a tracker event (kind `reminder`),
 * so the timing carries on and the back office sees it.
 *
 * A reminder is never a contact attempt (C17).
 */
export const SIGNUP_REMINDER_SENDER = 'SIGNUP_REMINDER_SENDER';

export interface SignupReminder {
  accountId: string;
  /** CustomerProfile.id once a record exists. */
  profileId: string | null;
  trackerId: string;
  profileKind: string;
  stage: string;
  /** 1 = first reminder, 2 = second, `reengage` = the monthly re-engagement nudge. */
  reminder: 1 | 2 | 'reengage';
  /** Steps still to do, e.g. ["selfie", "payment"]. */
  missing: string[];
  /** Unique per tracker and reminder, so a repeated job run never sends twice. */
  dedupeKey: string;
}

export interface SignupReminderSender {
  sendSignupReminder(reminder: SignupReminder): Promise<void>;
}
