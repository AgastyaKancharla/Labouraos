import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useDraft, type VisitDraft } from './visitDraft';

/**
 * The visit being worked on: the in-memory draft when the agent came from the
 * previous step, otherwise read back from the server (app reopened, or the
 * visit opened from My visits / the business page).
 */
export function useVisit(id: string | undefined) {
  const draft = useDraft(id);
  const { visits } = useEndpoints();
  const server = useQuery({
    queryKey: queryKeys.visit(id ?? ''),
    queryFn: () => visits.get(id!),
    enabled: Boolean(id),
    retry: false,
  });
  const v = server.data;
  const merged: VisitDraft | null = draft
    ? draft
    : v
      ? {
          id: v.id,
          startedAt: v.startedAt,
          latitude: v.latitude,
          longitude: v.longitude,
          accuracy: v.accuracyMeters,
          shopName: v.shopName ?? '',
          businessId: v.business?.id ?? null,
          businessName: v.business?.name ?? null,
          spokeTo: v.spokeTo ?? '',
          contactPhone: '',
          endedAt: v.endedAt,
          proofDistance: v.proofDistanceMeters,
          proofAt: null,
        }
      : null;
  return { visit: merged, server: v ?? null, loading: !draft && server.isPending && Boolean(id), error: !draft && server.isError ? server.error : null };
}
