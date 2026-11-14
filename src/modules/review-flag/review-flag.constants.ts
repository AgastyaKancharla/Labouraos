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
  /** Laboura Field (decided 9 Nov): an owner's complaint on a call goes to the Team Lead with the recording. */
  'owner_complaint',
  /** FA11: the owner said on the joining call that the worker didn't come. */
  'joining_no_show',
  /** T-Verify: the Team Lead marked a registration as fake (Manager sees it). */
  'registration_suspect',
  /** T-Quality: the Team Lead flagged a recorded call. */
  'call_flagged',
  /** T-Visits: the Team Lead flagged a shop visit. */
  'visit_flagged',
  /** Aadhaar QR (guide, 14 Nov): his OTP-verified phone is not the one linked to that Aadhaar — a flag, not a block. */
  'aadhaar_phone_not_linked',
  /** Aadhaar QR: repeated QR codes that failed UIDAI's digital signature (possibly an edited card). */
  'aadhaar_qr_tampered',
  /** Aadhaar QR (rev 154): a card newer than our newest UIDAI certificate — not fraud; the CEO adds the new certificate. */
  'aadhaar_cert_missing',
  /** Aadhaar QR (rev 154): the same Aadhaar (last 4 + date of birth + name) is already verified for another person — the Manager looks; never a block. */
  'aadhaar_duplicate_person',
] as const;

export type ReviewFlagKind = (typeof REVIEW_FLAG_KINDS)[number];

export const REVIEW_FLAG_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReviewFlagStatus = (typeof REVIEW_FLAG_STATUSES)[number];

/** Flags about money or a business hiding a hire: the CEO decides them (guide, Quality). */
export const CEO_OWNED_FLAG_KINDS: readonly string[] = [
  'payment_overdue',
  'payment_mismatch',
  'payout_name_mismatch',
  'payout_shared_account',
  'payout_matches_staff',
  'bypass_suspected',
  'aadhaar_cert_missing',
];
