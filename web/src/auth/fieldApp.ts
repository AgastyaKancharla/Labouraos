import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api/client';

/**
 * Laboura Field's real address (owner decision 14 Nov: each app accepts only
 * its own roles). The API answers GET /auth/apps with FIELD_HOST's address
 * (https://field.laboura.com/) or /field/ on this address when none is set.
 * Until it answers, and if it cannot, links use /field/ on this address.
 */
export const DEFAULT_FIELD_APP_URL = '/field/';

/** The start of the API's refusal when a field agent signs in to the office app. */
export const FIELD_AGENT_REFUSAL = 'Field agents use Laboura Field';

export function isFieldAgentRefusal(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.startsWith(FIELD_AGENT_REFUSAL);
}

/** "Field agents use Laboura Field: https://field.laboura.com/" → "https://field.laboura.com/". */
export function fieldAppUrlFromRefusal(message: string): string {
  const url = message.slice(FIELD_AGENT_REFUSAL.length).replace(/^\s*:\s*/, '').trim();
  return /^(https:\/\/|\/)/.test(url) ? url : DEFAULT_FIELD_APP_URL;
}

export function useFieldAppUrl(): string {
  const query = useQuery({
    queryKey: ['auth', 'apps'],
    queryFn: () => api.get<{ fieldAppUrl?: string }>('/auth/apps', { auth: false }),
    staleTime: Infinity,
    retry: false,
  });
  const url = query.data?.fieldAppUrl;
  return typeof url === 'string' && /^(https:\/\/|\/)/.test(url) ? url : DEFAULT_FIELD_APP_URL;
}
