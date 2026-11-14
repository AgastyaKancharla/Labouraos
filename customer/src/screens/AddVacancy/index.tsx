import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { errorText } from '@/api/errorText';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import type { OtpProof, VacancySummary } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, ErrorState, LoadingState, Screen, Text, TextField } from '@/components';
import { Checkbox, DateField, MoneyField, NumberField, Segmented, SelectField, addDays, todayKeyIst, type Choice } from '@/components/form';
import { useI18n } from '@/i18n';
import { colors } from '@/theme';
import { clearDraft, useDraft } from '@/lib/drafts';
import { rupees } from '@/lib/money';
import { routes } from '@/navigation/routes';
import { OtpCodeCard } from '../shared/OtpCodeCard';
import { shiftChoices } from '../shared/choices';
import { belowLegalMinimum, emptyVacancy, toVacancyDraft, validateVacancy, type VacancyErrors } from './form';

type Step = 'form' | 'otp' | 'done';

/**
 * Add a vacancy (proposal 2.2, C8): saved as a DRAFT, then confirmed by the
 * contact person's fresh OTP — the same proof as an agent's vacancy. Below
 * the legal minimum wage is allowed but warned, with a tick. No age or
 * gender requirements in the app form (only where legally allowed and
 * genuinely needed, which an agent handles). Candidates are shown only after
 * the verification visit and approval.
 *
 * `?vacancyId=` opens the OTP step for a draft that already exists (the
 * staff-needed rows from registration).
 */
