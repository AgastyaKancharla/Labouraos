import type { ApiClient } from '../client';

/** One metric in GET /targets/dashboard (target.constants.ts PaceEvaluationResult). */
export interface MetricPace {
  metric: string;
  label: string;
  status: string;
  storedTarget: number | null;
  effectiveTarget: number | null;
  achieved: number | null;
  expectedPace: number | null;
  isBehindPace: boolean;
  isBreached: boolean;
}

/** GET /targets/dashboard for a field agent: scope "agent", their own month. */
export interface TargetDashboard {
  scope: 'agent' | 'team' | 'city';
  period: { year: number; month: number; daysInMonth: number; currentDay: number; asOf: string };
  agent?: {
    staff: { id: string; code: string; name: string; role: string };
    achieved: { placementsClosed?: number; candidatesActivated?: number; vacanciesCaptured?: number };
    metrics: Record<string, MetricPace | undefined>;
    isBehindPace: boolean;
    isBreached: boolean;
  };
}

export const targetsApi = (api: ApiClient) => ({
  dashboard: () => api.get<TargetDashboard>('/targets/dashboard'),
});
