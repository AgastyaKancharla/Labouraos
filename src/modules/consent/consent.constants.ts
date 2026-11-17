export const JOB_SEEKER_REQUIRED_CONSENT_PURPOSES = [
  'job_matching',
  'profile_sharing',
  'call_recording',
  'aadhaar_verification',
  'job_updates',
] as const;

export const JOB_SEEKER_OPTIONAL_CONSENT_PURPOSES = ['promotions'] as const;

export const JOB_SEEKER_CONSENT_PURPOSES = [
  ...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES,
  ...JOB_SEEKER_OPTIONAL_CONSENT_PURPOSES,
] as const;

export type JobSeekerConsentPurpose = (typeof JOB_SEEKER_CONSENT_PURPOSES)[number];

export const REQUIRED_CONSENT_PURPOSES_BY_SUBJECT: Record<string, readonly string[]> = {
  job_seeker: JOB_SEEKER_REQUIRED_CONSENT_PURPOSES,
  business: ['agreement_terms', 'call_recording'],
  // Referral Partner Terms v1.0 (rev 176, S2): a separate ID-check consent for partners.
  referral: ['agreement_terms', 'call_recording', 'aadhaar_verification'],
  staff: ['gps_tracking', 'call_recording', 'data_use'],
};

/** English only (Master Guide rev 193). */
export const CONSENT_LANGUAGES = ['en'] as const;
export type ConsentLanguage = (typeof CONSENT_LANGUAGES)[number];

export const CONSENT_METHODS = ['sms_link', 'in_app', 'contract'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * 1.1 (rev 154): the ID check notice names the live photo of another ID card.
 * 1.2 (rev 176, 15 Nov): the six ticks word for word from Job Seeker Terms
 * v1.1, Part B. Consents given under 1.0 / 1.1 stay valid until the person
 * accepts 1.2 (re-consent).
 */
export const DEFAULT_NOTICE_VERSION = '1.2';
