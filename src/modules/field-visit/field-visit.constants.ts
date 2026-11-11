/** Every visit gets an outcome (Master Guide, field agent app, decided 9 Nov). */
export const VISIT_OUTCOMES = ['onboarded', 'interested_later', 'not_interested', 'owner_not_there'] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

/**
 * FA21 "Interested — onboard now": the talk is over and the agent steps out
 * for the proof selfie. The outcome becomes `onboarded` when the business is
 * registered from this visit.
 */
export const ONBOARD_NOW = 'onboard_now';

/** FA06c "If not interested, why?" */
export const NOT_INTERESTED_REASONS = [
  'hires_family_friends',
  'fee_too_high',
  'no_staff_needed',
  'other_agency',
  'other',
] as const;

/** FA21 "Who did you speak to?" */
export const SPOKE_TO = ['owner', 'manager', 'staff', 'no_one'] as const;

/** Outcomes that bring the agent back on a date (Home and Map show them then). */
export const REVISIT_OUTCOMES: readonly string[] = ['interested_later', 'owner_not_there'];

export const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
/** Largest photo accepted (the phone sends ~0.7 quality JPEGs). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** A phone time this far ahead of the server is not believed. */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
/** A queued visit older than this is not believed either. */
export const MAX_QUEUE_AGE_MS = 48 * 60 * 60 * 1000;
/** Attendance switches to On visit / Travelling only for visits sent live. */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;
/** Two readings this far apart in time that match to the last digit look faked. */
export const IDENTICAL_READING_MIN_GAP_MS = 60 * 1000;
