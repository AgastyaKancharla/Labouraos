/**
 * Shared names for the customer app (job seekers, businesses and referral
 * partners signing in to the Laboura app). One place, so the customer
 * sign-in, the app's APIs, notifications and the back office agree.
 * Customer app proposal (confirmed 14 Nov), sections 2 to 5 and C1-C24.
 */

/** Every customer API lives under this path. Staff routes never do. */
export const CUSTOMER_API_PREFIX = 'customer-api/v1';

/** The JWT audience and issuer of a customer access token (never on a staff token). */
export const CUSTOMER_TOKEN_AUDIENCE = 'laboura-customer';
export const CUSTOMER_TOKEN_ISSUER = 'laboura';
/** The `realm` claim every customer access token carries. */
export const CUSTOMER_TOKEN_REALM = 'customer';

export const CUSTOMER_PROFILE_KINDS = ['job_seeker', 'business', 'referral'] as const;
export type CustomerProfileKind = (typeof CUSTOMER_PROFILE_KINDS)[number];

/** Business profile roles (proposal 2.2). Job seeker and referral profiles are `self`. */
export const CUSTOMER_BUSINESS_ROLES = ['owner', 'manager', 'hr', 'supervisor'] as const;

export const CUSTOMER_LANGUAGES = ['kn', 'hi', 'en'] as const;

/** Sign-up tracker stages (proposal 4.1). */
export const SIGNUP_STAGES = ['A', 'B', 'C', 'D', 'E', 'done'] as const;
export type SignupStage = (typeof SIGNUP_STAGES)[number];

export const SIGNUP_OUTCOMES = ['open', 'self', 'assisted', 'gave_up', 'no_response'] as const;

/** CallTask.kind for "help finish an app sign-up" (C4). */
export const CALL_TASK_KIND_SIGNUP_HELP = 'signup_help';

/** VisitAssignment.purpose for a business that signed up in the app. */
export const VISIT_PURPOSE_BUSINESS_SIGNUP = 'business_signup';

/** "How they heard about Laboura" value for app sign-ups (C3). */
export const HEARD_FROM_LABOURA_APP = 'laboura_app';

/** MessageLog.channel values added by the app. Never counted as contact attempts (C17). */
export const CUSTOMER_MESSAGE_CHANNELS = ['push', 'in_app'] as const;

/** Inbox categories = the three notification switches (proposal 5.4). */
export const CUSTOMER_NOTIFICATION_CATEGORIES = ['service', 'job_updates', 'promotions'] as const;

/** Customer sessions last 90 days, renewed on use (C16). */
export const CUSTOMER_SESSION_DAYS = 90;
/** Access tokens are short; the app renews them with the refresh token. */
export const CUSTOMER_ACCESS_TOKEN_MINUTES = 15;
/** A fresh OTP for a sensitive action is good for this long, once. */
export const CUSTOMER_STEP_UP_MINUTES = 5;

/** Sensitive actions that always need a fresh OTP (proposal 3, point 5). */
export const CUSTOMER_STEP_UP_PURPOSES = [
  'delete_account',
  'payout_details',
  'sign_agreement',
  'interview_result',
  'confirm_vacancy',
] as const;
export type CustomerStepUpPurpose = (typeof CUSTOMER_STEP_UP_PURPOSES)[number];
