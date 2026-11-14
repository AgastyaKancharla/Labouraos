/**
 * The closed list of customer app notifications (customer app proposal,
 * section 5.3 "Which events notify whom", plus the sign-up reminders of 4.2).
 * Every event has a wording key of the same name in
 * customer-notification.wording.ts, in Kannada, Hindi and English.
 *
 * A push or in-app message is NEVER a contact attempt and never counts toward
 * a hit (C17, proposal 5.2): these rows are logged in MessageLog with the
 * channel `push` or `in_app` and the subject `customer_account`, so nothing
 * that counts SMS/WhatsApp attempts for a job seeker can ever see them.
 */

export type CustomerNotificationCategory = 'service' | 'job_updates' | 'promotions';
export type CustomerNotificationPriority = 'normal' | 'urgent';
export type CustomerAudience = 'job_seeker' | 'business' | 'referral';

export interface CustomerEventDefinition {
  /** service, job_updates or promotions: the three switches (proposal 5.4). */
  category: CustomerNotificationCategory;
  /** urgent: sent during quiet hours and never held by the daily cap. */
  priority: CustomerNotificationPriority;
  /**
   * The person just did this themselves (a payment receipt): sent at once,
   * even in quiet hours, and not counted in the daily cap (proposal 5.4).
   */
  selfAction?: boolean;
  /** Who it is for (documentation and tests; recipients come from the caller). */
  audience: readonly CustomerAudience[];
  /** Screen the app opens on tap (customer/src/push/deepLinks.ts maps it). */
  deepLink: '/home' | '/inbox' | '/settings';
  /** Placeholders the wording uses; the caller must pass every one. */
  vars: readonly string[];
}

export const CUSTOMER_EVENTS = {
  // --- Sign-up (proposal 4.2): sent by the sign-up tracker (Agent D) ---
  signup_reminder: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business', 'referral'], deepLink: '/home', vars: ['stepsLeft'] },

  // --- Identity check ---
  id_check_approved: { category: 'service', priority: 'normal', audience: ['job_seeker', 'referral'], deepLink: '/home', vars: [] },
  id_check_retry: { category: 'service', priority: 'normal', audience: ['job_seeker', 'referral'], deepLink: '/home', vars: [] },

  // --- Payments in (receipts: the person just paid) ---
  payment_confirmed: { category: 'service', priority: 'normal', selfAction: true, audience: ['job_seeker'], deepLink: '/home', vars: ['days'] },
  fee_paid: { category: 'service', priority: 'normal', selfAction: true, audience: ['business'], deepLink: '/home', vars: [] },

  // --- Job seeker journey ---
  job_match: { category: 'job_updates', priority: 'normal', audience: ['job_seeker'], deepLink: '/home', vars: [] },
  interview_booked: { category: 'service', priority: 'urgent', audience: ['job_seeker'], deepLink: '/home', vars: ['hours'] },
  interview_reminder_tomorrow: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: [] },
  interview_reminder_soon: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: [] },
  offer_check: { category: 'service', priority: 'normal', audience: ['job_seeker'], deepLink: '/home', vars: [] },
  joining_confirmed: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: [] },
  joining_moved: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: [] },
  joining_day_check: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: [] },
  hit_recorded: { category: 'service', priority: 'normal', audience: ['job_seeker'], deepLink: '/home', vars: [] },
  guarantee_countdown: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: ['daysLeft'] },
  refund_approved: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: [] },
  refund_paid: { category: 'service', priority: 'normal', audience: ['job_seeker', 'business'], deepLink: '/home', vars: [] },
  reward_approved: { category: 'service', priority: 'normal', audience: ['job_seeker'], deepLink: '/home', vars: [] },
  reward_paid: { category: 'service', priority: 'normal', audience: ['job_seeker'], deepLink: '/home', vars: [] },

  // --- Business journey ---
  visit_booked: { category: 'service', priority: 'normal', audience: ['business'], deepLink: '/home', vars: ['agentFirstName', 'when'] },
  business_approved: { category: 'service', priority: 'normal', audience: ['business'], deepLink: '/home', vars: [] },
  vacancy_confirmed: { category: 'service', priority: 'normal', audience: ['business'], deepLink: '/home', vars: ['vacancyCode'] },
  candidates_shared: { category: 'service', priority: 'normal', audience: ['business'], deepLink: '/home', vars: [] },
  interview_result_due: { category: 'service', priority: 'normal', audience: ['business'], deepLink: '/home', vars: [] },
  selected_pay_fee: { category: 'service', priority: 'urgent', audience: ['business'], deepLink: '/home', vars: ['hours'] },
  claim_decided: { category: 'service', priority: 'normal', audience: ['business'], deepLink: '/home', vars: [] },
  replacement_found: { category: 'service', priority: 'normal', audience: ['business'], deepLink: '/home', vars: [] },

  // --- Referral partner journey ---
  referral_registered: { category: 'service', priority: 'normal', audience: ['referral'], deepLink: '/home', vars: ['firstName'] },
  referral_paid: { category: 'service', priority: 'normal', audience: ['referral'], deepLink: '/home', vars: ['firstName'] },
  referral_joined: { category: 'service', priority: 'normal', audience: ['referral'], deepLink: '/home', vars: ['firstName'] },
  payout_approved: { category: 'service', priority: 'normal', audience: ['referral'], deepLink: '/home', vars: [] },
  payout_paid: { category: 'service', priority: 'normal', audience: ['referral'], deepLink: '/home', vars: [] },

  // --- Offers and promotions: only with the promotions consent (Q22) ---
  promotion: { category: 'promotions', priority: 'normal', audience: ['job_seeker', 'business', 'referral'], deepLink: '/inbox', vars: [] },
} as const satisfies Record<string, CustomerEventDefinition>;

