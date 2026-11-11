import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BusinessDetail, CreatedVacancy } from '@/api/endpoints';
import { Banner, Button, Card, Screen, Text, TextField } from '@/components';
import { Checkbox, DateField, MoneyField, SelectField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { routes, sellingRoutes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { BusinessHeader, BusinessTypeAhead, ErrorBanner, formatRupees, QueryView, SHIFT_KEYS, useParam } from '../_selling';
import {
  EMPTY_VACANCY, findTrade, HEADCOUNTS, isBelowLegalMinimum, OTHER_TRADE, QUICK_EXTRAS, tradeNameOf, VACANCY_SHIFTS,
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
 * to (₹ boxes), the legal-minimum warning with "Owner told" tick, shift,
 * needed from (calendar), extras. Saving sends the contact person an OTP
 * (FA17b), so every vacancy is confirmed by the business. Without signal the
 * form is saved on the phone and sent later; the owner then confirms from
 * the Vacancies tab or the SMS link.
 */
export default function AddVacancyScreen() {
  const { t } = useI18n();
  const businessId = useParam('businessId');
  const { selling } = useEndpoints();
  const business = useQuery({ queryKey: queryKeys.sellingBusiness(businessId), queryFn: () => selling.business(businessId), enabled: !!businessId });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa17.subtitle')} />
      <Screen testID="screen-FA17">
        <Text variant="h2" style={styles.title}>{t('fa17.title')}</Text>
        {businessId ? (
          <QueryView query={business}>{(b) => <Form business={b} />}</QueryView>
        ) : (
          <BusinessTypeAhead
            hintKey="fa19.hint"
            onPick={(b) => router.replace(sellingRoutes.addVacancy(b.id))}
            onRegister={() => router.push(routes.visitStart)}
          />
        )}
      </Screen>
    </View>
  );
}

function Form({ business }: { business: BusinessDetail }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const trades = useQuery({ queryKey: queryKeys.trades, queryFn: () => selling.trades(), staleTime: 10 * 60_000 });
  const [form, setForm] = useState<QuickVacancy>(EMPTY_VACANCY);
  const [tried, setTried] = useState(false);
  const [queued, setQueued] = useState(false);
  const set = <K extends keyof QuickVacancy>(key: K, value: QuickVacancy[K]) => setForm((f) => ({ ...f, [key]: value }));
  const trade = findTrade(trades.data, tradeNameOf(form));
  const errors = vacancyErrors(form, trade);
  const err = (key: VacancyError) => (tried && errors.includes(key) ? t(ERROR_KEYS[key]) : null);
  const below = isBelowLegalMinimum(trade, form.salaryMinPaise);

  const save = useMutation({
    mutationFn: () =>
      queue.submit<CreatedVacancy>(t('fa17.queuedLabel', { trade: tradeNameOf(form), business: business.name }), {
        method: 'POST',
        path: '/vacancies',
        json: vacancyBody(business.id, form),
      }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['selling'] });
      if (result.status === 'queued') {
        setQueued(true);
        return;
      }
      const created = result.response;
      if (!created?.id) return;
      const sent = created.confirmation && 'otpRequestId' in created.confirmation ? created.confirmation : null;
      router.replace(`${sellingRoutes.confirmVacancy(created.id)}${sent ? `?otp=${encodeURIComponent(sent.otpRequestId)}&last4=${sent.sentToLast4}` : ''}`);
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
        action={<Button label={t('fa17.backToVacancies')} variant="secondary" onPress={() => router.replace(routes.vacancies)} />}
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
        <BusinessHeader name={business.name} sub={[business.code, business.locality].filter(Boolean).join(' · ')} onChange={() => router.replace(routes.vacancies)} />
      </Card>
      <Card>
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
          {below && trade ? (
            <>
              <Banner tone="warn" title={t('fa17.belowTitle')} message={t('fa17.belowBody', { amount: formatRupees(trade.legalMinimumPaise) })} testID="below-minimum" />
              <Checkbox label={t('fa17.ownerTold')} checked={form.ownerTold} onChange={(v) => set('ownerTold', v)} testID="owner-told" />
              {err('ownerTold') ? <Text variant="small" color={colors.tomato}>{err('ownerTold')}</Text> : null}
            </>
          ) : null}
          <SelectField
            label={t('fa17.shift')}
            required
            value={form.shift}
            choices={VACANCY_SHIFTS.map((s) => ({ value: s, label: t(SHIFT_KEYS[s]) }))}
            onChange={(v) => set('shift', v)}
            error={err('shift')}
            testID="shift"
          />
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
      <ErrorBanner error={save.error} />
      <Button label={t('fa17.save')} loading={save.isPending} onPress={submit} testID="save-vacancy" />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { gap: 12 },
  title: { fontSize: 17 },
  extrasLabel: { color: colors.soft },
  extras: { flexDirection: 'row', flexWrap: 'wrap' },
  extra: { width: '50%' },
});
