import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, HeroCard, LoadingState, Screen } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAfterSave } from '@/api/refresh';
import { isApiError } from '@/api/errors';
import type { ReferralStep } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { finishLater } from '@/navigation/useFlow';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { StepRow } from '../_selling';

const STEPS: { key: 'terms' | 'selfie' | 'id' | 'upi'; label: MessageKey }[] = [
  { key: 'terms', label: 'fa23b.terms' },
  { key: 'selfie', label: 'fa23b.selfie' },
  { key: 'id', label: 'fa23b.id' },
  { key: 'upi', label: 'fa23b.upi' },
];

/**
 * FA23b — Referral partner saved: the RF- ID and the one registration link
 * he finishes on his own phone (terms + call-recording consent → selfie → ID
 * check → UPI), with Resend link. Asks every 5 seconds until complete.
 * Data: GET /referrals/:id, GET /referrals/:id/registration-status,
 * POST /referrals/:id/terms-links.
 */
export default function ReferralSavedScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id?: string; new?: string }>();
  const id = params.id ?? '';
  const { redesign } = useEndpoints();
  const queue = useOfflineQueue();
  const afterSave = useAfterSave();
  const header = useQuery({ queryKey: queryKeys.referral(id), queryFn: () => redesign.referral(id), enabled: Boolean(id) });
  const status = useQuery({
    queryKey: queryKeys.referralStatus(id),
    queryFn: () => redesign.referralStatus(id),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.currentStep === 'complete' ? false : 5000),
  });
  const resend = useMutation({
    mutationFn: () => queue.live(() => redesign.resendReferralLink(id, header.data?.language ?? undefined)),
    onSuccess: () => afterSave(queryKeys.referralStatus(id)),
  });
  const chip = (s: ReferralStep | undefined): { label: string; tone: 'green' | 'amber' | 'neutral' | 'tomato' } =>
    !s
      ? { label: '—', tone: 'neutral' }
      : s.state === 'done'
        ? { label: s.time ? t('fa23b.doneAt', { time: formatTimeIst(s.time) }) : t('fa06.done'), tone: 'green' }
        : s.state === 'in_progress'
          ? { label: t('fa23b.inProgress'), tone: 'amber' }
          : s.state === 'stuck'
            ? { label: t('fa23b.stuck'), tone: 'tomato' }
            : { label: t('fa23b.notYet'), tone: 'neutral' };
  return (
    <View style={styles.flex} testID="screen-FA23b">
      <AppHeader title={t('fa23b.title')} />
      <Screen onRefresh={() => void status.refetch()} refreshing={status.isRefetching}>
        {!id ? (
          <EmptyState message={t('common.error')} />
        ) : header.isPending ? (
          <LoadingState />
        ) : header.isError ? (
          <ErrorState error={header.error} onRetry={() => void header.refetch()} />
        ) : (
          <>
            {params.new === '1' ? <Banner tone="ok" title={t('fa23b.saved', { code: header.data.code })} message={t('fa23b.savedBody')} testID="fa23b-saved" /> : null}
            <HeroCard title={header.data.name} subtitle={header.data.code} emoji="🤝" />
            <Card title={t('fa23b.steps')} icon="clipboard" accent="royal" testID="fa23b-steps">
              {STEPS.map((s, i) => {
                const step = status.data?.steps[s.key];
                const c = chip(step);
                return <StepRow key={s.key} label={step?.state === 'stuck' && step.reason ? `${t(s.label)} · ${step.reason}` : t(s.label)} chip={c.label} tone={c.tone} last={i === STEPS.length - 1} testID={`fa23b-${s.key}`} />;
              })}
            </Card>
            {status.data?.currentStep !== 'complete' ? (
              <Button
                label={resend.isSuccess ? t('fa23b.resent') : t('fa23b.resend')}
                variant="secondary"
                loading={resend.isPending}
                disabled={resend.isSuccess}
                onPress={() => resend.mutate()}
                testID="fa23b-resend"
              />
            ) : null}
            {resend.error ? <Banner tone="error" message={isApiError(resend.error) ? resend.error.message : t('common.error')} /> : null}
            <Button label={t('fa23b.done')} onPress={() => finishLater(routes.jobSeekers)} testID="fa23b-done" />
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
