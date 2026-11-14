import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Pin } from '@/api/types';
import { readPin } from '@/device/location';
import { useI18n } from '@/i18n';
import { Button } from '../Button';
import { Text } from '../Text';
import { colors, fonts } from '@/theme';

/**
 * The map pin, without a map: one tap reads the phone's location (low data —
 * no map tiles are downloaded). Without a pin the server uses the centre of
 * the chosen area, and an agent fixes it later.
 */
export function PinField({ label, value, onChange, testID }: { label: string; value: Pin | null; onChange: (pin: Pin | null) => void; testID?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'denied' | 'error' | null>(null);
  return (
    <View style={styles.field}>
      <Text variant="small" style={styles.label}>
        {label}
      </Text>
      {value ? (
        <Text variant="small" testID={testID ? `${testID}-saved` : undefined}>
          {value.accuracyM ? t('form.pinSavedAccuracy', { meters: value.accuracyM }) : t('form.pinSaved')}
        </Text>
      ) : (
        <Text variant="muted">{t('form.pinHint')}</Text>
      )}
      {problem ? (
        <Text variant="small" accessibilityRole="alert" style={styles.problem}>
          {problem === 'denied' ? t('form.pinDenied') : t('form.pinError')}
        </Text>
      ) : null}
      <Button
        label={value ? t('form.pinAgain') : t('form.pinUse')}
        variant="secondary"
        loading={busy}
        testID={testID}
        onPress={async () => {
          setBusy(true);
          setProblem(null);
          const result = await readPin();
          setBusy(false);
          if (result.status === 'ok') onChange(result.pin);
          else setProblem(result.status);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontFamily: fonts.body700, color: colors.soft, fontSize: 14 },
  problem: { color: colors.tomato },
});
