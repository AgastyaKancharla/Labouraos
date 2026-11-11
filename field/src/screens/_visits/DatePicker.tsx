import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from '@/components';
import { useI18n } from '@/i18n';
import { ChipChoices } from './ChoiceList';
import { formatDateKey, nextDateKeys } from './format';

/**
 * Pick a date from the calendar, never typed (guide: Forms). Shows the next
 * two weeks as buttons; "Later dates" shows the following weeks.
 */
export function DatePicker({
  label,
  value,
  onChange,
  now,
  testID,
}: {
  label: string;
  value: string | null;
  onChange: (key: string) => void;
  now: number;
  testID?: string;
}) {
  const { t } = useI18n();
  const [weeks, setWeeks] = useState(2);
  const keys = useMemo(() => nextDateKeys(now, weeks * 7), [now, weeks]);
  const choices = keys.map((key, i) => ({
    value: key,
    label: i === 0 ? t('date.today') : i === 1 ? t('date.tomorrow') : formatDateKey(key),
  }));
  return (
    <View style={styles.box}>
      <Text variant="small" style={styles.label}>
        {label}
      </Text>
      <ChipChoices choices={choices} value={value} onChange={onChange} testID={testID} />
      {weeks < 12 ? <Button label={t('date.later')} variant="secondary" onPress={() => setWeeks((w) => w + 2)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  label: { fontWeight: '700' },
});
