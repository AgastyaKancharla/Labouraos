import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import type { OtherIdType } from '@/api/endpoints';
import { Banner, Button, Card, Text, TextField } from '@/components';
import { SelectField } from '@/components/form';
import { LiveCamera, type CapturedPhoto } from '@/device/camera';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { ErrorBanner } from './index';

/** What a typed number must look like (the server checks the same). */
const ID_TYPES: { id: OtherIdType; label: MessageKey; numberLabel: MessageKey; pattern: RegExp }[] = [
  { id: 'pan', label: 'fa10b.otherId.pan', numberLabel: 'fa10b.otherId.panNumber', pattern: /^[A-Z]{5}\d{4}[A-Z]$/ },
  { id: 'driving_licence', label: 'fa10b.otherId.dl', numberLabel: 'fa10b.otherId.dlNumber', pattern: /^[A-Z0-9-]{8,20}$/ },
  { id: 'voter_id', label: 'fa10b.otherId.voter', numberLabel: 'fa10b.otherId.voterNumber', pattern: /^[A-Z]{3}\d{7}$/ },
];

/**
 * "Photo of another ID" (rev 154): for a job seeker without a usable Aadhaar
 * QR, the field agent picks PAN, driving licence or voter ID, types the
 * number and takes a live photo of the card with this phone's camera (never
 * the gallery). It goes to the Team Lead, who checks it by eye next to the
 * selfie in T-Verify; until then the ID step is pending and payment waits.
 * Only for job seekers this agent registered. Needs signal (never queued).
 */
export function OtherIdPhoto({ jobSeekerId, onFinished, onClose }: { jobSeekerId: string; onFinished: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const [idType, setIdType] = useState<OtherIdType | ''>('');
  const [number, setNumber] = useState('');
  const [camera, setCamera] = useState(false);
  const def = ID_TYPES.find((d) => d.id === idType);
  const clean = number.toUpperCase().replace(/\s+/g, '');
  const valid = Boolean(def && def.pattern.test(clean));
  const send = useMutation({
    mutationFn: (photo: CapturedPhoto) => queue.live(() => selling.otherId(jobSeekerId, def!.id, clean, photo)),
    onSuccess: () => {
      setCamera(false);
      onFinished();
    },
    onError: () => setCamera(false),
  });

  if (send.data) {
    return (
      <Card testID="other-id-sent">
        <Banner tone="ok" title={t('fa10b.otherId.sent', { id: t(def!.label), last4: send.data.idNumberLast4 })} testID="other-id-pending" />
        <Text variant="muted">{t('fa10b.otherId.sentNote')}</Text>
        <Button label={t('fa10b.scanClose')} onPress={onClose} testID="other-id-close" />
      </Card>
    );
  }

  if (camera && def) {
    return (
      <View style={styles.camera} testID="other-id-camera">
        <Text variant="small">{t('fa10b.otherId.cameraTips')}</Text>
        <LiveCamera facing="back" requireLocation={false} label={`${t(def.label)} …${clean.slice(-4)}`} onCapture={(photo) => send.mutate(photo)} onCancel={() => setCamera(false)} />
      </View>
    );
  }

  return (
    <Card testID="other-id">
      <View style={styles.gap}>
        <Text variant="h2">{t('fa10b.otherId.title')}</Text>
        <Text variant="muted">{t('fa10b.otherId.note')}</Text>
        <SelectField
          label={t('fa10b.otherId.type')}
          value={idType}
          choices={ID_TYPES.map((d) => ({ value: d.id, label: t(d.label) }))}
          onChange={(v) => {
            setIdType(v as OtherIdType);
            setNumber('');
          }}
          testID="other-id-type"
        />
        {def ? (
          <TextField
            label={t(def.numberLabel)}
            value={number}
            onChangeText={setNumber}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            error={number.length > 0 && !valid ? t('fa10b.otherId.badNumber') : null}
            testID="other-id-number"
          />
        ) : null}
        <Button label={t('fa10b.otherId.takePhoto')} disabled={!valid || send.isPending} loading={send.isPending} onPress={() => setCamera(true)} testID="other-id-photo" />
        <Button label={t('common.cancel')} variant="secondary" onPress={onClose} />
        <ErrorBanner error={send.error} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  camera: { minHeight: 520, gap: 8 },
});
