import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BusinessDetail, CreatedVacancy } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { Banner, Button, Card, Emoji, Screen, Text, TextField } from '@/components';
import { Checkbox, DateField, MoneyField, SelectField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useFormDraft } from '@/lib/formDraft';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { useSellingRoutes } from '@/navigation/useFlow';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { BusinessHeader, BusinessTypeAhead, ErrorBanner, formatRupees, QueryView, useParam } from '../_selling';
import { AddShiftForm, useBusinessShifts } from '../_business/Shifts';
import {
  EMPTY_VACANCY, findTrade, HEADCOUNTS, isBelowLegalMinimum, legalMinimumFor, OTHER_TRADE, QUICK_EXTRAS, tradeNameOf,
  vacancyBody, vacancyErrors, type QuickVacancy, type VacancyError,
} from './payload';

const EXTRA_KEYS = { food: 'fa17.extra.food', accommodation: 'fa17.extra.stay', pf_esi: 'fa17.extra.pfEsi', uniform: 'fa17.extra.uniform' } as const;
const ERROR_KEYS = {
  trade: 'fa17.err.trade',
  salaryMin: 'fa17.err.salaryMin',
  salaryOrder: 'fa17.err.salaryOrder',
  ownerTold: 'fa17.err.ownerTold',
  shift: 'fa17.err.required',
  startDate: 'fa17.err.required',
} as const;

/**
 * FA17 — Add a vacancy: the quick form on the phone. Role from the CEO's
 * trade list (with the market range as a hint), how many, salary from / up
 * to (₹ boxes), the legal-minimum warning with "Owner told" tick, one of
 * the business's own shifts (17 Nov; "+ Add a shift" right here),
 * needed from (calendar), extras. Saving sends the contact person an OTP
 * (FA17b), so every vacancy is confirmed by the business. Without signal the
 * form is saved on the phone and sent later; the owner then confirms from
 * the Vacancies tab or the SMS link.
 */
export default function AddVacancyScreen() {
  const sr = useSellingRoutes();
  const { t } = useI18n();
  const businessId = useParam('businessId');
  const { selling } = useEndpoints();
  const business = useQuery({ queryKey: queryKeys.sellingBusiness(businessId), queryFn: () => selling.business(businessId), enabled: !!businessId });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa17.subtitle')} />
      <Screen testID="screen-FA17">
        <View style={styles.titleRow}>
          <Text variant="h2" style={styles.title}>{t('fa17.title')}</Text>
          <Emoji symbol="🧑‍🍳" size={24} />
        </View>
        {businessId ? (
          <QueryView query={business}>{(b) => <Form business={b} />}</QueryView>
        ) : (
          <BusinessTypeAhead
            hintKey="fa19.hint"
            onPick={(b) => router.replace(sr.addVacancy(b.id))}
            onRegister={() => router.push(routes.visitStart)}
          />
        )}
      </Screen>
    </View>
  );
}

