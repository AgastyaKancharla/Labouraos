import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useMutation } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import type { AadhaarQrOutcome } from '@/api/endpoints';
import { Banner, Button, Card, Text } from '@/components';
import { prepareQrDecoder } from '@/device/aadhaar-qr/prepareQrDecoder';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { colors, radius } from '@/theme';
import { ErrorBanner } from './index';

const RESULT_KEYS: Record<AadhaarQrOutcome['result'], MessageKey> = {
  verified: 'fa10b.scanVerified',
  name_mismatch: 'fa10b.scanNameMismatch',
  under_18: 'fa10b.scanUnder18',
  old_qr: 'fa10b.scanOldCard',
  bad_signature: 'fa10b.scanBadSignature',
  cert_missing: 'fa10b.scanCertMissing',
  unreadable: 'fa10b.scanUnreadable',
};

/**
 * "Scan Aadhaar QR" (guide, "Aadhaar verification", 14 Nov): the field agent
 * scans the Secure QR on the job seeker's Aadhaar card live with this phone's
 * camera — never the gallery, and nothing is saved on the phone. Only the QR's
 * text goes to the server (POST /field-work/job-seekers/:id/aadhaar-qr), which
 * checks UIDAI's signature, 18+, the name and the phone link, and needs the
 * job seeker's consent already given on his link. Needs signal (never queued).
 * The agent sees "verified" with the masked number, never anything read from
 * the card. Works in the phone app (the phone's scanner) and in both web
 * builds (the browser's BarcodeDetector or zxing WebAssembly).
 */
export function AadhaarQrScan({ jobSeekerId, onFinished, onClose }: { jobSeekerId: string; onFinished: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const [permission, requestPermission] = useCameraPermissions();
  const [failed, setFailed] = useState(false);
  const handled = useRef(false);
  const check = useMutation({
    mutationFn: (qrText: string) => queue.live(() => selling.aadhaarQr(jobSeekerId, qrText)),
    onSuccess: () => onFinished(),
  });

  useEffect(() => {
    prepareQrDecoder();
  }, []);

  const scanned = (event: BarcodeScanningResult) => {
    if (handled.current || !event.data) return;
    handled.current = true;
    check.mutate(event.data);
  };
  const again = () => {
    handled.current = false;
    check.reset();
  };

  const outcome = check.data;
  if (outcome) {
    const ok = outcome.result === 'verified';
    return (
      <Card testID="aadhaar-scan-result">
        <Banner
          tone={ok ? 'ok' : outcome.result === 'under_18' ? 'error' : 'warn'}
          title={t(RESULT_KEYS[outcome.result], { ref: outcome.maskedReference ?? '' })}
          testID={`aadhaar-scan-${outcome.result}`}
        />
        <View style={styles.gap}>
          {!ok && outcome.result !== 'under_18' ? <Button label={t('fa10b.scanAgain')} variant="secondary" onPress={again} testID="aadhaar-scan-again" /> : null}
          <Button label={t('fa10b.scanClose')} variant={ok ? 'primary' : 'secondary'} onPress={onClose} testID="aadhaar-scan-close" />
        </View>
      </Card>
    );
  }

  if (!permission) return <View style={styles.camera} />;
  if (!permission.granted) {
    return (
      <Card testID="aadhaar-scan-permission">
        <Text variant="h2">{t('device.camera.permissionTitle')}</Text>
        <Text variant="muted">{t('fa10b.scanNote')}</Text>
        <Button label={t('device.camera.allow')} onPress={() => void requestPermission()} testID="camera-allow" />
        <Button label={t('common.cancel')} variant="secondary" onPress={onClose} />
      </Card>
    );
  }

  return (
    <Card testID="aadhaar-scan">
      <Text variant="h2">{t('fa10b.scanTitle')}</Text>
      <View style={styles.camera}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={check.isPending || check.isSuccess || check.isError ? undefined : scanned}
          onMountError={() => setFailed(true)}
          testID="aadhaar-scan-camera"
        />
        <View style={styles.frame} pointerEvents="none" />
      </View>
      {failed ? <Banner tone="error" message={t('device.camera.unavailable')} /> : null}
      <Text variant="muted">{check.isPending ? t('fa10b.scanChecking') : t('fa10b.scanTips')}</Text>
      <Text variant="tiny">{t('fa10b.scanNote')}</Text>
      <ErrorBanner error={check.error} />
      {check.error ? <Button label={t('fa10b.scanAgain')} variant="secondary" onPress={again} testID="aadhaar-scan-again" /> : null}
      <Button label={t('common.cancel')} variant="secondary" onPress={onClose} testID="aadhaar-scan-cancel" />
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12, marginTop: 12 },
  camera: { aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  frame: { width: '78%', aspectRatio: 1, borderWidth: 3, borderColor: colors.white, borderRadius: radius.md },
});
