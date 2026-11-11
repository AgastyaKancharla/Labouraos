import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, Screen, Text, TextField } from '@/components';
import { isApiError } from '@/api/errors';
import { visitPaths, type VisitOutcome } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { routes } from '@/navigation/routes';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ChoiceList } from '../_visits/ChoiceList';
import { DatePicker } from '../_visits/DatePicker';
import { useVisit } from '../_visits/useVisit';

const OUTCOMES: VisitOutcome[] = ['onboarded', 'interested_later', 'not_interested', 'owner_not_there'];
const REASONS = ['hires_family_friends', 'fee_too_high', 'no_staff_needed', 'other_agency', 'other'] as const;

/**
 * FA06c — Visit outcome. Every visit ends with one: onboarded; interested —
 * come back later (date); not interested (reason); owner not there (date).
 * "Come back" visits reappear on Home and the Map on that date. Saved
 * through the offline queue. "Onboarded" is only for a registered business.
 */
export default function VisitOutcomeScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id?: string; outcome?: string }>();
  const { visit, server, loading, error } = useVisit(params.id);
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [outcome, setOutcome] = useState<VisitOutcome | null>(
    OUTCOMES.includes(params.outcome as VisitOutcome) ? (params.outcome as VisitOutcome) : null,
  );
  const [revisitOn, setRevisitOn] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<'sent' | 'queued' | null>(null);
  const [busy, setBusy] = useState(false);
  const [openedAt] = useState(() => Date.now());

  if (!params.id) return <EmptyState message={t('common.error')} />;
  if (loading) return <LoadingState />;
  if (!visit) return <ErrorState error={error} onRetry={() => router.replace(routes.visits)} />;

  const needsDate = outcome === 'interested_later' || outcome === 'owner_not_there';
  const name = visit.businessName ?? visit.shopName;

  async function save() {
    if (!outcome) return setProblem(t('fa06c.pickOutcome'));
    if (needsDate && !revisitOn) return setProblem(t('fa06c.pickDate'));
    if (outcome === 'not_interested' && !reason) return setProblem(t('fa06c.pickReason'));
    setProblem(null);
    setBusy(true);
    try {
      const result = await queue.submit(`${t('fa06c.queueLabel')} · ${name}`, {
        method: 'POST',
        path: visitPaths.outcome(visit!.id),
        json: {
          outcome,
          ...(visit!.businessId ? {} : { shopName: visit!.shopName }),
          ...(visit!.spokeTo ? { spokeTo: visit!.spokeTo } : {}),
          ...(visit!.contactPhone ? { contactPhone: visit!.contactPhone } : {}),
          ...(needsDate ? { revisitOn } : {}),
          ...(outcome === 'not_interested' ? { reason } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(visit!.endedAt ? { endedAt: visit!.endedAt } : {}),
        },
      });
      setSaved(result.status);
      void client.invalidateQueries({ queryKey: ['field-work'] });
    } catch (e) {
      setProblem(isApiError(e) ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex} testID="screen-FA06c">
      <AppHeader title={t('fa06c.title')} />
      <Screen>
        <Card>
          <Text variant="h2">{t('fa06c.question')}</Text>
          <Text variant="muted">{name}</Text>
          <View style={styles.gap} />
          <ChoiceList
            choices={OUTCOMES.map((o) => ({
              value: o,
              label: t(`fa06c.${o}` as const),
              disabled: o === 'onboarded' && !visit.businessId,
            }))}
            value={outcome}
            onChange={setOutcome}
            testID="fa06c-outcome"
          />
        </Card>
        {needsDate ? (
          <Card>
            <DatePicker label={t('fa06c.comeBackOn')} value={revisitOn} onChange={setRevisitOn} now={openedAt} testID="fa06c-date" />
          </Card>
        ) : null}
        {outcome === 'not_interested' ? (
          <Card>
            <Text variant="small" style={styles.label}>
              {t('fa06c.why')}
            </Text>
            <ChoiceList choices={REASONS.map((r) => ({ value: r, label: t(`reason.${r}` as const) }))} value={reason} onChange={setReason} testID="fa06c-reason" />
          </Card>
        ) : null}
        <Card>
          <TextField label={t('fa06c.note')} value={note} onChangeText={setNote} multiline numberOfLines={3} maxLength={1000} testID="fa06c-note" />
        </Card>
        {problem ? <Banner tone="error" message={problem} testID="fa06c-problem" /> : null}
        {saved ? (
          <Banner tone={saved === 'sent' ? 'ok' : 'info'} message={saved === 'sent' ? t('fa06c.saved') : t('fa06c.queued')} testID="fa06c-saved" />
        ) : null}
        {saved ? (
          <Button label={t('fa06c.backToVisits')} onPress={() => router.replace(routes.visits)} testID="fa06c-done" />
        ) : (
          <Button label={t('common.save')} loading={busy} onPress={() => void save()} testID="fa06c-save" />
        )}
        {server?.outcome && !saved ? <Text variant="muted">{t('fa06c.changing')}</Text> : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  gap: { height: 10 },
  label: { fontWeight: '700', marginBottom: 8 },
});