function Form({ business }: { business: BusinessDetail }) {
  const sr = useSellingRoutes();
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  // Rev 193: the legal minimum warned about is the one for this business's zone.
  const trades = useQuery({ queryKey: [...queryKeys.trades, business.id], queryFn: () => selling.trades(business.id), staleTime: 10 * 60_000 });
  const [form, setForm, clearForm] = useFormDraft<QuickVacancy>(`fa17:${business.id}`, EMPTY_VACANCY);
  const [tried, setTried] = useState(false);
  const [queued, setQueued] = useState(false);
  const set = <K extends keyof QuickVacancy>(key: K, value: QuickVacancy[K]) => setForm((f) => ({ ...f, [key]: value }));
  // 26 Nov: the server's own answer for this trade (it checks a typed trade as unskilled, for the business's zone).
  const [serverMinimum, setServerMinimum] = useState<{ trade: string; legalMinimumPaise: number } | null>(null);
  const trade = findTrade(trades.data, tradeNameOf(form));
  const legalMinimum = legalMinimumFor(trades.data, tradeNameOf(form), serverMinimum);
  const errors = vacancyErrors(form, legalMinimum);
  const err = (key: VacancyError) => (tried && errors.includes(key) ? t(ERROR_KEYS[key]) : null);
  const below = isBelowLegalMinimum(legalMinimum, form.salaryMinPaise);

  const save = useMutation({
    mutationFn: () =>
      queue.submit<CreatedVacancy>(t('fa17.queuedLabel', { trade: tradeNameOf(form), business: business.name }), {
        method: 'POST',
        path: '/vacancies',
        json: vacancyBody(business.id, form),
      }),
    onError: (error) => {
      const body = isApiError(error) ? (error.body as { code?: string; legalMinimumPaise?: number } | null) : null;
      if (body?.code === 'MINIMUM_WAGE_TICK_REQUIRED' && typeof body.legalMinimumPaise === 'number') {
        // Show the warning and the "Owner told" tick instead of the server's raw message.
        setServerMinimum({ trade: tradeNameOf(form), legalMinimumPaise: body.legalMinimumPaise });
        set('ownerTold', false);
      }
    },
    onSuccess: (result) => {
      clearForm();
      void client.invalidateQueries({ queryKey: ['selling'] });
      void client.invalidateQueries({ queryKey: ['field-work'] });
      if (result.status === 'queued') {
        setQueued(true);
        return;
      }
      const created = result.response;
      if (!created?.id) return;
      const sent = created.confirmation && 'otpRequestId' in created.confirmation ? created.confirmation : null;
      router.replace(`${sr.confirmVacancy(created.id)}${sent ? `?otp=${encodeURIComponent(sent.otpRequestId)}&last4=${sent.sentToLast4}` : ''}`);
    },
  });

  const submit = () => {
    setTried(true);
    if (errors.length === 0) save.mutate();
  };

  if (queued) {
    return (
      <Banner
        tone="info"
        title={t('fa03.waitingToSend')}
        message={t('fa17.queuedBody')}
        action={<Button label={t('fa17.backToBusiness')} variant="secondary" onPress={() => router.replace(sr.business(business.id))} />}
        testID="vacancy-queued"
      />
    );
  }

  const tradeChoices = [
    ...(trades.data ?? []).map((tr) => ({ value: tr.name, label: tr.name })),
    { value: OTHER_TRADE, label: t('fa17.otherTrade') },
  ];
  return (
    <>
      <Card>
        <BusinessHeader name={business.name} sub={[business.code, business.locality].filter(Boolean).join(' · ')} onChange={() => router.replace(sr.addVacancy())} />
      </Card>
      <Card stripe accent="orange">
        <View style={styles.gap}>
          <SelectField label={t('fa17.role')} required value={form.trade} choices={tradeChoices} onChange={(v) => set('trade', v)} error={err('trade')} testID="role" />
          {form.trade === OTHER_TRADE ? (
            <TextField label={t('fa17.typeTrade')} value={form.otherTrade} onChangeText={(v) => set('otherTrade', v)} hint={t('fa17.newTrade')} testID="other-trade" />
          ) : null}
          <SelectField
            label={t('fa17.howMany')}
            required
            value={form.headcount}
            choices={HEADCOUNTS.map((h) => ({ value: h, label: h === '5' ? '5+' : h }))}
            onChange={(v) => set('headcount', v)}
            testID="headcount"
          />
          {trade ? (
            <Banner
              tone="info"
              message={t('fa17.marketHint', { trade: trade.name, min: formatRupees(trade.salaryMinPaise), max: formatRupees(trade.salaryMaxPaise).replace('₹', '') })}
              testID="market-hint"
            />
          ) : null}
          <MoneyField label={t('fa17.salaryFrom')} required valuePaise={form.salaryMinPaise} onChange={(v) => set('salaryMinPaise', v)} error={err('salaryMin')} testID="salary-min" />
          <MoneyField label={t('fa17.salaryTo')} valuePaise={form.salaryMaxPaise} onChange={(v) => set('salaryMaxPaise', v)} error={err('salaryOrder')} testID="salary-max" />
          {below && legalMinimum ? (
            <>
              <Banner tone="warn" title={t('fa17.belowTitle')} message={t('fa17.belowBody', { amount: formatRupees(legalMinimum) })} testID="below-minimum" />
              <Checkbox label={t('fa17.ownerTold')} checked={form.ownerTold} onChange={(v) => set('ownerTold', v)} testID="owner-told" />
              {err('ownerTold') ? <Text variant="small" color={colors.tomato}>{err('ownerTold')}</Text> : null}
            </>
          ) : null}
          <ShiftPicker businessId={business.id} value={form.businessShiftId} onChange={(id) => set('businessShiftId', id)} error={err('shift')} />
          <DateField label={t('fa17.neededFrom')} required value={form.startDate} onChange={(v) => set('startDate', v)} min={todayKeyIst()} error={err('startDate')} testID="start-date" />
          <Text variant="small" style={styles.extrasLabel}>{t('fa17.extras')}</Text>
          <View style={styles.extras}>
            {QUICK_EXTRAS.map((x) => (
              <View key={x} style={styles.extra}>
                <Checkbox
                  label={t(EXTRA_KEYS[x])}
                  checked={form.extras.includes(x)}
                  onChange={(on) => set('extras', on ? [...form.extras, x] : form.extras.filter((y) => y !== x))}
                  testID={`extra-${x}`}
                />
              </View>
            ))}
          </View>
        </View>
      </Card>
      <ErrorBanner error={isMinimumWageError(save.error) && below ? null : save.error} />
      <Button label={t('fa17.save')} loading={save.isPending} onPress={submit} testID="save-vacancy" />
    </>
  );
}

