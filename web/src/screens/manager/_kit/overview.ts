import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';
import { periodToUtcRange, type Period } from '../../../lib/period';
import type { Forecast, PlanRow } from './kit';

/** GET /manager/overview — plan vs actual for the Manager's tree (MG-Home, MG-Plan). Counts only. */
export interface Overview {
  manager: { id: string; code: string; name: string };
  teams: string[];
  month: { year: number; month: number; key: string; dayOfMonth: number; daysInMonth: number; daysLeft: number };
  headline: {
    withTarget: number;
    reached: number;
    short: number;
    biggestGap: { metric: string; label: string; atThisSpeed: number; target: number | null; needPerDay: number | null; doingPerDay: number } | null;
  };
  bringMoney: PlanRow[];
  leadToMoney: PlanRow[];
  rates: { key: string; label: string; now: number | null; unit: 'out_of_10' | 'days' }[];
  byTeam: {
    teamLeadId: string;
    team: string;
    teamLead: string;
    people: number;
    atWork: number;
    rows: (Forecast & { metric: string; label: string })[];
  }[];
  byWeek: {
    label: string;
    soFar: boolean;
    registered: { done: number; target: number | null };
    paid: { done: number; target: number | null };
    businessesSignedUp: { done: number; target: number | null };
    placed: { done: number; target: number | null };
  }[];
  losses: { step: string; now: number | null; why: string | null }[];
  attendanceToday: { people: number; atWork: number; lateLogins: number; onLeave: number; missing: number; lostSeconds: number };
  watch: {
    agentsBehind: { staff: { id: string; code: string; name: string; role: string; isIntern: boolean }; team: string | null; done: number; target: number }[];
    openFlags: number;
  };
}

export function useOverview(period: Period) {
  const range = periodToUtcRange(period);
  return useQuery({ queryKey: ['manager', 'overview', range], queryFn: () => api.get<Overview>('/manager/overview', { query: range }) });
}

/** "At today's speed we reach 2 of 6 targets". */
export function headlineTitle(o: Overview): string {
  if (!o.headline.withTarget) return 'No targets set for this month yet';
  return `At today's speed we reach ${o.headline.reached} of ${o.headline.withTarget} target${o.headline.withTarget === 1 ? '' : 's'}`;
}

export function headlineGap(o: Overview): string {
  const g = o.headline.biggestGap;
  if (!g) return o.headline.withTarget ? 'Every target with a number is on course.' : 'Set agent targets on the Targets page to see where the month will end.';
  const need = g.needPerDay !== null ? ` To catch up we need ${g.needPerDay} a day instead of ${g.doingPerDay}.` : '';
  return `Biggest gap: ${g.label.toLowerCase()} — we'd end at ${g.atThisSpeed} of ${g.target}.${need}`;
}
