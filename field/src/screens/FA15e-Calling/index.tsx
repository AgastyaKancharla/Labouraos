import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { CandidateCard } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Screen, Text } from '@/components';
import { RadioGroup, SelectField } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors, fonts, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, formatRupees, Note, QueryView, Script, SHIFT_KEYS, useParam } from '../_selling';

/** Reasons he can give for saying no on the call (stored with the hit). */
export const DECLINE_REASONS = ['too_far', 'salary_low', 'timing', 'not_interested', 'other'] as const;
const CALL_POLL_MS = 3000;

/**
 * FA15e — Calling the job seeker from the shop. First the agent asks the owner
 * if he is free to talk; then a masked, recorded call from the agent's own
 * phone (POST /field-selling/calls — needs signal). Whether it connected comes
 * only from the phone system. His answer: yes → "Handing phone to owner"
 * (same call); no → a hit (the job suits him on every count), next liked
 * candidate; no answer → next candidate, or book for later.
 */
export default function CallingScreen() {
  const { t } = useI18n();
  const vacancyId = useParam('vacancyId');
  const jobSeekerId = useParam('jobSeekerId');
  const { selling } = useEndpoints();
  const card = useQuery({
    queryKey: queryKeys.sellingCandidate(jobSeekerId, vacancyId),
    queryFn: () => selling.candidate(jobSeekerId, vacancyId),
    enabled: !!jobSeekerId && !!vacancyId,
  });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15e.subtitle')} />
      <Screen testID="screen-FA15e">
        <QueryView query={card}>{(c) => <Calling card={c} vacancyId={vacancyId} />}</QueryView>
      </Screen>
    </View>
  );
}

function Calling({ card, vacancyId }: { card: CandidateCard; vacancyId: string }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const { selling } = useEndpoints();
  const queue = useOfflineQueue();
  const [callId, setCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [answer, setAnswer] = useState<'yes' | 'no' | 'no_answer' | null>(null);
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const status = useQuery({
    queryKey: queryKeys.call(callId ?? ''),
    queryFn: () => selling.call(callId!),
    enabled: !!callId,
    refetchInterval: (q) => (q.state.data?.answered ? false : CALL_POLL_MS),
  });

  const place = useMutation({
    mutationFn: () => queue.live(() => selling.callCandidate(vacancyId, card.jobSeekerId)),
    onSuccess: (r) => {
      setCallId(r.callRecordId);
      setStartedAt(Date.now());
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!callId || (answer !== 'yes' && answer !== 'no')) throw new Error('no answer');
      const r = await queue.live(() => selling.answer(callId, answer, answer === 'no' ? reason : undefined));
      if (answer === 'yes') await queue.live(() => selling.handOver(r.interviewId));
      return r;
    },
    onSuccess: (r) => {
      if (answer === 'yes') router.push(sellingRoutes.owner(r.interviewId));
      else router.back();
    },
  });

  const agent = (session?.staff.name ?? '').split(/\s+/)[0] ?? '';
  const shift = card.vacancy.shift && SHIFT_KEYS[card.vacancy.shift] ? t(SHIFT_KEYS[card.vacancy.shift]).toLowerCase() : '';
  const salary = `${formatRupees(card.vacancy.salaryMinPaise)}–${formatRupees(card.vacancy.salaryMaxPaise ?? card.vacancy.salaryMinPaise).replace('₹', '')}`;
  const elapsed = startedAt ? formatCountdown(now - startedAt) : '0:00';
  const answered = status.data?.answered === true;

  return (
    <>
      {callId ? (
        <View style={[styles.live, answered && styles.liveOn]} testID="on-call">
          <Text style={styles.liveTitle}>{t('fa15e.onCallWith', { name: card.firstName, time: elapsed })}</Text>
          <Text style={styles.liveSub}>{answered ? t('fa15e.recorded') : t('fa15e.ringing')}</Text>
        </View>
      ) : null}
      <Banner tone="warn" title={t('fa15e.beforeTitle')} message={t('fa15e.beforeBody')} testID="ask-owner" />
      <Script testID="script">
        {t('fa15e.script', {
          name: card.firstName,
          agent,
          trade: card.vacancy.trade.toLowerCase(),
          area: card.vacancy.locality ?? '',
          shift,
          salary,
        })}
      </Script>
      {!callId ? (
        <Button
          label={place.isPending ? t('fa15e.calling') : t('fa15e.call', { name: card.firstName })}
          loading={place.isPending}
          onPress={() => place.mutate()}
          testID="place-call"
        />
      ) : (
        <>
          <RadioGroup
            label={t('fa15e.hisAnswer')}
            value={answer}
            onChange={setAnswer}
            testID="answer"
            options={[
              { value: 'yes', label: t('fa15e.yes') },
              { value: 'no', label: t('fa15e.no'), tone: 'bad' },
              { value: 'no_answer', label: t('fa15e.noAnswer') },
            ]}
          />
          {answer === 'no' ? (
            <SelectField
              label={t('fa15e.reason')}
              required
              value={reason}
              onChange={setReason}
              choices={DECLINE_REASONS.map((r) => ({ value: r, label: t(`fa15e.reason.${r}` as const) }))}
              testID="reason"
            />
          ) : null}
          {answer === 'yes' ? (
            <Button label={t('fa15e.handOver')} loading={save.isPending} onPress={() => save.mutate()} testID="hand-over" />
          ) : answer === 'no' ? (
            <Button label={t('fa15e.saveNo')} variant="navy" disabled={!reason} loading={save.isPending} onPress={() => save.mutate()} testID="save-no" />
          ) : answer === 'no_answer' ? (
            <View style={styles.row}>
              <Button label={t('fa15e.nextCandidate')} variant="secondary" style={styles.flex1} onPress={() => router.back()} testID="next-candidate" />
              <Button
                label={t('fa15e.bookLater')}
                style={styles.flex1}
                onPress={() => router.push(sellingRoutes.book(vacancyId, card.jobSeekerId))}
                testID="book-later"
              />
            </View>
          ) : null}
        </>
      )}
      <ErrorBanner error={place.error ?? save.error} />
      <Note>{t('fa15e.rules')}</Note>
      <Button label={t('fa15e.ownerBusy')} variant="secondary" onPress={() => router.push(sellingRoutes.book(vacancyId, card.jobSeekerId))} testID="owner-busy" />
      <Button label={t('fa15e.endCall')} variant="danger" onPress={() => router.back()} testID="end-call" />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  live: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.amberBorder, backgroundColor: colors.amber100, padding: 14 },
  liveOn: { borderColor: '#A9DEC7', backgroundColor: colors.green100 },
  liveTitle: { fontFamily: fonts.display700, color: colors.green, fontSize: 15 },
  liveSub: { color: colors.green, fontFamily: fonts.body600, fontSize: 12.5 },
});
