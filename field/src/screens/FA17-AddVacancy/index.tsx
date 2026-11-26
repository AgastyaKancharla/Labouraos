import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { errorCode, type BusinessDetail, type BusinessShift, type CreatedVacancies, type OtpSent } from '@/api/endpoints';
import { Banner, Button, Card, Emoji, HeroCard, Screen, SendLinkButtons, Text, TextField, type SendChannel } from '@/components';
import { Checkbox, DateField, formatClock, MoneyField, SelectField, TimeField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useFormDraft } from '@/lib/formDraft';
import { useI18n } from '@/i18n';
import { routes } from '@/navigation/routes';
import { useSellingRoutes } from '@/navigation/useFlow';
import { colors, radius, touch } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { BusinessHeader, BusinessTypeAhead, ErrorBanner, formatRupees, Note, QueryView, useParam } from '../_selling';
import { OtpStep } from '../_selling/OtpStep';
import { SHIFT_PRESETS, shiftNameFor, useBusinessShifts } from '../_business/Shifts';
import {
  anotherShift, EMPTY_VACANCY, EXPERIENCE_CHOICES, findTrade, HEADCOUNTS, isBelowLegalMinimum, legalMinimumFor, MAX_VACANCIES, NOTE_MAX,
  OTHER_TRADE, QUICK_EXTRAS, tradeNameOf, vacancyErrors, vacancyRow, type QuickVacancy, type VacancyError,
} from './payload';

const EXTRA_KEYS = { food: 'fa17.extra.food', accommodation: 'fa17.extra.stay', pf_esi: 'fa17.extra.pfEsi', uniform: 'fa17.extra.uniform' } as const;
const ERROR_KEYS = {
  trade: 'fa17.err.trade',
  salaryMin: 'fa17.err.salaryMin',
  salaryOrder: 'fa17.err.salaryOrder',
  ownerTold: 'fa17.err.ownerTold',
  shift: 'fa17.err.shift',
  startDate: 'fa17.err.required',
  experience: 'fa17.err.experience',
  note: 'fa17.err.note',
} as const;

