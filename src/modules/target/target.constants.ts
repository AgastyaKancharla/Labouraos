export type MetricDirection = 'higher_is_better' | 'lower_is_better';
export type MetricStatus = 'active' | 'not_targeted' | 'not_measured';

export interface MetricDefinition {
  key: TargetMetricKey;
  label: string;
  direction: MetricDirection;
  isRate: boolean;
  proRateable: boolean;
  applicableRoles: ('call_agent' | 'field_agent')[];
}

export const TARGET_METRICS = {
  candidatesActivated: {
    key: 'candidatesActivated',
    label: 'Candidates activated',
    direction: 'higher_is_better',
    isRate: false,
    proRateable: true,
    applicableRoles: ['call_agent'],
  },
  refundRate: {
    key: 'refundRate',
    label: 'Refund rate on own registrations',
    direction: 'lower_is_better',
    isRate: true,
    proRateable: false,
    applicableRoles: ['call_agent'],
  },
  vacanciesCaptured: {
    key: 'vacanciesCaptured',
    label: 'Vacancies captured',
    direction: 'higher_is_better',
    isRate: false,
    proRateable: true,
    applicableRoles: ['call_agent'],
  },
  placementsClosed: {
    key: 'placementsClosed',
    label: 'Placements closed',
    direction: 'higher_is_better',
    isRate: false,
    proRateable: true,
    applicableRoles: ['field_agent'],
  },
  replacementsInside15Days: {
    key: 'replacementsInside15Days',
    label: 'Replacements secured inside 15 days',
    direction: 'higher_is_better',
    isRate: false,
    proRateable: true,
    applicableRoles: ['field_agent'],
  },
  repeatBusinesses: {
    key: 'repeatBusinesses',
    label: 'Repeat businesses',
    direction: 'higher_is_better',
    isRate: false,
    proRateable: true,
    applicableRoles: ['field_agent'],
  },
} as const satisfies Record<string, MetricDefinition>;

import { getCalendarPartsInTimezone, DEFAULT_BUSINESS_TIMEZONE } from '../../common/time/period-boundary';

export type TargetMetricKey =
  | 'candidatesActivated'
  | 'refundRate'
  | 'vacanciesCaptured'
  | 'placementsClosed'
  | 'replacementsInside15Days'
  | 'repeatBusinesses';

export const ALL_METRIC_KEYS: TargetMetricKey[] = [
  'candidatesActivated',
  'refundRate',
  'vacanciesCaptured',
  'placementsClosed',
  'replacementsInside15Days',
  'repeatBusinesses',
];

export const ALLOWED_TARGET_ROLES = ['call_agent', 'field_agent'] as const;

/**
 * Minimum matured registrations denominator required before flagging a refund rate breach.
 * Prevents small-sample noise from triggering performance flags (e.g. 1 refund out of 2 or 3
 * is noise, not a statistically valid breach signal).
 */
export const MIN_REFUND_RATE_DENOMINATOR = 5;

/**
 * Behind-pace threshold (80% of expected pace).
 * An agent whose achieved figure is below 80% of expected pace is flagged as behind pace.
 */
export const BEHIND_PACE_THRESHOLD = 0.8;

/**
 * Calendar day of the month (in Asia/Kolkata) from which behind-pace flagging begins.
 * Prevents flagging during the first week when small-sample variance is high.
 */
export const BEHIND_PACE_START_DAY = 8;

/**
 * Window in days for job seeker candidates approaching their 30-day refund deadline.
 * A candidate whose guarantee matures within 7 days is approaching deadline and at risk.
 */
export const CANDIDATE_AT_RISK_WINDOW_DAYS = 7;

/**
 * Window in days for dropped-out placements approaching their 15-day replacement deadline.
 * A replacement vacancy whose 15-day window matures within 5 days is approaching deadline and at risk.
 */
export const PLACEMENT_AT_RISK_WINDOW_DAYS = 5;

