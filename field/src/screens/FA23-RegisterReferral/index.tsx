import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, CodeInput, Emoji, LoadingState, Screen, StatusChip, Text, TextField } from '@/components';
import { Checkbox, MobileField, Segmented, SelectField } from '@/components/form';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { inShortText } from '@/api/endpoints/legal';
import { isApiError } from '@/api/errors';
import { isNeedsSignalError, useOfflineQueue } from '@/device/offline-queue';
import { useFormDraft } from '@/lib/formDraft';
import { duplicateMessage, readOtpSend } from '@/lib/otp-send';
import { formatTimeIst } from '@/lib/format';
import { pageRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { Script } from '../_selling';
import { referralBody, referralErrors, EMPTY_REFERRAL, HEARD_FROM, INDIVIDUAL_ROLES, type ReferralForm } from './payload';
import { BUSINESS_TYPE_GROUPS } from '@/lib/businessTypes';

/** 22 Nov (rev 207): a partner's business type uses the same grouped list as the business form. */
const PARTNER_TYPE_CHOICES = BUSINESS_TYPE_GROUPS.flatMap((g) => g.types.map((ty) => ({ value: ty.value, label: ty.label, group: g.label })));

const MOBILE = /^[6-9]\d{9}$/;

/**
 * FA23 — Register a referral partner (redesign, 16 Nov: field agents register
 * them too; the server already allowed it). The same steps and rules as the
 * office call agent's CA15: mobile checked by OTP, individual or business,
 * area and pincode, how they heard; the
 * Referral Partner Terms "In short" is read aloud. Saving creates the RF- ID,
 * sends it by SMS with the one registration link (terms → selfie → ID → UPI),
 * then FA23b shows the steps.
 * Data: POST /otp/send {purpose:'referral'}, POST /otp/verify, POST /referrals.
 */
export default function RegisterReferralScreen() {
  const { t } = useI18n();
  const { registration, redesign, legal } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const options = useQuery({ queryKey: queryKeys.registrationOptions, queryFn: () => registration.options(), staleTime: 3_600_000 });
  const [form, setForm, clearForm] = useFormDraft<ReferralForm>('fa23', EMPTY_REFERRAL);
  const set = (patch: Partial<ReferralForm>) => setForm((f) => ({ ...f, ...patch }));
  const [showErrors, setShowErrors] = useState(false);
  const [otpProblem, setOtpProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const inShort = useQuery({
    queryKey: ['legal-document', 'referral_terms', 'en'],
    queryFn: () => legal.document('referral_terms'),
    staleTime: 3_600_000,
  });
  const errors = referralErrors(form);
  const err = (key: string) => (showErrors && errors.includes(key) ? t('fa07.required') : null);

  function explain(e: unknown) {
    return isNeedsSignalError(e) ? t('common.needsSignal') : isApiError(e) ? e.message : t('common.error');
  }

  async function sendOtp() {
    if (!MOBILE.test(form.mobile)) return setOtpProblem(t('fa07.mobileInvalid'));
    setOtpProblem(null);
    setBusy('send');
    try {
      const outcome = readOtpSend(await queue.live(() => redesign.sendReferralOtp(form.mobile, form.requestId ?? undefined)));
      if (outcome.kind === 'duplicate') setOtpProblem(duplicateMessage(outcome, t));
      else if (outcome.kind === 'sent') set({ requestId: outcome.requestId, code: '', sentAt: Date.now(), verifiedAt: null });
      else setOtpProblem(t('otp.noAnswer'));
    } catch (e) {
      setOtpProblem(explain(e));
    } finally {
      setBusy(null);
    }
  }

  async function verifyOtp() {
    if (!form.requestId || form.code.length !== 6) return;
    setOtpProblem(null);
    setBusy('verify');
    try {
      await queue.live(() => registration.verifyOtp(form.requestId!, form.code));
      set({ verifiedAt: new Date().toISOString() });
    } catch (e) {
      setOtpProblem(explain(e));
    } finally {
      setBusy(null);
    }
  }

  const save = useMutation({
    mutationFn: () => queue.live(() => redesign.createReferral(referralBody(form))),
    onSuccess: (r) => {
      clearForm();
      void client.invalidateQueries({ queryKey: ['field-work'] });
      router.replace(`${pageRoutes.referralSaved(r.id)}?new=1`);
    },
  });
  const existing = save.error && isApiError(save.error) ? (save.error.body as { existingReferralCode?: string } | undefined)?.existingReferralCode : undefined;

  function submit() {
    setShowErrors(true);
    if (errors.length) return;
    save.mutate();
  }

  const choice = <V extends string>(values: readonly V[], prefix: string) => values.map((v) => ({ value: v, label: t(`${prefix}.${v}` as MessageKey) }));
  const canResend = !form.sentAt || now - form.sentAt > 30_000;

  return (
    <View style={styles.flex} testID="screen-FA23">
      <AppHeader title={t('fa23.title')} />
      <Screen>
        <View style={styles.titleRow}>
          <Text variant="h1" style={styles.flex1}>{t('fa23.heading')}</Text>
          <Emoji symbol="🤝" size={28} />
        </View>
        <Text variant="muted">{t('fa23.intro')}</Text>

        <Card stripe accent="royal" style={styles.card}>
          <TextField label={t('fa23.name')} value={form.name} onChangeText={(v) => set({ name: v })} error={err('name')} testID="fa23-name" />
          <MobileField
            label={t('fa07.mobile')}
            value={form.mobile}
            editable={!form.verifiedAt}
            onChange={(v) => set({ mobile: v, requestId: null, code: '', verifiedAt: null, sentAt: null })}
            error={err('mobile')}
            testID="fa23-mobile"
          />
          {form.verifiedAt ? (
            <View style={styles.inline}>
              <StatusChip tone="green" label={t('fa07.verified')} />
              <Text variant="muted" style={styles.flex1}>{t('fa07.checkedAt', { time: formatTimeIst(form.verifiedAt) })}</Text>
              <Button label={t('fa07.changeNumber')} variant="secondary" onPress={() => set({ mobile: '', requestId: null, code: '', verifiedAt: null, sentAt: null })} />
            </View>
          ) : form.requestId ? (
            <>
              <CodeInput value={form.code} onChange={(code) => set({ code })} label={t('fa07.otpCode')} testID="fa23-code" />
              <View style={styles.inline}>
                <Button label={t('fa07.verify')} style={styles.flex1} loading={busy === 'verify'} disabled={form.code.length !== 6} onPress={() => void verifyOtp()} testID="fa23-verify" />
                <Button label={t('fa07.resend')} variant="secondary" style={styles.flex1} disabled={!canResend} onPress={() => void sendOtp()} />
              </View>
            </>
          ) : (
            <Button label={t('fa07.sendOtp')} variant="secondary" loading={busy === 'send'} onPress={() => void sendOtp()} testID="fa23-send" />
          )}
          {otpProblem ? <Banner tone="error" message={otpProblem} testID="fa23-otp-problem" /> : null}
          <Checkbox label={t('fa07.whatsappSame')} checked={form.whatsappSame} onChange={(v) => set({ whatsappSame: v })} testID="fa23-whatsapp-same" />
          {!form.whatsappSame ? (
            <MobileField label={t('fa07.whatsapp')} value={form.whatsapp} onChange={(v) => set({ whatsapp: v })} error={err('whatsapp') ? t('fa07.mobileInvalid') : null} testID="fa23-whatsapp" />
          ) : null}
        </Card>

        <Card stripe accent="cyan" style={styles.card}>
          <Text variant="label">{t('fa23.partnerIs')}</Text>
          <Segmented
            value={form.type}
            options={[
              { value: 'individual', label: t('fa23.type.individual') },
              { value: 'business', label: t('fa23.type.business') },
            ]}
            onChange={(v) => set({ type: v })}
            testID="fa23-type"
          />
          {form.type === 'individual' ? (
            <SelectField label={t('fa23.whatTheyDo')} value={form.individualRole} choices={choice(INDIVIDUAL_ROLES, 'fa23.role')} onChange={(v) => set({ individualRole: v })} error={err('individualRole')} testID="fa23-role" />
          ) : (
            <>
              <TextField label={t('fa23.businessName')} value={form.partnerBusinessName} onChangeText={(v) => set({ partnerBusinessName: v })} error={err('business')} testID="fa23-business-name" />
              <SelectField label={t('fa07.businessType')} value={form.partnerBusinessType} choices={PARTNER_TYPE_CHOICES} onChange={(v) => set({ partnerBusinessType: v })} error={err('business')} testID="fa23-business-type" />
            </>
          )}
        </Card>

        <Card stripe accent="gold" style={styles.card}>
          <SelectField
            label={t('fa07.area')}
            value={form.area}
            choices={(options.data?.areas ?? []).map((a) => ({ value: a.name, label: a.name }))}
            onChange={(v) => {
              const area = options.data?.areas.find((a) => a.name === v);
              set({ area: v, pincode: form.pincode || area?.pincode || '' });
            }}
            error={err('area')}
            testID="fa23-area"
          />
          <TextField label={t('fa07.pincode')} value={form.pincode} keyboardType="number-pad" maxLength={6} onChangeText={(v) => set({ pincode: v.replace(/\D/g, '') })} error={err('pincode') ? t('fa07.pincodeInvalid') : null} testID="fa23-pincode" />
          <SelectField label={t('fa07.heardFrom')} value={form.heardFrom} choices={choice(HEARD_FROM, 'heard')} onChange={(v) => set({ heardFrom: v })} error={err('heardFrom')} testID="fa23-heard" />
        </Card>

        <Card title={t('fa23.readAloud')} icon="chat" accent="green" testID="fa23-script">
          {inShort.data ? (
            <Script>{inShortText(inShort.data)}</Script>
          ) : inShort.isError ? (
            <Button label={t('common.retry')} variant="secondary" onPress={() => void inShort.refetch()} />
          ) : (
            <LoadingState compact />
          )}
          <Text variant="muted">{t('fa23.linkNote')}</Text>
        </Card>

        {existing ? <Banner tone="warn" message={t('otp.alreadyRegistered.referral', { code: existing })} testID="fa23-existing" /> : save.error ? <Banner tone="error" message={explain(save.error)} testID="fa23-error" /> : null}
        {showErrors && errors.length ? <Banner tone="error" message={t('fa07.fixErrors')} testID="fa23-fix" /> : null}
        <Button label={t('fa23.save')} loading={save.isPending} disabled={!form.verifiedAt} onPress={submit} testID="fa23-save" />
        {!form.verifiedAt ? <Text variant="muted">{t('fa23.saveLocked')}</Text> : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  card: { gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
