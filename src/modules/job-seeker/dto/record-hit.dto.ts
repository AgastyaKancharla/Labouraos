export const JOB_SEEKER_HIT_REASONS = [
  'no_pickup',
  'offer_declined',
  'offer_no_reply',
  'interview_no_show',
] as const;

export type JobSeekerHitReason = (typeof JOB_SEEKER_HIT_REASONS)[number];

export type HitReason =
  | JobSeekerHitReason
  | 'offer_rejected'; // legacy backwards-compatibility

/**
 * Normalizes hit reason on read: maps old 'offer_rejected' to 'offer_declined'.
 */
export function normalizeHitReason(reason: string): string {
  if (reason === 'offer_rejected') {
    return 'offer_declined';
  }
  return reason;
}

export interface RecordHitDto {
  reason: HitReason;
  note?: string;
  interviewId?: string;
  callRecordId?: string;
  [key: string]: unknown;
}

export interface ReverseHitDto {
  reversalReason: string;
}