/**
 * FA17 — Add vacancies: the quick form on the phone. Each vacancy is a card: role from the CEO's trade list
 * (with the market range as a hint), how many, experience needed, salary from / up to (₹ boxes), the
 * legal-minimum warning with "Owner told" tick, the shift (tap one of the business's shifts or a usual one,
 * or set the start and end on the clock: a new shift is saved to the business), needed from (calendar),
 * extras and a note (26 Nov). "+ Same role, another shift" copies the card for two people on different
 * shifts; "+ Another role" adds an empty card. One Save sends them all, and the owner confirms all of them
 * with ONE code (POST /vacancies/batch, /vacancies/batch/send-code, /vacancies/batch/confirm), or later by
 * the links. Needs signal: the owner confirms live.
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
  const { selling, redesign } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  // Rev 193: the legal minimum warned about is the one for this business's zone.
  const trades = useQuery({ queryKey: [...queryKeys.trades, business.id], queryFn: () => selling.trades(business.id), staleTime: 10 * 60_000 });
  const shifts = useBusinessShifts(business.id);
  const [cards, setCards, clearCards] = useFormDraft<QuickVacancy[]>(`fa17v2:${business.id}`, [EMPTY_VACANCY]);
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState<CreatedVacancies | null>(null);
  // The server's own legal minimum per card (it checks a typed trade as unskilled, for the business's zone).
  const [serverMinimums, setServerMinimums] = useState<Record<number, { trade: string; legalMinimumPaise: number }>>({});
  const update = (i: number, next: QuickVacancy) => setCards((list) => list.map((c, j) => (j === i ? next : c)));
  const minimumOf = (i: number) => legalMinimumFor(trades.data, tradeNameOf(cards[i]), serverMinimums[i] ?? null);
  const errorsOf = (i: number) => vacancyErrors(cards[i], minimumOf(i));
  const firstBad = cards.findIndex((_, i) => errorsOf(i).length > 0);

  const save = useMutation({
    mutationFn: () =>
      queue.live(async () => {
        // A shift set on the clock becomes one of the business's shifts (same times → the same shift).
        const list: BusinessShift[] = [...(shifts.data ?? (await redesign.shifts(business.id)))];
        const ids: string[] = [];
        for (const c of cards) {
          if (c.businessShiftId) {
            ids.push(c.businessShiftId);
            continue;
          }
          const same = list.find((s) => s.startTime === c.shiftStart && s.endTime === c.shiftEnd);
          if (same) {
            ids.push(same.id);
            continue;
          }
          const created = await redesign.addShift(business.id, { name: uniqueShiftName(c.shiftName.trim() || shiftNameFor(c.shiftStart), list), startTime: c.shiftStart, endTime: c.shiftEnd });
          list.push(created);
          ids.push(created.id);
        }
        client.setQueryData(queryKeys.businessShifts(business.id), list);
        return selling.createVacancies(business.id, cards.map((c, i) => vacancyRow(c, ids[i])));
      }),
    onError: (error) => {
      const d = errorDetails(error);
      if (d?.code === 'MINIMUM_WAGE_TICK_REQUIRED' && typeof d.vacancyIndex === 'number' && typeof d.legalMinimumPaise === 'number') {
        // Show that card's warning and "Owner told" tick instead of the server's message.
        const i = d.vacancyIndex;
        setServerMinimums((m) => ({ ...m, [i]: { trade: tradeNameOf(cards[i]), legalMinimumPaise: d.legalMinimumPaise as number } }));
        update(i, { ...cards[i], ownerTold: false });
        setTried(true);
      }
    },
    onSuccess: (result) => {
      clearCards();
      void client.invalidateQueries({ queryKey: ['selling'] });
      void client.invalidateQueries({ queryKey: ['field-work'] });
      setSaved(result);
    },
  });

  if (saved) return <ConfirmAll business={business} saved={saved} />;

  const submit = () => {
    setTried(true);
    if (firstBad === -1) save.mutate();
  };
  const tradeChoices = [
    ...(trades.data ?? []).map((tr) => ({ value: tr.name, label: tr.name })),
    { value: OTHER_TRADE, label: t('fa17.otherTrade') },
  ];
  const errorCodeNow = save.error ? errorCode(save.error) : null;
  return (
    <>
      <Card>
        <BusinessHeader name={business.name} sub={[business.code, business.locality].filter(Boolean).join(' · ')} onChange={() => router.replace(sr.addVacancy())} />
      </Card>
      {cards.map((card, i) => (
        <VacancyCard
          key={i}
          index={i}
          count={cards.length}
          form={card}
          onChange={(next) => update(i, next)}
          onRemove={cards.length > 1 ? () => setCards((list) => list.filter((_, j) => j !== i)) : undefined}
          tradeChoices={tradeChoices}
          trades={trades.data}
          shifts={shifts.data ?? []}
          legalMinimum={minimumOf(i)}
          errors={tried ? errorsOf(i) : []}
        />
      ))}
      {cards.length < MAX_VACANCIES ? (
        <View style={styles.addRow}>
          <Button label={t('fa17.addSameRole')} variant="secondary" style={styles.addButton} onPress={() => setCards((list) => [...list, anotherShift(list[list.length - 1])])} testID="add-same-role" />
          <Button label={t('fa17.addAnotherRole')} variant="secondary" style={styles.addButton} onPress={() => setCards((list) => [...list, { ...EMPTY_VACANCY, startDate: list[list.length - 1].startDate }])} testID="add-another-role" />
        </View>
      ) : null}
      {tried && firstBad !== -1 ? <Banner tone="error" message={t('fa17.err.card', { n: firstBad + 1 })} testID="card-error" /> : null}
      {save.error && errorCodeNow !== 'MINIMUM_WAGE_TICK_REQUIRED' ? <ErrorBanner error={save.error} /> : null}
      <Button
        label={cards.length > 1 ? t('fa17.saveMany', { n: cards.length }) : t('fa17.save')}
        loading={save.isPending}
        onPress={submit}
        testID="save-vacancy"
      />
    </>
  );

}

/** A shift name the business does not have yet ("Morning", then "Morning 2"…). */
function uniqueShiftName(name: string, list: readonly BusinessShift[]): string {
  const taken = new Set(list.map((s) => s.name.trim().toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n += 1) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

/** The fields of an error answer (the server sends them under `details`). */
export function errorDetails(error: unknown): Record<string, unknown> | null {
  const body = (error as { body?: unknown } | null)?.body;
  if (!body || typeof body !== 'object') return null;
  const details = (body as { details?: unknown }).details;
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : (body as Record<string, unknown>);
}

function VacancyCard({ index, count, form, onChange, onRemove, tradeChoices, trades, shifts, legalMinimum, errors }: {
  index: number;
  count: number;
  form: QuickVacancy;
  onChange: (next: QuickVacancy) => void;
  onRemove?: () => void;
  tradeChoices: { value: string; label: string }[];
  trades: Parameters<typeof findTrade>[0];
  shifts: readonly BusinessShift[];
  legalMinimum: number | null;
  errors: VacancyError[];
}) {
  const { t } = useI18n();
  // The first card keeps the screen's old test ids; the others add their number.
  const id = (base: string) => (index === 0 ? base : `${base}-${index}`);
  const set = <K extends keyof QuickVacancy>(key: K, value: QuickVacancy[K]) => onChange({ ...form, [key]: value });
  const err = (key: VacancyError) => (errors.includes(key) ? t(ERROR_KEYS[key]) : null);
  const trade = findTrade(trades, tradeNameOf(form));
  const below = isBelowLegalMinimum(legalMinimum, form.salaryMinPaise);
  return (
    <Card stripe accent={index % 2 === 0 ? 'orange' : 'cyan'} testID={id('vacancy-card')}>
      <View style={styles.gap}>
        {count > 1 ? (
          <View style={styles.cardHead}>
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa17.card', { n: index + 1 })}</Text>
            {onRemove ? <Button label={t('fa17.remove')} variant="secondary" onPress={onRemove} testID={`remove-vacancy-${index}`} /> : null}
          </View>
        ) : null}
        <SelectField label={t('fa17.role')} required value={form.trade} choices={tradeChoices} onChange={(v) => set('trade', v)} error={err('trade')} testID={id('role')} />
        {form.trade === OTHER_TRADE ? (
          <TextField label={t('fa17.typeTrade')} value={form.otherTrade} onChangeText={(v) => set('otherTrade', v)} hint={t('fa17.newTrade')} testID={id('other-trade')} />
        ) : null}
        <SelectField
          label={t('fa17.howMany')}
          required
          value={form.headcount}
          choices={HEADCOUNTS.map((h) => ({ value: h, label: h === '5' ? '5+' : h }))}
          onChange={(v) => set('headcount', v)}
          testID={id('headcount')}
        />
        <SelectField
          label={t('fa17.experience')}
          required
          value={form.experience}
          choices={EXPERIENCE_CHOICES.map((x) => ({ value: x, label: t(`fa17.exp.${x}` as const) }))}
          onChange={(v) => set('experience', v)}
          error={err('experience')}
          testID={id('experience')}
        />
        {trade ? (
          <Banner
            tone="info"
            message={t('fa17.marketHint', { trade: trade.name, min: formatRupees(trade.salaryMinPaise), max: formatRupees(trade.salaryMaxPaise).replace('₹', '') })}
            testID={id('market-hint')}
          />
        ) : null}
        <MoneyField label={t('fa17.salaryFrom')} required valuePaise={form.salaryMinPaise} onChange={(v) => set('salaryMinPaise', v)} error={err('salaryMin')} testID={id('salary-min')} />
        <MoneyField label={t('fa17.salaryTo')} valuePaise={form.salaryMaxPaise} onChange={(v) => set('salaryMaxPaise', v)} error={err('salaryOrder')} testID={id('salary-max')} />
        {below && legalMinimum ? (
          <>
            <Banner tone="warn" title={t('fa17.belowTitle')} message={t('fa17.belowBody', { amount: formatRupees(legalMinimum) })} testID={id('below-minimum')} />
            <Checkbox label={t('fa17.ownerTold')} checked={form.ownerTold} onChange={(v) => set('ownerTold', v)} testID={id('owner-told')} />
            {err('ownerTold') ? <Text variant="small" color={colors.tomato}>{err('ownerTold')}</Text> : null}
          </>
        ) : null}
        <ShiftChooser form={form} onChange={onChange} shifts={shifts} error={err('shift')} id={id} />
        <DateField label={t('fa17.neededFrom')} required value={form.startDate} onChange={(v) => set('startDate', v)} min={todayKeyIst()} error={err('startDate')} testID={id('start-date')} />
        <Text variant="small" style={styles.extrasLabel}>{t('fa17.extras')}</Text>
        <View style={styles.extras}>
          {QUICK_EXTRAS.map((x) => (
            <View key={x} style={styles.extra}>
              <Checkbox
                label={t(EXTRA_KEYS[x])}
                checked={form.extras.includes(x)}
                onChange={(on) => set('extras', on ? [...form.extras, x] : form.extras.filter((y) => y !== x))}
                testID={id(`extra-${x}`)}
              />
            </View>
          ))}
        </View>
        <TextField
          label={t('fa17.note')}
          value={form.note}
          onChangeText={(v) => set('note', v)}
          hint={t('fa17.noteHint')}
          error={err('note')}
          multiline
          maxLength={NOTE_MAX}
          testID={id('note')}
        />
      </View>
    </Card>
  );
}

/**
 * The vacancy's shift (26 Nov): tap one of the business's shifts or a usual one, or set the start and end
 * on the clock (half hours). A time set by hand is saved as a new business shift when the vacancies are saved.
 */
function ShiftChooser({ form, onChange, shifts, error, id }: {
  form: QuickVacancy;
  onChange: (next: QuickVacancy) => void;
  shifts: readonly BusinessShift[];
  error: string | null;
  id: (base: string) => string;
}) {
  const { t } = useI18n();
  const presets = SHIFT_PRESETS.filter((p) => !shifts.some((s) => s.startTime === p.startTime && s.endTime === p.endTime));
  const start = form.businessShiftId ? shifts.find((s) => s.id === form.businessShiftId)?.startTime ?? form.shiftStart : form.shiftStart;
  const end = form.businessShiftId ? shifts.find((s) => s.id === form.businessShiftId)?.endTime ?? form.shiftEnd : form.shiftEnd;
  const isNew = !form.businessShiftId && start && end && start !== end && !shifts.some((s) => s.startTime === start && s.endTime === end);
  const chip = (key: string, label: string, on: boolean, pick: () => void) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={pick} style={[styles.chip, on && styles.chipOn]} testID={id(`shift-${key}`)}>
      <Text variant="small" color={on ? colors.white : colors.ink}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.gap} testID={id('shift-picker')}>
      <Text variant="small" style={styles.extrasLabel}>{`${t('fa17.shift')} *`}</Text>
      <Text variant="muted">{t('fa17.shiftHint')}</Text>
      <View style={styles.chips}>
        {shifts.map((s) => chip(s.id, s.label, form.businessShiftId === s.id, () => onChange({ ...form, businessShiftId: s.id, shiftStart: s.startTime, shiftEnd: s.endTime, shiftName: s.name })))}
        {presets.map((p) =>
          chip(p.key, `${p.name} ${formatClock(p.startTime)}–${formatClock(p.endTime)}`, !form.businessShiftId && form.shiftStart === p.startTime && form.shiftEnd === p.endTime, () =>
            onChange({ ...form, businessShiftId: '', shiftStart: p.startTime, shiftEnd: p.endTime, shiftName: p.name })))}
      </View>
      <View style={styles.row}>
        <View style={styles.flex1}>
          <TimeField label={t('fa17.shiftStart')} value={start} onChange={(v) => onChange({ ...form, businessShiftId: '', shiftStart: v, shiftEnd: end, shiftName: '' })} from="00:00" to="23:30" step={30} testID={id('shift-start')} />
        </View>
        <View style={styles.flex1}>
          <TimeField label={t('fa17.shiftEnd')} value={end} onChange={(v) => onChange({ ...form, businessShiftId: '', shiftStart: start, shiftEnd: v, shiftName: '' })} from="00:00" to="23:30" step={30} testID={id('shift-end')} />
        </View>
      </View>
      {isNew ? <Text variant="small" color={colors.soft} testID={id('shift-new')}>{t('fa17.shiftNew', { start: formatClock(start), end: formatClock(end) })}</Text> : null}
      {error ? <Text variant="small" color={colors.tomato} testID={id('shift-error')}>{error}</Text> : null}
    </View>
  );
}

