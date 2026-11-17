import { CUSTOMER_EVENTS, CustomerEventKind } from './customer-notification.constants';

/**
 * Notification wording, in English only (Master Guide rev 193, decided 17
 * Nov). One title and one body per event; the same text is the inbox copy and
 * the push.
 *
 * Lock-screen rule (proposal 5.4): no private details. Never a business name,
 * an address, a phone number, a rupee amount or a reason here: "You have an
 * interview tomorrow. Open Laboura", and the app shows the details after
 * sign-in. A referral partner sees a first name only (decided, question 18).
 *
 * Push and in-app wording needs no DLT or Meta approval; the same text can
 * seed the SMS and WhatsApp templates later (proposal 5.4).
 */

/** English only (rev 193); a stored 'kn' or 'hi' from before is read as English. */
export type CustomerLanguage = 'en';

export interface Wording {
  title: string;
  body: string;
}

export const CUSTOMER_NOTIFICATION_WORDING: Record<CustomerEventKind, Record<CustomerLanguage, Wording>> = {
  signup_reminder: {
    en: { title: 'Finish your Laboura sign-up', body: '{stepsLeft} steps left. Tap to continue where you stopped.' },
  },
  id_check_approved: {
    en: { title: 'ID check done', body: 'Your identity is verified. Open Laboura for the next step.' },
  },
  id_check_retry: {
    en: { title: 'ID check needs another try', body: 'We could not finish your ID check. Open Laboura to try again.' },
  },
  payment_confirmed: {
    en: { title: 'Payment received', body: 'Your {days}-day guarantee has started. Your receipt is in Laboura.' },
  },
  fee_paid: {
    en: { title: 'Payment received', body: 'Thank you. Your invoice and the candidate details are in Laboura.' },
  },
  replacement_cancelled: {
    en: { title: 'Replacement cancelled', body: 'The salary difference was not paid in time, so this replacement was cancelled. We keep looking for another.' },
  },
  interview_cancelled: {
    en: { title: 'Interview cancelled', body: 'This interview is cancelled: the business cannot hold interviews for now. Open Laboura for details.' },
  },
  selection_cancelled: {
    en: { title: 'Selection cancelled', body: 'The business did not complete its payment, so this job is cancelled. You are back on the list for new jobs.' },
  },
  job_match: {
    en: { title: 'A new job that suits you', body: 'Open Laboura to see it and tap "I\'m interested".' },
  },
  interview_booked: {
    en: { title: 'You have an interview offer', body: 'Reply within {hours} hours. Open Laboura for the details.' },
  },
  interview_reminder_tomorrow: {
    en: { title: 'Interview tomorrow', body: 'You have an interview tomorrow. Open Laboura for the time.' },
  },
  interview_reminder_soon: {
    en: { title: 'Interview in 2 hours', body: 'Your interview is in about 2 hours. Open Laboura for directions.' },
  },
  offer_check: {
    en: { title: 'Did they offer you the job?', body: 'Tell us in Laboura: yes or no.' },
  },
  joining_confirmed: {
    en: { title: 'Joining date confirmed', body: 'Open Laboura to see the joining date.' },
  },
  joining_moved: {
    en: { title: 'Joining date changed', body: 'The joining date has moved. Open Laboura to see the new date.' },
  },
  joining_day_check: {
    en: { title: 'Joining day', body: 'Today is the joining day. Tell us in Laboura if it happened.' },
  },
  hit_recorded: {
    en: { title: 'A hit was recorded', body: 'Open Laboura to see why, and how to ask for a review.' },
  },
  guarantee_countdown: {
    en: { title: 'Guarantee update', body: '{daysLeft} days left in your guarantee. Open Laboura for your status.' },
  },
  refund_approved: {
    en: { title: 'Refund approved', body: 'Your refund is approved. Laboura will pay it to your UPI soon.' },
  },
  refund_paid: {
    en: { title: 'Refund paid', body: 'Your refund has been paid. The UPI reference is in Laboura.' },
  },
  reward_approved: {
    en: { title: 'Joining reward approved', body: 'Your joining reward is approved. Laboura will pay it to your UPI soon.' },
  },
  reward_paid: {
    en: { title: 'Joining reward paid', body: 'Your joining reward has been paid. The UPI reference is in Laboura.' },
  },
  visit_booked: {
    en: { title: 'Visit booked', body: '{agentFirstName} from Laboura will visit you on {when}.' },
  },
  business_approved: {
    en: { title: 'Your business is verified', body: 'Laboura can now share candidates with you. Open Laboura.' },
  },
  vacancy_confirmed: {
    en: { title: 'Vacancy confirmed', body: 'Vacancy {vacancyCode} is confirmed. We will look for candidates.' },
  },
  candidates_shared: {
    en: { title: 'New candidates for you', body: 'Laboura shared candidates for your vacancy. Open Laboura to see them.' },
  },
  interview_result_due: {
    en: { title: 'Record today\'s interview result', body: 'Please record the result in Laboura by 8 PM today.' },
  },
  selected_pay_fee: {
    en: { title: 'Candidate selected: pay to confirm', body: 'Pay the fee within {hours} hours to confirm the joining. Open Laboura.' },
  },
  claim_decided: {
    en: { title: 'Replacement claim decided', body: 'There is a decision on your replacement claim. Open Laboura.' },
  },
  replacement_found: {
    en: { title: 'Replacement found', body: 'Laboura found a replacement candidate for you. Open Laboura.' },
  },
  referral_registered: {
    en: { title: 'New referral', body: '{firstName} registered with your link.' },
  },
  referral_paid: {
    en: { title: 'Referral update', body: '{firstName} has paid and is now looking for a job with Laboura.' },
  },
  referral_joined: {
    en: { title: 'Your referral joined a job', body: '{firstName} joined a job. Your reward is now due. Open Laboura.' },
  },
  payout_approved: {
    en: { title: 'Payout approved', body: 'Your referral payout is approved. Laboura will pay it to your UPI soon.' },
  },
  payout_paid: {
    en: { title: 'Payout paid', body: 'Your referral payout has been paid. The UPI reference is in Laboura.' },
  },
  promotion: {
    en: { title: 'News from Laboura', body: 'Open Laboura to see what is new.' },
  },
};

