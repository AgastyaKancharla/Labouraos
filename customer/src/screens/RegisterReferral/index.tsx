import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import type { RegisterResult } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, ErrorState, LoadingState, Screen, Text, TextField } from '@/components';
import { PinField, RadioGroup, SelectField, type Choice } from '@/components/form';
import { useI18n } from '@/i18n';
import { colors } from '@/theme';
import { clearDraft, useDraft } from '@/lib/drafts';
import { rupees } from '@/lib/money';
import { SavedNextSteps } from '../shared/SavedNextSteps';
import { businessTypeChoices, messageLanguageChoices } from '../shared/choices';
import { emptyReferral, toReferralForm, validateReferral, type ReferralErrors } from './form';

const REWARD_PAISE = 20_000;

/**
 * Referral partner registration, native (proposal 2.3): individual or
 * business, area, language. Then terms and call-recording consent, selfie,
 * ID check and UPI (checked against the name on the ID) in the secure sheet.
 * ₹200 is earned when a referred job seeker JOINS a job, never for
 * referring yourself.
 */
export default function RegisterReferral() {
  const { t, language } = useI18n();
  const api = useCustomerApi();
  const { account, refreshAccount, setActiveProfileId } = useAuth();
  const [draft, setDraft, ready] = useDraft('referral_partner', emptyReferral(language, account?.name ?? ''));
  const [errors, setErrors] = useState<ReferralErrors>({});
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [saved, setSaved] = useState<RegisterResult | null>(null);
  const options = useQuery({ queryKey: queryKeys.formOptions, queryFn: () => api.formOptions(), staleTime: 60 * 60_000 });
  // Start the name from the Google / Apple account name, once it is known.
  const accountName = account?.name ?? '';
  useEffect(() => {
    if (ready && accountName) setDraft((d) => (d.name ? d : { ...d, name: accountName }));
  }, [ready, accountName, setDraft]);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const err = (key: keyof typeof draft) => (errors[key] ? t(errors[key]!) : null);
  const header = <AppHeader title={t('referral.title')} onBack={() => router.back()} />;

  if (saved) {
    return (
      <View style={styles.flex}>
        {header}
        <Screen>
          <SavedNextSteps result={saved} purpose="registration" nextSteps={t('referral.nextSteps')} testID="ref-saved" />
        </Screen>
      </View>
    );
  }
  if (!ready || options.isLoading) {
    return (
      <View style={styles.flex}>
        {header}
        <LoadingState />
      </View>
    );
  }
  if (options.isError || !options.data) {
    return (
      <View style={styles.flex}>
        {header}
        <ErrorState error={options.error} onRetry={() => void options.refetch()} />
      </View>
    );
  }
  const areas = options.data.areas;
  const areaChoices: Choice[] = areas.map((a) => ({ value: a.name, label: a.name }));

  const submit = async () => {
    const found = validateReferral(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSendError(null);
    try {
      const result = await api.registerReferralPartner(toReferralForm(draft));
      await clearDraft('referral_partner');
      setActiveProfileId(result.profile.id);
      await refreshAccount();
      setSaved(result);
    } catch (e) {
      setSendError(isApiError(e) ? (e.isNetworkError ? t('common.networkError') : e.message) : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex} testID="ref-form">
      {header}
      <Screen>
        <Banner tone="info" message={t('referral.howItWorks', { amount: rupees(REWARD_PAISE) })} />
        <Card>
          <View style={styles.gap}>
            <TextField label={t('referral.name')} value={draft.name} onChangeText={(v) => set('name', v)} error={err('name')} testID="ref-name" />
            <RadioGroup
              label={t('referral.type')}
              value={draft.partnerType || null}
              onChange={(v) => set('partnerType', v)}
              options={[
                { value: 'individual', label: t('referral.individual') },
                { value: 'business', label: t('referral.business') },
              ]}
              testID="ref-type"
            />
            {errors.partnerType ? <Text variant="small" style={styles.errorText} testID="ref-type-error">{t(errors.partnerType)}</Text> : null}
            {draft.partnerType === 'individual' ? (
              <SelectField
                label={t('referral.whatYouDo')}
                value={draft.individualKind}
                choices={(['auto_driver', 'shop_staff', 'security_guard', 'existing_worker', 'other'] as const).map((v) => ({ value: v, label: t(`refKind.${v}`) }))}
                onChange={(v) => set('individualKind', v)}
                required
                error={err('individualKind')}
                testID="ref-kind"
              />
            ) : null}
            {draft.partnerType === 'business' ? (
              <>
                <SelectField label={t('business.type')} value={draft.businessType} choices={businessTypeChoices(t)} onChange={(v) => set('businessType', v)} required error={err('businessType')} testID="ref-biz-type" />
                <TextField label={t('business.boardName')} value={draft.businessName} onChangeText={(v) => set('businessName', v)} error={err('businessName')} testID="ref-biz-name" />
              </>
            ) : null}
            <SelectField
              label={t('form.area')}
              value={draft.area}
              choices={areaChoices}
              onChange={(v) => {
                const area = areas.find((a) => a.name === v);
                setDraft((d) => ({ ...d, area: v, pincode: d.pincode || area?.pincode || '' }));
              }}
              required
              error={err('area')}
              testID="ref-area"
            />
            <TextField label={t('form.pincode')} value={draft.pincode} onChangeText={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" error={err('pincode')} testID="ref-pincode" />
            <PinField label={t('referral.pin')} value={draft.pin} onChange={(v) => set('pin', v)} testID="ref-pin" />
            <SelectField label={t('jobSeeker.messageLanguage')} value={draft.messageLanguage} choices={messageLanguageChoices(t)} onChange={(v) => set('messageLanguage', v)} required testID="ref-msg-lang" />
          </View>
        </Card>
        {Object.keys(errors).length > 0 ? <Banner tone="error" message={t('form.fixMarked')} testID="ref-errors" /> : null}
        {sendError ? <Banner tone="error" message={sendError} /> : null}
        <Button label={t('referral.save')} onPress={() => void submit()} loading={busy} testID="ref-submit" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 14 },
  errorText: { color: colors.tomato },
});
