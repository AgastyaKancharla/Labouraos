import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Text, TextField } from '@/components';
import { visitPaths } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { Sheet } from '../_attendance/DayControls';
import { ChoiceList } from './ChoiceList';

export const CLOSE_REASONS = ['not_interested', 'shop_closed', 'wrong_or_duplicate', 'other'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

/**
 * "Close this revisit" (Master Guide rev 208, 22 Nov): the agent stops the
 * revisits of a shop with a reason — not interested, shop closed, wrong or
 * duplicate shop, or other (in his words, required). Nothing is deleted; the
 * server audits it and the Team Lead sees it in Visit proof. Sent through
 * the offline queue, so it works without signal too.
 */
export function CloseRevisitButton({ visitId, name, testID }: { visitId: string; name: string; testID: string }) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CloseReason | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function close() {
    if (!reason) return setProblem(t('revisit.pickReason'));
    if (reason === 'other' && note.trim().length < 3) return setProblem(t('revisit.sayWhy'));
    setProblem(null);
    setBusy(true);
    try {
      await queue.submit(`${t('revisit.queueLabel')} · ${name}`, {
        method: 'POST',
        path: visitPaths.closeRevisit(visitId),
        json: { reason, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      setOpen(false);
      void client.invalidateQueries({ queryKey: ['field-work'] });
    } catch (e) {
      setProblem(isApiError(e) ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button label={t('revisit.close')} variant="secondary" onPress={() => setOpen(true)} testID={testID} style={styles.button} />
      <Sheet open={open} onClose={() => setOpen(false)} title={t('revisit.closeTitle', { name })}>
        <Text variant="muted">{t('revisit.closeBody')}</Text>
        <ChoiceList
          choices={CLOSE_REASONS.map((r) => ({ value: r, label: t(`revisit.reason.${r}` as const) }))}
          value={reason}
          onChange={(r) => setReason(r)}
          testID={`${testID}-reason`}
        />
        {reason === 'other' ? (
          <TextField label={t('revisit.otherLabel')} value={note} onChangeText={setNote} maxLength={500} testID={`${testID}-note`} />
        ) : null}
        {problem ? <Banner tone="error" message={problem} testID={`${testID}-problem`} /> : null}
        <View style={styles.row}>
          <Button label={t('revisit.confirm')} variant="danger" loading={busy} onPress={() => void close()} testID={`${testID}-confirm`} />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', marginLeft: 46, marginBottom: 8 },
  row: { gap: 8 },
});
