import { useState, type ReactNode } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, PlaceLine, Text } from '@/components';
import type { CapturedPhoto } from '@/device/camera';
import { useI18n } from '@/i18n';
import { formatStampIst } from '@/lib/format';
import { colors, radius } from '@/theme';

/**
 * The photo just taken, shown back before going on (Master Guide rev 207,
 * 22 Nov): a thumbnail (tap to see it large), the area in words with the GPS
 * accuracy and the time, anything the step adds (the selfie's "same spot ·
 * N m"), then Retake or Continue.
 */
export function PhotoPreview({
  photo,
  onRetake,
  onContinue,
  continueLabel,
  busy = false,
  continueDisabled = false,
  children,
  testID,
}: {
  photo: CapturedPhoto;
  onRetake: () => void;
  onContinue: () => void;
  continueLabel?: string;
  busy?: boolean;
  continueDisabled?: boolean;
  children?: ReactNode;
  testID: string;
}) {
  const { t } = useI18n();
  const [large, setLarge] = useState(false);
  const { latitude, longitude, accuracy, takenAt } = photo.stamp;
  return (
    <View style={styles.box} testID={testID}>
      <View style={styles.row}>
        <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('photo.enlarge')} onPress={() => setLarge(true)} testID={`${testID}-thumb`}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} resizeMode="cover" />
        </Pressable>
        <View style={styles.flex1}>
          <Text variant="bodyStrong">{t('photo.taken')}</Text>
          {latitude !== null && longitude !== null ? (
            <PlaceLine latitude={latitude} longitude={longitude} accuracy={accuracy} testID={`${testID}-place`} />
          ) : (
            <Text variant="small">{t('photo.noGps')}</Text>
          )}
          <Text variant="tiny">{formatStampIst(takenAt)}</Text>
          {children}
        </View>
      </View>
      <View style={styles.buttons}>
        <View style={styles.flex1}>
          <Button label={t('photo.retake')} variant="secondary" onPress={onRetake} disabled={busy} testID={`${testID}-retake`} />
        </View>
        <View style={styles.flex1}>
          <Button label={continueLabel ?? t('photo.continue')} loading={busy} disabled={continueDisabled} onPress={onContinue} testID={`${testID}-continue`} />
        </View>
      </View>
      <Modal visible={large} transparent animationType="fade" onRequestClose={() => setLarge(false)}>
        <Pressable style={styles.backdrop} onPress={() => setLarge(false)} accessibilityRole="button" accessibilityLabel={t('common.close')} testID={`${testID}-large`}>
          <Image source={{ uri: photo.uri }} style={styles.large} resizeMode="contain" />
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  flex1: { flex: 1 },
  thumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.neutral100 },
  buttons: { flexDirection: 'row', gap: 8 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 16 },
  large: { width: '100%', height: '80%' },
});
