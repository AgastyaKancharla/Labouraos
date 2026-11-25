import { phoneLast4 } from './indian-mobile';

/**
 * Security M3: when a job seeker's, business owner's or referral partner's
 * mobile number is changed, the OLD number gets an SMS saying so (with the new
 * number's last 4 digits and the record's ID), so a change the person did not
 * ask for is noticed. Register a DLT template for this name (DEPLOY.md).
 */
export const PHONE_CHANGED_SMS_TEMPLATE = 'phone_number_changed';

interface Messenger {
  sendPreferWhatsApp(input: {
    template: string;
    subjectType: string;
    subjectId: string;
    recipientPhone?: string;
    variables?: Record<string, string>;
  }): Promise<unknown>;
}

export async function sendPhoneChangedNotice(
  messaging: Messenger | undefined,
  input: { subjectType: 'job_seeker' | 'business' | 'referral'; subjectId: string; code: string; oldPhone: string | null | undefined; newPhone: string },
): Promise<void> {
  if (!messaging || !input.oldPhone) return;
  // A failed SMS never undoes the change; the message log keeps the failure.
  // WhatsApp first, SMS as backup (rev 211), to the old number.
  await messaging
    .sendPreferWhatsApp({
      template: PHONE_CHANGED_SMS_TEMPLATE,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      recipientPhone: input.oldPhone,
      variables: { code: input.code, newLast4: phoneLast4(input.newPhone) },
    })
    .catch(() => undefined);
}
