export const REVIEW_FLAG_KINDS = [
  'duplicate_business',
  'gps_mismatch',
  'no_documents_check',
  'in_person_onboarding_review',
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
  'hit_reversal_needs_manager',
  'vacancy_captured_for_account_business',
  'claim_decision_overdue',
  'name_check',
  'break_overrun',
  /** A follow-up call went unanswered 3 times; the Team Lead is told (guide, 9 Nov). */
  'follow_up_unanswered',
  // Shop visits (field agent app, decided 9 Nov): checks for the Team Lead.
  /** Inside the shop for less than the "very short visit" setting. */
  'visit_short',
  /** Two shops too far apart for the time between the visits. */
  'visits_too_far_apart',
  /** A name-board photo or selfie that was already used (the upload is refused too). */
  'visit_photo_reused',
  /** GPS that looks faked (no accuracy, identical readings, photo stamp elsewhere). */
  'visit_gps_suspect',
  /** Many visits in the window and not one onboarding. */
  'visits_no_onboarding',
] as const;

export type ReviewFlagKind = (typeof REVIEW_FLAG_KINDS)[number];

export const REVIEW_FLAG_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReviewFlagStatus = (typeof REVIEW_FLAG_STATUSES)[number];