function isMinimumWageError(error: unknown): boolean {
  return isApiError(error) && (error.body as { code?: string } | null)?.code === 'MINIMUM_WAGE_TICK_REQUIRED';
}

const ADD_SHIFT = '__add__';

/** The vacancy's shift: one of the business's own shifts, or add one here (17 Nov). */
function ShiftPicker({ businessId, value, onChange, error }: { businessId: string; value: string; onChange: (id: string) => void; error: string | null }) {
  const { t } = useI18n();
  const shifts = useBusinessShifts(businessId);
  const list = shifts.data ?? [];
  const [adding, setAdding] = useState(false);
  const showForm = adding || (shifts.isSuccess && list.length === 0);
  return (
    <View style={styles.gap} testID="shift-picker">
      {list.length > 0 ? (
        <SelectField
          label={t('shifts.pick')}
          required
          value={value}
          choices={[...list.map((s) => ({ value: s.id, label: s.label })), { value: ADD_SHIFT, label: t('shifts.addForBusiness') }]}
          onChange={(v) => (v === ADD_SHIFT ? setAdding(true) : onChange(v))}
          error={showForm ? null : error}
          hint={t('shifts.pickHint')}
          testID="shift"
        />
      ) : (
        <Text variant="small" style={styles.extrasLabel}>{t('shifts.pick')} *</Text>
      )}
      {shifts.isSuccess && list.length === 0 ? <Text variant="muted">{t('shifts.none')}</Text> : null}
      {showForm ? (
        <AddShiftForm
          businessId={businessId}
          onAdded={(shift) => {
            onChange(shift.id);
            setAdding(false);
          }}
          onCancel={list.length > 0 ? () => setAdding(false) : undefined}
          testID="vacancy-add-shift"
        />
      ) : null}
      {showForm && error ? <Text variant="small" color={colors.tomato}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { gap: 12 },
  title: { fontSize: 17, flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  extrasLabel: { color: colors.soft },
  extras: { flexDirection: 'row', flexWrap: 'wrap' },
  extra: { width: '50%' },
});
