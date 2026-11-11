import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';

/** Shapes of the reads in src/modules/screens-call-registration and the existing endpoints these screens use. */
export interface Area {
  name: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

export interface Trade {
  id: string;
  name: string;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  minimumWageLevel: string;
  legalMinimumPaise: number;
}

export type StepState = 'done' | 'in_progress' | 'stuck' | 'not_started' | 'confirming';

export interface Step {
  state: StepState;
  time?: string | null;
  reason?: string | null;
}

export interface JobSeekerStatus {
  id: string;
  code: string;
  name: string;
  age: number | null;
  gender: string | null;
  phone: string;
  phoneVerifiedAt: string | null;
  messageLanguage: string | null;
  locality: string | null;
  travelDistanceKm: number | null;
  shiftPreference: string | null;
  salaryPeriod: string | null;
  minSalary?: number;
  maxSalary?: number;
  trades: { trade: string; yearsExperience: number; isPrimary: boolean; listed: boolean }[];
  status: string;
  stage: 'registered' | 'in_progress' | 'active';
  nextStep: 'consent' | 'selfie' | 'id_check' | 'payment' | 'complete';
  steps: { phone: Step; consent: Step; selfie: Step; idCheck: Step; payment: Step };
  consent: { requiredGiven: number; requiredTotal: number; promotions: boolean };
  registrationLinkExpiresAt: string | null;
  paymentOnlyLink: { payerPhone: string | null; relation: string | null; sentAt: string; expiresAt: string; live: boolean; used: boolean } | null;
  paymentConfirmedAt: string | null;
  paymentReceivedAt: string | null;
  guaranteeEndsAt: string | null;
}

export interface SignedConsent {
  jobSeekerId: string;
  code: string;
  name: string;
  signed: boolean;
  purposes?: { purpose: string; required: boolean; given: boolean; grantedAt: string | null; withdrawnAt: string | null }[];
  givenAt?: string;
  otpPhone?: string;
  otpVerifiedAt?: string | null;
  language?: string;
  noticeVersion?: string;
  explainedOnCall?: { staffName: string | null; at: string | null; recorded: boolean } | null;
}

export interface ExistingRecord {
  type: 'job_seeker' | 'business' | 'referral';
  id: string;
  code: string;
  name: string;
  registeredAt: string;
  registeredBy: string | null;
}

export interface BusinessHit {
  id: string;
  code: string;
  name: string;
  locality: string | null;
  verificationStatus: string | null;
  canShowCandidates: boolean;
  contactName: string | null;
  contactRole: string | null;
  branches: { id: string; name: string; locality: string | null }[];
}

export interface BusinessStatus {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactRole: string | null;
  contactLanguage: string | null;
  phone: string;
  verificationStatus: string;
  paused: boolean;
  steps: {
    phone: Step;
    agreement: Step & { signedName?: string; expiresAt?: string | null };
    visit: Step & { suggestedStaffName?: string | null; assignedStaffName?: string | null };
    teamLeadApproval: Step;
    verified: Step;
  };
  draftVacancies: {
    id: string;
    code: string;
    trade: string;
    headcount: number;
    salaryMinPaise?: number | null;
    salaryMaxPaise?: number | null;
    salaryPeriod: string | null;
    startDate: string | null;
    status: string;
  }[];
}

export interface ReferralHeader {
  id: string;
  code: string;
  name: string;
  phone: string;
  phoneVerifiedAt: string | null;
  type: string;
  language: string | null;
  registrationLink: { sentAt: string; expiresAt: string; live: boolean } | null;
}

export interface ReferralStatus {
  referralId: string;
  steps: { terms: Step; selfie: Step; id: Step; upi: Step };
  currentStep: string;
}

export const qk = {
  options: ['screens-call-registration', 'options'] as const,
  trades: ['trades'] as const,
  jobSeeker: (id: string) => ['job-seekers', id, 'registration-screen'] as const,
  signedConsent: (id: string) => ['job-seekers', id, 'signed-consent'] as const,
  business: (id: string) => ['businesses', id, 'registration-screen'] as const,
  referral: (id: string) => ['referrals', id, 'registration-screen'] as const,
  referralStatus: (id: string) => ['referrals', id, 'registration-status'] as const,
};

export function useFormOptions() {
  return useQuery({
    queryKey: qk.options,
    queryFn: () => api.get<{ city: string; areas: Area[] }>('/screens/call-registration/options'),
    staleTime: 60 * 60_000,
  });
}

export function useTrades() {
  return useQuery({ queryKey: qk.trades, queryFn: () => api.get<Trade[]>('/trades'), staleTime: 10 * 60_000 });
}

export function lookupRecord(code: string) {
  return api.get<ExistingRecord>(`/screens/call-registration/records/${encodeURIComponent(code)}`);
}

/** Reads a field the API put next to the message of a 4xx (e.g. existingBusinessCode). */
export function errorDetail(err: unknown, key: string): unknown {
  if (!isApiError(err) || !err.details || typeof err.details !== 'object') return undefined;
  return (err.details as Record<string, unknown>)[key];
}

/** The first trade whose name matches, ignoring case and spaces. */
export function findTrade(trades: readonly Trade[] | undefined, name: string): Trade | undefined {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return trades?.find((t) => t.name.trim().toLowerCase().replace(/\s+/g, ' ') === key);
}

/** "2026-11-16" → "2026-11-16T00:00:00.000Z" for Prisma date columns. */
export function dateKeyToIso(key: string): string {
  return `${key}T00:00:00.000Z`;
}

/** CA08b/c/f step panel; polls every 5 s until the registration is complete. */
export function useJobSeekerStatus(id: string) {
  return useQuery({
    queryKey: qk.jobSeeker(id),
    queryFn: () => api.get<JobSeekerStatus>(`/screens/call-registration/job-seekers/${encodeURIComponent(id)}`),
    refetchInterval: (query) => (query.state.data?.stage === 'active' ? false : 5000),
    enabled: Boolean(id),
  });
}
