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
  attendanceToday: ['attendance', 'today'] as const,
  targetDashboard: ['targets', 'dashboard'] as const,
};