export type CustomerEventKind = keyof typeof CUSTOMER_EVENTS;

export const CUSTOMER_EVENT_KINDS = Object.keys(CUSTOMER_EVENTS) as CustomerEventKind[];

export function isCustomerEventKind(value: string): value is CustomerEventKind {
  return Object.prototype.hasOwnProperty.call(CUSTOMER_EVENTS, value);
}

export function eventDefinition(kind: CustomerEventKind): CustomerEventDefinition {
  return CUSTOMER_EVENTS[kind];
}

/** Quiet hours, IST (Q21, C18): nothing non-urgent between 21:00 and 09:00. */
export const QUIET_START = '21:00';
export const QUIET_END = '09:00';
/** At most this many non-urgent pushes a day per account (Q21). */
export const DAILY_NON_URGENT_CAP = 3;

/** Android notification channels; the app creates the same ids (customer/src/push/channels.ts). */
export const ANDROID_CHANNEL_BY_CATEGORY: Record<CustomerNotificationCategory, string> = {
  service: 'service',
  job_updates: 'job-updates',
  promotions: 'promotions',
};

/** MessageLog.subjectType for push and in-app rows: never a job seeker, so never a contact attempt. */
export const CUSTOMER_MESSAGE_SUBJECT = 'customer_account';

/** CustomerInboxMessage.pushStatus values (schema comment). */
export const PUSH_STATUS = {
  none: 'none',
  queued: 'queued',
  sent: 'sent',
  failed: 'failed',
  heldQuietHours: 'held_quiet_hours',
  heldDailyCap: 'held_daily_cap',
  off: 'off',
} as const;

/** Expo push token shape: ExponentPushToken[...] (or the newer ExpoPushToken[...]). */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-:.]{10,200}\]$/;

/** How long after sending Expo's receipts are checked (Expo suggests about 15 minutes). */
export const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

/** BullMQ queue of the push worker (src/jobs/customer-push.job.ts). */
export const CUSTOMER_PUSH_QUEUE = 'customer-push';
/** Job names on that queue. */
export const CUSTOMER_PUSH_SEND_NOW = 'send-customer-push-now';
export const CUSTOMER_PUSH_CHECK_RECEIPTS = 'check-customer-push-receipts';

/**
 * Phones of an account that can get a push: a token, not signed out, and the
 * phone's permission not refused. (A null permission is allowed: SQL's NOT
 * would drop nulls, hence the OR.)
 */
export function pushableDevices(accountId: string) {
  return {
    accountId,
    pushToken: { not: null },
    revokedAt: null,
    OR: [{ pushPermission: null }, { pushPermission: { not: 'denied' } }],
  };
}
