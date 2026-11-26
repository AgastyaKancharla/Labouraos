import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { EmptyState, ErrorState, LoadingState, Screen } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { BusinessProfile } from '../_business/BusinessProfile';

export { nextStepText } from '../_business/BusinessProfile';

/**
 * FA08 — the one business profile (_business/BusinessProfile.tsx; owner, 27 Nov: the same
 * screen from the Businesses tab and from a visit in the Visits tab).
 * Data: GET /field-work/businesses/:id/page.
 */
export default function BusinessScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { redesign } = useEndpoints();
  const q = useQuery({ queryKey: queryKeys.businessPage(id ?? ''), queryFn: () => redesign.businessPage(id!), enabled: Boolean(id) });
  return (
    <View style={styles.flex} testID="screen-FA08">
      <AppHeader title={t('fa08.title')} subtitle={q.data?.code} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {!id ? (
          <EmptyState message={t('common.error')} />
        ) : q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <BusinessProfile b={q.data} />
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
