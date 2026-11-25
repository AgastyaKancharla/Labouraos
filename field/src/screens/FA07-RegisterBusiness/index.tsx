import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, CodeInput, Emoji, LoadingState, PinFinder, PlaceLine, Screen, StatusChip, Text, TextField, TileMap } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { readOtpSend, duplicateMessage } from '@/lib/otp-send';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import { type ResolvedMapsLink, type SimilarShop, type Trade, type WhereAmI } from '@/api/endpoints';
import { isNeedsSignalError, useOfflineQueue } from '@/device/offline-queue';
import { readLocation } from '@/device/location/location';
import { locationProvider } from '@/device/location/provider';
import { formatTimeIst } from '@/lib/format';
import { DEFAULT_AREA_AUTO_FILL_MAX_METERS, distanceText, nearestArea } from '@/lib/nearestArea';
import { routes } from '@/navigation/routes';
import { useFormDraft } from '@/lib/formDraft';
import { inShortText } from '@/api/endpoints/legal';
import { type Accent, accents, colors, fonts, radius, touch } from '@/theme';
import { BUSINESS_TYPE_GROUPS, businessTypeLabel } from '@/lib/businessTypes';
import { AppHeader } from '../_shared/AppHeader';
import { SelectField } from '../_visits/SelectField';
import { DatePicker } from '../_visits/DatePicker';
import { useVisit } from '../_visits/useVisit';
import { updateDraft, type VisitDraft } from '../_visits/visitDraft';
import { StepHeader } from '../_visits/StepHeader';
import { businessBody, DEFAULT_CITY, formErrors, proofCount, type FormState, type MobileState, type StaffRow } from './form';

const ROLES = ['owner', 'manager', 'hr', 'supervisor', 'other'] as const;
const HEARD = ['toll_free_missed_call', 'ad', 'referral_partner', 'field_visit', 'social_media', 'whatsapp', 'walk_in', 'other'] as const;
/** 22 Nov (rev 207): the full grouped list, the same as the consoles and the server. */
const BTYPE_CHOICES = BUSINESS_TYPE_GROUPS.flatMap((g) => g.types.map((ty) => ({ value: ty.value, label: ty.label, group: g.label })));
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
 * signal), each staff-needed row (optional) becomes a draft vacancy, and
 * after saving the agreement link goes to the contact person, who agrees on
 * his own phone (the agreement step, FA07b). Step 4 of 7 in the Visits tab.
 * Saving marks the visit Onboarded on the server. What was typed survives
 * going back. A visit whose business is already registered goes straight on
 * to the agreement step instead of opening a blank form.
 */
export default function RegisterBusinessScreen() {
  const { visitId } = useLocalSearchParams<{ visitId?: string }>();
  const { visit, server, loading } = useVisit(visitId);
  const { t } = useI18n();
  if (visitId && loading) return <LoadingState />;
  const registered = server?.business?.id ?? visit?.businessId ?? null;
  if (visitId && registered) {
    return (
      <View style={styles.flex} testID="screen-FA07">
        <AppHeader title={t('fa07.header')} />
        <Screen>
          <StepHeader step={4} />
          <Banner tone="ok" title={t('fa07.registeredFromVisit', { name: server?.business?.name ?? visit?.businessName ?? '' })} testID="fa07-already" />
          <Button
            label={t('fa07.toAgreement')}
            onPress={() => router.replace({ pathname: routes.visitAgreement, params: { businessId: registered, visitId } })}
            testID="fa07-to-agreement"
          />
        </Screen>
      </View>
    );
  }
  return <RegisterForm visitId={visitId ?? null} visit={visit} />;
}

