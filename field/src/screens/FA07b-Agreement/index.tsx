import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, Emoji, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Screen, StatusChip, Text, SendLinkButtons, type SendChannel } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { errorCode, inShortText, type AgreementStatus } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { FinishLaterButton } from '../_visits/FinishLater';
import { StepHeader } from '../_visits/StepHeader';
import { Script } from '../_selling';

/** How often the screen asks whether the owner has signed. */
export const AGREEMENT_POLL_MS = 10_000;

const HIDDEN_KEYS: Record<string, MessageKey> = {
  suspended: 'biz.hidden.suspended',
  paused: 'biz.hidden.paused',
  agreement_not_signed: 'biz.hidden.agreement_not_signed',
  visit_outside_area: 'biz.hidden.visit_outside_area',
  not_verified: 'biz.hidden.not_verified',
};

/**
 * FA07b — the agreement, step 5 of 7 (redesign, 16 Nov). After the business
 * form the owner signs the agreement on his own phone, from the SMS link
 * (terms, authority and call-recording ticks, then his OTP): the agent never
 * signs for him. This screen shows where the link is, turns green when he
 * signs (asks every 10 seconds), offers Resend link, and the agreement's
 * "In short" to read aloud (English only, rev 193).
 * Data: GET /field-work/businesses/:id/agreement, POST …/agreement-link,
 * GET /legal/documents/business_agreement.
 */
export default function AgreementScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ businessId?: string; visitId?: string; linkFailed?: string; accountAgent?: string }>();
  const { redesign } = useEndpoints();
  const businessId = params.businessId ?? '';
  const q = useQuery({
    queryKey: queryKeys.agreement(businessId),
    queryFn: () => redesign.agreement(businessId),
    enabled: Boolean(businessId),
    refetchInterval: (query) => (query.state.data?.state === 'signed' ? false : AGREEMENT_POLL_MS),
  });
  return (
    <View style={styles.flex} testID="screen-FA07b">
      <AppHeader title={t('fa07b.title')} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        <StepHeader step={5} />
        {/* Straight after a verification visit that made him the account agent (server: becameAccountAgent). */}
        {params.accountAgent === 'new' ? <Banner tone="ok" message={t('fa06b.accountAgent')} testID="fa07b-account-agent" /> : null}
        {!businessId ? (
          <EmptyState message={t('common.error')} />
        ) : q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <Agreement status={q.data} businessId={businessId} visitId={params.visitId} linkFailed={params.linkFailed === '1'} />
        )}
      </Screen>
    </View>
  );
}

