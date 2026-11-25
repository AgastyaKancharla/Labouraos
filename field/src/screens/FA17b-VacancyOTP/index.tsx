import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { errorCode, type BusinessPage, type OtpSent, type PageVacancy } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { Banner, Button, Card, HeroCard, Screen, Text, SendLinkButtons, type SendChannel } from '@/components';
import { Checkbox, formatDateKey } from '@/components/form';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n } from '@/i18n';
import { formatTimeIst } from '@/lib/format';
import { useSellingRoutes } from '@/navigation/useFlow';
import { colors } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, formatRupees, Note, QueryView, useParam, vacancyShiftText } from '../_selling';
import { OtpStep } from '../_selling/OtpStep';
import { roleKey } from '../FA18-CallOwner';

/** While the vacancy waits for the owner, look again this often (he may confirm from the SMS link). */
export const VACANCY_POLL_MS = 4000;

/** Waiting for the owner: sent to him, not yet confirmed (code or link). */
const isWaiting = (status: string | null | undefined) => status === 'awaiting_confirmation';

/**
 * FA17b — a vacancy and its one next step (redesign, 16 Nov), so no vacancy
 * is invented:
 * - draft (from the business form): "Check and send to owner" — one tap after
 *   checking the details (and the "owner told" tick when the salary is below
 *   the legal minimum); the owner then gets the details and a code by SMS;
 * - waiting: the owner reads the code out here, or gets a confirmation link;
 * - confirmed: Show candidates.
 * Not the agent's business: view only.
 * Data: GET /vacancies/:id (its business), GET /field-work/businesses/:id/page,
 * POST /vacancies/:id/submit-for-confirmation, …/confirmation/send-code,
 * …/confirm, …/confirmation-link.
 */
export default function VacancyOtpScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const { selling, redesign } = useEndpoints();
  const vacancy = useQuery({
    queryKey: ['selling', 'vacancy', id],
    queryFn: async () => {
      const raw = await selling.vacancy(id);
      const page = await redesign.businessPage(raw.businessId);
      return { page, row: page.vacancies.find((v) => v.id === id) ?? null, status: raw.status, confirmedByName: raw.confirmedByName, confirmedAt: raw.confirmedAt };
    },
    enabled: !!id,
    // The owner can confirm from the SMS link while this screen is open: look again every few
    // seconds while it waits (fix list A3). Polling stops once confirmed, and when the screen
    // closes (no one is watching the query any more).
    refetchInterval: (q) => (isWaiting(q.state.data?.row?.status ?? q.state.data?.status) ? VACANCY_POLL_MS : false),
  });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa17b.header')} />
      <Screen testID="screen-FA17b">
        <QueryView query={vacancy}>
          {({ page, row, status, confirmedAt, confirmedByName }) => (
            <Vacancy page={page} row={row} id={id} status={row?.status ?? status} confirmedAt={confirmedAt} confirmedByName={confirmedByName} />
          )}
        </QueryView>
      </Screen>
    </View>
  );
}

