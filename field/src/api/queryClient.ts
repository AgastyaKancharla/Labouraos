import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors';

/**
 * Shared TanStack Query settings for a phone on patchy signal:
 * - retry network errors and 5xx twice, never 4xx (a 401 already signed out);
 * - keep data fresh for 30 s, and refetch when the app comes back to the front.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (failureCount, error) => failureCount < 2 && (!isApiError(error) || error.isRetryable),
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Query keys in one place so screens invalidate each other reliably. */
export const queryKeys = {
  /** GET /staff/me/photo: must the agent take a staff photo before going on. */
  staffPhoto: ['staff-photo', 'me'] as const,
  attendanceToday: ['attendance', 'today'] as const,
  targetDashboard: ['targets', 'dashboard'] as const,
  fieldHome: ['field-work', 'home'] as const,
  fieldVisits: ['field-work', 'visits'] as const,
  fieldTargets: ['field-work', 'targets'] as const,
  fieldMap: (lat: number, lng: number) => ['field-work', 'map', lat.toFixed(4), lng.toFixed(4)] as const,
  fieldBusiness: (ref: string) => ['field-work', 'business', ref] as const,
  visit: (id: string) => ['field-visits', id] as const,
  leaderboard: ['targets', 'leaderboard'] as const,
  registrationOptions: ['registration', 'options'] as const,
  trades: ['trades'] as const,
  // Laboura Field selling (FA10–FA19)
  sellingSettings: ['selling', 'settings'] as const,
  sellingBusinesses: (q: string) => ['selling', 'businesses', q] as const,
  sellingBusiness: (id: string) => ['selling', 'business', id] as const,
  sellingMatches: (vacancyId: string, page: number) => ['selling', 'matches', vacancyId, page] as const,
  sellingNoMore: (vacancyId: string) => ['selling', 'no-more', vacancyId] as const,
  sellingCandidate: (id: string, vacancyId: string) => ['selling', 'candidate', id, vacancyId] as const,
  sellingInterview: (id: string) => ['selling', 'interview', id] as const,
  sellingPlacement: (id: string) => ['selling', 'placement', id] as const,
  sellingRecent: ['selling', 'recent-vacancies'] as const,
  sellingBooking: (vacancyId: string, jobSeekerId: string) => ['selling', 'booking', vacancyId, jobSeekerId] as const,
  call: (id: string) => ['calls', id] as const,
  formOptions: ['registration', 'options'] as const,
  seekerStatus: (id: string) => ['registration', 'job-seeker', id] as const,
  // My attendance, leave, corrections and payslips (CA14e–CA14h for the field app)
  myMonth: (month: string) => ['attendance', 'month', month] as const,
  leaveBalance: ['attendance', 'leave', 'balance'] as const,
  myRequests: ['attendance', 'requests', 'mine'] as const,
  myPayslips: ['payroll', 'my-payslips'] as const,
  myPayslip: (month: string) => ['payroll', 'my-payslips', month] as const,
  // Search (CA16-Search for the field app)
  search: (q: string, type: string) => ['search', q, type] as const,
};
