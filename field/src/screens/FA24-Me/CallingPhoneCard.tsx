import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, Text } from '@/components';
import { MobileField } from '@/components/form';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthProvider';
import { useOfflineQueue } from '@/device/offline-queue';
import { ErrorBanner } from '../_selling';

/**
 * Me → "Your calling phone" (21 Nov, B2): the mobile the calling system rings
 * first when the agent calls an owner or a candidate from the app. Before,
 * only a Team Lead could set it on the office web. GET /field-work/calling-phone,
 * PUT /staff/:id/call-routing-phone (his own; needs signal).
 */
export function CallingPhoneCard() {
  const { t } = useI18n();
  const { session } = useAuth();
  const { fieldOps } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.callingPhone, queryFn: () => fieldOps.callingPhone() });
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => queue.live(() => fieldOps.setCallingPhone(session!.staff.id, phone)),
    onSuccess: () => {
      setSaved(true);
      setEditing(false);
      setPhone('');
      void client.invalidateQueries({ queryKey: queryKeys.callingPhone });
    },
  });
  const isSet = status.data?.set === true;
  const open = editing || (status.data !== undefined && !isSet);
  return (
    <Card title={t('me.callingPhone')} icon="phone" accent={isSet ? 'green' : 'orange'} testID="me-calling-phone">
      <Text variant="muted">{t('me.callingPhoneHelp')}</Text>
      {status.data ? (
        <Text testID="me-calling-phone-state" style={styles.state}>
          {isSet ? t('me.callingPhoneSet', { last4: status.data.last4 ?? '' }) : t('me.callingPhoneNotSet')}
        </Text>
      ) : null}
      {saved ? <Banner tone="ok" message={t('me.callingPhoneSaved')} testID="me-calling-phone-saved" /> : null}
      {open ? (
        <View style={styles.form}>
          <MobileField label={t('me.callingPhoneLabel')} value={phone} onChange={setPhone} required testID="me-calling-phone-input" />
          <ErrorBanner error={save.error} />
          <Button label={t('me.callingPhoneSave')} disabled={phone.length !== 10} loading={save.isPending} onPress={() => save.mutate()} testID="me-calling-phone-save" />
        </View>
      ) : isSet ? (
        <Button label={t('me.callingPhoneChange')} variant="secondary" onPress={() => { setSaved(false); setEditing(true); }} testID="me-calling-phone-change" />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  state: { marginTop: 6 },
  form: { gap: 8, marginTop: 8 },
});
