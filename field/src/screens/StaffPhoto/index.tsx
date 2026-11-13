import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { StaffPhotoStatus } from '@/api/endpoints/staffPhoto';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Screen, Text } from '@/components';
import { LiveCamera, type CapturedPhoto } from '@/device/camera';
import { useI18n } from '@/i18n';
import { colors } from '@/theme';

/**
 * Staff photo before going on (guide, login codes, 14 Nov). No design file:
 * an agent with no staff photo yet (accounts made before photos), or whose
 * photo the CEO asked to be retaken, takes a live front-camera selfie here.
 * Camera only — the app never asks for the gallery.
 */
export default function StaffPhotoScreen({ reason }: { reason: StaffPhotoStatus['reason'] }) {
  const { t } = useI18n();
  const { staffPhoto } = useEndpoints();
  const { logout, session } = useAuth();
  const queryClient = useQueryClient();
  const [camera, setCamera] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(photo: CapturedPhoto) {
    setCamera(false);
    setSaving(true);
    setFailed(false);
    try {
      const saved = await staffPhoto.upload(photo);
      queryClient.setQueryData([...queryKeys.staffPhoto, session?.staff.id ?? ''], { ...saved, required: false, reason: null });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  if (camera) {
    return <LiveCamera facing="front" requireLocation={false} onCapture={(photo) => void save(photo)} onCancel={() => setCamera(false)} />;
  }

  return (
    <View style={styles.flex}>
      <Screen testID="screen-staff-photo">
        <Text variant="h1">{t('staffPhoto.title')}</Text>
        <Text variant="muted">{t(reason === 'retake' ? 'staffPhoto.retake' : 'staffPhoto.missing')}</Text>
        {failed ? <Banner tone="error" title={t('staffPhoto.failed')} /> : null}
        <Button label={saving ? t('staffPhoto.saving') : t('staffPhoto.open')} loading={saving} onPress={() => setCamera(true)} testID="staff-photo-open" />
        <Button label={t('staffPhoto.signOut')} variant="secondary" onPress={() => void logout()} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
