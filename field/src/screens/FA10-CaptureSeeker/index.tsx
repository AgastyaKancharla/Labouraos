import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { Banner, Button, Card, Screen, Text, TextField } from '@/components';
import { addDays, Checkbox, ChipPicker, DateField, MobileField, MoneyField, Segmented, SelectField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useLocation } from '@/device/location/useLocation';
import { useI18n, type MessageKey } from '@/i18n';
import { formatTimeIst } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, formatRupees, Script, UserFacingError } from '../_selling';
import { OtpStep } from '../_selling/OtpStep';
import { JOB_SEEKER_CONSENT_SCRIPT, SCRIPT_LANGUAGES, type ScriptLanguage } from '../_selling/scripts';
import {
  BEST_TIME, createBody, EMPTY_FORM, GENDERS, HEARD_FROM, JOB_TYPES, LICENCES, MESSAGE_LANGUAGES, OTHER_TRADE, profileBody,
  QUALIFICATIONS, SHIFT_PREFERENCES, SPOKEN_LANGUAGES, tradeName, TRAVEL_KM, validate, YEARS, type FieldError, type JobSeekerForm,
} from './payload';

const MAX_TRADES = 3;
const ERROR_KEYS: Record<FieldError, MessageKey> = {
  name: 'fa10.err.required',
  dateOfBirth: 'fa10.err.dob',
  gender: 'fa10.err.required',
  messageLanguage: 'fa10.err.required',
  bestTime: 'fa10.err.required',
  heardFrom: 'fa10.err.required',
  area: 'fa10.err.required',
  pincode: 'fa10.err.pincode',
  pin: 'fa10.err.pin',
  travelKm: 'fa10.err.required',
  trade: 'fa10.err.required',
  years: 'fa10.err.required',
  duplicateTrade: 'fa10.err.duplicateTrade',
  lookingSince: 'fa10.err.required',
  minSalary: 'fa10.err.required',
  maxSalary: 'fa10.err.required',
  salaryOrder: 'fa10.err.salaryOrder',
  availableFrom: 'fa10.err.required',
  shift: 'fa10.err.required',
  jobType: 'fa10.err.required',
  spoken: 'fa10.err.required',
  whatsapp: 'fa10.err.mobile',
};

/** The draft lives in memory while the app is open (a dropped call loses nothing; nothing stays on the phone). */
let draft: JobSeekerForm | null = null;
export function clearSeekerDraft() {
  draft = null;
}

/**
 * FA10 — Register a job seeker: exactly the call agent's form and rules
 * (CA08), on a phone, using the same endpoints (POST /otp/send with purpose
 * job_seeker, POST /job-seekers, PATCH /job-seekers/:id/profile). The mobile
 * is checked by OTP first; the consent is explained aloud in the person's
 * language — she gives it herself on the link. Needs signal to save (the OTP
 * has just been checked).
 */
