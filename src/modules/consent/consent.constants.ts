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
  referral: ['agreement_terms', 'call_recording'],
  staff: ['gps_tracking', 'call_recording', 'data_use'],
};

export const CONSENT_LANGUAGES = ['kn', 'hi', 'en'] as const;
export type ConsentLanguage = (typeof CONSENT_LANGUAGES)[number];

export const CONSENT_METHODS = ['sms_link', 'in_app', 'contract'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const DEFAULT_NOTICE_VERSION = '1.0';
