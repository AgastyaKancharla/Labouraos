/**
 * Master Guide: "Keeping data" (replaces the 25 October "never delete" rule)
 *
 * Data                                       | Kept                         | Then
 * -------------------------------------------|------------------------------|-----------
 * Payments, invoices, refunds, payouts       | 8 years                      | deleted
 * Job seeker, business, referral profiles    | 23 months after last activity| anonymised
 * Identity verification                      | result only                  | —
 * Call recordings                            | 1 year, or until dispute     | deleted
 * Login and access logs                      | 1 year                       | deleted
 *
 * Changes to retention periods require legal advice and code review;
 * they are NOT stored in PricingPolicy.
 */

export const PROFILE_RETENTION_MONTHS = 23;
export const CALL_RECORDING_RETENTION_MONTHS = 12;
export const ACCESS_LOG_RETENTION_MONTHS = 12;
export const MONEY_RECORD_RETENTION_YEARS = 8;

export const RETENTION_PERIODS = {
  PROFILES_MONTHS: PROFILE_RETENTION_MONTHS,
  CALL_RECORDINGS_MONTHS: CALL_RECORDING_RETENTION_MONTHS,
  LOGIN_AND_ACCESS_LOGS_MONTHS: ACCESS_LOG_RETENTION_MONTHS,
  MONEY_RECORDS_YEARS: MONEY_RECORD_RETENTION_YEARS,
} as const;

export function getProfileRetentionCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - PROFILE_RETENTION_MONTHS);
  return cutoff;
}

export function getCallRecordingRetentionCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - CALL_RECORDING_RETENTION_MONTHS);
  return cutoff;
}

export function getAccessLogRetentionCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - ACCESS_LOG_RETENTION_MONTHS);
  return cutoff;
}

export function getMoneyRecordRetentionCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - MONEY_RECORD_RETENTION_YEARS);
  return cutoff;
}
