import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useI18n } from '@/i18n';
import { Card, Screen } from '@/components';
import { todayKeyIst } from '@/components/form';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { DAY_TYPES, DayKindFilter, DaySwitcher, DayWork, useDayWork, type DayKind } from '../_visits/DayWork';

/**
 * FA05b — Today's work, the full list (redesign, 16 Nov), in the Visits tab:
 * Today, Yesterday or a picked day, filtered by kind. Today's numbers open
 * it with their kind (`?kind=`), e.g. Onboarded → businesses onboarded.
 */
export default function TodaysWorkScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ date?: string; kind?: string }>();
  const [date, setDate] = useState(params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayKeyIst());
  const [kind, setKind] = useState<DayKind | null>(params.kind === 'onboarded' || (DAY_TYPES as string[]).includes(params.kind ?? '') ? (params.kind as DayKind) : null);
  const q = useDayWork(date);
  return (
    <View style={styles.flex} testID="screen-FA05b">
      <AppHeader title={t('work.title')} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        <DaySwitcher date={date} onDate={setDate} />
        <DayKindFilter counts={q.data?.counts} kind={kind} onKind={setKind} />
        <Card>
          <DayWork date={date} kind={kind} />
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