/**
 * Returns total days in a given calendar month (UTC).
 * Month is 1-indexed (1 = January, 12 = December).
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Pro-rating factor calculation for mid-month joiners:
 *
 * Formula (inclusive of start day):
 * factor = (daysInMonth - creationDay + 1) / daysInMonth
 *
 * Example: Starting on the 20th of a 30-day month -> 11 days worked (20th to 30th)
 * factor = 11 / 30.
 *
 * Note on start date signal:
 * Staff.createdAt is the only available start-date signal, and it is account
 * creation rather than first working day. Close enough, and stated so nobody later
 * mistakes it for an HR record.
 */
export function calculateProRatingFactor(
  staffCreatedAt: Date,
  targetYear: number,
  targetMonth: number,
  timezoneOrCity: string = DEFAULT_BUSINESS_TIMEZONE,
): { factor: number; isMidMonthJoiner: boolean; daysPresent: number; daysInMonth: number } {
  const daysInMonth = getDaysInMonth(targetYear, targetMonth);
  const parts = getCalendarPartsInTimezone(staffCreatedAt, timezoneOrCity);
  const createdYear = parts.year;
  const createdMonth = parts.month;
  const createdDay = parts.day;

  // If staff account was created during the target month:
  if (createdYear === targetYear && createdMonth === targetMonth) {
    const daysPresent = Math.max(0, daysInMonth - createdDay + 1);
    const factor = daysPresent / daysInMonth;
    return { factor, isMidMonthJoiner: true, daysPresent, daysInMonth };
  }

  // If staff was created before the target month: full month present
  if (createdYear < targetYear || (createdYear === targetYear && createdMonth < targetMonth)) {
    return { factor: 1.0, isMidMonthJoiner: false, daysPresent: daysInMonth, daysInMonth };
  }

  // If staff was created after the target month: 0 days present in period
  return { factor: 0.0, isMidMonthJoiner: false, daysPresent: 0, daysInMonth };
}

export interface MetricEvaluationResult {
  metric: TargetMetricKey;
  label: string;
  direction: MetricDirection;
  storedTarget: number | null;
  effectiveTarget: number | null;
  isMeasured: boolean;
  status: MetricStatus;
}

/**
 * Evaluates effective target for a single metric:
 * - If stored target is null: status = 'not_targeted', effectiveTarget = null, isMeasured = false.
 * - If refundRate: ceiling ratio, not scaled by pro-rating factor. status = 'active', isMeasured = true.
 * - If volume count: scaled by factor and rounded with Math.floor.
 *   If the floor computes to 0: status = 'not_measured', effectiveTarget = null, isMeasured = false.
 *   ("Where the effective target computes to 0, return a state meaning 'not measured this period'
 *    rather than a target of 0 — a zero target reads as no expectation, which is not the same thing.")
 */
export function evaluateMetricTarget(
  key: TargetMetricKey,
  storedValue: number | null,
  proRatingFactor: number,
): MetricEvaluationResult {
  const def = TARGET_METRICS[key];

  if (storedValue === null || storedValue === undefined) {
    return {
      metric: key,
      label: def.label,
      direction: def.direction,
      storedTarget: null,
      effectiveTarget: null,
      isMeasured: false,
      status: 'not_targeted',
    };
  }

  // Rate ceiling (refundRate): does not scale down with tenure/pro-rating
  if (!def.proRateable) {
    return {
      metric: key,
      label: def.label,
      direction: def.direction,
      storedTarget: storedValue,
      effectiveTarget: storedValue,
      isMeasured: true,
      status: 'active',
    };
  }

  // Volume count: floor(stored * factor)
  const floored = Math.floor(storedValue * proRatingFactor);

  if (floored <= 0) {
    return {
      metric: key,
      label: def.label,
      direction: def.direction,
      storedTarget: storedValue,
      effectiveTarget: null,
      isMeasured: false,
      status: 'not_measured',
    };
  }

  return {
    metric: key,
    label: def.label,
    direction: def.direction,
    storedTarget: storedValue,
    effectiveTarget: floored,
    isMeasured: true,
    status: 'active',
  };
}

