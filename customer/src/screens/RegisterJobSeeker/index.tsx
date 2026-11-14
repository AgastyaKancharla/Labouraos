import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import type { RegisterResult } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader, Banner, Button, Card, ErrorState, LoadingState, Screen, Text, TextField } from '@/components';
import { ChipPicker, DateField, MoneyField, NumberField, PinField, RadioGroup, Segmented, SelectField, addDays, todayKeyIst, type Choice } from '@/components/form';
import { useI18n } from '@/i18n';
import { colors } from '@/theme';
import { clearDraft, useDraft } from '@/lib/drafts';
import { rupees } from '@/lib/money';
import { SavedNextSteps } from '../shared/SavedNextSteps';
import { heardFromChoices, messageLanguageChoices, shiftChoices, spokenLanguageChoices } from '../shared/choices';
import { MAX_TRADES, OTHER_TRADE, checkAge, emptyJobSeeker, salaryHint, toJobSeekerForm, validateJobSeeker, type JobSeekerErrors } from './form';

/**
 * Job seeker registration, native (proposal 2.1, steps 3 and 4): date of
 * birth first — under 18 stops here — then the same fields as the agent's
 * form, saved on the phone as they type. After saving, consent, selfie, ID
 * check and the ₹499 payment open in the secure sheet (SavedNextSteps).
 */
