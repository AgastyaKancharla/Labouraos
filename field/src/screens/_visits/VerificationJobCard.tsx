import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, Icon, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import type { VerificationJob } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst, formatShiftTime, formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { formatDateKey } from './format';
import { ErrorBanner } from '../_selling';

/** Google Maps for the business: its pin, else its address. */
export function mapsUrl(job: Pick<VerificationJob, 'business'>): string | null {
  const b = job.business;
  if (b.latitude !== null && b.longitude !== null) return `https://www.google.com/maps/search/?api=1&query=${b.latitude},${b.longitude}`;
  const where = [b.address, b.locality].filter(Boolean).join(', ');
  return where ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}` : null;
}

/** Where Verify opens: the verification steps, resuming a started visit. */
export function verifyHref(job: VerificationJob) {
  return {
    pathname: routes.visitVerify,
    params: {
      businessId: job.business.id,
      assignmentId: job.assignmentId,
      ...(job.unfinishedVisitId ? { visitId: job.unfinishedVisitId } : {}),
    },
  };
}

/**
 * A verification visit as a job card (21 Nov, M12): the business's address,
 * the owner, his phone's last 4 digits, Call owner (the masked, recorded call
 * from the agent's calling phone), Open in Maps and Verify. Used on Today
 * (Needs you now), Visits → Planned and the verification screen itself
 * (`showVerify` off there).
 */
export function VerificationJobCard({ job, showVerify = true, testID }: { job: VerificationJob; showVerify?: boolean; testID?: string }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const [calling, setCalling] = useState(false);
  const call = useMutation({
    mutationFn: () => queue.live(() => selling.placeCall({ subjectType: 'business', subjectId: job.business.id, purpose: 'verification' })),
    onSuccess: () => setCalling(true),
  });
  const b = job.business;
  const maps = mapsUrl(job);
  const owner = b.ownerName ? t('job.owner', { name: b.ownerName }) : b.contactName ? t('job.contact', { name: b.contactName }) : null;
  const last = job.lastAttempt;
  const comeBack = last?.revisitOn
    ? t('job.comeBack', { when: `${formatDateKey(last.revisitOn)}${last.revisitTime ? ` ${formatShiftTime(last.revisitTime)}` : ''}` })
    : null;
  return (
    <Card stripe accent={job.purpose === 'business_signup' ? 'green' : 'royal'} testID={testID ?? `job-${job.assignmentId}`}>
      <View style={styles.head}>
        <Text variant="bodyStrong" style={styles.flex1}>{b.name || b.code}</Text>
        <StatusChip
          tone={job.purpose === 'business_signup' ? 'green' : job.purpose === 'candidate_report' ? 'tomato' : 'blue'}
          label={job.purpose === 'business_signup' ? t('job.signup') : job.purpose === 'candidate_report' ? t('job.candidateReport') : t('job.lead')}
        />
      </View>
      <Text variant="muted" testID="job-address">{[b.address, b.locality].filter(Boolean).join(' · ') || t('job.noAddress')}</Text>
      {owner ? <Text testID="job-owner">{owner}</Text> : null}
      <Text variant="muted" testID="job-phone">{t('job.phone', { last4: b.phoneLast4 })}</Text>
      {job.requestedFor ? <Text variant="muted">{t('fa05.ownerPicked', { when: `${formatDayIst(job.requestedFor)} ${formatTimeIst(job.requestedFor)}` })}</Text> : null}
      {last?.outcome === 'owner_not_there' ? (
        <Text variant="muted" testID="job-last-try">{[t('job.lastTry', { date: formatDayIst(last.at) }), comeBack].filter(Boolean).join(' · ')}</Text>
      ) : null}
      {calling ? <Banner tone="info" icon="phone" message={t('job.calling')} testID="job-calling" /> : null}
      <ErrorBanner error={call.error} />
      <View style={styles.buttons}>
        <Button
          label={t('job.callOwner')}
          variant="secondary"
          icon={<Icon name="phone" color={colors.cyan} />}
          loading={call.isPending}
          onPress={() => call.mutate()}
          style={styles.flex1}
          testID="job-call-owner"
        />
        <Button
          label={t('job.openMaps')}
          variant="secondary"
          icon={<Icon name="map" color={colors.cyan} />}
          disabled={!maps}
          onPress={() => (maps ? void Linking.openURL(maps) : undefined)}
          style={styles.flex1}
          testID="job-maps"
        />
      </View>
      {showVerify ? (
        <Button
          label={job.unfinishedVisitId ? t('job.resume') : t('job.verify')}
          icon={<Icon name="shield" color={colors.white} />}
          onPress={() => router.push(verifyHref(job) as never)}
          testID="job-verify"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 8 },
});
