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
    label: 'Replacement vacancies filled inside 15 days',
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
): { factor: number; isMidMonthJoiner: boolean; daysPresent: number; daysInMonth: number } {
  const daysInMonth = getDaysInMonth(targetYear, targetMonth);
  const createdYear = staffCreatedAt.getUTCFullYear();
  const createdMonth = staffCreatedAt.getUTCMonth() + 1;
  const createdDay = staffCreatedAt.getUTCDate();

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
