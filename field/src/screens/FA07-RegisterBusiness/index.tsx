import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, CodeInput, LoadingState, Screen, StatusChip, Text, TextField } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import type { Trade } from '@/api/endpoints';
import { isNeedsSignalError, useOfflineQueue } from '@/device/offline-queue';
import { readLocation } from '@/device/location/location';
import { locationProvider } from '@/device/location/provider';
import { formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors, fonts, radius, touch } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { SelectField } from '../_visits/SelectField';
import { DatePicker } from '../_visits/DatePicker';
import { useVisit } from '../_visits/useVisit';
import type { VisitDraft } from '../_visits/visitDraft';
import { BUSINESS_SCRIPT, SCRIPT_LANGUAGE_LABELS, type ScriptLanguage } from './script';
import { businessBody, formErrors, type FormState, type MobileState, type StaffRow } from './form';

const ROLES = ['owner', 'manager', 'hr', 'supervisor', 'other'] as const;
const LANGS = ['kn', 'hi', 'en'] as const;
const HEARD = ['toll_free_missed_call', 'ad', 'referral_partner', 'field_visit', 'social_media', 'walk_in', 'other'] as const;
const BTYPES = [
  'restaurant_hotel', 'bakery', 'retail_shop', 'supermarket', 'apartment_society', 'household', 'office',
  'factory', 'warehouse', 'hospital_clinic', 'construction', 'security_agency', 'salon', 'other',
] as const;
const EMPLOYEES = ['1-5', '6-20', '21-50', '51-200', '200+'] as const;
const RUNNING = ['under_1', '1_3', '3_10', '10_plus'] as const;
const HIRING = ['rarely', 'every_few_months', 'every_month', 'every_week'] as const;
const SHIFTS = ['day', 'night', 'rotational'] as const;
const LICENCE_KINDS = ['shopEstablishmentNumber', 'udyamNumber', 'licenceNumber'] as const;
const TIMES = Array.from({ length: 38 }, (_, i) => {
  const minutes = 5 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
const OTHER_TRADE = '__other__';

const emptyMobile = (): MobileState => ({ number: '', requestId: null, code: '', verifiedAt: null, sentAt: null });
const emptyRow = (): StaffRow => ({ trade: '', other: '', headcount: '1', salaryMin: '', salaryMax: '', shift: '', startDate: '', ownerTold: false });

function rupees(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 7);
  return digits ? Number(digits).toLocaleString('en-IN') : '';
}

/**
 * FA07 — Register a business: the same form every staff member uses (CA13),
 * laid out for a phone, opened from a shop visit after the proof selfie
 * (FA22). The live storefront photo and GPS come from the visit; the map pin
 * starts at the shop. The contact person's mobile is checked by OTP (needs
 * signal), each staff-needed row becomes a draft vacancy, and after saving
 * the agreement link goes to the contact person, who agrees on his own phone.
 */
export default function RegisterBusinessScreen() {
  const { visitId } = useLocalSearchParams<{ visitId?: string }>();
  const { visit, loading } = useVisit(visitId);
  if (visitId && loading) return <LoadingState />;
  return <RegisterForm visitId={visitId ?? null} visit={visit} />;
}

function RegisterForm({ visitId, visit }: { visitId: string | null; visit: VisitDraft | null }) {
  const { t } = useI18n();
  const { registration, visits } = useEndpoints();
  const queue = useOfflineQueue();
  const options = useQuery({ queryKey: queryKeys.registrationOptions, queryFn: () => registration.options(), staleTime: 3_600_000 });
  const trades = useQuery({ queryKey: queryKeys.trades, queryFn: () => registration.trades(), staleTime: 600_000 });
  const [openedAt] = useState(() => Date.now());
  const [now, setNow] = useState(openedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const [form, setForm] = useState<FormState>(() => ({
    contactName: '',
    contactRole: '',
    mobile: emptyMobile(),
    whatsappSame: true,
    whatsapp: '',
    language: '',
    billingEmail: '',
    heardFrom: 'field_visit',
    boardName: visit?.shopName ?? '',
    legalName: '',
    familyName: '',
    businessType: '',
    employees: '',
    running: '',
    hiring: '',
    opensAt: '',
    closesAt: '',
    shopNumber: '',
    street: '',
    landmark: '',
    area: '',
    pincode: '',
    pin: visit ? { latitude: visit.latitude, longitude: visit.longitude } : null,
    branches: [],
    gstin: '',
    fssai: '',
    licenceKind: 'shopEstablishmentNumber',
    licenceNumber: '',
    pan: '',
    noDocuments: false,
    staff: [emptyRow()],
  }));
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));


  const tradeList: Trade[] = trades.data ?? [];
  const findTrade = (row: StaffRow) => tradeList.find((tr) => tr.name === row.trade);
  const errors = formErrors(form, findTrade);
  const err = (key: string) => showErrors && errors.includes(key);
  const household = form.businessType === 'household';

  function explain(e: unknown) {
    setProblem(isNeedsSignalError(e) ? t('common.needsSignal') : isApiError(e) ? e.message : t('common.error'));
  }

  async function sendOtp(current: MobileState, update: (m: MobileState) => void, key: string) {
    if (!/^[6-9]\d{9}$/.test(current.number)) return setProblem(t('fa07.mobileInvalid'));
    setProblem(null);
    setBusy(key);
    try {
      const sent = await queue.live(() => registration.sendOtp(current.number, current.requestId ?? undefined));
      if (sent.alreadyRegistered) {
        setProblem(t('fa07.alreadyRegistered', { code: sent.existingCode ?? '' }));
      } else if (sent.requestId) {
        update({ ...current, requestId: sent.requestId, sentAt: sent.resendAvailableAt ? Date.parse(sent.resendAvailableAt) - 30_000 : openedAt, code: '' });
      }
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  async function verifyOtp(current: MobileState, update: (m: MobileState) => void, key: string) {
    if (!current.requestId || current.code.length !== 6) return;
    setBusy(key);
    try {
      await queue.live(() => registration.verifyOtp(current.requestId!, current.code));
      update({ ...current, verifiedAt: new Date().toISOString() });
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  async function movePin() {
    setBusy('pin');
    try {
      const fix = await readLocation(locationProvider);
      set({ pin: { latitude: fix.latitude, longitude: fix.longitude } });
    } catch {
      setProblem(t('device.location.unavailable'));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setShowErrors(true);
    if (errors.length) return setProblem(t('fa07.fixErrors'));
    setProblem(null);
    setBusy('save');
    try {
      const created = await queue.live(() => registration.createBusiness(businessBody(form, visitId)));
      await visits.sendAgreementLink(created.id, form.language).catch(() => undefined);
      router.replace({ pathname: routes.visitDone, params: { businessId: created.id, ...(visitId ? { visitId } : {}) } });
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  const choice = <V extends string>(values: readonly V[], prefix: string) =>
    values.map((v) => ({ value: v, label: t(`${prefix}.${v}` as MessageKey) }));

  function mobileBlock(m: MobileState, update: (m: MobileState) => void, key: string, label: string) {
    const canResend = !m.sentAt || now - m.sentAt > 30_000;
    return (
      <View style={styles.block}>
        <View style={styles.mobileRow}>
          <View style={styles.prefix}>
            <Text variant="bodyStrong">+91</Text>
          </View>
          <View style={styles.flex1}>
            <TextField
              label={label}
              value={m.number}
              editable={!m.verifiedAt}
              keyboardType="number-pad"
              maxLength={10}
              onChangeText={(v) => update({ ...emptyMobile(), number: v.replace(/\D/g, '').slice(0, 10) })}
              error={err(key) ? t('fa07.mobileRequired') : null}
              testID={`fa07-${key}`}
              style={styles.mobileInput}
            />
          </View>
        </View>
        {m.verifiedAt ? (
          <View style={styles.inline}>
            <StatusChip tone="green" label={t('fa07.verified')} />
            <Text variant="muted" style={styles.flex1}>
              {t('fa07.checkedAt', { time: formatTimeIst(m.verifiedAt) })}
            </Text>
            <Button label={t('fa07.changeNumber')} variant="secondary" onPress={() => update(emptyMobile())} />
          </View>
        ) : m.requestId ? (
          <View style={styles.block}>
            <CodeInput value={m.code} onChange={(code) => update({ ...m, code })} label={t('fa07.otpCode')} testID={`fa07-${key}-code`} />
            <View style={styles.inline}>
              <Button label={t('fa07.verify')} loading={busy === `${key}-verify`} disabled={m.code.length !== 6} onPress={() => void verifyOtp(m, update, `${key}-verify`)} style={styles.flex1} testID={`fa07-${key}-verify`} />
              <Button label={t('fa07.resend')} variant="secondary" disabled={!canResend} onPress={() => void sendOtp(m, update, `${key}-send`)} style={styles.flex1} />
            </View>
          </View>
        ) : (
          <Button label={t('fa07.sendOtp')} variant="secondary" loading={busy === `${key}-send`} onPress={() => void sendOtp(m, update, `${key}-send`)} testID={`fa07-${key}-send`} />
        )}
      </View>
    );
  }

  const tradeChoices = [...tradeList.map((tr) => ({ value: tr.name, label: tr.name })), { value: OTHER_TRADE, label: t('fa07.otherTrade') }];

  return (
    <View style={styles.flex} testID="screen-FA07">
      <AppHeader title={t('fa07.header')} />
      <Screen>
        <Text variant="h1">{t('fa07.title')}</Text>
        <Text variant="muted">{t('fa07.sameForm')}</Text>
        <Banner tone="info" message={t('fa07.requiredNote')} />

        <Card style={styles.gapCard}>
          <Section n={1} title={t('fa07.s1')} />
          <TextField label={t('fa07.contactName')} value={form.contactName} onChangeText={(v) => set({ contactName: v })} error={err('contactName') ? t('fa07.required') : null} testID="fa07-contact-name" />
          <SelectField label={t('fa07.contactRole')} value={form.contactRole} choices={choice(ROLES, 'role')} onChange={(v) => set({ contactRole: v })} error={err('contactRole')} testID="fa07-role" />
          {mobileBlock(form.mobile, (mobile) => set({ mobile }), 'mobile', t('fa07.mobile'))}
          <Toggle label={t('fa07.whatsappSame')} value={form.whatsappSame} onChange={(v) => set({ whatsappSame: v })} />
          {!form.whatsappSame ? (
            <TextField label={t('fa07.whatsapp')} value={form.whatsapp} keyboardType="number-pad" maxLength={10} onChangeText={(v) => set({ whatsapp: v.replace(/\D/g, '') })} error={err('whatsapp') ? t('fa07.mobileInvalid') : null} />
          ) : null}
          <SelectField label={t('fa07.language')} value={form.language} choices={choice(LANGS, 'lang')} onChange={(v) => set({ language: v })} error={err('language')} testID="fa07-language" />
          <TextField label={t('fa07.billingEmail')} value={form.billingEmail} keyboardType="email-address" autoCapitalize="none" onChangeText={(v) => set({ billingEmail: v })} error={err('billingEmail') ? t('fa07.emailInvalid') : null} />
          <SelectField label={t('fa07.heardFrom')} value={form.heardFrom} choices={choice(HEARD, 'heard')} onChange={(v) => set({ heardFrom: v })} error={err('heardFrom')} />
        </Card>

        <Card style={styles.gapCard}>
          <Section n={2} title={t('fa07.s2')} />
          <TextField label={t('fa07.boardName')} value={form.boardName} onChangeText={(v) => set({ boardName: v })} error={err('boardName') ? t('fa07.required') : null} testID="fa07-board-name" />
          {household ? (
            <TextField label={t('fa07.familyName')} value={form.familyName} onChangeText={(v) => set({ familyName: v })} error={err('familyName') ? t('fa07.required') : null} />
          ) : (
            <TextField label={t('fa07.legalName')} value={form.legalName} onChangeText={(v) => set({ legalName: v })} />
          )}
          <SelectField label={t('fa07.businessType')} value={form.businessType} choices={choice(BTYPES, 'btype')} onChange={(v) => set({ businessType: v })} error={err('businessType')} testID="fa07-type" />
          <SelectField label={t('fa07.employees')} value={form.employees} choices={EMPLOYEES.map((v) => ({ value: v, label: v.replace('-', '–') }))} onChange={(v) => set({ employees: v })} error={err('employees')} testID="fa07-employees" />
          <SelectField label={t('fa07.running')} value={form.running} choices={choice(RUNNING, 'running')} onChange={(v) => set({ running: v })} />
          <SelectField label={t('fa07.hiring')} value={form.hiring} choices={choice(HIRING, 'hiring')} onChange={(v) => set({ hiring: v })} />
          <View style={styles.inline}>
            <View style={styles.flex1}>
              <SelectField label={t('fa07.opensAt')} value={form.opensAt} choices={TIMES.map((v) => ({ value: v, label: v }))} onChange={(v) => set({ opensAt: v })} />
            </View>
            <View style={styles.flex1}>
              <SelectField label={t('fa07.closesAt')} value={form.closesAt} choices={TIMES.map((v) => ({ value: v, label: v }))} onChange={(v) => set({ closesAt: v })} />
            </View>
          </View>
          <Text variant="muted">{t('fa07.householdHint')}</Text>
        </Card>

        <Card style={styles.gapCard}>
          <Section n={3} title={t('fa07.s3')} />
          <TextField label={t('fa07.shopNumber')} value={form.shopNumber} onChangeText={(v) => set({ shopNumber: v })} error={err('shopNumber') ? t('fa07.required') : null} />
          <TextField label={t('fa07.street')} value={form.street} onChangeText={(v) => set({ street: v })} error={err('street') ? t('fa07.required') : null} />
          <TextField label={t('fa07.landmark')} value={form.landmark} onChangeText={(v) => set({ landmark: v })} error={err('landmark') ? t('fa07.required') : null} />
          <SelectField
            label={t('fa07.area')}
            value={form.area}
            choices={(options.data?.areas ?? []).map((a) => ({ value: a.name, label: a.name }))}
            onChange={(v) => {
              const area = options.data?.areas.find((a) => a.name === v);
              set({ area: v, pincode: form.pincode || area?.pincode || '' });
            }}
            error={err('area')}
            testID="fa07-area"
          />
          <TextField label={t('fa07.pincode')} value={form.pincode} keyboardType="number-pad" maxLength={6} onChangeText={(v) => set({ pincode: v.replace(/\D/g, '') })} error={err('pincode') ? t('fa07.pincodeInvalid') : null} hint={t('fa07.city')} />
          <View style={styles.inline}>
            <Text variant="small" style={styles.flex1}>
              {form.pin ? `📍 ${t('fa07.pinSet')}` : t('fa07.pinMissing')}
            </Text>
            <Button label={t('fa07.pinChange')} variant="secondary" loading={busy === 'pin'} onPress={() => void movePin()} />
          </View>
          <Text variant="muted">{t('fa07.branchesHint')}</Text>
          {form.branches.map((br, i) => (
            <View key={i} style={styles.branch}>
              <Text variant="bodyStrong">{t('fa07.branchN', { n: i + 1 })}</Text>
              <TextField label={t('fa07.branchName')} value={br.name} onChangeText={(v) => set({ branches: form.branches.map((b, j) => (j === i ? { ...b, name: v } : b)) })} error={err(`branch${i}`) && !br.name.trim() ? t('fa07.required') : null} />
              <SelectField label={t('fa07.area')} value={br.area} choices={(options.data?.areas ?? []).map((a) => ({ value: a.name, label: a.name }))} onChange={(v) => set({ branches: form.branches.map((b, j) => (j === i ? { ...b, area: v } : b)) })} />
              <TextField label={t('fa07.contactName')} value={br.contactName} onChangeText={(v) => set({ branches: form.branches.map((b, j) => (j === i ? { ...b, contactName: v } : b)) })} />
              <SelectField label={t('fa07.contactRole')} value={br.contactRole} choices={choice(ROLES, 'role')} onChange={(v) => set({ branches: form.branches.map((b, j) => (j === i ? { ...b, contactRole: v } : b)) })} />
              {mobileBlock(br.mobile, (mobile) => setForm((f) => ({ ...f, branches: f.branches.map((b, j) => (j === i ? { ...b, mobile } : b)) })), `branch${i}-mobile`, t('fa07.mobile'))}
              <Button label={t('fa07.remove')} variant="danger" onPress={() => set({ branches: form.branches.filter((_, j) => j !== i) })} />
            </View>
          ))}
          <Button label={t('fa07.addBranch')} variant="secondary" onPress={() => set({ branches: [...form.branches, { name: '', area: '', contactName: '', contactRole: '', mobile: emptyMobile() }] })} testID="fa07-add-branch" />
        </Card>

        {!household ? (
          <Card style={styles.gapCard}>
            <Section n={4} title={t('fa07.s4')} />
            {!form.noDocuments ? (
              <>
                <TextField label={t('fa07.gstin')} value={form.gstin} autoCapitalize="characters" maxLength={15} onChangeText={(v) => set({ gstin: v.toUpperCase() })} error={err('gstin') ? t('fa07.gstinInvalid') : null} />
                <TextField label={t('fa07.fssai')} value={form.fssai} keyboardType="number-pad" maxLength={14} onChangeText={(v) => set({ fssai: v.replace(/\D/g, '') })} />
                <SelectField label={t('fa07.licenceKind')} value={form.licenceKind} choices={choice(LICENCE_KINDS, 'licence')} onChange={(v) => set({ licenceKind: v })} />
                <TextField label={t('fa07.licenceNumber')} placeholder={t('fa07.ifTheyHave')} value={form.licenceNumber} onChangeText={(v) => set({ licenceNumber: v })} />
                <TextField label={t('fa07.pan')} placeholder={t('fa07.ifTheyHave')} value={form.pan} autoCapitalize="characters" maxLength={10} onChangeText={(v) => set({ pan: v.toUpperCase() })} error={err('pan') ? t('fa07.panInvalid') : null} />
              </>
            ) : null}
            <Toggle label={t('fa07.noDocuments')} value={form.noDocuments} onChange={(v) => set({ noDocuments: v })} />
          </Card>
        ) : null}

        <Card style={styles.gapCard}>
          <Section n={5} title={t('fa07.s5')} />
          {form.staff.map((row, i) => {
            const trade = findTrade(row);
            const min = Number(row.salaryMin.replace(/\D/g, '')) * 100;
            const below = Boolean(trade && min > 0 && min < trade.legalMinimumPaise);
            const update = (patch: Partial<StaffRow>) => set({ staff: form.staff.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
            return (
              <View key={i} style={styles.branch} testID={`fa07-staff-${i}`}>
                <SelectField label={t('fa07.role')} value={row.trade} choices={tradeChoices} onChange={(v) => update({ trade: v })} error={err(`staff${i}`) && !row.trade} testID={`fa07-staff-${i}-trade`} />
                {row.trade === OTHER_TRADE ? <TextField label={t('fa07.otherTrade')} value={row.other} onChangeText={(v) => update({ other: v })} /> : null}
                <SelectField label={t('fa07.howMany')} value={row.headcount} choices={Array.from({ length: 10 }, (_, k) => ({ value: String(k + 1), label: String(k + 1) }))} onChange={(v) => update({ headcount: v })} />
                <View style={styles.inline}>
                  <View style={styles.flex1}>
                    <MoneyField label={t('fa07.salaryFrom')} value={row.salaryMin} onChange={(v) => update({ salaryMin: rupees(v) })} error={err(`staff${i}`) && !row.salaryMin} testID={`fa07-staff-${i}-min`} />
                  </View>
                  <View style={styles.flex1}>
                    <MoneyField label={t('fa07.salaryTo')} value={row.salaryMax} onChange={(v) => update({ salaryMax: rupees(v) })} />
                  </View>
                </View>
                <SelectField label={t('fa07.shift')} value={row.shift} choices={choice(SHIFTS, 'shift')} onChange={(v) => update({ shift: v })} error={err(`staff${i}`) && !row.shift} testID={`fa07-staff-${i}-shift`} />
                <DatePicker label={t('fa07.neededFrom')} value={row.startDate || null} onChange={(v) => update({ startDate: v })} now={openedAt} testID={`fa07-staff-${i}-date`} />
                {trade ? (
                  <Text variant="muted">
                    {t('fa07.tradeHint', { trade: trade.name, from: (trade.salaryMinPaise / 100).toLocaleString('en-IN'), to: (trade.salaryMaxPaise / 100).toLocaleString('en-IN') })}
                  </Text>
                ) : null}
                {below ? (
                  <>
                    <Banner tone="warn" title={t('fa07.belowMinimum')} message={t('fa07.belowMinimumBody', { amount: (trade!.legalMinimumPaise / 100).toLocaleString('en-IN') })} />
                    <Toggle label={t('fa07.ownerTold')} value={row.ownerTold} onChange={(v) => update({ ownerTold: v })} error={err(`staffLegal${i}`)} />
                  </>
                ) : null}
                {form.staff.length > 1 ? <Button label={t('fa07.remove')} variant="danger" onPress={() => set({ staff: form.staff.filter((_, j) => j !== i) })} /> : null}
              </View>
            );
          })}
          <Button label={t('fa07.addRole')} variant="secondary" onPress={() => set({ staff: [...form.staff, emptyRow()] })} testID="fa07-add-role" />
        </Card>

        <Card style={styles.gapCard}>
          <Section n={6} title={t('fa07.s6')} />
          {(['kn', 'hi', 'en'] as ScriptLanguage[]).map((lang) => (
            <View key={lang} style={styles.script}>
              <Text variant="label">{SCRIPT_LANGUAGE_LABELS[lang]}</Text>
              <Text>{BUSINESS_SCRIPT[lang]}</Text>
            </View>
          ))}
          <Text variant="muted">{t('fa07.ownerAgrees')}</Text>
        </Card>

        {problem ? <Banner tone="error" message={problem} testID="fa07-problem" /> : null}
        <Button label={t('fa07.save')} loading={busy === 'save'} onPress={() => void save()} testID="fa07-save" />
      </Screen>
    </View>
  );
}

function Section({ n, title }: { n: number; title: string }) {
  return (
    <View style={styles.section}>
      <View style={styles.num}>
        <Text style={styles.numText}>{n}</Text>
      </View>
      <Text variant="h2" style={styles.flex1}>
        {title}
      </Text>
    </View>
  );
}

function Toggle({ label, value, onChange, error }: { label: string; value: boolean; onChange: (v: boolean) => void; error?: boolean }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={styles.toggle}>
      <View style={[styles.box, value && styles.boxOn, error && styles.boxError]}>{value ? <Text style={styles.tick}>✓</Text> : null}</View>
      <Text variant="small" style={styles.flex1}>
        {label}
      </Text>
    </Pressable>
  );
}

function MoneyField({ label, value, onChange, error, testID }: { label: string; value: string; onChange: (v: string) => void; error?: boolean; testID?: string }) {
  return (
    <View style={styles.money}>
      <Text style={styles.rupee}>₹</Text>
      <View style={styles.flex1}>
        <TextField label={label} value={value} keyboardType="number-pad" onChangeText={onChange} error={error ? ' ' : null} testID={testID} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  block: { gap: 8 },
  gapCard: { gap: 12 },
  label: { fontFamily: fonts.body700, color: colors.soft, fontSize: 12 },
  mobileRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  prefix: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.neutral100, borderWidth: 1, borderColor: colors.border },
  mobileInput: {},
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  section: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  numText: { color: colors.white, fontFamily: fonts.display700, fontSize: 13 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touch.min },
  box: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  boxError: { borderColor: colors.tomato },
  tick: { color: colors.white, fontFamily: fonts.body700, fontSize: 13 },
  branch: { gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  money: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  rupee: { fontFamily: fonts.body700, fontSize: 18, color: colors.ink, paddingBottom: 12 },
  script: { gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: colors.blue100, marginBottom: 8 },
});
