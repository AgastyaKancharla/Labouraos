import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { PlacementView } from '@/api/endpoints';
import { Banner, Button, Card, Text } from '@/components';
import { DateField, SelectField } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { formatCountdown, formatDayIst, formatTimeIst } from '@/lib/format';
import { ErrorBanner } from '../_selling';

/** Indian date ("2026-11-14") of an instant. */
function istKey(input: string | number): string {
  return new Date(new Date(input).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * "Report worker left" on the joining screen (FA11), once the worker has
 * joined: the replacement claim the old Admin Dashboard used to take. The
 * owner says the worker left → pick the date and the reason; the claim is
 * recorded on the answered call with the owner (POST /placements/:id/claims,
 * which keeps every rule: inside the guarantee, an answered owner call,
 * reasons from the agreed list, auto-rejection when late, unpaid or not
 * covered). A Team Lead or Manager then decides it. Field agents report only
 * for their own account businesses (the server checks).
 */
export function WorkerLeft({ placement: p }: { placement: PlacementView }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const form = useQuery({ queryKey: queryKeys.workerLeft(p.id), queryFn: () => selling.workerLeft(p.id) });
  const [open, setOpen] = useState(false);
  const [leftOn, setLeftOn] = useState('');
  const [reason, setReason] = useState<string>('');
  const [saved, setSaved] = useState<'sent' | 'queued' | null>(null);
  const call = useMutation({
    mutationFn: () =>
      queue.live(() => selling.placeCall({ subjectType: 'business', subjectId: p.business.id, purpose: 'general', relatedType: 'placement', relatedId: p.id })),
  });
  const ownerCall = form.data?.ownerCalls[0] ?? null;
  const save = useMutation({
    mutationFn: () =>
      queue.submit(t('fa11.left.queuedLabel', { name: p.candidate.firstName }), {
        method: 'POST',
        path: `/placements/${encodeURIComponent(p.id)}/claims`,
        json: { workerLeftOn: leftOn, reason, callRecordId: ownerCall?.id },
      }),
    onSuccess: (r) => {
      setSaved(r.status);
      void client.invalidateQueries({ queryKey: queryKeys.sellingPlacement(p.id) });
    },
  });
  const d = form.data;
  if (!d) return null;
  if (saved) {
    return <Banner tone={saved === 'sent' ? 'ok' : 'info'} message={saved === 'sent' ? t('fa11.left.sent', { hours: d.guarantee.decisionHours }) : t('fa03.waitingToSend')} testID="left-saved" />;
  }
  if (d.blocked === 'open_claim' && d.openClaim) return <Banner tone="info" message={t('fa11.left.waiting', { code: d.openClaim.code })} testID="left-waiting" />;
  if (!d.canReport) return null;

  const notCovered = d.reasons.notCovered.includes(reason);
  const label = (r: string) => t(`fa11.left.reason.${r}` as MessageKey);
  const choices = [
    ...d.reasons.covered.map((r) => ({ value: r, label: label(r) })),
    ...d.reasons.notCovered.map((r) => ({ value: r, label: t('fa11.left.notCovered', { reason: label(r) }) })),
  ];
  const min = d.placement.joinedDate ? istKey(d.placement.joinedDate) : undefined;
  const max = istKey(Math.min(new Date(d.leftOnLatest).getTime(), Date.now()));
  const ready = !!leftOn && !!reason && !!ownerCall;
  return (
    <Card title={t('fa11.left.title')}>
      <Text variant="muted">{t('fa11.left.intro', { name: p.candidate.firstName, days: d.guarantee.windowDays, hours: d.guarantee.decisionHours })}</Text>
      {!open ? (
        <Button label={t('fa11.left.open')} variant="secondary" onPress={() => setOpen(true)} testID="left-open" />
      ) : (
        <View style={styles.form}>
          <DateField
            label={t('fa11.left.leftOn', { name: p.candidate.firstName })}
            required
            value={leftOn}
            onChange={setLeftOn}
            min={min}
            max={max}
            hint={t('fa11.left.leftOnHint', { days: d.guarantee.reportWithinDays })}
            testID="left-on"
          />
          <SelectField label={t('fa11.left.reason')} required value={reason} choices={choices} onChange={setReason} testID="left-reason" />
          {notCovered ? <Banner tone="warn" message={t('fa11.left.notCoveredNote')} testID="left-not-covered" /> : null}
          {ownerCall ? (
            <Text variant="small" testID="left-call">
              {t('fa11.left.call', { time: `${formatDayIst(ownerCall.at)} ${formatTimeIst(ownerCall.at)}`, duration: ownerCall.durationSec ? formatCountdown(ownerCall.durationSec * 1000) : '—' })}
            </Text>
          ) : (
            <>
              <Banner tone="warn" message={t('fa11.left.noCall')} testID="left-no-call" />
              <View style={styles.row}>
                <Button label={t('fa11.left.callOwner')} variant="secondary" loading={call.isPending} onPress={() => call.mutate()} testID="left-call-owner" />
                <Button label={t('fa11.left.refresh')} variant="secondary" onPress={() => void form.refetch()} testID="left-refresh" />
              </View>
              <ErrorBanner error={call.error} />
            </>
          )}
          <Button label={t('fa11.left.send')} variant="danger" disabled={!ready} loading={save.isPending} onPress={() => save.mutate()} testID="left-send" />
          <ErrorBanner error={save.error} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12, marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
