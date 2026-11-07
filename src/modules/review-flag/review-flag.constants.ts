export const REVIEW_FLAG_KINDS = [
  'duplicate_business',
  'gps_mismatch',
  'no_documents_check',
  'interview_result_mismatch',
  'interview_result_overdue',
  'interview_no_result',
  'interview_result_due',
  'payment_overdue',
  'payment_mismatch',
  'business_many_rejections',
  'agent_rejection_pattern',
  'business_stopped_after_interviews',
  'bypass_suspected',
  'payout_name_mismatch',
  'payout_shared_account',
  'payout_matches_staff',
  'odd_hour_login',
  'screenshot_taken',
  'hit_reversed',
  'vacancy_captured_for_account_business',
] as const;

export type ReviewFlagKind = (typeof REVIEW_FLAG_KINDS)[number];

export const REVIEW_FLAG_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReviewFlagStatus = (typeof REVIEW_FLAG_STATUSES)[number];
