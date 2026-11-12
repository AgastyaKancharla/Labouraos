import { StatusPill, type StatusTone } from '../../../components/Badge';

/** Status words and pills shared by the CEO screens. */
export const SEEKER_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  lead: { label: 'Registered, not paid', tone: 'muted' },
  consented: { label: 'Consent given', tone: 'muted' },
  pending_activation: { label: 'Paid — confirming', tone: 'warn' },
  active: { label: 'Active', tone: 'info' },
  paused: { label: 'Paused', tone: 'warn' },
  deactivated: { label: 'Deactivated', tone: 'danger' },
  placed: { label: 'Placed', tone: 'good' },
  closed: { label: 'Closed', tone: 'muted' },
  refunded: { label: 'Refunded · can pay again', tone: 'muted' },
};
export function guaranteePill(daysLeft: number | null) {
  if (daysLeft === null) return <span className="ceo-sub">—</span>;
  if (daysLeft < 0) return <StatusPill tone="danger">Ran out {Math.abs(daysLeft)} d ago</StatusPill>;
  const tone: StatusTone = daysLeft <= 5 ? 'crit' : daysLeft <= 15 ? 'warn' : 'good';
  return <StatusPill tone={tone}>{daysLeft === 1 ? '1 day left' : `${daysLeft} days left`}</StatusPill>;
}


export const BUSINESS_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  lead: { label: 'Lead · visit needed', tone: 'muted' },
  pending_visit: { label: 'Visit needed', tone: 'warn' },
  pending_tl_check: { label: 'TL review', tone: 'warn' },
  verified: { label: 'Verified', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'danger' },
  paused: { label: 'Paused', tone: 'danger' },
};

export const VACANCY_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: 'Matching', tone: 'info' },
  filled: { label: 'Filled', tone: 'good' },
  cancelled: { label: 'Closed', tone: 'muted' },
  draft: { label: 'Draft', tone: 'muted' },
  awaiting_confirmation: { label: 'Waiting for owner OTP', tone: 'warn' },
};

export const PLACEMENT_STAGE: Record<string, { label: string; tone: StatusTone }> = {
  awaiting_payment: { label: 'Waiting for fee', tone: 'warn' },
  paid_not_joined: { label: 'Paid, not joined', tone: 'info' },
  working: { label: 'Working', tone: 'good' },
  replacement: { label: 'Replacement search', tone: 'crit' },
  cleared: { label: 'Cleared 60 days', tone: 'good' },
  refunded: { label: 'Refunded', tone: 'danger' },
  guarantee_ended: { label: 'Guarantee ended', tone: 'muted' },
  replaced: { label: 'Replaced', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: 'Owed · waiting for approval', tone: 'warn' },
  approved: { label: 'Approved · ready to pay', tone: 'info' },
  processing: { label: 'Processing', tone: 'info' },
  succeeded: { label: 'Paid', tone: 'good' },
  completed: { label: 'Paid', tone: 'good' },
  failed: { label: 'Failed', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'muted' },
  reversed: { label: 'Reversed', tone: 'muted' },
  refunded: { label: 'Refunded', tone: 'muted' },
};

export const PAYMENT_TYPE: Record<string, string> = {
  activation: '₹499 registration',
  reactivation: '₹499 re-registration',
  placement_fee: 'Placement fee',
  refund: 'Refund',
  duplicate_refund: 'Duplicate payment refund',
  referral_payout: 'Referral payout',
  joining_reward: 'Joining reward',
};
