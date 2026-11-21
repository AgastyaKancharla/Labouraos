import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Banner, Button, Card, Text } from '@/components';
import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme';

/**
 * Reads the Secure QR on an Aadhaar card with the phone's camera. Only the
 * QR's text leaves the phone (the server checks UIDAI's signature, 18+, the
 * name and the phone link); no photo is taken. The text is handed over once,
 * then the camera stops reading.
 */
export function AadhaarScanner({ onText, onCancel }: { onText: (text: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const done = useRef(false);

  if (!permission) return <View style={styles.frame} />;
  if (!permission.granted) {
    return (
      <Card testID="qr-permission">
        <View style={styles.gap}>
          <Text variant="h2">{t('camera.permissionTitle')}</Text>
          <Text variant="muted">{t('camera.permissionBody')}</Text>
          {permission.canAskAgain ? (
            <Button label={t('camera.allow')} onPress={() => void requestPermission()} testID="qr-allow" />
          ) : (
            <Button label={t('camera.openSettings')} onPress={() => void Linking.openSettings()} />
          )}
          <Button label={t('camera.back')} variant="secondary" onPress={onCancel} testID="qr-back" />
        </View>
      </Card>
    );
  }

  return (
    <View style={styles.gap} testID="qr-scanner">
      <Text variant="bodyStrong">{t('qr.scanning')}</Text>
      <Text variant="muted">{t('qr.tips')}</Text>
      <View style={styles.frame}>
        <CameraView
          key={attempt}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onMountError={() => setFailed(true)}
          onCameraReady={() => setFailed(false)}
          onBarcodeScanned={(result) => {
            if (done.current || !result.data) return;
            done.current = true;
            onText(result.data);
          }}
          testID="qr-camera"
        />
        <View pointerEvents="none" style={styles.square} />
      </View>
      {failed ? (
        <Banner tone="error" message={t('camera.failed')} action={<Button label={t('verify.retry')} variant="secondary" onPress={() => setAttempt((n) => n + 1)} />} />
      ) : null}
      <Text variant="muted">{t('qr.noPhoto')}</Text>
      <Button label={t('camera.back')} variant="secondary" onPress={onCancel} testID="qr-back" />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  frame: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.navy },
  square: { position: 'absolute', left: '12%', right: '12%', top: '12%', bottom: '12%', borderRadius: 12, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
});
