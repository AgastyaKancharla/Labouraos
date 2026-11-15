import type { IconName } from '@/components/Icon';
import type { Accent } from '@/theme';

export interface NotificationStyle {
  accent: Accent;
  icon: IconName;
}

/**
 * The colour and drawn icon of each notification type in the inbox
 * (Master Guide rev 171: colour-coded notifications, the Command Center's
 * palette). The title always says what the message is; the colour only
 * helps the eye.
 * - offer / interview / job: orange
 * - payment / receipt / money paid: green
 * - ID check result: cyan
 * - reminders and countdowns: gold
 * - refunds and replacement claims: royal
 * - anything else (promotions, unknown kinds): navy
 */
export function notificationStyle(kind: string): NotificationStyle {
  const k = kind.toLowerCase();
  if (k.includes('reminder') || k === 'guarantee_countdown' || k === 'hit_recorded') return { accent: 'gold', icon: 'clock' };
  if (k.startsWith('refund_') || k === 'claim_decided' || k === 'replacement_found') return { accent: 'royal', icon: 'refund' };
  if (k.startsWith('id_check_')) return { accent: 'cyan', icon: 'id-card' };
  if (k === 'visit_booked' || k === 'referral_registered') return { accent: 'cyan', icon: 'calendar' };
  if (
    k.startsWith('interview_') ||
    k.startsWith('offer_') ||
    k.startsWith('joining_') ||
    k === 'job_match' ||
    k === 'candidates_shared' ||
    k === 'selected_pay_fee'
  ) {
    return { accent: 'orange', icon: 'briefcase' };
  }
  if (
    k.startsWith('payment_') ||
    k === 'fee_paid' ||
    k.endsWith('_paid') ||
    k.endsWith('_approved') ||
    k === 'vacancy_confirmed' ||
    k === 'referral_joined'
  ) {
    return { accent: 'good', icon: 'rupee' };
  }
  return { accent: 'navy', icon: 'bell' };
}