/** After saving: the owner reads out ONE code for all the vacancies, or gets the links to confirm later. */
function ConfirmAll({ business, saved }: { business: BusinessDetail; saved: CreatedVacancies }) {
  const { t } = useI18n();
  const sr = useSellingRoutes();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const ids = saved.vacancies.map((v) => v.id);
  const n = ids.length;
  const sent = saved.confirmation && 'otpRequestId' in saved.confirmation ? (saved.confirmation as OtpSent) : null;
  const [result, setResult] = useState<{ confirmed: number; vacancies: { code: string; confirmed: boolean }[] } | null>(null);
  const links = useMutation({
    mutationFn: async (channel: SendChannel) => {
      let last: { sentToLast4: string } | null = null;
      for (const vid of ids) last = await queue.live(() => selling.vacancyLink(vid, channel));
      return last;
    },
  });
  const summary = saved.vacancies.map((v) => (v.headcount > 1 ? `${v.tradeSkill} × ${v.headcount}` : v.tradeSkill)).join(' · ');
  const notConfirmed = result?.vacancies.filter((v) => !v.confirmed).map((v) => v.code) ?? [];
  return (
    <>
      <HeroCard title={n > 1 ? t('fa17.confirmTitle', { n }) : t('fa17.confirmTitleOne')} subtitle={`${business.name} · ${summary}`} emoji="🔐" />
      {result ? (
        <>
          <Banner
            tone={notConfirmed.length ? 'warn' : 'ok'}
            message={
              notConfirmed.length
                ? t('fa17.confirmedSome', { n: result.confirmed, codes: notConfirmed.join(', ') })
                : result.confirmed === 1 ? t('fa17.confirmedOne') : t('fa17.confirmedAll', { n: result.confirmed })
            }
            testID="vacancies-confirmed"
          />
          <Button label={t('fa17.backToBusiness')} onPress={() => router.replace(sr.business(business.id))} testID="back-to-business" />
        </>
      ) : (
        <Card stripe accent="gold">
          {!sent ? <Banner tone="warn" message={t('fa17.codeNotSent')} testID="code-not-sent" /> : null}
          <OtpStep
            testID="vacancies-otp"
            initial={sent}
            sendLabel={t('fa17.confirmSend', { name: sent?.contactName ?? t('fa15f.owner') })}
            verifyLabel={t('fa17.confirmVerify')}
            intro={(s) => t('fa17.confirmSent', { name: s.contactName ?? t('fa15f.owner'), last4: s.sentToLast4, n })}
            send={(prev, channel) => selling.sendVacanciesCode(business.id, ids, prev, channel)}
            verify={async (requestId, code) => {
              const r = await selling.confirmVacancies(business.id, ids, requestId, code);
              setResult(r);
              await client.invalidateQueries({ queryKey: ['selling'] });
              await client.invalidateQueries({ queryKey: ['field-work'] });
            }}
          />
          <Note>{t('fa17.notHere')}</Note>
          <SendLinkButtons
            label={links.isSuccess && links.data ? t('fa17.linksSent', { last4: links.data.sentToLast4 }) : t('fa17.sendLinks')}
            disabled={links.isSuccess || links.isPending}
            run={(channel) => links.mutateAsync(channel)}
            onError={() => undefined}
            testID="send-links"
          />
          <ErrorBanner error={links.error} />
          {links.isSuccess ? <Button label={t('fa17.backToBusiness')} variant="secondary" onPress={() => router.replace(sr.business(business.id))} testID="links-back" /> : null}
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  gap: { gap: 12 },
  row: { flexDirection: 'row', gap: 8 },
  title: { fontSize: 17, flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  extrasLabel: { color: colors.soft },
  extras: { flexDirection: 'row', flexWrap: 'wrap' },
  extra: { width: '50%' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addButton: { flexBasis: '45%', flexGrow: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: touch.min,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.blue, borderColor: colors.blue },
});
