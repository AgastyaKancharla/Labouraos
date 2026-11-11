import './console.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api/client';

/**
 * Data for the call agent console's daily-work screens. Everything comes
 * from the Nest module src/modules/screens-call-agent (GET /call-work/…,
 * GET /search) plus the existing call and follow-up endpoints. Phone numbers
 * arrive as the last 4 digits only.
 */
export type SubjectType = 'job_seeker' | 'business' | 'referral';
export type WorkKind =
  | 'callback'
  | 'missed_call'
  | 'refund_check'
  | 'close_to_refund'
  | 'offer_reply'
  | 'interview_today'
  | 'follow_up'
  | 'retry'
  | 'stuck_registration'
  | 'win_back';
export type WorkCategory = 'callbacks' | 'follow_ups' | 'offers' | 'new_leads' | 'priority';

export interface WorkCall {
  purpose: string;
  relatedType: string | null;
  relatedId: string | null;
}

export interface WorkItem {
  key: string;
  kind: WorkKind;
  category: WorkCategory;
  subjectType: SubjectType;
  subjectId: string;
  code: string | null;
  name: string;
  maskedPhone: string | null;
  trade: string | null;
  dueAt: string;
  priority: boolean;
  daysLeft: number | null;
  guaranteeDay: number | null;
  guaranteeDays: number | null;
  detail: Record<string, string | number | null>;
  call: WorkCall;
  callable: boolean;
  lockedReason: string | null;
}

export interface StuckRow {
  jobSeekerId: string;
  code: string;
  name: string;
  maskedPhone: string;
  trade: string | null;
  step: string;
  failures: number;
  linkLive: boolean;
  since: string;
}

export interface MetricView {
  achieved: number | null;
  target: number | null;
  expectedPace: number | null;
  status: string | null;
  behindPace: boolean;
  breached: boolean;
}

export interface MonthTargets {
  year: number;
  month: number;
  currentDay: number;
  daysInMonth: number;
  candidatesActivated: MetricView;
  vacanciesCaptured: MetricView;
  refundRate: MetricView & { matured: number | null };
}

export interface HomeData {
  now: string;
  callingHours: { start: string; end: string };
  inCallingHours: boolean;
  attendanceStatus: string | null;
  canCall: boolean;
  callNext: { key: string; name: string; subjectType: SubjectType; subjectId: string } | null;
  today: {
    callsAnswered: number;
    talkSeconds: number;
    productionSeconds: number;
    productionTargetSeconds: number;
    registrations: number;
    interviewsBooked: number;
    teamAverage: { agents: number; callsAnswered: number; talkSeconds: number; registrations: number; interviewsBooked: number };
  };
  work: { items: WorkItem[]; counts: Record<'all' | WorkCategory, number> };
  month: MonthTargets;
  stuck: StuckRow[];
  nearRefund: { count: number; windowDays: number };
  doneToday: Array<{ kind: string; at: string; name: string; code: string | null; status: string; extra: string | null }>;
}

export interface CallNextResult {
  placed: boolean;
  blocked: null | 'outside_calling_hours' | 'not_available' | 'nothing_to_call' | 'call_refused';
  message?: string;
  callingHours: { start: string; end: string };
  item: WorkItem | null;
  callRecordId: string | null;
}

export interface HistoryRow {
  kind: string;
  at: string;
  [key: string]: unknown;
}

export interface Introduction {
  interviewId: string;
  businessId: string;
  businessName: string;
  trade: string;
  slotStartsAt: string;
  offerSentAt: string;
  status: string;
  result: string | null;
  feePaid: boolean;
}

interface ProfileBase {
  onList: WorkItem | null;
  history: HistoryRow[];
  canCallNow: boolean;
  attendanceAvailable: boolean;
  inCallingHours: boolean;
  callingHours: { start: string; end: string };
  id: string;
  code: string;
  name: string;
  maskedPhone: string;
}

