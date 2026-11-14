import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { PlacementView } from '@/api/endpoints';
import { Banner, Button, Card, Text } from '@/components';
import { DateField, SelectField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { formatCountdown, formatDayIst, formatTimeIst } from '@/lib/format';
import { ErrorBanner } from '../_selling';

/** Indian date ("2026-11-14") of an instant. */
function istKey(input: string): string {
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
 * for their own account businesses (the server checks). It needs signal: the
 * claim is sent live, never kept on the phone for later.
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
  const [saved, setSaved] = useState<{ code: string; rejected: string | null } | null>(null);
  const call = useMutation({
    mutationFn: () =>
      queue.live(() => selling.placeCall({ subjectType: 'business', subjectId: p.business.id, purpose: 'general', relatedType: 'placement', relatedId: p.id })),
  });
  // Only a call made on or after the leaving day is evidence; never an older one.
  const ownerCall = leftOn ? (form.data?.ownerCalls.find((c) => istKey(c.at) >= leftOn) ?? null) : null;
  // Sent live, never queued: a claim replayed later would carry the wrong report time.
  const save = useMutation({
    mutationFn: () => queue.live(() => selling.reportClaim(p.id, { workerLeftOn: leftOn, reason, callRecordId: ownerCall!.id })),
    onSuccess: (claim) => {
      setSaved({ code: claim.code, rejected: claim.decision === 'rejected' ? (claim.decisionReason ?? '') : null });
      void client.invalidateQueries({ queryKey: queryKeys.sellingPlacement(p.id) });
    },
  });
  const openForm = async () => {
    // Look again before showing the form: someone may have reported it meanwhile.
    const fresh = await form.refetch();
    if (fresh.data?.canReport) setOpen(true);
  };
  const d = form.data;
  if (!d) return null;
  if (saved) {
    return saved.rejected !== null
      ? <Banner tone="warn" message={t('fa11.left.sentRejected', { code: saved.code, reason: saved.rejected })} testID="left-saved" />
      : <Banner tone="ok" message={t('fa11.left.sent', { hours: d.guarantee.decisionHours })} testID="left-saved" />;
  }
  if (d.blocked === 'open_claim' && d.openClaim) return <Banner tone="info" message={t('fa11.left.waiting', { code: d.openClaim.code })} testID="left-waiting" />;
  const earlier = d.previousClaims?.length ? (
    <View style={styles.form} testID="left-previous">
      <Text variant="label">{t('fa11.left.previous')}</Text>
      {d.previousClaims.map((c) => (
        <Text key={c.code} variant="muted">
          {`${c.code} · ${formatDayIst(c.reportedAt)} · ${c.decision === 'accepted' ? t('fa11.left.accepted') : t('fa11.left.rejected')}${c.rejectionCode ? ` · ${t(`fa11.left.rejection.${c.rejectionCode}` as MessageKey)}` : ''}${c.decisionReason ? ` · “${c.decisionReason}”` : ''}`}
        </Text>
      ))}
    </View>
  ) : null;
  // Rejected before and not allowed again for this person: say why (owner decision 14 Nov).
  if (d.blocked === 'not_again' && d.reportAgain) {
    return (
      <Card title={t('fa11.left.title')}>
        <Banner tone="warn" message={d.reportAgain.who === 'nobody' ? t('fa11.left.againNever') : t('fa11.left.againManager')} testID="left-not-again" />
        {earlier}
      </Card>
    );
  }
  if (!d.canReport) return null;

  const notCovered = d.reasons.notCovered.includes(reason);
  const label = (r: string) => t(`fa11.left.reason.${r}` as MessageKey);
  const choices = [
    ...d.reasons.covered.map((r) => ({ value: r, label: label(r) })),
    ...d.reasons.notCovered.map((r) => ({ value: r, label: t('fa11.left.notCovered', { reason: label(r) }) })),
  ];
  const min = d.leftOnEarliest ?? undefined;
  const today = todayKeyIst();
  const max = d.leftOnLatest < today ? d.leftOnLatest : today;
  const ready = !!leftOn && !!reason && !!ownerCall;
  return (
    <Card title={t('fa11.left.title')}>
      <Text variant="muted">{t('fa11.left.intro', { name: p.candidate.firstName, days: d.guarantee.windowDays, hours: d.guarantee.decisionHours })}</Text>
      {d.reportAgain?.allowed && d.reportAgain.until ? <Banner tone="info" message={t('fa11.left.againOnce', { date: formatDayIst(`${d.reportAgain.until}T12:00:00+05:30`) })} testID="left-again-once" /> : null}
      {earlier}
      {!open ? (
        <Button label={t('fa11.left.open')} variant="secondary" loading={form.isRefetching} onPress={() => void openForm()} testID="left-open" />
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
          {!leftOn ? (
            <Text variant="muted">{t('fa11.left.callAfterDate')}</Text>
          ) : ownerCall ? (
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