const LOCALE: Record<CustomerLanguage, string> = { en: 'en-IN' };

export function isCustomerLanguage(value: unknown): value is CustomerLanguage {
  return value === 'en';
}

export type WordingVars = Record<string, string | number | Date>;

/** Formats a value for a placeholder: dates in IST, in the person's language. */
function formatVar(value: string | number | Date, language: CustomerLanguage): string {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat(LOCALE[language], {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(value);
  }
  return String(value);
}

function fill(template: string, vars: WordingVars, language: CustomerLanguage): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? formatVar(vars[name], language) : match,
  );
}

/**
 * The title and body of one event in one language. Unknown languages fall
 * back to English. Throws when a placeholder the event needs is missing, so a
 * caller can never send "{firstName} joined a job".
 */
export function renderWording(kind: CustomerEventKind, language: string, vars: WordingVars = {}): Wording & { language: CustomerLanguage } {
  const lang: CustomerLanguage = isCustomerLanguage(language) ? language : 'en';
  const missing = CUSTOMER_EVENTS[kind].vars.filter((name) => !Object.prototype.hasOwnProperty.call(vars, name));
  if (missing.length > 0) {
    throw new Error(`Notification ${kind} needs ${missing.join(', ')}`);
  }
  const wording = CUSTOMER_NOTIFICATION_WORDING[kind][lang];
  return { title: fill(wording.title, vars, lang), body: fill(wording.body, vars, lang), language: lang };
}

/**
 * Lock-screen text for events whose inbox copy names another person (privacy
 * review L1): the push says "Someone you referred …"; the first name is shown
 * only in the app's inbox, after sign-in. No placeholders.
 */
export const LOCK_SCREEN_WORDING: Partial<Record<CustomerEventKind, Record<CustomerLanguage, Wording>>> = {
  referral_registered: {
    en: { title: 'New referral', body: 'Someone you referred registered with your link. Open Laboura.' },
  },
  referral_paid: {
    en: { title: 'Referral update', body: 'Someone you referred has paid and is now looking for a job with Laboura.' },
  },
  referral_joined: {
    en: { title: 'Your referral joined a job', body: 'Someone you referred joined a job. Your reward is now due. Open Laboura.' },
  },
};

/** The push's title and body: the lock-screen text when the event has one, else the inbox copy. */
export function pushWording(kind: string, language: string, inbox: Wording): Wording {
  const table = LOCK_SCREEN_WORDING[kind as CustomerEventKind];
  if (!table) return inbox;
  return table[isCustomerLanguage(language) ? language : 'en'];
}
