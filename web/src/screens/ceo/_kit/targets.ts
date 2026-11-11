import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';

/** GET /ceo/targets — the month's targets, what each agent achieved, pace, and the ranked leaderboard. */
export interface TargetRow {
  position?: number;
  staff: { id: string; code: string; name: string; role: string };
  team: string | null;
  targetId: string | null;
  target: { candidatesActivated: number | null; vacanciesCaptured: number | null; refundRate: number | null; placementsClosed: number | null; replacementsInside15Days: number | null; repeatBusinesses: number | null } | null;
  main: { achieved: number; target: number | null };
  second: { achieved: number; target: number | null };
  feesPaise: number | null;
  progressPercent: number | null;
  pace: 'on_pace' | 'behind' | 'no_target' | 'early';
}
export interface TargetsBoard {
  year: number;
  month: number;
  dayOfMonth: number;
  daysInMonth: number;
  rows: TargetRow[];
  leaderboard: TargetRow[];
  summary: { agents: number; withTarget: number; behind: number };
}

export function useTargetsBoard(monthKey: string) {
  const [year, month] = monthKey.split('-');
  return useQuery({ queryKey: ['ceo', 'targets', monthKey], queryFn: () => api.get<TargetsBoard>('/ceo/targets', { query: { year, month: String(Number(month)) } }) });
}

export const PACE_LABEL: Record<TargetRow['pace'], { label: string; tone: 'good' | 'warn' | 'muted' | 'info' }> = {
  on_pace: { label: 'On pace', tone: 'good' },
  behind: { label: 'Behind pace', tone: 'warn' },
  no_target: { label: 'No target', tone: 'muted' },
  early: { label: 'Too early to tell', tone: 'info' },
};