export default function RegisterJobSeeker() {
  const { t, language } = useI18n();
  const api = useCustomerApi();
  const { refreshAccount, setActiveProfileId } = useAuth();
  const [draft, setDraft, ready] = useDraft('job_seeker', emptyJobSeeker(language));
  const [ageProblem, setAgeProblem] = useState<'missing' | 'under18' | null>(null);
  const [errors, setErrors] = useState<JobSeekerErrors>({});
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [saved, setSaved] = useState<RegisterResult | null>(null);
  const options = useQuery({ queryKey: queryKeys.formOptions, queryFn: () => api.formOptions(), staleTime: 60 * 60_000 });
  const today = todayKeyIst();
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const err = (key: string) => (errors[key] ? t(errors[key]!) : null);

  const header = <AppHeader title={t('jobSeeker.title')} onBack={() => router.back()} />;

  if (saved) {
    return (
      <View style={styles.flex}>
        {header}
        <Screen>
          <SavedNextSteps result={saved} purpose="registration" nextSteps={t('jobSeeker.nextSteps')} testID="js-saved" />
        </Screen>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.flex}>
        {header}
        <LoadingState />
      </View>
    );
  }

  // ---- Step 1: age, before anything else
  if (!draft.ageConfirmed) {
    return (
      <View style={styles.flex} testID="js-age">
        {header}
        <Screen>
          <Card title={t('jobSeeker.stepAge')}>
            <View style={styles.gap}>
              <DateField
                label={t('jobSeeker.dob')}
                value={draft.dateOfBirth}
                onChange={(v) => {
                  set('dateOfBirth', v);
                  setAgeProblem(null);
                }}
                yearFirst
                max={today}
                min="1946-01-01"
                required
                testID="js-dob"
              />
              {ageProblem === 'under18' ? (
                <Banner tone="warn" title={t('jobSeeker.under18Title')} message={t('jobSeeker.under18')} testID="js-under18" />
              ) : null}
              {ageProblem === 'missing' ? <Banner tone="error" message={t('jobSeeker.dobMissing')} /> : null}
              <Button
                label={t('common.continue')}
                disabled={ageProblem === 'under18'}
                onPress={() => {
                  const check = checkAge(draft.dateOfBirth, today);
                  if (check === 'ok') set('ageConfirmed', true);
                  else {
                    setAgeProblem(check);
                    // Nothing about a minor is kept on the phone.
                    if (check === 'under18') setDraft(emptyJobSeeker(language));
                  }
                }}
                testID="js-age-continue"
              />
            </View>
          </Card>
        </Screen>
      </View>
    );
  }

  if (options.isLoading) {
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

  const { areas, trades } = options.data;
  const tradeChoices: Choice[] = [...trades.map((tr) => ({ value: tr.name, label: tr.name })), { value: OTHER_TRADE, label: t('form.otherTrade') }];
  const areaChoices: Choice[] = areas.map((a) => ({ value: a.name, label: a.name }));
  const firstTrade = trades.find((tr) => tr.name === draft.trades[0]?.trade);
  const hint = salaryHint(firstTrade, draft);

  const submit = async () => {
    const found = validateJobSeeker(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSendError(null);
    try {
      const result = await api.registerJobSeeker(toJobSeekerForm(draft));
      await clearDraft('job_seeker');
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
    <View style={styles.flex} testID="js-form">
      {header}
      <Screen>
        <Text variant="muted">{t('form.autosaved')}</Text>

        <Card title={t('jobSeeker.sectionYou')}>
          <View style={styles.gap}>
            <TextField label={t('jobSeeker.fullName')} value={draft.fullName} onChangeText={(v) => set('fullName', v)} error={err('fullName')} autoComplete="name" testID="js-name" />
            <RadioGroup
              label={t('jobSeeker.gender')}
              value={draft.gender || null}
              onChange={(v) => set('gender', v)}
              options={(['male', 'female', 'other'] as const).map((v) => ({ value: v, label: t(`gender.${v}`) }))}
              testID="js-gender"
            />
            {errors.gender ? <Text variant="small" style={styles.errorText} testID="js-gender-error">{t(errors.gender)}</Text> : null}
            <Text variant="muted">{t('jobSeeker.genderWhy')}</Text>
            <SelectField label={t('jobSeeker.messageLanguage')} value={draft.messageLanguage} choices={messageLanguageChoices(t)} onChange={(v) => set('messageLanguage', v)} required testID="js-msg-lang" />
            <SelectField
              label={t('jobSeeker.bestTime')}
              value={draft.bestTimeToCall}
              choices={(['morning', 'afternoon', 'evening', 'any'] as const).map((v) => ({ value: v, label: t(`bestTime.${v}`) }))}
              onChange={(v) => set('bestTimeToCall', v)}
              required
              error={err('bestTimeToCall')}
              testID="js-best-time"
            />
            <ChipPicker
              label={t('jobSeeker.languagesSpoken')}
              values={draft.languagesSpoken}
              choices={spokenLanguageChoices(t)}
              onChange={(v) => set('languagesSpoken', v)}
              addLabel={t('form.addChip')}
              required
              error={err('languagesSpoken')}
              testID="js-languages"
            />
          </View>
        </Card>

        <Card title={t('jobSeeker.sectionWhere')}>
          <View style={styles.gap}>
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
              testID="js-area"
            />
            <TextField
              label={t('form.pincode')}
              value={draft.pincode}
              onChangeText={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              error={err('pincode')}
              testID="js-pincode"
            />
            <PinField label={t('jobSeeker.homePin')} value={draft.pin} onChange={(v) => set('pin', v)} testID="js-pin" />
            <SelectField
              label={t('jobSeeker.travel')}
              value={draft.travelKm === null ? '' : String(draft.travelKm)}
              choices={['2', '5', '10', '15', '20', '30'].map((km) => ({ value: km, label: t('jobSeeker.km', { km }) }))}
              onChange={(v) => set('travelKm', Number(v))}
              required
              error={err('travelKm')}
              testID="js-travel"
            />
          </View>
        </Card>

        <Card title={t('jobSeeker.sectionWork')}>
          <View style={styles.gap}>
            {draft.trades.map((row, i) => (
              <View key={i} style={styles.tradeRow}>
                <SelectField
                  label={i === 0 ? t('jobSeeker.trade') : t('jobSeeker.moreTrade')}
                  value={row.trade}
                  choices={tradeChoices}
                  onChange={(v) => setDraft((d) => ({ ...d, trades: d.trades.map((r, j) => (j === i ? { ...r, trade: v } : r)) }))}
                  required
                  error={err(`trade${i}`)}
                  testID={`js-trade-${i}`}
                />
                {row.trade === OTHER_TRADE ? (
                  <TextField
                    label={t('form.otherTradeName')}
                    value={row.otherName}
                    onChangeText={(v) => setDraft((d) => ({ ...d, trades: d.trades.map((r, j) => (j === i ? { ...r, otherName: v } : r)) }))}
                    error={err(`tradeOther${i}`)}
                    testID={`js-trade-other-${i}`}
                  />
                ) : null}
                <NumberField
                  label={t('jobSeeker.years')}
                  value={row.years}
                  onChange={(v) => setDraft((d) => ({ ...d, trades: d.trades.map((r, j) => (j === i ? { ...r, years: v } : r)) }))}
                  required
                  max={60}
                  error={err(`years${i}`)}
                  testID={`js-years-${i}`}
                />
                {i > 0 ? (
                  <Button
                    label={t('form.remove')}
                    variant="danger"
                    onPress={() => setDraft((d) => ({ ...d, trades: d.trades.filter((_, j) => j !== i) }))}
                    testID={`js-trade-remove-${i}`}
                  />
                ) : null}
              </View>
            ))}
            {draft.trades.length < MAX_TRADES ? (
              <Button
                label={t('jobSeeker.addTrade')}
                variant="secondary"
                onPress={() => setDraft((d) => ({ ...d, trades: [...d.trades, { trade: '', otherName: '', years: null }] }))}
                testID="js-trade-add"
              />
            ) : null}
            <DateField
              label={t('jobSeeker.availableFrom')}
              value={draft.availableFrom}
              onChange={(v) => set('availableFrom', v)}
              min={today}
              max={addDays(today, 180)}
              required
              error={err('availableFrom')}
              testID="js-available"
            />
            <SelectField
              label={t('jobSeeker.lookingFor')}
              value={draft.lookingFor}
              choices={(['just_started', 'under_1_month', '1_3_months', 'over_3_months'] as const).map((v) => ({ value: v, label: t(`looking.${v}`) }))}
              onChange={(v) => set('lookingFor', v)}
              required
              error={err('lookingFor')}
              testID="js-looking"
            />
            <SelectField label={t('form.shift')} value={draft.shift} choices={shiftChoices(t)} onChange={(v) => set('shift', v)} required error={err('shift')} testID="js-shift" />
            <SelectField
              label={t('jobSeeker.jobType')}
              value={draft.jobType}
              choices={(['full_time', 'part_time', 'any'] as const).map((v) => ({ value: v, label: t(`jobType.${v}`) }))}
              onChange={(v) => set('jobType', v)}
              required
              error={err('jobType')}
              testID="js-job-type"
            />
          </View>
        </Card>

        <Card title={t('jobSeeker.sectionPay')}>
          <View style={styles.gap}>
            <Segmented
              value={draft.salaryPeriod}
              options={[
                { value: 'monthly', label: t('form.perMonth') },
                { value: 'daily', label: t('form.perDay') },
              ]}
              onChange={(v) => set('salaryPeriod', v)}
              testID="js-period"
            />
            <MoneyField label={t('jobSeeker.salaryMin')} valuePaise={draft.salaryMinPaise} onChange={(v) => set('salaryMinPaise', v)} required error={err('salaryMin')} testID="js-salary-min" />
            <MoneyField label={t('jobSeeker.salaryMax')} valuePaise={draft.salaryMaxPaise} onChange={(v) => set('salaryMaxPaise', v)} required error={err('salaryMax')} testID="js-salary-max" />
            {hint ? (
              <Text variant="muted" testID="js-salary-hint">
                {t('jobSeeker.marketRange', { trade: firstTrade?.name ?? '', min: rupees(hint.minPaise), max: rupees(hint.maxPaise) })}
              </Text>
            ) : null}
            {hint?.aboveRange ? (
              <Banner tone="warn" message={t('jobSeeker.aboveRange', { max: rupees(hint.maxPaise) })} testID="js-salary-warning" />
            ) : null}
          </View>
        </Card>

        <Card title={t('jobSeeker.sectionLast')}>
          <SelectField label={t('form.heardFrom')} value={draft.heardFrom} choices={heardFromChoices(t)} onChange={(v) => set('heardFrom', v)} required testID="js-heard" />
        </Card>

        {Object.keys(errors).length > 0 ? <Banner tone="error" message={t('form.fixMarked')} testID="js-errors" /> : null}
        {sendError ? <Banner tone="error" message={sendError} testID="js-send-error" /> : null}
        <Button label={t('jobSeeker.save')} onPress={() => void submit()} loading={busy} testID="js-submit" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 14 },
  tradeRow: { gap: 10, paddingBottom: 6 },
  errorText: { color: colors.tomato },
});