function RegisterForm({ visitId, visit }: { visitId: string | null; visit: VisitDraft | null }) {
  const { t } = useI18n();
  const { registration, visits, legal, fieldOps, redesign } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const options = useQuery({ queryKey: queryKeys.registrationOptions, queryFn: () => registration.options(), staleTime: 3_600_000 });
  const trades = useQuery({ queryKey: queryKeys.trades, queryFn: () => registration.trades(), staleTime: 600_000 });
  const [openedAt] = useState(() => Date.now());
  const [now, setNow] = useState(openedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const [form, setForm, clearForm] = useFormDraft<FormState>(`fa07:${visitId ?? 'new'}`, () => ({
    contactName: '',
    contactRole: '',
    mobile: emptyMobile(),
    whatsappSame: true,
    whatsapp: '',
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
    city: DEFAULT_CITY,
    pin: visit ? { latitude: visit.latitude, longitude: visit.longitude } : null,
    branches: [],
    gstin: '',
    fssai: '',
    licenceKind: 'shopEstablishmentNumber',
    licenceNumber: '',
    pan: '',
    noDocuments: false,
    // Staff needed is optional (redesign, 16 Nov): a business can be onboarded with no vacancy.
    staff: [],
  }));
  const [showErrors, setShowErrors] = useState(false);
  // 21 Nov: a shop nearby with a similar name: "Is this the same shop?" before a second record.
  const [similar, setSimilar] = useState<SimilarShop | null>(null);
  const [differentShop, setDifferentShop] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A Send OTP / Verify problem is shown right under that mobile field and next to its
  // button (owner, testing 16 Nov: the banner at the bottom of the form was never seen).
  const [mobileProblem, setMobileProblem] = useState<Record<string, string>>({});
  const setFieldProblem = (field: string, message: string | null) =>
    setMobileProblem((all) => {
      const next = { ...all };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Guide (14 Nov): the area is filled in from the shop's map pin when an area's
  // centre is within the Settings distance (1 km); otherwise the agent must pick
  // it. `autoArea` is the name the pin filled in, so a new pin can replace it —
  // never an area the agent picked himself.
  const [autoArea, setAutoArea] = useState<string | null>(null);
  const areaList = options.data?.areas ?? [];
  const areaMaxMeters = options.data?.areaAutoFillMaxMeters ?? DEFAULT_AREA_AUTO_FILL_MAX_METERS;
  const nearArea = form.pin ? nearestArea(areaList, form.pin, areaMaxMeters) : null;
  const noAreaNear = Boolean(form.pin) && areaList.length > 0 && !nearArea;
  // Fill in again only for a new pin or a newly loaded list (React's "adjust
  // state while rendering" pattern, so no extra effect pass).
  const fillKey = form.pin && options.data ? `${form.pin.latitude}|${form.pin.longitude}|${areaList.length}|${areaMaxMeters}` : null;
  const [filledFor, setFilledFor] = useState<string | null>(null);
  if (fillKey && fillKey !== filledFor) {
    setFilledFor(fillKey);
    if (!form.area || form.area === autoArea) {
      setAutoArea(nearArea?.name ?? null);
      setForm((f) => ({ ...f, area: nearArea?.name ?? '', pincode: f.pincode || nearArea?.pincode || '' }));
    }
  }


  const tradeList: Trade[] = trades.data ?? [];
  const findTrade = (row: StaffRow) => tradeList.find((tr) => tr.name === row.trade);
  const errors = formErrors(form, findTrade);
  const err = (key: string) => showErrors && errors.includes(key);
  const household = form.businessType === 'household';

  function explain(e: unknown) {
    const body = isApiError(e) && e.body && typeof e.body === 'object' ? (e.body as { details?: { code?: unknown; maxMeters?: unknown } }).details : undefined;
    if (body?.code === 'area_required') {
      setShowErrors(true);
      return setProblem(t('fa07.areaNoneNear', { distance: distanceText(typeof body.maxMeters === 'number' ? body.maxMeters : areaMaxMeters) }));
    }
    setProblem(isNeedsSignalError(e) ? t('common.needsSignal') : isApiError(e) ? e.message : t('common.error'));
  }

  function mobileErrorText(e: unknown): string {
    return isNeedsSignalError(e) ? t('common.needsSignal') : isApiError(e) ? e.message : t('common.error');
  }

  async function sendOtp(current: MobileState, update: (m: MobileState) => void, key: string) {
    const field = key.replace(/-send$/, '');
    if (!/^[6-9]\d{9}$/.test(current.number)) return setFieldProblem(field, t('fa07.mobileInvalid'));
    setFieldProblem(field, null);
    setBusy(key);
    try {
      const outcome = readOtpSend(await queue.live(() => registration.sendOtp(current.number, current.requestId ?? undefined)));
      if (outcome.kind === 'duplicate') {
        setFieldProblem(field, duplicateMessage(outcome, t));
      } else if (outcome.kind === 'sent') {
        update({ ...current, requestId: outcome.requestId, sentAt: outcome.resendAvailableAt ? Date.parse(outcome.resendAvailableAt) - 30_000 : openedAt, code: '' });
      } else {
        // Neither a request nor "already registered": never do nothing.
        setFieldProblem(field, t('otp.noAnswer'));
      }
    } catch (e) {
      setFieldProblem(field, mobileErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function verifyOtp(current: MobileState, update: (m: MobileState) => void, key: string) {
    if (!current.requestId || current.code.length !== 6) return;
    const field = key.replace(/-verify$/, '');
    setFieldProblem(field, null);
    setBusy(key);
    try {
      await queue.live(() => registration.verifyOtp(current.requestId!, current.code));
      update({ ...current, verifiedAt: new Date().toISOString() });
    } catch (e) {
      setFieldProblem(field, mobileErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  // 17 Nov: "Paste Google Maps link" sets the pin and fills (or replaces, when pasted again) the shop number,
  // street, area, PIN code and city from the lookup; the agent can correct them. The PIN code from the link wins
  // over the one the GPS area suggested, and the city decides the legal minimum wage zone on the server.
  // 21 Nov (rev 204): the same box also takes a typed address or coordinates (PinFinder), and the pin is
  // confirmed on the map ("Is this the right place?") before anything is filled.
  const [mapsNote, setMapsNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  function fillFromPin(found: ResolvedMapsLink, opts: { shopNumber?: boolean } = {}) {
    const withShopNumber = opts.shopNumber !== false;
    const a = found.address;
    const lookupArea = a?.area?.trim().toLowerCase() ?? '';
    const listedArea = lookupArea
      ? areaList.find((x) => x.name.toLowerCase() === lookupArea) ?? areaList.find((x) => x.name.toLowerCase().includes(lookupArea) || lookupArea.includes(x.name.toLowerCase()))
      : undefined;
    const filled: string[] = [];
    if (a?.shopNumber && withShopNumber) filled.push(t('fa07.mapsField.shopNumber'));
    if (a?.street) filled.push(t('fa07.mapsField.street'));
    if (listedArea) filled.push(t('fa07.mapsField.area'));
    if (a?.pincode) filled.push(t('fa07.mapsField.pincode'));
    if (a?.city) filled.push(t('fa07.mapsField.city'));
    // An area from the list that matches the lookup; else the area follows the new pin (as before).
    setAutoArea(null);
    setForm((f) => ({
      ...f,
      pin: { latitude: found.latitude, longitude: found.longitude },
      shopNumber: withShopNumber ? a?.shopNumber ?? f.shopNumber : f.shopNumber,
      street: a?.street ?? f.street,
      area: listedArea ? listedArea.name : '',
      pincode: a?.pincode ?? (listedArea?.pincode || ''),
      city: a?.city ?? f.city,
    }));
    setMapsNote({
      tone: 'ok',
      text: a && filled.length ? t('fa07.mapsLinkFilledFields', { fields: filled.join(', ') }) : t('fa07.mapsLinkPinOnly'),
    });
    return filled;
  }

  // 22 Nov (rev 207–208, owner's field test): "Use where I am" is the first control of the address:
  // the GPS pin, the address there from the server's reverse lookup filled in (street, area, PIN code,
  // city) for the agent to correct, and a small map with the pin and the address in words to check it.
  // The shop number, floor or street he adds himself. Without signal the pin is still set.
  const [where, setWhere] = useState<{ latitude: number; longitude: number; accuracy: number | null; words: string | null; state: 'filled' | 'pin_only' | 'offline' } | null>(null);
  async function fillFromWhereIAm() {
    setProblem(null);
    setBusy('where');
    try {
      let fix;
      try {
        fix = await readLocation(locationProvider);
      } catch {
        setProblem(t('device.location.unavailable'));
        return;
      }
      const point = { latitude: fix.latitude, longitude: fix.longitude };
      let found: WhereAmI | null = null;
      let offline = false;
      try {
        found = await queue.live(() => redesign.whereIs(point.latitude, point.longitude));
      } catch {
        offline = true;
      }
      if (found?.address) {
        const filled = fillFromPin({ ...point, placeName: null, address: found.address, shortLink: false }, { shopNumber: false });
        setMapsNote({ tone: 'ok', text: filled.length ? t('addr.filled', { fields: filled.join(', ') }) : t('addr.pinOnly') });
      } else {
        setAutoArea(null);
        set({ pin: point });
        setMapsNote({ tone: offline ? 'error' : 'ok', text: offline ? t('addr.offline') : t('addr.pinOnly') });
      }
      setWhere({
        ...point,
        accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : null,
        words: found?.address?.displayName ?? found?.area ?? null,
        state: found?.address ? 'filled' : offline ? 'offline' : 'pin_only',
      });
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
      // The server needs the board photo and the selfie first: send what is waiting before saving.
      if (visitId && (await queue.flushAndCheck(visitId))) {
        setProblem(t('fa07.photosWaiting'));
        return;
      }
      if (!differentShop && form.pin && form.boardName.trim()) {
        const pin = form.pin;
        const found = await queue
          .live(() => fieldOps.similarShops(form.boardName.trim(), pin.latitude, pin.longitude))
          .then((r) => r.matches[0] ?? null)
          .catch(() => null);
        if (found) {
          setSimilar(found);
          return;
        }
      }
      const created = await queue.live(() => registration.createBusiness(businessBody(form, visitId)));
      clearForm();
      // The visit now belongs to this business and is Onboarded: the phone's copy must say so too.
      if (visitId) updateDraft(visitId, { businessId: created.id, businessName: created.name });
      void client.invalidateQueries({ queryKey: ['field-work'] });
      void client.invalidateQueries({ queryKey: ['field-visits'] });
      void client.invalidateQueries({ queryKey: ['selling'] });
      const linkSent = await visits
        .sendAgreementLink(created.id)
        .then((r) => r?.smsSent !== false)
        .catch(() => false);
      router.replace({
        pathname: routes.visitAgreement,
        params: { businessId: created.id, ...(visitId ? { visitId } : {}), ...(linkSent ? {} : { linkFailed: '1' }) },
      });
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
              onChangeText={(v) => {
                setFieldProblem(key, null);
                update({ ...emptyMobile(), number: v.replace(/\D/g, '').slice(0, 10) });
              }}
              error={mobileProblem[key] ?? (err(key) ? t('fa07.mobileRequired') : null)}
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
        {mobileProblem[key] && !m.verifiedAt ? <Banner tone="error" message={mobileProblem[key]} testID={`fa07-${key}-problem`} /> : null}
      </View>
    );
  }

  const tradeChoices = [...tradeList.map((tr) => ({ value: tr.name, label: tr.name })), { value: OTHER_TRADE, label: t('fa07.otherTrade') }];
  // "Explain Laboura": the business agreement's "In short" from the server, in English
  // (rev 193), with every number filled from Settings (never a number written in the app).
  const inShort = useQuery({
    queryKey: ['legal-document', 'business_agreement', 'en'],
    queryFn: () => legal.document('business_agreement', 'en'),
    staleTime: 3_600_000,
  });

  return (
    <View style={styles.flex} testID="screen-FA07">
      <AppHeader title={t('fa07.header')} />
      <Screen>
        {visitId ? <StepHeader step={4} /> : null}
        <View style={styles.titleRow}>
          <Text variant="h1" style={styles.flex1}>{t('fa07.title')}</Text>
          <Emoji symbol="🏪" size={28} />
        </View>
        <Text variant="muted">{t('fa07.sameForm')}</Text>
        <Banner tone="info" message={t('fa07.requiredNote')} />

        <Card style={styles.gapCard} stripe accent={SECTION_ACCENTS[0]}>
          <Section n={1} title={t('fa07.s1')} />
          <TextField label={t('fa07.contactName')} value={form.contactName} onChangeText={(v) => set({ contactName: v })} error={err('contactName') ? t('fa07.required') : null} testID="fa07-contact-name" />
          <SelectField label={t('fa07.contactRole')} value={form.contactRole} choices={choice(ROLES, 'role')} onChange={(v) => set({ contactRole: v })} error={err('contactRole')} testID="fa07-role" />
          {mobileBlock(form.mobile, (mobile) => set({ mobile }), 'mobile', t('fa07.mobile'))}
          <Toggle label={t('fa07.whatsappSame')} value={form.whatsappSame} onChange={(v) => set({ whatsappSame: v })} />
          {!form.whatsappSame ? (
            <TextField label={t('fa07.whatsapp')} value={form.whatsapp} keyboardType="number-pad" maxLength={10} onChangeText={(v) => set({ whatsapp: v.replace(/\D/g, '') })} error={err('whatsapp') ? t('fa07.mobileInvalid') : null} />
          ) : null}
          <TextField label={t('fa07.billingEmail')} value={form.billingEmail} keyboardType="email-address" autoCapitalize="none" onChangeText={(v) => set({ billingEmail: v })} error={err('billingEmail') ? t('fa07.emailInvalid') : null} />
          <SelectField label={t('fa07.heardFrom')} value={form.heardFrom} choices={choice(HEARD, 'heard')} onChange={(v) => set({ heardFrom: v })} error={err('heardFrom')} />
        </Card>

        <Card style={styles.gapCard} stripe accent={SECTION_ACCENTS[1]}>
          <Section n={2} title={t('fa07.s2')} />
          <TextField label={t('fa07.boardName')} value={form.boardName} onChangeText={(v) => set({ boardName: v })} error={err('boardName') ? t('fa07.required') : null} testID="fa07-board-name" />
          {household ? (
            <TextField label={t('fa07.familyName')} value={form.familyName} onChangeText={(v) => set({ familyName: v })} error={err('familyName') ? t('fa07.required') : null} />
          ) : (
            <>
              {/* 22 Nov (rev 207): "Same as the shop name" fills the legal name and keeps it read-only. */}
              <Toggle label={t('fa07.legalSame')} value={Boolean(form.legalSameAsShop)} onChange={(v) => set({ legalSameAsShop: v })} testID="fa07-legal-same" />
              <TextField
                label={t('fa07.legalName')}
                value={form.legalSameAsShop ? form.boardName : form.legalName}
                editable={!form.legalSameAsShop}
                onChangeText={(v) => set({ legalName: v })}
                testID="fa07-legal-name"
              />
            </>
          )}
          <SelectField
            label={t('fa07.businessType')}
            value={form.businessType}
            choices={BTYPE_CHOICES.some((c) => c.value === form.businessType) || !form.businessType ? BTYPE_CHOICES : [...BTYPE_CHOICES, { value: form.businessType, label: businessTypeLabel(form.businessType), group: undefined }]}
            onChange={(v) => set({ businessType: v })}
            error={err('businessType')}
            searchable
            testID="fa07-type"
          />
          {form.businessType === 'other' ? (
            <TextField
              label={t('fa07.typeOther')}
              value={form.businessTypeOther ?? ''}
              maxLength={80}
              onChangeText={(v) => set({ businessTypeOther: v })}
              error={err('businessTypeOther') ? t('fa07.typeOtherRequired') : null}
              testID="fa07-type-other"
            />
          ) : null}
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

        <Card style={styles.gapCard} stripe accent={SECTION_ACCENTS[2]}>
          <Section n={3} title={t('fa07.s3')} />
          <Button
            label={busy === 'where' ? t('addr.finding') : t('addr.useWhereIAm')}
            icon={<Text color={colors.white}>📍</Text>}
            loading={busy === 'where'}
            onPress={() => void fillFromWhereIAm()}
            testID="fa07-where"
          />
          {where ? (
            <View style={styles.block} testID="fa07-where-preview">
              <TileMap
                center={where}
                markers={[{ key: 'pin', latitude: where.latitude, longitude: where.longitude, color: colors.tomato, label: '📍' }]}
                attribution={t('fa13.attribution')}
                height={170}
                zoom={17}
                testID="fa07-where-map"
              />
              <Text variant="bodyStrong">{t('addr.checkMap')}</Text>
              {where.words ? (
                <Text variant="small" testID="fa07-where-words">{where.words}</Text>
              ) : (
                <PlaceLine latitude={where.latitude} longitude={where.longitude} accuracy={where.accuracy} testID="fa07-where-words" />
              )}
            </View>
          ) : null}
          <PinFinder label={t('addr.orType')} hint={t('fa07.mapsLinkHint')} onConfirm={(found) => void fillFromPin(found)} testID="fa07-maps" />
          {mapsNote ? (
            <Text variant="small" color={mapsNote.tone === 'ok' ? colors.greenText : colors.tomato} testID="fa07-maps-note">
              {mapsNote.text}
            </Text>
          ) : null}
          <TextField label={t('fa07.shopNumber')} value={form.shopNumber} onChangeText={(v) => set({ shopNumber: v })} error={err('shopNumber') ? t('fa07.required') : null} />
          <TextField label={t('fa07.street')} value={form.street} onChangeText={(v) => set({ street: v })} error={err('street') ? t('fa07.required') : null} />
          <TextField label={t('fa07.landmark')} value={form.landmark} onChangeText={(v) => set({ landmark: v })} error={err('landmark') ? t('fa07.required') : null} />
          <SelectField
            label={t('fa07.area')}
            value={form.area}
            choices={(options.data?.areas ?? []).map((a) => ({ value: a.name, label: a.name }))}
            onChange={(v) => {
              const area = options.data?.areas.find((a) => a.name === v);
              setAutoArea(null);
              set({ area: v, pincode: form.pincode || area?.pincode || '' });
            }}
            error={err('area')}
            testID="fa07-area"
          />
          {autoArea && form.area === autoArea ? (
            <Text variant="muted" testID="fa07-area-from-pin">{t('fa07.areaFromPin', { distance: distanceText(areaMaxMeters) })}</Text>
          ) : noAreaNear && !form.area ? (
            <Text variant="small" color={err('area') ? colors.tomato : colors.amber} testID="fa07-area-none-near">
              {t('fa07.areaNoneNear', { distance: distanceText(areaMaxMeters) })}
            </Text>
          ) : null}
          <TextField label={t('fa07.pincode')} value={form.pincode} keyboardType="number-pad" maxLength={6} onChangeText={(v) => set({ pincode: v.replace(/\D/g, '') })} error={err('pincode') ? t('fa07.pincodeInvalid') : null} testID="fa07-pincode" />
          <TextField label={t('fa07.cityLabel')} value={form.city ?? DEFAULT_CITY} onChangeText={(v) => set({ city: v })} hint={t('fa07.cityHint')} maxLength={60} testID="fa07-city" />
          <View style={styles.inline}>
            <View style={styles.flex1} testID="fa07-pin-line">
              {form.pin ? (
                <>
                  <Text variant="small">{`📍 ${t('fa07.pinSet')}`}</Text>
                  <PlaceLine latitude={form.pin.latitude} longitude={form.pin.longitude} variant="muted" coordinates testID="fa07-pin-place" />
                </>
              ) : (
                <Text variant="small">{t('fa07.pinMissing')}</Text>
              )}
            </View>
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
          <Card style={styles.gapCard} stripe accent={SECTION_ACCENTS[3]}>
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
            {/* 25 Nov (rev 211–212): the Maps link proof, a business run from home, and the proof count. */}
            <TextField label={t('fa07.mapsLink')} placeholder="https://maps.app.goo.gl/…" value={form.mapsLink ?? ''} autoCapitalize="none" onChangeText={(v) => set({ mapsLink: v })} testID="fa07-maps-link" />
            <Toggle label={t('fa07.runsFromHome')} value={Boolean(form.runsFromHome)} onChange={(v) => set({ runsFromHome: v })} />
            <Text variant="muted" testID="fa07-proof-count">
              {proofCount(form) >= 2 ? t('fa07.proofsEnough', { count: proofCount(form) }) : t('fa07.proofsSmall', { count: proofCount(form) })}
            </Text>
          </Card>
        ) : null}

        <Card style={styles.gapCard} stripe accent={SECTION_ACCENTS[4]}>
          <Section n={5} title={t('fa07.s5')} />
          <Text variant="muted" testID="fa07-staff-optional">{t('fa07.staffOptional')}</Text>
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
                    {/* 21 Nov: a usual pay below the legal minimum never reads as advice to pay less. */}
                    {trade.legalMinimumPaise > trade.salaryMinPaise
                      ? ` ${t('fa07.tradeHintLegal', { amount: (trade.legalMinimumPaise / 100).toLocaleString('en-IN') })}`
                      : ''}
                  </Text>
                ) : null}
                {below ? (
                  <>
                    {/* 21 Nov: the owner-told tick is asked once, when the vacancy is sent to the owner (where it is recorded). */}
                    <Banner tone="warn" title={t('fa07.belowMinimum')} message={t('fa07.belowMinimumOnce', { amount: (trade!.legalMinimumPaise / 100).toLocaleString('en-IN') })} testID={`fa07-staff-${i}-below`} />
                  </>
                ) : null}
                <Button label={t('fa07.remove')} variant="danger" onPress={() => set({ staff: form.staff.filter((_, j) => j !== i) })} testID={`fa07-staff-${i}-remove`} />
              </View>
            );
          })}
          <Button label={t('fa07.addRole')} variant="secondary" onPress={() => set({ staff: [...form.staff, emptyRow()] })} testID="fa07-add-role" />
        </Card>

        <Card style={styles.gapCard} stripe accent={SECTION_ACCENTS[5]}>
          <Section n={6} title={t('fa07.s6')} />
          <View style={styles.script} testID="fa07-script">
            {inShort.data ? (
              <Text>{inShortText(inShort.data)}</Text>
            ) : inShort.isError ? (
              <Button label={t('common.retry')} variant="secondary" onPress={() => void inShort.refetch()} />
            ) : (
              <LoadingState compact />
            )}
          </View>
          <Text variant="muted">{t('fa07.ownerAgrees')}</Text>
        </Card>

        {similar && !differentShop ? (
          <Card stripe accent="red" testID="fa07-similar">
            <Text variant="h2">{t('dup.title')}</Text>
            <Text>{t('dup.body', { name: similar.name, code: similar.code, meters: similar.distanceMeters })}</Text>
            <Text variant="muted">{t('dup.tl')}</Text>
            <View style={styles.dupButtons}>
              <Button
                label={t('dup.revisit')}
                onPress={() => router.replace({ pathname: routes.visitStart, params: { businessId: similar.id, name: similar.name } })}
                testID="fa07-similar-revisit"
              />
              <Button
                label={t('dup.different')}
                variant="secondary"
                onPress={() => {
                  setDifferentShop(true);
                  setSimilar(null);
                }}
                testID="fa07-similar-different"
              />
            </View>
          </Card>
        ) : null}
        {problem ? <Banner tone="error" message={problem} testID="fa07-problem" /> : null}
        <Button label={t('fa07.save')} loading={busy === 'save'} onPress={() => void save()} testID="fa07-save" />
      </Screen>
    </View>
  );
}

/** Each section of the form has its own calm accent: the stripe and the numbered disc. */
const SECTION_ACCENTS: Accent[] = ['royal', 'cyan', 'gold', 'navy', 'orange', 'green'];

function Section({ n, title }: { n: number; title: string }) {
  const a = accents[SECTION_ACCENTS[(n - 1) % SECTION_ACCENTS.length]];
  return (
    <View style={styles.section}>
      <View style={[styles.num, { backgroundColor: a.raw }]}>
        <Text style={[styles.numText, { color: a.on }]}>{n}</Text>
      </View>
      <Text variant="h2" style={styles.flex1}>
        {title}
      </Text>
    </View>
  );
}

function Toggle({ label, value, onChange, error, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; error?: boolean; testID?: string }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)} style={styles.toggle} testID={testID}>
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
  dupButtons: { gap: 8, marginTop: 8 },
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
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  numText: { color: colors.white, fontFamily: fonts.display700, fontSize: 13 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: touch.min },
  box: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.blue, borderColor: colors.blue },
  boxError: { borderColor: colors.tomato },
  tick: { color: colors.white, fontFamily: fonts.body700, fontSize: 13 },
  branch: { gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  money: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  rupee: { fontFamily: fonts.body700, fontSize: 18, color: colors.ink, paddingBottom: 12 },
  script: { gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: colors.blue100, borderLeftWidth: 4, borderLeftColor: colors.cyanRaw, marginBottom: 8 },
});
