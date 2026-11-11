import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import { Button, Text } from '@/components';
import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme';
import { useLocation } from '@/device/location/useLocation';
import type { GpsFix } from '@/device/location/types';
import { burnStamp } from './burnStamp';
import { buildStamp } from './stamp';
import type { CapturedPhoto } from './types';

interface Props {
  /** "back" for the shop board photo, "front" for the visit selfie. */
  facing?: CameraType;
  /** Optional third stamp line, e.g. the business code. */
  label?: string;
  /** Wait for a GPS fix before allowing the photo (default true). */
  requireLocation?: boolean;
  onCapture: (photo: CapturedPhoto) => void;
  onCancel?: () => void;
  /** Tests inject a clock. */
  now?: () => Date;
}

/**
 * The only way to take a photo in Laboura Field: the live camera, never the
 * gallery (guide: "camera only, stamped with time and place"). The photo is
 * stamped with the time and the GPS reading taken when the camera opened,
 * previewed, and handed to the screen only when the agent taps "Use this photo".
 *
 * Works in the phone app (expo-camera) and in the installed web app
 * (expo-camera uses the browser's live camera there; it needs HTTPS).
 */
export function LiveCamera({ facing: initialFacing = 'back', label, requireLocation = true, onCapture, onCancel, now = () => new Date() }: Props) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(initialFacing);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<CapturedPhoto | null>(null);
  const camera = useRef<CameraView>(null);
  const location = useLocation();
  const { read } = location;

  useEffect(() => {
    void read();
  }, [read]);

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]} testID="camera-permission">
        <Text variant="h2" align="center">
          {t('device.camera.permissionTitle')}
        </Text>
        <Text variant="muted" align="center">
          {t('device.camera.permissionBody')}
        </Text>
        <Button label={t('device.camera.allow')} onPress={() => void requestPermission()} testID="camera-allow" />
        {onCancel ? <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} /> : null}
      </View>
    );
  }

  const fix: GpsFix | null = location.fix;
  const waitingForLocation = requireLocation && !fix;

  async function take() {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.7, exif: false });
      const stamp = buildStamp(now(), fix, label);
      const stamped = await burnStamp(shot.uri, stamp);
      setPreview({
        uri: stamped.uri,
        width: stamped.width ?? shot.width,
        height: stamped.height ?? shot.height,
        mimeType: 'image/jpeg',
        source: 'live_camera',
        stamp,
      });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (preview) {
    return (
      <View style={styles.fill} testID="camera-preview">
        <Image source={{ uri: preview.uri }} style={styles.preview} resizeMode="contain" accessibilityIgnoresInvertColors />
        <View style={styles.actions}>
          {preview.stamp.lines.map((line) => (
            <Text key={line} variant="small" color={colors.white}>
              {line}
            </Text>
          ))}
          <Button label={t('device.camera.use')} onPress={() => onCapture(preview)} testID="camera-use" />
          <Button label={t('device.camera.retake')} variant="secondary" onPress={() => setPreview(null)} testID="camera-retake" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill} testID="live-camera">
      <CameraView
        ref={camera}
        style={styles.camera}
        facing={facing}
        mode="picture"
        onCameraReady={() => setReady(true)}
        onMountError={() => setFailed(true)}
      />
      <View style={styles.actions}>
        {failed ? (
          <Text variant="small" color={colors.white} accessibilityRole="alert">
            {t('device.camera.unavailable')}
          </Text>
        ) : (
          <Text variant="small" color={colors.white}>
            {waitingForLocation
              ? location.errorKey
                ? t(location.errorKey)
                : t('device.camera.needLocation')
              : t('device.camera.liveOnly')}
          </Text>
        )}
        {waitingForLocation && location.errorKey ? (
          <Button label={t('common.retry')} variant="secondary" onPress={() => void read()} />
        ) : null}
        <Button
          label={t('device.camera.take')}
          onPress={() => void take()}
          loading={busy}
          disabled={!ready || waitingForLocation}
          testID="camera-take"
        />
        <View style={styles.row}>
          <Button
            label={t('device.camera.switch')}
            variant="secondary"
            style={styles.half}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          />
          {onCancel ? <Button label={t('common.cancel')} variant="secondary" style={styles.half} onPress={onCancel} /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.ink },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, backgroundColor: colors.bg },
  camera: { flex: 1 },
  preview: { flex: 1, backgroundColor: colors.ink },
  actions: { padding: 16, gap: 10, backgroundColor: colors.ink },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, borderRadius: radius.md },
});
