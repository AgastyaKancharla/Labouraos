import { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { useCameraPermissions, type CameraType } from 'expo-camera';
import type { MessageKey } from '@/i18n';
import { Button, Text } from '@/components';
import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme';
import { useLocation } from '@/device/location/useLocation';
import type { GpsFix } from '@/device/location/types';
import { burnStamp } from './burnStamp';
import { CameraSurface, type CameraSurfaceHandle } from './CameraSurface';
import { buildStamp } from './stamp';
import type { CapturedPhoto } from './types';
import type { CameraErrorKind } from './webStream';

/** What the agent reads when the camera does not start: allow it, close other apps, no camera, or https. */
export const CAMERA_ERROR_KEYS: Record<CameraErrorKind, MessageKey> = {
  denied: 'device.camera.permissionDenied',
  in_use: 'device.camera.unavailable',
  no_camera: 'device.camera.noCamera',
  insecure: 'device.camera.insecure',
};

/**
 * The phone app asks for the camera permission first (expo-camera). The web
 * app does not: getUserMedia itself is the browser's prompt, and a separate
 * probe stream made Android Chrome refuse the real camera (17 Nov, item 4).
 */
const ASK_PERMISSION_FIRST = Platform.OS !== 'web';

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
 * Works in the phone app (expo-camera) and in the installed web app (our
 * own getUserMedia camera, CameraSurface.web.tsx; it needs HTTPS). When the
 * camera does not start, the agent is told why: the camera is not allowed
 * (how to allow it), it is in use, there is none, or the page is not https —
 * with Try again.
 */
export function LiveCamera({ facing: initialFacing = 'back', label, requireLocation = true, onCapture, onCancel, now = () => new Date() }: Props) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>(initialFacing);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<CameraErrorKind | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<CapturedPhoto | null>(null);
  const camera = useRef<CameraSurfaceHandle>(null);
  const location = useLocation();
  const { read } = location;

  useEffect(() => {
    void read();
  }, [read]);

  if (ASK_PERMISSION_FIRST && !permission) return <View style={styles.fill} />;

  if (ASK_PERMISSION_FIRST && permission && !permission.granted) {
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
    setCaptureFailed(false);
    try {
      const shot = await camera.current.takePicture();
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
      // The frame could not be read: the camera itself is still on, so the agent simply taps again.
      setCaptureFailed(true);
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
      <CameraSurface
        key={`${facing}-${attempt}`}
        ref={camera}
        style={styles.camera}
        facing={facing}
        onReady={() => {
          setFailed(null);
          setReady(true);
        }}
        onError={(kind) => {
          setReady(false);
          setFailed(kind);
        }}
      />
      <View style={styles.actions}>
        {failed ? (
          <>
            <Text variant="small" color={colors.white} accessibilityRole="alert" testID="camera-error">
              {t(CAMERA_ERROR_KEYS[failed])}
            </Text>
            <Button
              label={t('common.retry')}
              variant="secondary"
              onPress={() => {
                setFailed(null);
                setAttempt((n) => n + 1);
              }}
              testID="camera-retry"
            />
          </>
        ) : (
          <Text variant="small" color={colors.white}>
            {captureFailed
              ? t('device.camera.captureFailed')
              : waitingForLocation
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
            onPress={() => {
              // The old camera is stopped before the other one opens (Android opens one camera at a time).
              setReady(false);
              setFailed(null);
              setFacing((f) => (f === 'back' ? 'front' : 'back'));
            }}
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
