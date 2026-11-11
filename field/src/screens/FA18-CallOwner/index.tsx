import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { BusinessDetail } from '@/api/endpoints';
import { Banner, Button, Screen, Text, TextField } from '@/components';
import { addDays, DateField, RadioGroup, TimeField, todayKeyIst } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors, fonts, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, QueryView, useParam } from '../_selling';

const ROLE_KEYS = { owner: 'fa17b.role.owner', manager: 'fa17b.role.manager', hr: 'fa17b.role.hr', supervisor: 'fa17b.role.supervisor' } as const;
export function roleKey(role: string | null) {
  return ROLE_KEYS[(role ?? '') as keyof typeof ROLE_KEYS] ?? 'fa17b.role.other';
}

type Outcome = 'needs_staff' | 'happy' | 'callback' | 'complaint';
const IST_OFFSET_MS = 330 * 60_000;

/** "2026-11-16" + "11:00" IST → ISO instant. */
export function istIso(dateKey: string, hhmm: string): string {
  return new Date(Date.parse(`${dateKey}T${hhmm}:00.000Z`) - IST_OFFSET_MS).toISOString();
}

/**
 * FA18 — Call the owner: a masked, recorded call to one of the agent's
 * businesses (POST /calls — needs signal), ending with an outcome from the
 * list: needs more staff (→ add a vacancy), happy, call back later (date and
 * time), or a complaint (goes to the Team Lead with this recording). The
 * outcome is saved on the phone if the signal drops after the call.
 */
export default function CallOwnerScreen() {
  const { t } = useI18n();
  const businessId = useParam('businessId');
  const { selling } = useEndpoints();
  const business = useQuery({ queryKey: queryKeys.sellingBusiness(businessId), queryFn: () => selling.business(businessId), enabled: !!businessId });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15e.subtitle')} />
      <Screen testID="screen-FA18">
        <QueryView query={business}>{(b) => <CallOwner business={b} />}</QueryView>
      </Screen>
    </View>
  );
}

function CallOwner({ business }: { business: BusinessDetail }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const [callId, setCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<'sent' | 'queued' | null>(null);
  useEffect(() => {
    if (!callId) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [callId]);
  const place = useMutation({
    mutationFn: () => queue.live(() => selling.placeCall({ subjectType: 'business', subjectId: business.id, purpose: 'check_in' })),
    onSuccess: (r) => {
      setCallId(r.callRecordId);
      setStartedAt(Date.now());
    },
  });
  const save = useMutation({
    mutationFn: (andAddVacancy: boolean) =>
      queue
        .submit(t('fa18.queuedLabel', { business: business.name }), {
          method: 'POST',
          path: `/field-selling/owner-calls/${encodeURIComponent(callId!)}/outcome`,
          json: {
            outcome,
            ...(outcome === 'callback' ? { callbackAt: istIso(date, time) } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        })
        .then((r) => ({ r, andAddVacancy })),
    onSuccess: ({ r, andAddVacancy }) => {
      setSaved(r.status);
      if (andAddVacancy) router.replace(sellingRoutes.addVacancy(business.id));
    },
  });
  const ready = !!outcome && (outcome !== 'callback' || (!!date && !!time)) && (outcome !== 'complaint' || !!note.trim());
  const contact = [business.contactName, business.contactRole ? t(roleKey(business.contactRole)) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      {callId ? (
        <View style={styles.live} testID="on-call">
          <Text style={styles.liveTitle}>{t('fa18.onCall', { time: formatCountdown(now - startedAt) })}</Text>
          <Text style={styles.liveSub}>{`${business.name}${contact ? ` · ${contact}` : ''}`}</Text>
        </View>
      ) : (
        <>
          <Text variant="h2" style={styles.title}>{business.name}</Text>
          <Text variant="muted">{t('fa18.masked', { last4: business.contactPhoneLast4 })}</Text>
          <Button label={t('fa18.call', { name: business.contactName ?? t('fa15f.owner') })} loading={place.isPending} onPress={() => place.mutate()} testID="call-owner" />
          <ErrorBanner error={place.error} />
        </>
      )}
      {callId && !saved ? (
        <>
          <RadioGroup
            label={t('fa18.what')}
            value={outcome}
            onChange={setOutcome}
            testID="outcome"
            options={[
              { value: 'needs_staff', label: t('fa18.needsStaff') },
              { value: 'happy', label: t('fa18.happy') },
              { value: 'callback', label: t('fa18.callback') },
              { value: 'complaint', label: t('fa18.complaint'), tone: 'bad', hint: t('fa18.complaintHint') },
            ]}
          />
          {outcome === 'callback' ? (
            <View style={styles.row}>
              <View style={styles.flex1}>
                <DateField label={t('fa18.date')} required value={date} onChange={setDate} min={todayKeyIst()} max={addDays(todayKeyIst(), 60)} testID="callback-date" />
              </View>
              <View style={styles.flex1}>
                <TimeField label={t('fa18.time')} required value={time} onChange={setTime} testID="callback-time" />
              </View>
            </View>
          ) : null}
          {outcome === 'complaint' || outcome === 'callback' ? (
            <TextField label={t('fa18.note')} value={note} onChangeText={setNote} multiline testID="note" />
          ) : null}
          <ErrorBanner error={save.error} />
          {outcome === 'needs_staff' ? (
            <Button label={t('fa18.saveAndAdd')} disabled={!ready} loading={save.isPending} onPress={() => save.mutate(true)} testID="save-add" />
          ) : null}
          <Button label={t('fa18.save')} variant={outcome === 'needs_staff' ? 'secondary' : 'primary'} disabled={!ready} loading={save.isPending} onPress={() => save.mutate(false)} testID="save" />
        </>
      ) : null}
      {saved ? (
        <Banner tone={saved === 'sent' ? 'ok' : 'info'} message={saved === 'sent' ? t('fa18.saved') : t('fa03.waitingToSend')} testID="saved" />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  title: { fontSize: 17 },
  live: { borderRadius: radius.lg, borderWidth: 1, borderColor: '#A9DEC7', backgroundColor: colors.green100, padding: 14 },
  liveTitle: { fontFamily: fonts.display700, color: colors.green, fontSize: 15 },
  liveSub: { color: colors.green, fontFamily: fonts.body600, fontSize: 12.5 },
});