function Agreement({ status: a, businessId, visitId, linkFailed }: { status: AgreementStatus; businessId: string; visitId?: string; linkFailed: boolean }) {
  const { t } = useI18n();
  const { redesign, legal } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const signed = a.state === 'signed';
  // Rev 211: "Send on WhatsApp" (SMS as backup) or the small "Send by SMS".
  const resend = useMutation({
    mutationFn: (channel: SendChannel) => queue.live(() => redesign.resendAgreement(businessId, channel)),
    onSettled: () => void client.invalidateQueries({ queryKey: ['field-work'] }),
  });
  const inShort = useQuery({
    queryKey: ['legal-document', 'business_agreement', 'en'],
    queryFn: () => legal.document('business_agreement'),
    staleTime: 3_600_000,
  });
  const resendError = resend.error ? resendErrorText(resend.error, t) : null;
  const linkLine =
    a.state === 'link_sent' && a.linkSentAt
      ? t('fa07b.linkSent', { last4: a.sentToLast4 ?? '—', time: formatTimeIst(a.linkSentAt) })
      : a.state === 'link_expired'
        ? t('fa07b.linkExpired', { last4: a.sentToLast4 ?? '—' })
        : a.state === 'not_sent'
          ? t('fa07b.notSent')
          : null;

  return (
    <>
      {signed ? (
        <Banner
          tone="ok"
          title={a.signedByName ? t('fa07b.signedBy', { name: a.signedByName }) : t('fa07b.signed')}
          message={a.signedAt ? t('fa07b.signedAt', { time: `${formatDayIst(a.signedAt)} ${formatTimeIst(a.signedAt)}` }) : undefined}
          testID="fa07b-signed"
        />
      ) : (
        <Card stripe accent="orange" testID="fa07b-waiting">
          <View style={styles.row}>
            <View style={styles.flex1}>
              <Text variant="h2">{t('fa07b.ownerSigns')}</Text>
              <Text variant="muted">{t('fa07b.ownerSignsBody')}</Text>
            </View>
            <Emoji symbol="📱" size={30} />
          </View>
          <View style={styles.gap} />
          {linkLine ? (
            <ListRow
              title={linkLine}
              leading={<IconTile icon="chat" accent={a.state === 'link_expired' || a.state === 'not_sent' ? 'red' : 'gold'} size={34} />}
              trailing={<StatusChip tone={a.state === 'link_sent' ? 'amber' : 'tomato'} label={t(`fa07b.state.${a.state}` as MessageKey)} />}
              last={!a.linkOpenedAt}
              testID="fa07b-link"
            />
          ) : null}
          {a.linkOpenedAt ? (
            <ListRow title={t('fa07b.opened', { time: formatTimeIst(a.linkOpenedAt) })} leading={<IconTile icon="check" accent="cyan" size={34} />} last />
          ) : null}
        </Card>
      )}
      {linkFailed && !signed && !resend.isSuccess ? <Banner tone="error" message={t('fa07b.firstLinkFailed')} testID="fa07b-first-failed" /> : null}
      {!signed ? (
        <>
          <SendLinkButtons
            label={resend.isSuccess ? t('fa07b.resent', { last4: resend.data.sentToLast4 }) : t('fa07b.resend')}
            disabled={!a.canResend || resend.isPending}
            run={(channel) => resend.mutateAsync(channel)}
            onError={() => undefined}
            testID="fa07b-resend"
          />
          {!a.canResend && a.resendAvailableAt ? (
            <Text variant="muted" testID="fa07b-resend-at">{t('fa07b.resendAt', { time: formatTimeIst(a.resendAvailableAt) })}</Text>
          ) : null}
          {resendError ? <Banner tone="error" message={resendError} testID="fa07b-resend-error" /> : null}
        </>
      ) : null}
      {signed && !a.canShowCandidates && a.candidatesHiddenReason ? (
        <Banner tone="info" message={t(HIDDEN_KEYS[a.candidatesHiddenReason] ?? 'biz.hidden.not_verified')} testID="fa07b-hidden" />
      ) : null}

      <Card title={t('fa07b.readAloud')} icon="chat" accent="cyan" testID="fa07b-summary">
        {inShort.data ? (
          <Script testID="fa07b-in-short">{inShortText(inShort.data)}</Script>
        ) : inShort.isError ? (
          <ErrorState compact error={inShort.error} onRetry={() => void inShort.refetch()} />
        ) : (
          <LoadingState compact />
        )}
      </Card>

      <Button
        label={signed ? t('fa07b.next') : t('fa07b.nextUnsigned')}
        onPress={() => router.push({ pathname: routes.visitVacancies, params: { businessId, ...(visitId ? { visitId } : {}) } })}
        testID="fa07b-next"
      />
      <FinishLaterButton />
    </>
  );
}

function resendErrorText(error: unknown, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const code = errorCode(error);
  const body = (error as { body?: { retryAt?: string; details?: { retryAt?: string } } }).body;
  const retryAt = body?.details?.retryAt ?? body?.retryAt;
  switch (code) {
    case 'AGREEMENT_RESEND_TOO_SOON':
    case 'AGREEMENT_RESEND_LIMIT':
      return retryAt ? t('fa07b.err.tooSoon', { time: formatTimeIst(retryAt) }) : t('fa07b.err.tooSoonNoTime');
    case 'AGREEMENT_SMS_FAILED':
      return t('fa07b.err.smsFailed');
    case 'AGREEMENT_ALREADY_SIGNED':
      return t('fa07b.err.alreadySigned');
    case 'NOT_YOUR_BUSINESS':
      return t('biz.err.notYours');
    default:
      return isApiError(error) ? error.message : t('common.error');
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gap: { height: 10 },
});
