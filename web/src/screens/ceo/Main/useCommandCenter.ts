import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';
import { periodToUtcRange, type Period } from '../../../lib/period';

/**
 * Data for the Command Center. Every number is computed on the server for the
 * chosen period (GET /ceo/command-center/*), so the browser never downloads
 * whole lists. Query keys start with the resource so other screens'
 * mutations can invalidate them.
 */
export interface CcMoney {
  activationPaise: number;
  activationCount: number;
  placementFeePaise: number;
  placementCount: number;
  gstPaise: number;
  grossPaise: number;
  refundsPaidPaise: number;
  netPaise: number;
  receivedInclGstPaise: number;
  /** Paid no-bypass charges, fee + penalty without GST (older APIs leave it out). */
  bypassChargePaise?: number;
  bypassChargeCount?: number;
  changePercent: number | null;
  refundExposure: { owedNowPaise: number; owedNowCount: number; atRiskPaise: number; totalPaise: number };
  payouts: { duePaise: number; dueCount: number; referralDueCount: number; rewardDueCount: number; failedCount: number };
}
export interface NearSide {
  count: number;
  atStakePaise: number;
  buckets: { '0-5': number; '6-10': number; '11-15': number };
}
export interface CcPipeline {
  jobSeekers: { registered: number; stuckBeforePaying: number; paid: number; paidPercent: number; offered: number; accepted: number; declined: number; acceptedPercent: number; joined: number; joinedPercent: number; closeToRefund: NearSide };
  businesses: { fieldVisits: number; signedUp: number; vacanciesAdded: number; openingsAdded: number; filled: number; fillPercent: number; droppedOut: number; replacingNow: number; closeToRefund: NearSide };
  windowDays: number;
}
export interface CcVerticals {
  jobSeekers: { activeInPool: number; nearRefund: number; atTwoHits: number; waitingOnKyc: number };
  referrals: { partners: number; individual: number; business: number; referredJoined: number; payoutsDueCount: number; payoutsDuePaise: number };
  businesses: { active: number; signedInRange: number; geofenceFlagged: number; topArea: string | null };
  vacancies: { open: number; positions: number; over15Days: number; replacements: number; averageDaysToFill: number | null };
  placements: { working: number; replacing: number; paused: number; cleared: number };
  payments: { receivedInclGstPaise: number; failed: number; processing: number; settled: number };
  refunds: { waiting: number; waitingPaise: number; businessCount: number; businessPaise: number; jobSeekerCount: number; jobSeekerPaise: number; oldestDays: number | null };
  callCenter: { callsToday: number; connectPercent: number; missedToReturn: number };
  fieldOps: { visitsToday: number; vacanciesThisWeek: number; geofenceToday: number; agentsInField: number };
  team: { accounts: number; twoFactorOnAllManagement: boolean; invitesPending: number; signedInNow: number };
}
export interface CcInsights {
  revenueByWeek: { week: string; netPaise: number }[];
  joinedByWeek: { week: string; count: number }[];
  supplyDemand: { trade: string; pool: number; open: number }[];
  shortTrades: string[];
  team: { callAgents: { id: string; name: string; calls: number; connects: number; connectPercent: number }[]; fieldAgents: { id: string; name: string; vacancies: number; topArea: string | null }[] };
  openVacanciesByArea: { name: string; count: number }[];
  openVacanciesTotal: number;
  activity: { id: string; at: string; actor: string | null; action: string; entityType: string; entityCode: string }[];
  pricing: { activationFeePaise: number; guaranteeDays: number; placementFeePercent: number; gstPercent: number; replacementWindowDays: number; replacementSearchDays: number; referralPayoutPaise: number; effectiveFrom: string };
}
export interface GuaranteeBucket {
  receivedPaise: number;
  couldGoBackPaise: number;
  safelyEarnedPaise: number;
  refundedPaise: number;
}
export interface MoneyUnderGuarantee {
  range: ({ from: string; to: string; total: GuaranteeBucket; activation: GuaranteeBucket; placementFee: GuaranteeBucket }) | null;
  asOfNow: { total: GuaranteeBucket };
}
export interface DaysToFirstInterview {
  minDays: number;
  waitingCount: number;
  waitingAnyDays: number;
  oldestDays: number | null;
}
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  idCheck: { status: 'up' | 'down' };
  components: { name: string; status: 'healthy' | 'degraded' | 'unhealthy' }[];
}

export const commandCenterKeys = {
  money: (p: Period) => ['payments', 'ceo-command-center', 'money', p.from, p.to] as const,
  pipeline: (p: Period) => ['ceo', 'command-center', 'pipeline', p.from, p.to] as const,
  verticals: (p: Period) => ['ceo', 'command-center', 'verticals', p.from, p.to] as const,
  insights: (p: Period) => ['ceo', 'command-center', 'insights', p.from, p.to] as const,
  guarantee: (p: Period) => ['payments', 'money-under-guarantee', p.from, p.to] as const,
  firstInterview: ['growth', 'days-to-first-interview'] as const,
  health: ['system', 'status'] as const,
};

export function useCommandCenter(period: Period) {
  const range = periodToUtcRange(period);
  const money = useQuery({ queryKey: commandCenterKeys.money(period), queryFn: () => api.get<CcMoney>('/ceo/command-center/money', { query: range }) });
  const pipeline = useQuery({ queryKey: commandCenterKeys.pipeline(period), queryFn: () => api.get<CcPipeline>('/ceo/command-center/pipeline', { query: range }) });
  const verticals = useQuery({ queryKey: commandCenterKeys.verticals(period), queryFn: () => api.get<CcVerticals>('/ceo/command-center/verticals', { query: range }) });
  const insights = useQuery({ queryKey: commandCenterKeys.insights(period), queryFn: () => api.get<CcInsights>('/ceo/command-center/insights', { query: range }) });
  // N1 (confirmed 11 Nov): money still under guarantee, for the IST days of the period.
  const guarantee = useQuery({ queryKey: commandCenterKeys.guarantee(period), queryFn: () => api.get<MoneyUnderGuarantee>('/growth/money-under-guarantee', { query: { from: period.from, to: period.to } }) });
  // N2 (confirmed 11 Nov): paid job seekers with no interview 10+ days after paying.
  const firstInterview = useQuery({ queryKey: commandCenterKeys.firstInterview, queryFn: () => api.get<DaysToFirstInterview>('/growth/days-to-first-interview/summary') });
  const health = useQuery({ queryKey: commandCenterKeys.health, queryFn: () => api.get<SystemHealth>('/system/status/details') });
  return { money, pipeline, verticals, insights, guarantee, firstInterview, health };
}