export interface SeekerProfile extends ProfileBase {
  type: 'job_seeker';
  status: string;
  trades: Array<{ trade: string; years: number; primary: boolean }>;
  languages: string[];
  salary: { minPaise: number; maxPaise: number; period: string };
  locality: string | null;
  travelDistanceKm: number | null;
  shiftPreference: string | null;
  availableFrom: string | null;
  bestTime: { start: string; end: string };
  withinBestTimeNow: boolean;
  registeredBy: string | null;
  registeredAt: string;
  editLocked: boolean;
  glance: {
    consentsGiven: number;
    consentsRequired: number;
    callRecordingConsent: boolean;
    paid: boolean;
    guaranteeDay: number | null;
    guaranteeDays: number;
    daysLeft: number | null;
    priority: boolean;
    aadhaar: string;
    hits: number;
    maxHits: number;
  };
  registration: { steps: Record<'consent' | 'selfie' | 'idCheck' | 'payment', boolean>; done: number; total: number };
  liveOffer: { interviewId: string; replyDueAt: string; trade: string } | null;
  followUpDue: { id: string; kind: string; dueAt: string } | null;
  introductions: Introduction[];
}

export interface BusinessProfile extends ProfileBase {
  type: 'business';
  businessType: string | null;
  locality: string | null;
  contactName: string | null;
  contactRole: string | null;
  verificationStatus: string | null;
  accountAgent: string | null;
  openVacancies: Array<{ id: string; code: string; tradeSkill: string; headcount: number; roleTitle: string | null }>;
}

export interface ReferralProfile extends ProfileBase {
  type: 'referral';
  partnerType: string;
  occupation: string | null;
  locality: string | null;
  referred: number;
  joined: number;
}

export type Profile = SeekerProfile | BusinessProfile | ReferralProfile;

export interface JobMatch {
  vacancyId: string;
  vacancyCode: string;
  trade: string;
  roleTitle: string | null;
  locality: string | null;
  businessType: string | null;
  salaryMinPaise: number;
  salaryMaxPaise: number;
  shift: string | null;
  workingHours: string | null;
  weeklyOff: string | null;
  extras: string[];
  interviewType: string | null;
  distanceKm: number;
  suitability: { sameTrade: boolean; salaryInRange: boolean; distanceKm: number; travelDistanceKm: number; shift: string | null };
  slots: Array<{ id: string; startsAt: string; endsAt: string; placesLeft: number | null }>;
}

export interface JobsResult {
  jobSeekerId: string;
  page: number;
  pageSize: number;
  total: number;
  blockedReason: string | null;
  jobs: JobMatch[];
}

export interface CallState {
  id: string;
  code: string;
  subjectType: SubjectType | null;
  subjectId: string | null;
  purpose: string | null;
  relatedType: string | null;
  relatedId: string | null;
  status: string;
  answered: boolean;
  final: boolean;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  recorded: boolean;
  agentOutcome: string | null;
  noAnswer: null | {
    endedAt: string;
    whatsapp: { status: string; at: string } | null;
    nextTryAt: string | null;
    missedToday: number;
    missedForHit: number;
  };
  next: { name: string; subjectId: string } | null;
}

export interface FollowUpRow {
  id: string;
  code: string;
  kind: string;
  status: string;
  answer: string | null;
  subjectType: SubjectType;
  subjectId: string;
  personCode: string | null;
  name: string;
  maskedPhone: string | null;
  businessName: string | null;
  dueAt: string;
  missed: boolean;
  call: WorkCall;
}

export interface FollowUpDetail extends Omit<FollowUpRow, 'answer' | 'missed'> {
  introducedBusinesses: Array<{ businessId: string; name: string; introducedAt: string; result: string | null; resultAt: string | null; feePaid: boolean }>;
}

export interface IncomingCard {
  callbackTaskId: string;
  status: string;
  ringingSince: string;
  maskedPhone: string;
  known: boolean;
  caller: { type: SubjectType; id: string; code: string; name: string } | null;
  standing?: { status?: string; guaranteeDay?: number | null; guaranteeDays?: number; hasOffer?: boolean; trade?: string | null };
  likelyAbout?: string;
  lastContact?: { at: string; by: string | null; outcome: string | null; note: string | null } | null;
}

export interface TargetsData extends MonthTargets {
  leaderboard: Array<{ position: number; name: string; staffCode: string; placementsClosed: number; isMe: boolean }>;
}

