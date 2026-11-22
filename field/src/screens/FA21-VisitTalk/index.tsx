import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, HeroCard, Icon, LoadingState, Screen, Text, TextField } from '@/components';
import { isApiError } from '@/api/errors';
import { visitPaths } from '@/api/endpoints';
import { queryKeys } from '@/api/queryClient';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatTimeIst } from '@/lib/format';
import { useFormDraft } from '@/lib/formDraft';
import { pageRoutes, routes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { StepHeader } from '../_visits/StepHeader';
import { formatTimer } from '../_visits/format';
import { useVisit } from '../_visits/useVisit';
import { saveDraft, type VisitDraft } from '../_visits/visitDraft';

/**
 * FA21 — Visit a shop, step 2 (inside, talking). The visit timer runs from
 * the board photo. The agent notes the shop name, then picks how it went
 * (22 Nov, rev 207: only these two). "Interested — onboard now" closes the
 * timer and leads to the proof selfie (FA22) — the contact person, role and
 * mobile are asked once, in registration (FA07); the other three open the
 * outcome form (FA06c), which asks whom he spoke to and the optional shop
 * phone, and the date or reason. Very short visits are flagged to the Team Lead by the server.
 * A visit that already has a result (an old link, or back from a later step)
 * opens its visit details instead: no timer and no result buttons again
 * (fix list A5).
 */
export default function VisitTalkScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { visit, server, loading, error } = useVisit(id);
  if (!id) return <EmptyState message={t('common.error')} />;
  if (server?.outcome) return <Redirect href={pageRoutes.visitDetails(id)} />;
  if (loading) return <LoadingState />;
  if (!visit) return <ErrorState error={error} onRetry={() => router.replace(routes.visits)} />;
  return <Talk visit={visit} />;
}

function Talk({ visit }: { visit: VisitDraft }) {
  const { t } = useI18n();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  // What was typed survives going back to this step (redesign: the back arrow never loses it).
  const [fields, setFields] = useFormDraft(`fa21:${visit.id}`, () => ({
    shopName: visit.businessName ?? visit.shopName ?? '',
  }));
  const { shopName } = fields;
  const setShopName = (v: string) => setFields((f) => ({ ...f, shopName: v }));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const startedAt = new Date(visit.startedAt).getTime();
  function valid(): boolean {
    if (!shopName.trim()) {
      setProblem(t('fa21.needName'));
      return false;
    }
    setProblem(null);
    return true;
  }

  function keep(endedAt: string) {
    // 21 Nov: written whole (from the server's copy after a reload), so the next step always has it.
    saveDraft({ ...visit, shopName: shopName.trim(), endedAt });
  }

  async function onboardNow() {
    if (!valid()) return;
    setBusy(true);
    const endedAt = new Date().toISOString();
    try {
      await queue.submit(`${t('fa21.queueLabel')} · ${shopName.trim()}`, {
        method: 'POST',
        path: visitPaths.outcome(visit.id),
        json: { outcome: 'onboard_now', shopName: shopName.trim(), endedAt },
      });
      keep(endedAt);
      void client.invalidateQueries({ queryKey: ['field-work'] });
      // The visit now has its result: back on this step later opens its details (A5).
      void client.invalidateQueries({ queryKey: queryKeys.visit(visit.id) });
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
        <StepHeader step={2} revisit={Boolean(visit.businessId)} />
        <HeroCard eyebrow={t('fa21.timer')} emoji="⏱️">
          <View style={styles.timerRow}>
            <Text style={styles.started}>{t('fa21.started', { time: formatTimeIst(startedAt) })}</Text>
            <Text style={styles.timer} testID="fa21-timer">
              {formatTimer(now - startedAt)}
            </Text>
          </View>
        </HeroCard>
        <Card stripe accent="gold">
          <View style={styles.form}>
            <TextField
              label={t('fa21.shopName')}
              value={shopName}
              onChangeText={setShopName}
              editable={!visit.businessId}
              testID="fa21-shop-name"
            />
          </View>
        </Card>
        {problem ? <Banner tone="error" message={problem} testID="fa21-problem" /> : null}
        <Text variant="label">{t('fa21.howDidItGo')}</Text>
        <Button label={t('fa21.onboardNow')} icon={<Icon name="check-circle" color={colors.white} />} loading={busy} onPress={() => void onboardNow()} testID="fa21-onboard" />
        <Button label={t('fa21.comeBack')} variant="secondary" icon={<Icon name="calendar" color={colors.cyan} />} onPress={() => other('interested_later')} testID="fa21-come-back" />
        <Button label={t('fa21.notInterested')} variant="secondary" icon={<Icon name="x-circle" color={colors.crit} />} onPress={() => other('not_interested')} testID="fa21-not-interested" />
        <Button label={t('fa21.ownerNotThere')} variant="secondary" icon={<Icon name="clock" color={colors.amber} />} onPress={() => other('owner_not_there')} testID="fa21-owner-not-there" />
        <Button label={t('fa21.openPitch')} variant="secondary" icon={<Icon name="chat" color={colors.navy} />} onPress={() => router.push(routes.visitPitch)} testID="fa21-pitch" />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  timerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  started: { fontFamily: fonts.body500, fontSize: 13, color: colors.onBlueSoft, flexShrink: 1 },
  timer: { fontFamily: fonts.display800, fontSize: 30, color: colors.white, fontVariant: ['tabular-nums'] },
  form: { gap: 12 },
});
