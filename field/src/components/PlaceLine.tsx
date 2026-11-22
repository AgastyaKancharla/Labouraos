import { useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { WhereAmI } from '@/api/endpoints';
import { useI18n } from '@/i18n';
import { Text, type TextVariant } from './Text';

/** Rounded to 4 decimals (about 11 m): the same spot is looked up once a session. */
export function useAreaName(point: { latitude: number; longitude: number } | null | undefined) {
  const { redesign } = useEndpoints();
  const valid = Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && !(point.latitude === 0 && point.longitude === 0));
  return useQuery<WhereAmI>({
    queryKey: valid ? queryKeys.whereIs(point!.latitude, point!.longitude) : ['where-is', 'none'],
    queryFn: () => redesign.whereIs(Number(point!.latitude.toFixed(4)), Number(point!.longitude.toFixed(4))),
    enabled: valid,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

/** "Kothnur, JP Nagar 8th Phase · ±13 m"; offline "±13 m · area shown when online"; while looking "±13 m · finding the area…". */
export function placeText(
  t: ReturnType<typeof useI18n>['t'],
  area: string | null | undefined,
  state: 'found' | 'finding' | 'offline',
  accuracy?: number | null,
): string {
  const acc = accuracy !== null && accuracy !== undefined && Number.isFinite(accuracy) ? t('place.accuracy', { meters: Math.round(accuracy) }) : null;
  if (state === 'found' && area) return [area, acc].filter(Boolean).join(' · ');
  if (state === 'finding') return [acc, t('place.finding')].filter(Boolean).join(' · ');
  return [acc, t('place.offline')].filter(Boolean).join(' · ');
}

/**
 * The area in words for a GPS fix (Master Guide rev 207, 22 Nov): wherever
 * Laboura Field shows a GPS reading it shows the place ("Kothnur, JP Nagar
 * 8th Phase · ±13 m") instead of latitude and longitude, from the server's
 * reverse lookup. The coordinates stay stored as before and show only small,
 * underneath, when `coordinates` is set.
 */
export function PlaceLine({
  latitude,
  longitude,
  accuracy,
  variant = 'small',
  color,
  coordinates = false,
  testID = 'place-line',
}: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  variant?: TextVariant;
  color?: string;
  coordinates?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  const where = useAreaName({ latitude, longitude });
  const state = where.data?.area ? 'found' : where.isPending && where.fetchStatus !== 'idle' ? 'finding' : 'offline';
  return (
    <>
      <Text variant={variant} color={color} testID={testID}>
        {placeText(t, where.data?.area, state, accuracy)}
      </Text>
      {coordinates ? (
        <Text variant="tiny" color={color} testID={`${testID}-coords`}>
          {`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}
        </Text>
      ) : null}
    </>
  );
}