export const callWorkKeys = {
  home: ['call-work', 'home'] as const,
  profile: (ref: string) => ['call-work', 'people', ref] as const,
  jobs: (ref: string, page: number) => ['call-work', 'people', ref, 'jobs', page] as const,
  call: (id: string) => ['call-work', 'calls', id] as const,
  followUps: ['call-work', 'follow-ups'] as const,
  followUp: (id: string) => ['call-work', 'follow-ups', id] as const,
  incoming: (id: string) => ['call-work', 'incoming', id] as const,
  targets: ['call-work', 'targets'] as const,
};

export function useHome() {
  return useQuery({ queryKey: callWorkKeys.home, queryFn: () => api.get<HomeData>('/call-work/home'), refetchInterval: 60_000 });
}

export function useProfile(ref: string) {
  return useQuery({
    queryKey: callWorkKeys.profile(ref),
    queryFn: () => api.get<Profile>(`/call-work/people/${encodeURIComponent(ref)}`),
    enabled: Boolean(ref),
  });
}

export function useJobs(ref: string, page: number, vacancy?: string | null) {
  return useQuery({
    queryKey: [...callWorkKeys.jobs(ref, page), vacancy ?? null],
    queryFn: () => api.get<JobsResult>(`/call-work/people/${encodeURIComponent(ref)}/jobs`, { query: { page, vacancy: vacancy ?? undefined } }),
    enabled: Boolean(ref),
  });
}

/** Polls every 3 s until the call is final; the live channel refetches sooner. */
export function useCallState(id: string) {
  return useQuery({
    queryKey: callWorkKeys.call(id),
    queryFn: () => api.get<CallState>(`/call-work/calls/${encodeURIComponent(id)}`),
    refetchInterval: (query) => (query.state.data?.final && query.state.data.agentOutcome !== undefined ? false : 3000),
  });
}

export function useFollowUps() {
  return useQuery({ queryKey: callWorkKeys.followUps, queryFn: () => api.get<{ now: string; rows: FollowUpRow[] }>('/call-work/follow-ups') });
}

export function useFollowUp(id: string) {
  return useQuery({ queryKey: callWorkKeys.followUp(id), queryFn: () => api.get<FollowUpDetail>(`/call-work/follow-ups/${encodeURIComponent(id)}`) });
}

export function useIncoming(id: string | null) {
  return useQuery({
    queryKey: callWorkKeys.incoming(id ?? ''),
    queryFn: () => api.get<IncomingCard>(`/call-work/incoming/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
  });
}

export function useTargets() {
  return useQuery({ queryKey: callWorkKeys.targets, queryFn: () => api.get<TargetsData>('/call-work/targets') });
}

export interface PlaceCallInput {
  subjectType: SubjectType;
  subjectId: string;
  purpose: string;
  relatedType?: string | null;
  relatedId?: string | null;
}

/** Click-to-call through the calling system (POST /calls): rings the agent's phone first. */
export function usePlaceCall() {
  return useMutation({
    mutationFn: (input: PlaceCallInput) =>
      api.post<{ callRecordId: string }>('/calls', {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        purpose: input.purpose,
        relatedType: input.relatedType ?? undefined,
        relatedId: input.relatedId ?? undefined,
      }),
  });
}

export function useCallNext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skip: string[]) => api.post<CallNextResult>('/call-work/call-next', { skip }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['call-work'] }),
  });
}

/** Resends the registration link; it continues from the step he stopped at (POST /consent/links). */
export function useResendRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobSeekerId: string) => api.post('/consent/links', { jobSeekerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: callWorkKeys.home }),
  });
}

/** People the agent set aside with "Skip" this session; Call next passes over them. */
const SKIP_KEY = 'laboura_call_next_skip';
export function readSkipped(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SKIP_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function addSkipped(subjectId: string) {
  try {
    sessionStorage.setItem(SKIP_KEY, JSON.stringify([...new Set([...readSkipped(), subjectId])].slice(-200)));
  } catch {
    // Storage blocked: skipping only lasts until the page reloads.
  }
}