export default function AddVacancy() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const queryClient = useQueryClient();
  const { activeProfile, account } = useAuth();
  const params = useLocalSearchParams<{ vacancyId?: string }>();
  const [form, setForm, ready] = useDraft('vacancy', emptyVacancy());
  const [step, setStep] = useState<Step>(params.vacancyId ? 'otp' : 'form');
  const [vacancyId, setVacancyId] = useState<string | null>(params.vacancyId ?? null);
  const [confirmed, setConfirmed] = useState<VacancySummary | null>(null);
  const [errors, setErrors] = useState<VacancyErrors>({});
  const [ownerTold, setOwnerTold] = useState(false);
  /** 409 BELOW_MINIMUM_WAGE_TICK_REQUIRED on confirm: the legal minimum to show with the tick. */
  const [tickFor, setTickFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options = useQuery({ queryKey: queryKeys.formOptions, queryFn: () => api.formOptions(), staleTime: 60 * 60_000 });
  const today = todayKeyIst();
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const err = (key: keyof typeof form) => (errors[key] ? t(errors[key]!) : null);
  const failure = (e: unknown) => setProblem(errorText(t, e));
  const header = <AppHeader title={t('vacancy.title')} onBack={() => router.back()} />;
  const profileId = activeProfile?.kind === 'business' ? activeProfile.id : null;

  if (!profileId) {
    return (
      <View style={styles.flex}>
        {header}
        <Screen>
          <Banner tone="warn" message={t('vacancy.needBusiness')} />
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

  const trades = options.data.trades;
  const trade = trades.find((tr) => tr.name === form.trade);
  const tradeChoices: Choice[] = trades.map((tr) => ({ value: tr.name, label: tr.name }));
  const below = belowLegalMinimum(trade, form);

  const saveDraft = async () => {
    const found = validateVacancy(form, trade);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const vacancy = await api.createVacancy(profileId, toVacancyDraft(form));
      await clearDraft('vacancy');
      setVacancyId(vacancy.id);
      setOwnerTold(form.legalMinimumAcknowledged);
      setStep('otp');
      await queryClient.invalidateQueries({ queryKey: queryKeys.home(profileId) });
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  };

  /** Confirm the draft. `otp` null = retry after the tick, with the OTP already checked. */
  const confirm = async (otp: OtpProof | null, told: boolean) => {
    if (!vacancyId) return;
    try {
      setConfirmed(await api.confirmVacancy(profileId, vacancyId, { otp, ownerToldMinimumWage: told }));
      setStep('done');
      await queryClient.invalidateQueries({ queryKey: queryKeys.home(profileId) });
    } catch (e) {
      if (isApiError(e) && e.code === 'BELOW_MINIMUM_WAGE_TICK_REQUIRED') {
        setTickFor(e.field<number>('legalMinimumPaise') ?? 0);
        return;
      }
      if (isApiError(e) && e.code === 'STEP_UP_REQUIRED') {
        // The checked code was used up: ask for a new one.
        setTickFor(null);
        setProblem(errorText(t, e));
        return;
      }
      throw e;
    }
  };

  if (step === 'done') {
    return (
      <View style={styles.flex} testID="vacancy-done">
        {header}
        <Screen>
          <Banner tone="ok" title={t('vacancy.confirmedTitle')} message={confirmed?.code ? t('vacancy.confirmedCode', { code: confirmed.code }) : undefined} />
          {confirmed?.status !== 'open' ? <Banner tone="info" message={t('vacancy.waitingForVisit')} testID="vacancy-waiting-visit" /> : null}
          <Button label={t('vacancy.backHome')} onPress={() => router.replace(routes.home)} testID="vacancy-home" />
        </Screen>
      </View>
    );
  }

  if (step === 'otp') {
    return (
      <View style={styles.flex} testID="vacancy-otp">
        {header}
        <Screen>
          <Banner tone="info" title={t('vacancy.draftSaved')} message={t('vacancy.otpWhy')} />
          {tickFor !== null ? (
            <Card testID="vacancy-tick-needed">
              <View style={styles.gap}>
                <Banner tone="warn" title={t('vacancy.belowMinimumTitle')} message={t('vacancy.belowMinimum', { amount: rupees(tickFor) })} />
                <Checkbox label={t('vacancy.legalMinimumTick')} checked={ownerTold} onChange={setOwnerTold} testID="vacancy-otp-tick" />
                <Button
                  label={t('vacancy.confirm')}
                  disabled={!ownerTold || busy}
                  loading={busy}
                  onPress={async () => {
                    setBusy(true);
                    setProblem(null);
                    try {
                      await confirm(null, true);
                    } catch (e) {
                      failure(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  testID="vacancy-confirm-after-tick"
                />
              </View>
            </Card>
          ) : (
            <Card>
              <OtpCodeCard
                testID="vacancy-otp-card"
                send={(resendOf) => api.sendStepUp('confirm_vacancy', resendOf)}
                submit={(otp) => confirm(otp, ownerTold)}
                sendLabel={t('vacancy.sendOtp', { last4: account?.phoneLast4 ?? '' })}
                submitLabel={t('vacancy.confirm')}
                sentText={t('otp.sentTo', { last4: account?.phoneLast4 ?? '' })}
              />
            </Card>
          )}
          {problem ? <Banner tone="error" message={problem} testID="vacancy-problem" /> : null}
          <Button label={t('vacancy.later')} variant="secondary" onPress={() => router.replace(routes.home)} testID="vacancy-later" />
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.flex} testID="vacancy-form">
      {header}
      <Screen>
        <Text variant="muted">{t('form.autosaved')}</Text>
        <Card>
          <View style={styles.gap}>
            <SelectField label={t('vacancy.trade')} value={form.trade} choices={tradeChoices} onChange={(v) => set('trade', v)} required error={err('trade')} testID="vacancy-trade" />
            <TextField label={t('vacancy.roleTitle')} value={form.roleTitle} onChangeText={(v) => set('roleTitle', v)} testID="vacancy-role" />
            <NumberField label={t('vacancy.openings')} value={form.openings} onChange={(v) => set('openings', v)} required max={99} error={err('openings')} testID="vacancy-openings" />
            <Segmented
              value={form.salaryPeriod}
              options={[
                { value: 'monthly', label: t('form.perMonth') },
                { value: 'daily', label: t('form.perDay') },
              ]}
              onChange={(v) => set('salaryPeriod', v)}
              testID="vacancy-period"
            />
            <MoneyField label={t('vacancy.salaryMin')} valuePaise={form.salaryMinPaise} onChange={(v) => set('salaryMinPaise', v)} required error={err('salaryMinPaise')} testID="vacancy-salary-min" />
            <MoneyField label={t('vacancy.salaryMax')} valuePaise={form.salaryMaxPaise} onChange={(v) => set('salaryMaxPaise', v)} error={err('salaryMaxPaise')} testID="vacancy-salary-max" />
            {trade ? (
              <Text variant="muted" testID="vacancy-range">
                {t('vacancy.marketRange', { min: rupees(trade.salaryMinPaise), max: rupees(trade.salaryMaxPaise) })}
              </Text>
            ) : null}
            {below && trade ? (
              <View style={styles.gap} testID="vacancy-min-wage">
                <Banner tone="warn" title={t('vacancy.belowMinimumTitle')} message={t('vacancy.belowMinimum', { amount: rupees(trade.legalMinimumPaise) })} />
                <Checkbox label={t('vacancy.legalMinimumTick')} checked={form.legalMinimumAcknowledged} onChange={(v) => set('legalMinimumAcknowledged', v)} testID="vacancy-min-wage-tick" />
                {errors.legalMinimumAcknowledged ? (
                  <Text variant="small" style={styles.errorText} testID="vacancy-min-wage-error">
                    {t(errors.legalMinimumAcknowledged)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <SelectField label={t('form.shift')} value={form.shift} choices={shiftChoices(t)} onChange={(v) => set('shift', v)} required error={err('shift')} testID="vacancy-shift" />
            <DateField label={t('vacancy.startDate')} value={form.startDate} onChange={(v) => set('startDate', v)} min={today} max={addDays(today, 180)} required error={err('startDate')} testID="vacancy-start" />
            <TextField label={t('vacancy.description')} value={form.description} onChangeText={(v) => set('description', v)} multiline numberOfLines={3} testID="vacancy-description" />
          </View>
        </Card>
        <Text variant="muted">{t('vacancy.employerNote')}</Text>
        {Object.keys(errors).length > 0 ? <Banner tone="error" message={t('form.fixMarked')} testID="vacancy-errors" /> : null}
        {problem ? <Banner tone="error" message={problem} /> : null}
        <Button label={t('vacancy.saveDraft')} onPress={() => void saveDraft()} loading={busy} testID="vacancy-save" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 14 },
  errorText: { color: colors.tomato },
});
