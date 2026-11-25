import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomerApi } from '@/api/ApiProvider';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import { AppHeader, Banner, Button, Card, ErrorState, HeroCard, LoadingState, Screen, Text } from '@/components';
import { DateField, MoneyField, RadioGroup, todayKeyIst } from '@/components/form';
import { useI18n, type MessageKey } from '@/i18n';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { routes } from '@/navigation/routes';
import { stepErrorText } from '@/verify/errors';
import { useStepsApi } from '@/verify/StepsApiProvider';
import { tokenFromLink } from '@/verify/stepsApi';
import type { InterviewResultInput, InterviewResultValue } from '@/verify/types';
import { OtpCodeCard } from '../shared/OtpCodeCard';

type Happened = 'yes' | 'no';

function hasOpensAt(error: unknown): boolean {
  const body = (error as { body?: { details?: { opensAt?: unknown }; opensAt?: unknown } } | null)?.body;
  return Boolean(body?.details?.opensAt ?? body?.opensAt);
}
type Decision = 'selected' | 'not_selected';

/**
 * 26 Nov (owner): the result of an interview our team booked, given in the
 * app about an hour after it starts. Did it happen → Selected / Not selected
 * (and why) → confirmed by a code to the owner's number, the same check as
 * the result link (P05). The fee is not taken in the app yet: "Pay now" is
 * shown but switched off until the business pricing is final.
 */
