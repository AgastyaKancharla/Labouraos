import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text, TextField } from '@/components';
import { isApiError } from '@/api/errors';
import { visitPaths } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ChipChoices } from '../_visits/ChoiceList';
import { StepHeader } from '../_visits/StepHeader';
import { formatTimer } from '../_visits/format';
import { useVisit } from '../_visits/useVisit';
import { updateDraft, type VisitDraft } from '../_visits/visitDraft';

const MOBILE = /^[6-9]\d{9}$/;

/**
 * FA21 — Visit a shop, step 2 (inside, talking). The visit timer runs from
 * the board photo. The agent notes the shop name and who he spoke to (and
 * optionally their mobile, for the Team Lead to check), then picks how it
 * went. "Interested — onboard now" closes the timer and leads to the proof
 * selfie (FA22); the other three open the outcome form (FA06c) for the date
 * or reason. Very short visits are flagged to the Team Lead by the server.
 */
export default function VisitTalkScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { visit, loading, error } = useVisit(id);
  if (!id) return <EmptyState message={t('common.error')} />;
  if (loading) return <LoadingState />;
  if (!visit) return <ErrorState error={error} onRetry={() => router.replace(routes.visits)} />;
  return <Talk visit={visit} />;
}

function Talk({ visit }: { visit: VisitDraft }) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const [now, setNow] = useState(() => Date.now());
  const [shopName, setShopName] = useState(visit.businessName ?? visit.shopName ?? '');
  const [spokeTo, setSpokeTo] = useState<string | null>(visit.spokeTo || null);
  const [mobile, setMobile] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const startedAt = new Date(visit.startedAt).getTime();
  const spokeChoices = [
    { value: 'owner', label: t('spoke.owner') },
    { value: 'manager', label: t('spoke.manager') },
    { value: 'staff', label: t('spoke.staff') },
    { value: 'no_one', label: t('spoke.no_one') },
  ];

  function valid(): boolean {
    if (!shopName.trim() || !spokeTo) {
      setProblem(t('fa21.needNameAndPerson'));
      return false;
    }
    if (mobile && !MOBILE.test(mobile)) {
      setProblem(t('fa21.mobileInvalid'));
      return false;
    }
    setProblem(null);
    return true;
  }

  function keep(endedAt: string) {
    updateDraft(visit.id, { shopName: shopName.trim(), spokeTo: spokeTo ?? '', contactPhone: mobile, endedAt });
  }

  async function onboardNow() {
    if (!valid()) return;
    setBusy(true);
    const endedAt = new Date().toISOString();
    try {
      await queue.submit(`${t('fa21.queueLabel')} · ${shopName.trim()}`, {
        method: 'POST',
        path: visitPaths.outcome(visit.id),
        json: { outcome: 'onboard_now', shopName: shopName.trim(), spokeTo, ...(mobile ? { contactPhone: mobile } : {}), endedAt },
      });
      keep(endedAt);
      router.push({ pathname: routes.visitProof, params: { id: visit.id } });
    } catch (e) {
      setProblem(isApiError(e) ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function other(outcome: 'interested_later' | 'not_interested' | 'owner_not_there') {
    if (!valid()) return;
    keep(new Date().toISOString());
    router.push({ pathname: routes.visitOutcome, params: { id: visit.id, outcome } });
  }

  return (
    <View style={styles.flex} testID="screen-FA21">
      <AppHeader title={t('fa20.title')} />
      <Screen>
        <StepHeader step={2} label={t('fa21.step')} />
        <Card>
          <Text variant="label">{t('fa21.timer')}</Text>
          <View style={styles.timerRow}>
            <Text variant="muted">{t('fa21.started', { time: formatTimeIst(startedAt) })}</Text>
            <Text style={styles.timer} testID="fa21-timer">
              {formatTimer(now - startedAt)}
            </Text>
          </View>
        </Card>
        <Card>
          <View style={styles.form}>
            <TextField
              label={t('fa21.shopName')}
              value={shopName}
              onChangeText={setShopName}
              editable={!visit.businessId}
              testID="fa21-shop-name"
            />
            <Text variant="small" style={styles.bold}>
              {t('fa21.spokeTo')}
            </Text>
            <ChipChoices choices={spokeChoices} value={spokeTo} onChange={setSpokeTo} testID="fa21-spoke" />
            <TextField
              label={t('fa21.mobile')}
              placeholder={t('fa21.mobilePlaceholder')}
              value={mobile}
              onChangeText={(v) => setMobile(v.replace(/\D/g, '').slice(0, 10))}
              keyboardType="number-pad"
              maxLength={10}
              testID="fa21-mobile"
            />
          </View>
        </Card>
        {problem ? <Banner tone="error" message={problem} testID="fa21-problem" /> : null}
        <Text variant="label">{t('fa21.howDidItGo')}</Text>
        <Button label={t('fa21.onboardNow')} variant="success" loading={busy} onPress={() => void onboardNow()} testID="fa21-onboard" />
        <Button label={t('fa21.comeBack')} variant="secondary" onPress={() => other('interested_later')} testID="fa21-come-back" />
        <Button label={t('fa21.notInterested')} variant="secondary" onPress={() => other('not_interested')} testID="fa21-not-interested" />
        <Button label={t('fa21.ownerNotThere')} variant="secondary" onPress={() => other('owner_not_there')} testID="fa21-owner-not-there" />
        <Button label={t('fa21.openPitch')} variant="navy" onPress={() => router.push(routes.feeCalculator)} testID="fa21-pitch" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  timerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 },
  timer: { fontFamily: fonts.display800, fontSize: 30, color: colors.navy, fontVariant: ['tabular-nums'] },
  form: { gap: 12 },
  bold: { fontFamily: fonts.body700, color: colors.soft, fontSize: 12 },
});
