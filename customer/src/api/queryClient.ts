import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors';

/**
 * Shared TanStack Query settings for cheap phones on patchy, metered data:
 * - retry network errors and 5xx twice, never 4xx;
 * - keep answers for 60 s and do not refetch on every focus (low data); Home
 *   refetches itself when the person comes back from the secure sheet.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        retry: (failureCount, error) => failureCount < 2 && (!isApiError(error) || error.isRetryable),
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

/** Query keys in one place so screens invalidate each other reliably. */
export const queryKeys = {
  formOptions: ['form-options'] as const,
  home: (profileId: string) => ['home', profileId] as const,
  homes: ['home'] as const,
};