export default function InterviewResultScreen() {
  const { t } = useI18n();
  const api = useCustomerApi();
  const steps = useStepsApi();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ profileId?: string; interviewId?: string }>();
  const profileId = params.profileId ?? null;
  const interviewId = params.interviewId ?? null;

  const link = useQuery({
    queryKey: ['interview-result', 'link', profileId, interviewId],
    queryFn: () => api.interviewResultLink(profileId!, interviewId!),
    enabled: Boolean(profileId && interviewId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const token = link.data ? tokenFromLink(link.data.url) : null;
  const details = useQuery({
    queryKey: ['interview-result', 'details', token],
    queryFn: () => steps.interviewResultDetails(token!),
    enabled: Boolean(token),
    retry: false,
  });

  const [happened, setHappened] = useState<Happened | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [typedSalary, setSalary] = useState<number | null | undefined>(undefined);
  const [joining, setJoining] = useState('');
  const [sent, setSent] = useState<InterviewResultValue | null>(null);
  // When the screen opened (the server refuses an early "did not come" anyway).
  const [openedAt] = useState(() => Date.now());

  const d = details.data;
  // Starts at the vacancy's salary until the owner changes it.
  const salary = typedSalary === undefined ? (d?.vacancySalaryMinPaise ?? null) : typedSalary;

  // Home shows the new card state when the owner comes back, by any way.
  useEffect(
    () => () => {
      if (profileId) void client.invalidateQueries({ queryKey: queryKeys.home(profileId) });
    },
    [client, profileId],
  );

  const input: InterviewResultInput | null =
    happened === 'no'
      ? { result: 'candidate_no_show' }
      : happened === 'yes' && decision === 'not_selected' && reason
        ? { result: 'not_selected', resultReason: reason }
        : happened === 'yes' && decision === 'selected' && salary && joining
          ? { result: 'selected', selectedSalaryPaise: salary, selectedJoiningDate: `${joining}T00:00:00.000Z` }
          : null;

  const header = <AppHeader title={t('ivResult.title')} onBack={() => router.back()} />;
  let body;
  if (!profileId || !interviewId) body = <ErrorState />;
  else if (link.isLoading || details.isLoading) body = <LoadingState label={t('ivResult.loading')} />;
  else if (link.isError || details.isError || !token || !d) {
    // 409 with opensAt: not open yet. Any other 409: the result is already given or the time to give it is over.
    const conflict = isApiError(link.error) && link.error.status === 409;
    const early = conflict && hasOpensAt(link.error);
    body = (
      <View style={styles.gap}>
        <Banner
          tone={conflict ? 'info' : 'error'}
          message={early ? t('ivResult.tooEarly') : conflict ? t('ivResult.closed') : t('ivResult.failed')}
          testID={early ? 'iv-result-early' : conflict ? 'iv-result-closed' : 'iv-result-failed'}
        />
        {conflict ? null : <Button label={t('ivResult.retry')} onPress={() => void link.refetch()} testID="iv-result-retry" />}
      </View>
    );
  } else if (sent) {
    const name = d.candidateFirstName;
    body = (
      <View style={styles.gap} testID="iv-result-done">
        <HeroCard eyebrow={t('ivResult.title')} title={sent === 'selected' ? t('ivResult.doneSelected', { name }) : t('ivResult.doneMore')} />
        {sent === 'selected' ? (
          <Card title={t('ivResult.payTitle')} accent="gold" testID="iv-result-pay">
            <View style={styles.gap}>
              <Text variant="muted">{t('ivResult.payBody')}</Text>
              <Button label={t('ivResult.payNow')} disabled onPress={() => undefined} testID="iv-result-pay-now" />
            </View>
          </Card>
        ) : null}
        <Button variant="secondary" label={t('ivResult.home')} onPress={() => router.replace(routes.home)} testID="iv-result-home" />
      </View>
    );
  } else if (!d.awaitingResult) {
    body = <Banner tone="info" message={t('ivResult.alreadySent')} testID="iv-result-already" />;
  } else {
    const name = d.candidateFirstName;
    // "Did not come" costs him his refund, so (like the field agent's) it opens only when the slot is over.
    const slotOver = openedAt >= Date.parse(d.slotEndsAt);
    body = (
      <View style={styles.gap} testID="iv-result-form">
        <Text variant="h1">{name}</Text>
        <Text variant="muted">{t('ivResult.intro', { name, job: d.job, day: formatDayIst(d.slotStartsAt), time: formatTimeIst(d.slotStartsAt) })}</Text>
        <Card>
          <RadioGroup<Happened>
            label={t('ivResult.happened')}
            value={happened}
            onChange={setHappened}
            options={[
              { value: 'yes', label: t('ivResult.yes') },
              ...(slotOver ? [{ value: 'no' as const, label: t('ivResult.noShow', { name }), tone: 'bad' as const }] : []),
            ]}
            testID="iv-result-happened"
          />
          {slotOver ? null : (
            <Text variant="muted" testID="iv-result-no-show-later">
              {t('ivResult.noShowLater', { name, time: formatTimeIst(d.slotEndsAt) })}
            </Text>
          )}
        </Card>
        {happened === 'yes' ? (
          <Card>
            <View style={styles.gap}>
              <RadioGroup<Decision>
                label={t('ivResult.outcome')}
                value={decision}
                onChange={setDecision}
                options={[
                  { value: 'selected', label: t('ivResult.selected'), tone: 'ok' },
                  { value: 'not_selected', label: t('ivResult.notSelected'), tone: 'bad' },
                ]}
                testID="iv-result-decision"
              />
              {decision === 'selected' ? (
                <>
                  <MoneyField label={t('ivResult.salary')} valuePaise={salary} onChange={setSalary} required testID="iv-result-salary" />
                  <DateField label={t('ivResult.joining')} value={joining} onChange={setJoining} min={todayKeyIst()} required testID="iv-result-joining" />
                </>
              ) : null}
              {decision === 'not_selected' ? (
                <RadioGroup<string>
                  label={t('ivResult.reasonLabel')}
                  value={reason}
                  onChange={setReason}
                  options={d.reasons.map((r) => ({ value: r, label: t(`ivResult.reason.${r}` as MessageKey) ?? r }))}
                  testID="iv-result-reason"
                />
              ) : null}
            </View>
          </Card>
        ) : null}
        <Card title={t('ivResult.confirmTitle')} accent="royal">
          <OtpCodeCard
            testID="iv-result-otp"
            send={() => steps.sendInterviewResultOtp(token)}
            beforeSend={() => (input ? null : t('ivResult.pickFirst'))}
            submit={async (proof) => {
              if (!input) throw new Error(t('ivResult.pickFirst'));
              await steps.submitInterviewResult(token, proof.requestId, proof.code, input);
              setSent(input.result);
            }}
            sendLabel={t('ivResult.send')}
            submitLabel={t('ivResult.submit')}
            sentText={t('ivResult.codeSent', { phone: d.maskedPhone })}
            describeError={(err) => stepErrorText(t, err)}
          >
            <Text variant="muted">{t('ivResult.codeIntro', { phone: d.maskedPhone })}</Text>
          </OtpCodeCard>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.flex} testID="interview-result">
      {header}
      <Screen>{body}</Screen>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, gap: { gap: 14 } });