function Vacancy({ page, row, id, status, confirmedAt, confirmedByName }: {
  page: BusinessPage;
  row: PageVacancy | null;
  id: string;
  status: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
}) {
  const { t } = useI18n();
  const otpParam = useParam('otp');
  const last4Param = useParam('last4');
  const sr = useSellingRoutes();
  const { selling, redesign } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [told, setTold] = useState(false);
  const [sent, setSent] = useState<OtpSent | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['selling'] });
    void client.invalidateQueries({ queryKey: ['field-work'] });
  };
  // Rev 211: "Send on WhatsApp" (SMS as backup) or the small "Send by SMS".
  const link = useMutation({ mutationFn: (channel: SendChannel) => queue.live(() => selling.vacancyLink(id, channel)), onSettled: refresh });
  const submit = useMutation({
    mutationFn: () => queue.live(() => redesign.submitDraft(id, told || undefined)),
    onSuccess: (r) => {
      const c = r.confirmation && 'otpRequestId' in r.confirmation ? r.confirmation : null;
      if (c) setSent({ otpRequestId: c.otpRequestId, sentToLast4: c.sentToLast4, contactName: c.contactName });
      refresh();
    },
  });
  const contact = row?.contactName ?? page.contact?.name ?? t('fa15f.owner');
  const role = page.contact?.role ?? 'owner';
  const last4 = row?.contactPhoneLast4 ?? page.contact?.phoneLast4 ?? '';
  const details = row
    ? [
        `${page.name} · ${row.headcount > 1 ? `${row.trade} × ${row.headcount}` : row.trade}`,
        row.salaryMinPaise ? `${formatRupees(row.salaryMinPaise)}${row.salaryMaxPaise ? `–${formatRupees(row.salaryMaxPaise).replace('₹', '')}` : ''}` : null,
        row.shift ? t('fa17b.shiftLabel', { shift: vacancyShiftText(row.shift, t)! }) : null,
        row.startDate ? t('fa17b.from', { date: formatDateKey(String(row.startDate).slice(0, 10)) }) : null,
      ].filter(Boolean).join(' · ')
    : page.name;
  const confirmed = status === 'open';
  // Confirmed while this screen was open (code here, or the owner's link): the business page,
  // Today and Needs you now are out of date (fix list A3).
  const wasConfirmed = useRef(confirmed);
  useEffect(() => {
    if (confirmed && !wasConfirmed.current) void client.invalidateQueries({ queryKey: ['field-work'] });
    wasConfirmed.current = confirmed;
  }, [confirmed, client]);
  const draft = status === 'draft' && !submit.isSuccess;
  const step = row?.nextStep;
  const initial: OtpSent | null = sent ?? (otpParam ? { otpRequestId: otpParam, sentToLast4: last4Param || last4, contactName: contact } : null);
  const submitCode = submit.error ? errorCode(submit.error) : null;

  return (
    <>
      <HeroCard title={draft ? t('fa17b.draftTitle') : t('fa17b.title')} subtitle={details} emoji={draft ? '📝' : '🔐'} />
      {!page.canAct ? <Banner tone="info" title={t('biz.viewOnly')} message={t('biz.viewOnlyBody')} testID="vacancy-view-only" /> : null}
      {confirmed ? (
        <Banner tone="ok" title={t('fa17b.confirmed', { name: confirmedByName ?? contact, time: confirmedAt ? formatTimeIst(confirmedAt) : '' })} testID="vacancy-confirmed" />
      ) : !page.canAct ? null : draft ? (
        <Card stripe accent="navy" testID="vacancy-draft">
          <Text>{t('fa17b.draftBody', { name: contact })}</Text>
          {step?.kind === 'send_to_owner' && step.missing.length > 0 ? <Banner tone="warn" message={t('vac.err.incomplete')} testID="vacancy-missing" /> : null}
          {step?.kind === 'send_to_owner' && step.needsMinimumWageTick ? (
            <>
              <Banner tone="warn" title={t('fa17.belowTitle')} message={step.legalMinimumPaise ? t('fa17.belowBody', { amount: formatRupees(step.legalMinimumPaise) }) : undefined} />
              <Checkbox label={t('fa17.ownerTold')} checked={told} onChange={setTold} testID="vacancy-told" />
            </>
          ) : null}
          <Button
            label={t('vac.checkAndSend')}
            loading={submit.isPending}
            disabled={(step?.kind === 'send_to_owner' && (step.missing.length > 0 || (step.needsMinimumWageTick && !told))) || false}
            onPress={() => submit.mutate()}
            testID="vacancy-send"
          />
          {submit.error ? (
            <Banner
              tone="error"
              message={
                submitCode === 'MINIMUM_WAGE_TICK_REQUIRED' ? t('vac.err.tick') : submitCode === 'DRAFT_INCOMPLETE' ? t('vac.err.incomplete') : submitCode === 'DRAFT_CHANGED' ? t('vac.err.changed') : isApiError(submit.error) ? submit.error.message : t('common.error')
              }
              testID="vacancy-send-error"
            />
          ) : null}
        </Card>
      ) : (
        <Card stripe accent="gold">
          <OtpStep
            key={initial?.otpRequestId ?? 'none'}
            testID="vacancy-otp"
            initial={initial}
            sendLabel={t('fa17b.send', { name: contact })}
            verifyLabel={t('fa17b.verify')}
            intro={(s) => t('fa17b.sent', { name: s.contactName ?? contact, role: t(roleKey(role)), last4: s.sentToLast4 })}
            send={(prev, channel) => selling.sendVacancyCode(id, prev, channel)}
            verify={async (requestId, code) => {
              await selling.confirmVacancy(id, requestId, code);
              await client.invalidateQueries({ queryKey: ['selling'] });
              await client.invalidateQueries({ queryKey: ['field-work'] });
            }}
          />
          <Note>{t('fa17b.notHere')}</Note>
          {isWaiting(status) ? <Note testID="vacancy-watching">{t('fa17b.watching')}</Note> : null}
          <SendLinkButtons
            label={link.isSuccess ? t('fa17b.linkSent', { last4: link.data.sentToLast4 }) : t('fa17b.sendLink')}
            disabled={link.isSuccess || link.isPending}
            run={(channel) => link.mutateAsync(channel)}
            onError={() => undefined}
            testID="send-link"
          />
          <ErrorBanner error={link.error} />
        </Card>
      )}
      <Button
        label={t('fa17b.showMatches')}
        disabled={!confirmed || !page.status.canShowCandidates || !page.canAct}
        onPress={() => router.replace(sr.matches(page.id, id))}
        testID="show-matches"
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