export interface PaceEvaluationResult {
  metric: TargetMetricKey;
  label: string;
  direction: MetricDirection;
  status: MetricStatus;
  storedTarget: number | null;
  effectiveTarget: number | null;
  achieved: number | null;
  expectedPace: number | null;
  isBehindPace: boolean;
  isBreached: boolean;
  maturedCount?: number;
}

/**
 * Evaluates pacing and breach status for a single metric:
 *
 * PACE FLAGGING RULES (Task 6):
 * 1. Pace flags apply ONLY to higher_is_better metrics. Applying pace to a ceiling metric (refund rate)
 *    is meaningless and would falsely flag low refund rates.
 * 2. A metric with status 'not_targeted' or 'not_measured' is NEVER flagged.
 * 3. Behind-pace flagging fires from day 8 onward (BEHIND_PACE_START_DAY = 8) in the business timezone.
 *    A slow first week does not flag the whole team.
 * 4. Expected pace = effectiveTarget * (daysElapsed / daysInPeriod).
 *    For mid-month joiners, daysElapsed and daysInPeriod are measured from their start day,
 *    matching calculateProRatingFactor.
 * 5. Flagged as behind pace if achieved < (BEHIND_PACE_THRESHOLD * expectedPace), where BEHIND_PACE_THRESHOLD = 0.8.
 *
 * REFUND RATE BREACH RULES (Task 6):
 * 1. Fires only when the actual rate is above the target AND the matured denominator is at least
 *    MIN_REFUND_RATE_DENOMINATOR (5).
 * 2. Zero denominator has no refund rate and is never flagged. Small samples (< 5) are treated as noise.
 */
export function evaluateMetricPace(params: {
  metric: TargetMetricKey;
  targetEvaluation: MetricEvaluationResult;
  achieved: number | null;
  currentDay: number;
  daysElapsed: number;
  daysInPeriod: number;
  maturedCount?: number;
}): PaceEvaluationResult {
  const {
    metric,
    targetEvaluation,
    achieved,
    currentDay,
    daysElapsed,
    daysInPeriod,
    maturedCount = 0,
  } = params;

  const def = TARGET_METRICS[metric];
  const { direction, status, storedTarget, effectiveTarget } = targetEvaluation;

  // 1. Lower-is-better metrics (ceiling: refundRate)
  if (direction === 'lower_is_better') {
    let isBreached = false;
    if (
      status === 'active' &&
      effectiveTarget !== null &&
      achieved !== null &&
      maturedCount >= MIN_REFUND_RATE_DENOMINATOR
    ) {
      if (achieved > effectiveTarget) {
        isBreached = true;
      }
    }

    return {
      metric,
      label: def.label,
      direction,
      status,
      storedTarget,
      effectiveTarget,
      achieved,
      expectedPace: null,
      isBehindPace: false, // Pace flagging NEVER applies to ceiling metrics
      isBreached,
      maturedCount,
    };
  }

  // 2. Higher-is-better metrics (volume / margin floors)
  // Not targeted or not measured -> never flagged
  if (status !== 'active' || effectiveTarget === null || effectiveTarget <= 0) {
    return {
      metric,
      label: def.label,
      direction,
      status,
      storedTarget,
      effectiveTarget,
      achieved,
      expectedPace: null,
      isBehindPace: false,
      isBreached: false,
    };
  }

  // Expected pace calculation
  const expectedPace =
    daysInPeriod > 0 ? (effectiveTarget * daysElapsed) / daysInPeriod : 0;

  // Behind pace flagging: only from BEHIND_PACE_START_DAY (day 8) onward
  let isBehindPace = false;
  if (currentDay >= BEHIND_PACE_START_DAY) {
    const threshold = BEHIND_PACE_THRESHOLD * expectedPace;
    if ((achieved ?? 0) < threshold) {
      isBehindPace = true;
    }
  }

  return {
    metric,
    label: def.label,
    direction,
    status,
    storedTarget,
    effectiveTarget,
    achieved,
    expectedPace,
    isBehindPace,
    isBreached: false,
  };
}