export default function CaptureSeekerScreen() {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const location = useLocation();
  const options = useQuery({ queryKey: queryKeys.formOptions, queryFn: () => selling.formOptions(), staleTime: 60 * 60_000 });
  const trades = useQuery({ queryKey: queryKeys.trades, queryFn: () => selling.trades(), staleTime: 10 * 60_000 });
  const [form, setForm] = useState<JobSeekerForm>(() => draft ?? EMPTY_FORM);
  const [verified, setVerified] = useState<{ requestId: string; at: number; mobile: string } | null>(null);
  const [duplicate, setDuplicate] = useState<{ code?: string } | null>(null);
  const [tried, setTried] = useState(false);
  const [scriptLang, setScriptLang] = useState<ScriptLanguage>('kn');
  useEffect(() => {
    draft = form;
  }, [form]);
  const set = <K extends keyof JobSeekerForm>(key: K, value: JobSeekerForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const errors = validate(form);
  const err = (key: FieldError) => (tried && errors.includes(key) ? t(ERROR_KEYS[key]) : null);
  const mobileOk = /^[6-9]\d{9}$/.test(form.mobile);
  const isVerified = verified !== null && verified.mobile === form.mobile;

  const today = todayKeyIst();
  const adultMax = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
  const firstTrade = trades.data?.find((tr) => tr.name === tradeName(form.trades[0] ?? { trade: '', other: '', years: '' }));
  const aboveMarket = !!firstTrade && form.period === 'monthly' && form.minSalaryPaise !== null && form.minSalaryPaise > firstTrade.salaryMaxPaise;

  const save = useMutation({
    mutationFn: async () => {
      if (!verified) throw new UserFacingError(t('fa10.verifyFirst'));
      const created = await queue.live(() => selling.createJobSeeker(createBody(form, verified.requestId)));
      const extras = profileBody(form);
      if (extras) await queue.live(() => selling.updateProfile(created.id, extras)).catch(() => undefined);
      return created;
    },
    onSuccess: (created) => {
      clearSeekerDraft();
      router.replace(sellingRoutes.seekerSaved(created.id));
    },
  });

  const submit = () => {
    setTried(true);
    if (errors.length === 0 && isVerified) save.mutate();
  };

  const choice = <V extends string>(values: readonly V[], prefix: string) =>
    values.map((v) => ({ value: v, label: t(`${prefix}.${v}` as MessageKey) }));
  const tradeChoices = [
    ...(trades.data ?? []).map((tr) => ({ value: tr.name, label: tr.name })),
    { value: OTHER_TRADE, label: t('fa17.otherTrade') },
  ];
  const areas = options.data?.areas ?? [];

  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa10.subtitle')} />
      <Screen testID="screen-FA10">
        <View>
          <Text variant="h1">{t('fa10.title')}</Text>
          <Text variant="muted">{t('fa10.sameForm')}</Text>
          <Text variant="tiny" style={styles.top}>{t('fa10.requiredNote')}</Text>
        </View>

        <Section n={1} title={t('fa10.s1')}>
          <TextField label={`${t('fa10.name')} *`} value={form.name} onChangeText={(v) => set('name', v)} error={err('name')} testID="name" />
          <MobileField
            label={t('fa10.mobile')}
            required
            value={form.mobile}
            onChange={(v) => {
              set('mobile', v);
              setDuplicate(null);
            }}
            editable={!isVerified}
            testID="mobile"
            hint={isVerified ? t('fa10.verifiedAt', { time: formatTimeIst(verified!.at) }) : undefined}
          />
          {isVerified ? (
            <Pressable accessibilityRole="button" onPress={() => setVerified(null)} testID="change-number">
              <Text style={styles.link}>{t('fa10.changeNumber')}</Text>
            </Pressable>
          ) : duplicate ? (
            <Banner
              tone="warn"
              title={t('fa10.alreadyTitle')}
              message={duplicate.code ? t('fa10.alreadyBody', { code: duplicate.code }) : t('fa10.alreadyHidden')}
              action={duplicate.code ? <Button label={t('fa10.openIt')} variant="secondary" onPress={() => router.push(sellingRoutes.seekerProgress(duplicate.code!))} /> : undefined}
              testID="already-registered"
            />
          ) : mobileOk ? (
            <OtpStep
              key={form.mobile}
              testID="mobile-otp"
              sendLabel={t('fa10.sendOtp')}
              verifyLabel={t('fa10.verify')}
              intro={() => t('fa10.otpSent', { last4: form.mobile.slice(-4) })}
              send={async (prev) => {
                const r = await selling.sendOtp(form.mobile, prev);
                if ('alreadyRegistered' in r) {
                  setDuplicate({ code: r.code });
                  throw new UserFacingError(t('fa10.alreadyTitle'));
                }
                return { otpRequestId: r.requestId, sentToLast4: form.mobile.slice(-4), contactName: null };
              }}
              verify={async (requestId, code) => {
                await selling.verifyOtp(requestId, code);
                setVerified({ requestId, at: Date.now(), mobile: form.mobile });
              }}
            />
          ) : null}
          <Checkbox label={t('fa10.whatsappSame')} checked={form.whatsappSame} onChange={(v) => set('whatsappSame', v)} testID="whatsapp-same" />
          {!form.whatsappSame ? (
            <MobileField label={t('fa10.whatsapp')} value={form.whatsapp} onChange={(v) => set('whatsapp', v)} error={err('whatsapp')} testID="whatsapp" />
          ) : null}
          <DateField label={t('fa10.dob')} required yearFirst value={form.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} max={adultMax} min="1940-01-01" error={err('dateOfBirth')} hint={t('fa10.dobHint')} testID="dob" />
          <SelectField label={t('fa10.gender')} required value={form.gender} choices={choice(GENDERS, 'fa10.gender')} onChange={(v) => set('gender', v)} error={err('gender')} testID="gender" />
          <SelectField label={t('fa10.messageLanguage')} required value={form.messageLanguage} choices={choice(MESSAGE_LANGUAGES, 'fa10.lang')} onChange={(v) => set('messageLanguage', v)} error={err('messageLanguage')} testID="message-language" />
          <SelectField label={t('fa10.bestTime')} required value={form.bestTime} choices={choice(BEST_TIME, 'fa10.time')} onChange={(v) => set('bestTime', v)} error={err('bestTime')} testID="best-time" />
          <SelectField label={t('fa10.heardFrom')} required value={form.heardFrom} choices={choice(HEARD_FROM, 'fa10.heard')} onChange={(v) => set('heardFrom', v)} error={err('heardFrom')} testID="heard-from" />
        </Section>

        <Section n={2} title={t('fa10.s2')}>
          <SelectField
            label={t('fa10.area')}
            required
            value={form.place.area}
            choices={areas.map((a) => ({ value: a.name, label: a.name }))}
            onChange={(name) => {
              const a = areas.find((x) => x.name === name);
              set('place', { area: name, pincode: a?.pincode ?? '', latitude: a?.latitude ?? null, longitude: a?.longitude ?? null });
            }}
            error={err('area')}
            testID="area"
          />
          <TextField
            label={`${t('fa10.pincode')} *`}
            keyboardType="number-pad"
            maxLength={6}
            value={form.place.pincode}
            onChangeText={(v) => set('place', { ...form.place, pincode: v.replace(/\D/g, '') })}
            hint={/^560\d{3}$/.test(form.place.pincode) ? t('fa10.city') : undefined}
            error={err('pincode')}
            testID="pincode"
          />
          <View style={styles.pinRow}>
            <Text style={styles.pinText} testID="pin">
              {form.place.latitude !== null ? t('fa10.pinSet') : t('fa10.pinMissing')}
            </Text>
            <Button
              label={t('fa10.pinHere')}
              variant="secondary"
              loading={location.loading}
              onPress={async () => {
                const fix = await location.read();
                if (fix) set('place', { ...form.place, latitude: fix.latitude, longitude: fix.longitude });
              }}
              testID="pin-here"
            />
          </View>
          {err('pin') ? <Text variant="small" color={colors.tomato}>{err('pin')}</Text> : null}
          <SelectField label={t('fa10.travel')} required value={form.travelKm} choices={TRAVEL_KM.map((k) => ({ value: k, label: k === '20' ? '20 km+' : `${k} km` }))} onChange={(v) => set('travelKm', v)} error={err('travelKm')} testID="travel" />
          <ChipPicker label={t('fa10.preferredAreas')} values={form.preferredAreas} choices={areas.map((a) => ({ value: a.name, label: a.name }))} onChange={(v) => set('preferredAreas', v)} addLabel={t('fa10.addArea')} testID="preferred" />
          <Checkbox label={t('fa10.relocate')} checked={form.relocate} onChange={(v) => set('relocate', v)} />
          <Checkbox label={t('fa10.accommodation')} checked={form.accommodation} onChange={(v) => set('accommodation', v)} />
        </Section>

        <Section n={3} title={t('fa10.s3')}>
          {form.trades.map((row, i) => (
            <View key={i} style={styles.tradeRow}>
              <View style={styles.rowHead}>
                <Text variant="label">{i === 0 ? t('fa10.tradeLooking') : t('fa10.tradeN', { n: i + 1 })}</Text>
                {i > 0 ? (
                  <Pressable accessibilityRole="button" onPress={() => set('trades', form.trades.filter((_, j) => j !== i))}>
                    <Text style={styles.link}>{t('fa10.remove')}</Text>
                  </Pressable>
                ) : null}
              </View>
              <SelectField
                label={t('fa10.trade')}
                required={i === 0}
                value={row.trade}
                choices={tradeChoices}
                onChange={(v) => set('trades', form.trades.map((r, j) => (j === i ? { ...r, trade: v } : r)))}
                error={i === 0 ? err('trade') : null}
                testID={`trade-${i}`}
              />
              {row.trade === OTHER_TRADE ? (
                <TextField
                  label={t('fa17.typeTrade')}
                  value={row.other}
                  onChangeText={(v) => set('trades', form.trades.map((r, j) => (j === i ? { ...r, other: v } : r)))}
                  hint={t('fa17.newTrade')}
                />
              ) : null}
              <SelectField
                label={t('fa10.years')}
                required={i === 0}
                value={row.years}
                choices={YEARS.map((y) => ({ value: y.value, label: t(`fa10.years.${y.value}` as MessageKey) }))}
                onChange={(v) => set('trades', form.trades.map((r, j) => (j === i ? { ...r, years: v } : r)))}
                error={err('years')}
                testID={`years-${i}`}
              />
            </View>
          ))}
          {err('duplicateTrade') ? <Text variant="small" color={colors.tomato}>{err('duplicateTrade')}</Text> : null}
          {form.trades.length < MAX_TRADES ? (
            <Pressable accessibilityRole="button" onPress={() => set('trades', [...form.trades, { trade: '', other: '', years: '' }])} testID="add-trade">
              <Text style={styles.link}>{t('fa10.addTrade', { left: MAX_TRADES - form.trades.length })}</Text>
            </Pressable>
          ) : null}
          <SelectField label={t('fa10.workingNow')} value={form.workingNow} choices={[{ value: 'no', label: t('fa10.no') }, { value: 'yes', label: t('fa10.yes') }]} onChange={(v) => set('workingNow', v)} />
          <TextField label={t('fa10.lastEmployer')} value={form.lastEmployer} onChangeText={(v) => set('lastEmployer', v)} />
          <SelectField label={t('fa10.lastRole')} value={form.lastRole} choices={tradeChoices.filter((c) => c.value !== OTHER_TRADE)} onChange={(v) => set('lastRole', v)} />
          <MoneyField label={form.workingNow === 'yes' ? t('fa10.currentSalary') : t('fa10.lastSalary')} valuePaise={form.lastSalaryPaise} onChange={(v) => set('lastSalaryPaise', v)} />
          <DateField label={t('fa10.lookingSince')} required value={form.lookingSince} onChange={(v) => set('lookingSince', v)} max={today} error={err('lookingSince')} testID="looking-since" />
        </Section>

        <Section n={4} title={t('fa10.s4')}>
          {firstTrade ? (
            <Banner
              tone="info"
              message={t('fa17.marketHint', { trade: firstTrade.name, min: formatRupees(firstTrade.salaryMinPaise), max: formatRupees(firstTrade.salaryMaxPaise).replace('₹', '') })}
              testID="market-hint"
            />
          ) : null}
          <MoneyField label={t('fa10.minSalary')} required valuePaise={form.minSalaryPaise} onChange={(v) => set('minSalaryPaise', v)} error={err('minSalary')} testID="min-salary" />
          <MoneyField label={t('fa10.maxSalary')} required valuePaise={form.maxSalaryPaise} onChange={(v) => set('maxSalaryPaise', v)} error={err('maxSalary') ?? err('salaryOrder')} testID="max-salary" />
          {aboveMarket && firstTrade ? (
            <Banner tone="warn" message={t('fa10.aboveMarket', { max: formatRupees(firstTrade.salaryMaxPaise) })} testID="above-market" />
          ) : null}
          <SelectField label={t('fa10.per')} required value={form.period} choices={[{ value: 'monthly', label: t('fa10.month') }, { value: 'daily', label: t('fa10.day') }]} onChange={(v) => set('period', v)} />
          <DateField label={t('fa10.availableFrom')} required value={form.availableFrom} onChange={(v) => set('availableFrom', v)} min={today} max={addDays(today, 365)} error={err('availableFrom')} testID="available-from" />
          <SelectField label={t('fa10.shift')} required value={form.shift} choices={choice(SHIFT_PREFERENCES, 'selling.shift')} onChange={(v) => set('shift', v)} error={err('shift')} testID="shift" />
          <SelectField label={t('fa10.jobType')} required value={form.jobType} choices={choice(JOB_TYPES, 'fa10.jobType')} onChange={(v) => set('jobType', v)} error={err('jobType')} testID="job-type" />
        </Section>

        <Section n={5} title={t('fa10.s5')}>
          <ChipPicker
            label={t('fa10.speaks')}
            required
            values={form.spoken}
            choices={SPOKEN_LANGUAGES.map((l) => ({ value: l, label: l }))}
            onChange={(v) => set('spoken', v)}
            error={err('spoken')}
            addLabel={t('fa10.addLanguage')}
            testID="spoken"
          />
        </Section>

        <Section n={6} title={t('fa10.s6')}>
          <SelectField label={t('fa10.qualification')} value={form.qualification} choices={choice(QUALIFICATIONS, 'fa10.qual')} onChange={(v) => set('qualification', v)} />
          <Checkbox label={t('fa10.noQualification')} checked={form.noQualification} onChange={(v) => set('noQualification', v)} />
          <SelectField label={t('fa10.licence')} value={form.licence} choices={choice(LICENCES, 'fa10.licence')} onChange={(v) => set('licence', v)} />
          <Checkbox label={t('fa10.ownVehicle')} checked={form.ownVehicle} onChange={(v) => set('ownVehicle', v)} />
          <Checkbox label={t('fa10.police')} checked={form.police} onChange={(v) => set('police', v)} />
          <Checkbox label={t('fa10.smartphone')} checked={form.smartphone} onChange={(v) => set('smartphone', v)} />
          <ReferredBy form={form} onChange={(referredByQuery, referredBy) => setForm((f) => ({ ...f, referredByQuery, referredBy }))} />
        </Section>

        <Section n={7} title={t('fa10.s7')}>
          <Segmented value={scriptLang} options={SCRIPT_LANGUAGES} onChange={setScriptLang} testID="script-language" />
          <Script testID="consent-script">{JOB_SEEKER_CONSENT_SCRIPT[scriptLang]}</Script>
          <Text variant="muted">{t('fa10.ownOtp')}</Text>
        </Section>

        {tried && errors.length > 0 ? <Banner tone="error" message={t('fa10.fixFields', { count: errors.length })} testID="form-errors" /> : null}
        {!isVerified ? <Text variant="muted" align="center">{t('fa10.verifyFirst')}</Text> : null}
        <ErrorBanner error={save.error} />
        <Button label={t('fa10.save')} disabled={!isVerified} loading={save.isPending} onPress={submit} testID="save-seeker" />
        <Text variant="tiny" align="center">{t('fa10.draftNote')}</Text>
      </Screen>
    </View>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <View style={styles.sectionHead}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{n}</Text>
        </View>
        <Text variant="h2">{title}</Text>
      </View>
      <View style={styles.gap}>{children}</View>
    </Card>
  );
}

