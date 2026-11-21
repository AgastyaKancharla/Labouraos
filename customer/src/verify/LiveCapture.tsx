import { useRef, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Banner, Button, Card, Text } from '@/components';
import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme';
import { preparePhoto, type PhotoKind } from './photo';
import type { PhotoFile } from './types';

interface Props {
  kind: PhotoKind;
  tips: string;
  takeLabel: string;
  savingLabel: string;
  /** Sends the photo; 'retry' keeps the camera open for another try (the error shows on the page). */
  onCapture: (photo: PhotoFile) => Promise<'done' | 'retry'>;
  testID: string;
}

/**
 * A live photo from the phone's own camera — never the gallery or a file —
 * for the selfie (front camera) and the photo of another ID card (back
 * camera). The server only accepts photos sent with captureSource
 * "live_camera"; this is the only way the app makes one.
 */
export function LiveCapture({ kind, tips, takeLabel, savingLabel, onCapture, testID }: Props) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [taking, setTaking] = useState(false);
  const [sending, setSending] = useState(false);
  const [takeFailed, setTakeFailed] = useState(false);
  const [preview, setPreview] = useState<PhotoFile | null>(null);

  if (!permission) return <View style={styles.frame} testID={`${testID}-waiting`} />;
  if (!permission.granted) {
    return (
      <Card testID={`${testID}-permission`}>
        <View style={styles.gap}>
          <Text variant="h2">{t('camera.permissionTitle')}</Text>
          <Text variant="muted">{t('camera.permissionBody')}</Text>
          {permission.canAskAgain ? (
            <Button label={t('camera.allow')} onPress={() => void requestPermission()} testID={`${testID}-allow`} />
          ) : (
            <Button label={t('camera.openSettings')} onPress={() => void Linking.openSettings()} testID={`${testID}-settings`} />
          )}
        </View>
      </Card>
    );
  }

  const take = async () => {
    if (!camera.current || taking) return;
    setTaking(true);
    setTakeFailed(false);
    try {
      // No EXIF from the camera; preparePhoto saves a fresh JPEG anyway.
      const shot = await camera.current.takePictureAsync({ quality: 0.9, exif: false, shutterSound: false });
      setPreview(await preparePhoto(shot, kind));
    } catch {
      setTakeFailed(true);
    } finally {
      setTaking(false);
    }
  };

  const send = async () => {
    if (!preview) return;
    setSending(true);
    try {
      const outcome = await onCapture(preview);
      if (outcome === 'retry') setPreview(null);
    } finally {
      setSending(false);
    }
  };

  if (preview) {
    return (
      <View style={styles.gap} testID={`${testID}-preview`}>
        <Image source={{ uri: preview.uri }} style={styles.frame} resizeMode="cover" accessibilityIgnoresInvertColors />
        {sending ? <Text variant="muted">{savingLabel}</Text> : null}
        <Button label={t('camera.use')} onPress={() => void send()} loading={sending} testID={`${testID}-use`} />
        <Button label={t('camera.retake')} variant="secondary" disabled={sending} onPress={() => setPreview(null)} testID={`${testID}-retake`} />
      </View>
    );
  }

  return (
    <View style={styles.gap} testID={testID}>
      <Text variant="muted">{tips}</Text>
      <View style={styles.frame}>
        <CameraView
          key={attempt}
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={kind === 'selfie' ? 'front' : 'back'}
          mirror={kind === 'selfie'}
          animateShutter={false}
          onCameraReady={() => {
            setFailed(false);
            setReady(true);
          }}
          onMountError={() => {
            setReady(false);
            setFailed(true);
          }}
          testID={`${testID}-camera`}
        />
        {kind === 'selfie' ? <View pointerEvents="none" style={styles.oval} /> : <View pointerEvents="none" style={styles.cardFrame} />}
      </View>
      {failed ? (
        <Banner
          tone="error"
          message={t('camera.failed')}
          action={<Button label={t('verify.retry')} variant="secondary" onPress={() => setAttempt((n) => n + 1)} testID={`${testID}-again`} />}
        />
      ) : null}
      {takeFailed ? <Banner tone="error" message={t('camera.takeFailed')} /> : null}
      <Button label={takeLabel} onPress={() => void take()} loading={taking} disabled={!ready} testID={`${testID}-take`} />
      <Text variant="muted">{t('camera.noGallery')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  frame: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.navy },
  oval: { position: 'absolute', left: '15%', right: '15%', top: '12%', bottom: '18%', borderRadius: 999, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  cardFrame: { position: 'absolute', left: '6%', right: '6%', top: '30%', bottom: '30%', borderRadius: 12, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
});
