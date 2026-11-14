import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { JobSeekerStatus, Step } from '@/api/endpoints';
import { Banner, Button, Card, Text } from '@/components';
import { MobileField, SelectField } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { formatTimeIst } from '@/lib/format';
import { routes, sellingRoutes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { ErrorBanner, Note, QueryView, useNow } from './index';
import { AadhaarQrScan } from './AadhaarQrScan';

const STATUS_POLL_MS = 5000;
const RELATIONS = ['brother', 'sister', 'parent', 'spouse', 'friend', 'other'] as const;
const NEXT_STEP_KEYS: Record<JobSeekerStatus['nextStep'], MessageKey> = {
  consent: 'fa10b.step.consent',
  selfie: 'fa10b.step.selfie',
  id_check: 'fa10b.step.idCheck',
  payment: 'fa10b.step.payment',
  complete: 'fa10b.step.payment',
};

function mark(step: Step): { icon: string; color: string } {
  if (step.state === 'done') return { icon: '✓', color: colors.green };
  if (step.state === 'stuck') return { icon: '✗', color: colors.tomato };
  if (step.state === 'in_progress' || step.state === 'confirming') return { icon: '…', color: colors.amber };
  return { icon: '–', color: colors.soft };
}

/**
 * The registration status panel shared by FA10b (just saved) and FA10c
 * (following the link): Phone verified, Consent, Selfie, ID check, ₹499 —
 * each done / sent / stuck / not started, with the reason when stuck.
 * The same endpoints as the call agent's panel (CA08b/c): one SMS link,
 * valid 48 hours, that resumes at the first unfinished step; a payment-only
 * link to another number once payment is reached. Sending needs signal.
 * At the ID step, with his consent given on his link, "Scan Aadhaar QR" lets
 * the field agent scan the QR on his Aadhaar card live (guide, 14 Nov).
 */
export function RegistrationPanel({ jobSeekerId, variant }: { jobSeekerId: string; variant: 'saved' | 'progress' }) {
  const { selling } = useEndpoints();
  const status = useQuery({
    queryKey: queryKeys.seekerStatus(jobSeekerId),
    queryFn: () => selling.seekerStatus(jobSeekerId),
    enabled: !!jobSeekerId,
    refetchInterval: (q) => (q.state.data?.stage === 'active' ? false : STATUS_POLL_MS),
  });
  return <QueryView query={status}>{(s) => <Panel status={s} variant={variant} refetch={() => void status.refetch()} />}</QueryView>;
}

function Panel({ status: s, variant, refetch }: { status: JobSeekerStatus; variant: 'saved' | 'progress'; refetch: () => void }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const [otherOpen, setOtherOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [payer, setPayer] = useState('');
  const [relation, setRelation] = useState('');
  const now = useNow();
  const linkLive = !!s.registrationLinkExpiresAt && new Date(s.registrationLinkExpiresAt).getTime() > now;
  const send = useMutation({
    mutationFn: () => queue.live(() => selling.sendRegistrationLink(s.id)),
    onSuccess: () => {
      refetch();
      if (variant === 'saved') router.replace(sellingRoutes.seekerProgress(s.id));
    },
  });
  const other = useMutation({
    mutationFn: () => queue.live(() => selling.paymentOnlyLink(s.id, payer, relation || undefined)),
    onSuccess: () => {
      setOtherOpen(false);
      refetch();
    },
  });
  const rows: { key: string; label: string; step: Step; detail: string }[] = [
    { key: 'phone', label: t('fa10b.phone'), step: s.steps.phone, detail: `+91 ${s.phone} · ${t('fa10b.otpChecked', { time: s.phoneVerifiedAt ? formatTimeIst(s.phoneVerifiedAt) : '' })}` },
    {
      key: 'consent',
      label: t('fa10b.consent'),
      step: s.steps.consent,
      detail: s.steps.consent.state === 'done'
        ? t('fa10b.consentDone', { given: s.consent.requiredGiven, total: s.consent.requiredTotal, promotions: s.consent.promotions ? t('fa10.yes') : t('fa10.no') })
        : '',
    },
    { key: 'selfie', label: t('fa10b.selfie'), step: s.steps.selfie, detail: s.steps.selfie.state === 'done' ? t('fa10b.selfieDone') : '' },
    { key: 'idCheck', label: t('fa10b.idCheck'), step: s.steps.idCheck, detail: '' },
    { key: 'payment', label: t('fa10b.payment'), step: s.steps.payment, detail: s.steps.payment.state === 'confirming' ? t('fa10b.confirming') : '' },
  ];
  const stateText = (step: Step) =>
    step.state === 'done'
      ? step.time ? formatTimeIst(step.time) : t('fa10b.done')
      : step.state === 'stuck'
        ? t('fa10b.stuck', { reason: step.reason ?? '' })
        : step.state === 'in_progress' || step.state === 'confirming'
          ? t('fa10b.inProgress')
          : linkLive ? t('fa10b.waiting') : t('fa10b.notSent');
  return (
    <>
      <Banner
        tone="ok"
        title={variant === 'saved' && !linkLive ? t('fa10b.saved', { code: s.code }) : s.stage === 'active' ? t('fa10b.active', { code: s.code }) : t('fa10b.linkSent')}
        testID="seeker-banner"
      />
      <Card>
        <Text variant="h2">{t('fa10b.registration', { name: s.name, code: s.code })}</Text>
        <Text variant="tiny" style={styles.legend}>{t('fa10b.legend')}</Text>
        {rows.map((r, i) => {
          const m = mark(r.step);
          return (
            <View key={r.key} style={[styles.row, i < rows.length - 1 && styles.line]} testID={`step-${r.key}`}>
              <Text style={[styles.icon, { color: m.color }]}>{m.icon}</Text>
              <View style={styles.flex}>
                <Text style={styles.stepLabel}>{r.key === 'phone' ? r.label : `${i} · ${r.label}`}</Text>
                <Text variant="muted">{r.detail || stateText(r.step)}</Text>
              </View>
            </View>
          );
        })}
      </Card>
      {s.stage !== 'active' && s.nextStep === 'id_check' && s.steps.consent.state === 'done' ? (
        scanOpen ? (
          <AadhaarQrScan jobSeekerId={s.id} onFinished={refetch} onClose={() => setScanOpen(false)} />
        ) : (
          <Button label={t('fa10b.scanAadhaar')} onPress={() => setScanOpen(true)} testID="scan-aadhaar" />
        )
      ) : null}
      {s.stage !== 'active' ? (
        <>
          <Button
            label={linkLive ? t('fa10b.resend', { step: t(NEXT_STEP_KEYS[s.nextStep]) }) : t('fa10b.send')}
            loading={send.isPending}
            onPress={() => send.mutate()}
            testID="send-link"
          />
          {s.nextStep === 'payment' ? (
            <Button label={t('fa10b.otherPayer')} variant="secondary" onPress={() => setOtherOpen(!otherOpen)} testID="other-payer" />
          ) : null}
          {otherOpen ? (
            <Card>
              <View style={styles.gap}>
                <MobileField label={t('fa10b.payerMobile')} required value={payer} onChange={setPayer} testID="payer-mobile" />
                <SelectField label={t('fa10b.relation')} value={relation} choices={RELATIONS.map((r) => ({ value: r, label: t(`fa10b.relation.${r}` as MessageKey) }))} onChange={setRelation} />
                <Button label={t('fa10b.sendPaymentLink')} disabled={!/^[6-9]\d{9}$/.test(payer)} loading={other.isPending} onPress={() => other.mutate()} testID="send-payment-link" />
                <Note>{t('fa10b.paymentOnlyNote', { minutes: s.paymentOnlyLinkMinutes ?? 15 })}</Note>
              </View>
            </Card>
          ) : null}
          {s.paymentOnlyLink?.live ? <Banner tone="info" message={t('fa10b.paymentLinkLive')} testID="payment-link-live" /> : null}
          <Button
            label={s.gender === 'female' ? t('fa10b.preview.she') : s.gender === 'male' ? t('fa10b.preview.he') : t('fa10b.preview')}
            variant="secondary"
            onPress={() => setPreview(!preview)}
            testID="preview"
          />
          {preview ? (
            <Card testID="preview-card">
              <Text>{t('fa10b.previewBody')}</Text>
              <Text>{t('fa10b.preview.consent')}</Text>
              <Text>{t('fa10b.preview.selfie')}</Text>
              <Text>{t('fa10b.preview.id')}</Text>
              <Text>{t('fa10b.preview.payment')}</Text>
              <Text variant="muted">{t('fa10b.preview.note')}</Text>
            </Card>
          ) : null}
        </>
      ) : null}
      <ErrorBanner error={send.error ?? other.error} />
      <Note>{linkLive ? t('fa10c.note') : t('fa10b.note')}</Note>
      <Button label={t('fa10b.home')} variant="secondary" onPress={() => router.replace(routes.home)} testID="home" />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 12 },
  legend: { marginTop: 4, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, minHeight: 48 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { fontFamily: fonts.body700, fontSize: 16, width: 18, textAlign: 'center' },
  stepLabel: { fontFamily: fonts.body700, color: colors.ink },
});