function ReferredBy({ form, onChange }: {
  form: JobSeekerForm;
  onChange: (query: string, partner: JobSeekerForm['referredBy']) => void;
}) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const look = async () => {
    const q = form.referredByQuery.trim();
    if (!q) return;
    setBusy(true);
    try {
      const r = await selling.findReferralPartner(q);
      setNotFound(!r.partner);
      onChange(q, r.partner);
    } catch {
      setNotFound(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.gap}>
      <TextField
        label={t('fa10.referredBy')}
        value={form.referredBy ? `${form.referredBy.code} · ${form.referredBy.name}` : form.referredByQuery}
        onChangeText={(v) => onChange(v, null)}
        onBlur={() => void look()}
        hint={notFound ? t('fa10.partnerNotFound') : undefined}
        testID="referred-by"
      />
      {!form.referredBy && form.referredByQuery.trim() ? (
        <Button label={t('fa10.findPartner')} variant="secondary" loading={busy} onPress={() => void look()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { gap: 12 },
  top: { marginTop: 4 },
  link: { color: colors.blue, fontFamily: fonts.body700, paddingVertical: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontFamily: fonts.body700, fontSize: 12 },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pinText: { color: colors.ink, flex: 1 },
  tradeRow: { gap: 8, paddingBottom: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
