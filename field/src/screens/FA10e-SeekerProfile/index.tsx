import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { Banner, Button, Card, EmptyState, ErrorState, Icon, IconTile, ListRow, LoadingState, Screen, StatusChip, Text, SendLinkButtons, type SendChannel } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAfterSave } from '@/api/refresh';
import type { JobSeekerStatus, SeekerPage, Step } from '@/api/endpoints';
import { useOfflineQueue } from '@/device/offline-queue';
import { formatDayIst, formatTimeIst } from '@/lib/format';
import { pageRoutes, sellingRoutes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { ErrorBanner, KeyValue, vacancyShiftText } from '../_selling';
import { AadhaarQrScan } from '../_selling/AadhaarQrScan';
import { OtherIdPhoto } from '../_selling/OtherIdPhoto';
import { Avatar, WaitingMark } from '../_lists';
import { seekerGuaranteeLine, seekerStatusText, seekerTradeLine } from '../FA10d-MyJobSeekers';

/** Each registration step's mark: ✓ done, … sent or waiting, ✗ stuck, – not started. */
function mark(step: Step): { icon: string; color: string; fill: string } {
  if (step.state === 'done') return { icon: '✓', color: colors.white, fill: colors.green };
  if (step.state === 'stuck') return { icon: '✗', color: colors.white, fill: colors.redRaw };
  if (step.state === 'in_progress' || step.state === 'confirming') return { icon: '…', color: colors.navy, fill: colors.gold };
  return { icon: '–', color: colors.soft, fill: colors.navy100 };
}

/**
 * FA10e — one job seeker's profile in Laboura Field (Master Guide, "Laboura
 * Field lists, decided 22 Nov evening"): what tapping a job seeker opens,
 * never the registration screen straight away. Laid out like the Team Lead's
 * and CEO's profile pages: his photo and name on top; "Where they're stuck"
 * with the remaining steps as buttons (Continue registration, Scan Aadhaar
 * QR, Photo of another ID, Resend link, Send payment link, Book interview —
 * as they apply; "All done" when complete; "Waiting" while the Team Lead
 * checks his ID); the registration steps with ✓ / … / ✗; details; the
 * guarantee day and hits once paid; interviews and placements; history.
 * No rupee amounts. `?open=scan` (the list's Scan Aadhaar QR) opens the
 * scanner at once.
 * Data: GET /field-work/job-seekers/:ref/page and the registration status
 * (GET /screens/call-registration/job-seekers/:id, as FA10c).
 */
export default function SeekerProfileScreen() {
  const { t } = useI18n();
  const { id, open } = useLocalSearchParams<{ id?: string; open?: string }>();
  const { people } = useEndpoints();
  const q = useQuery({ queryKey: queryKeys.seekerPage(id ?? ''), queryFn: () => people.seekerPage(id!), enabled: Boolean(id) });
  return (
    <View style={styles.flex} testID="screen-FA10e">
      <AppHeader title={t('fa10e.title')} subtitle={q.data?.code} />
      <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
        {!id ? (
          <EmptyState message={t('common.error')} />
        ) : q.isPending ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <Profile p={q.data} openScan={open === 'scan'} refetch={() => void q.refetch()} />
        )}
      </Screen>
    </View>
  );
}

function Profile({ p, openScan, refetch }: { p: SeekerPage; openScan: boolean; refetch: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <Card stripe accent="cyan" testID="fa10e-top">
        <View style={styles.top}>
          <Avatar name={p.name} photoUrl={p.photoUrl} size={72} testID="fa10e-photo" />
          <View style={styles.topText}>
            <Text style={styles.name} accessibilityRole="header">
              {p.name}
            </Text>
            <Text variant="small" color={colors.soft}>
              {seekerTradeLine(p, t)}
            </Text>
            <Text variant="tiny">{[p.code, p.phoneLast4 ? `******${p.phoneLast4}` : null].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
      </Card>
      <StuckBox p={p} openScan={openScan} refetch={refetch} />
      <RegistrationSteps p={p} />
      <Details p={p} />
      <Guarantee p={p} />
      <Work p={p} />
      <History p={p} />
    </>
  );
}

/** "Where they're stuck": the step in plain words and the buttons left to tap. */
function StuckBox({ p, openScan, refetch }: { p: SeekerPage; openScan: boolean; refetch: () => void }) {
  const { t } = useI18n();
  const { selling, people } = useEndpoints();
  const queue = useOfflineQueue();
  const afterSave = useAfterSave();
  const idStep = p.stuck.step === 'id_check' && !p.stuck.waitingForTeamLead && p.row.status === 'id_check_needed';
  const [scanOpen, setScanOpen] = useState(openScan && idStep);
  const [otherIdOpen, setOtherIdOpen] = useState(false);
  const done = () => {
    refetch();
    afterSave();
  };
  // Rev 211: "Send on WhatsApp" (SMS as backup) or the small "Send by SMS".
  const link = useMutation({ mutationFn: (channel: SendChannel) => queue.live(() => selling.sendRegistrationLink(p.id, channel)), onSuccess: done });
  const pay = useMutation({ mutationFn: (channel: SendChannel) => queue.live(() => people.sendPaymentLink(p.id, channel)), onSuccess: done });
  const registering = !['complete', 'closed'].includes(p.stuck.step) && !p.guarantee;
  const allDone = p.row.done && !p.row.action;
  return (
    <Card title={t('fa10e.stuck')} icon="clipboard" accent="royal" testID="fa10e-stuck">
      {allDone ? (
        <Banner tone="ok" title={t('fa10e.allDone')} message={seekerStatusText(p.row, t)} testID="fa10e-all-done" />
      ) : (
        <>
          <KeyValue label={t('fa10e.step')} value={t(`fa10e.step.${p.stuck.step}` as MessageKey)} strong />
          <View style={styles.statusLine}>
            <Text variant="bodyStrong" style={styles.flex1} testID="fa10e-status">
              {seekerStatusText(p.row, t)}
            </Text>
            {p.row.waiting ? <WaitingMark testID="fa10e-waiting" /> : null}
          </View>
          {p.stuck.reason && !p.row.waiting ? <Text variant="muted">{p.stuck.reason}</Text> : null}
        </>
      )}
      {scanOpen ? (
        <AadhaarQrScan jobSeekerId={p.id} onFinished={done} onClose={() => setScanOpen(false)} />
      ) : otherIdOpen ? (
        <OtherIdPhoto jobSeekerId={p.id} onFinished={done} onClose={() => setOtherIdOpen(false)} />
      ) : (
        <View style={styles.buttons}>
          {idStep ? (
            <>
              <Button label={t('fa10b.scanAadhaar')} icon={<Icon name="shield" color={colors.white} />} onPress={() => setScanOpen(true)} testID="fa10e-scan" />
              <Button label={t('fa10b.otherId.open')} variant="secondary" icon={<Icon name="id-card" color={colors.cyan} />} onPress={() => setOtherIdOpen(true)} testID="fa10e-other-id" />
            </>
          ) : null}
          {p.stuck.actions.includes('payment_link') ? (
            <SendLinkButtons label={pay.isSuccess ? t('lists.sent') : t('lists.js.action.payment_link')} disabled={pay.isSuccess || pay.isPending} run={(channel) => pay.mutateAsync(channel)} onError={() => undefined} testID="fa10e-payment-link" />
          ) : null}
          {p.stuck.actions.includes('registration_link') ? (
            <SendLinkButtons
              label={link.isSuccess ? t('lists.sent') : p.row.status === 'link_not_sent' ? t('lists.js.action.sendLink') : t('lists.js.action.registration_link')}
              disabled={link.isSuccess || link.isPending}
              run={(channel) => link.mutateAsync(channel)}
              onError={() => undefined}
              testID="fa10e-resend"
            />
          ) : null}
          {p.row.action === 'book_interview' && p.row.vacancyId ? (
            <Button label={t('lists.js.action.book_interview')} onPress={() => router.push(sellingRoutes.book(p.row.vacancyId!, p.id))} testID="fa10e-book" />
          ) : null}
          {registering ? (
            <Button label={t('fa10e.continue')} variant="secondary" icon={<Icon name="chevron-right" color={colors.blue} />} onPress={() => router.push(pageRoutes.seekerProgress(p.id))} testID="fa10e-continue" />
          ) : null}
        </View>
      )}
      <ErrorBanner error={link.error ?? pay.error} />
    </Card>
  );
}

/** Consent, selfie, ID check and payment with ✓ / … / ✗ (the same status as the registration screen). */
function RegistrationSteps({ p }: { p: SeekerPage }) {
  const { t } = useI18n();
  const { selling } = useEndpoints();
  const status = useQuery<JobSeekerStatus>({ queryKey: queryKeys.seekerStatus(p.id), queryFn: () => selling.seekerStatus(p.id) });
  if (!status.data) return null;
  const s = status.data.steps;
  const rows: [string, string, Step][] = [
    ['phone', t('fa10b.phone'), s.phone],
    ['consent', t('fa10b.consent'), s.consent],
    ['selfie', t('fa10b.selfie'), s.selfie],
    ['idCheck', t('fa10b.idCheck'), s.idCheck],
    ['payment', t('fa10e.step.payment'), s.payment],
  ];
  return (
    <Card title={t('fa10e.steps')} icon="id-card" accent="royal" testID="fa10e-steps">
      {rows.map(([key, label, step], i) => {
        const m = mark(step);
        return (
          <View key={key} style={[styles.stepRow, i < rows.length - 1 && styles.line]} testID={`fa10e-step-${key}`}>
            <View style={[styles.disc, { backgroundColor: m.fill }]}>
              <Text style={[styles.discIcon, { color: m.color }]}>{m.icon}</Text>
            </View>
            <Text style={styles.flex1}>{label}</Text>
            {step.state === 'done' && step.time ? <Text variant="tiny">{formatDayIst(step.time)}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

function Details({ p }: { p: SeekerPage }) {
  const { t } = useI18n();
  const d = p.details;
  const rows: [string, string | null][] = [
    [t('fa10e.d.trade'), p.trade],
    [t('fa10e.d.otherTrades'), p.otherTrades.length ? p.otherTrades.join(', ') : null],
    [t('fa10e.d.area'), p.locality],
    [t('fa10e.d.experience'), p.yearsExperience ? t(p.yearsExperience === 1 ? 'lists.js.year' : 'lists.js.years', { count: p.yearsExperience }) : null],
    [t('fa10e.d.age'), d.age !== null ? String(d.age) : null],
    [t('fa10e.d.languages'), d.languages.length ? d.languages.join(', ') : null],
    [t('fa10e.d.shift'), vacancyShiftText(d.shift, t)],
    [t('fa10e.d.lastJob'), [d.lastRole, d.lastEmployer].filter(Boolean).join(' · ') || null],
    [t('fa10e.d.registered'), p.registeredByMe ? t('fa10e.d.registeredByYou', { date: formatDayIst(p.registeredAt) }) : formatDayIst(p.registeredAt)],
    [t('fa10e.d.mobile'), p.phoneLast4 ? `******${p.phoneLast4}` : null],
  ];
  const shown = rows.filter(([, v]) => v);
  return (
    <Card title={t('fa10e.details')} icon="user" accent="navy" testID="fa10e-details">
      {shown.map(([label, value], i) => (
        <KeyValue key={label} label={label} value={value ?? ''} last={i === shown.length - 1} />
      ))}
    </Card>
  );
}

function Guarantee({ p }: { p: SeekerPage }) {
  const { t } = useI18n();
  return (
    <Card title={t('fa10e.guarantee')} icon="shield" accent="green" testID="fa10e-guarantee">
      <KeyValue
        label={t('fa10e.guarantee')}
        value={p.guarantee ? t('lists.js.dayOf', { day: p.guarantee.day, days: p.guarantee.days }) : p.paidWaitingForId ? t('fa10e.paidWaitingId') : t('fa10e.guaranteeNotStarted')}
        strong
      />
      <KeyValue label={t('fa10e.hits')} value={String(p.hits)} last={!p.nextInterviewAt} />
      {p.nextInterviewAt ? <KeyValue label={t('fa10e.nextInterview')} value={`${formatDayIst(p.nextInterviewAt)} ${formatTimeIst(p.nextInterviewAt)}`} last /> : null}
      {p.guarantee ? <Text variant="tiny" testID="fa10e-guarantee-line">{seekerGuaranteeLine(p, t)}</Text> : null}
    </Card>
  );
}

function Work({ p }: { p: SeekerPage }) {
  const { t } = useI18n();
  const total = p.interviews.length + p.placements.length;
  return (
    <Card title={t('fa10e.work')} icon="calendar" accent="gold" testID="fa10e-work">
      {total === 0 ? <EmptyState compact emoji="🗓️" message={t('fa10e.noWork')} /> : null}
      {p.placements.map((pl, i) => (
        <ListRow
          key={pl.id}
          title={`${pl.businessName} · ${pl.trade}`}
          subtitle={[t('fa10e.placement'), pl.code, pl.joiningDate ? formatDayIst(`${pl.joiningDate}T06:00:00Z`) : null].filter(Boolean).join(' · ')}
          leading={<IconTile icon="trophy" accent="green" size={32} />}
          trailing={<StatusChip tone="green" label={t(`fa10e.pl.${pl.status}` as MessageKey)} />}
          last={i === total - 1}
          testID={`fa10e-placement-${pl.id}`}
        />
      ))}
      {p.interviews.map((iv, i) => (
        <ListRow
          key={iv.id}
          title={`${iv.businessName} · ${iv.trade}`}
          subtitle={`${formatDayIst(iv.startsAt)} ${formatTimeIst(iv.startsAt)} · ${iv.code}`}
          leading={<IconTile icon="calendar" accent="royal" size={32} />}
          trailing={<StatusChip tone={iv.result === 'selected' ? 'green' : iv.result ? 'neutral' : 'blue'} label={iv.result ? t(`result.${iv.result}` as MessageKey) : t(`fa10e.iv.${iv.status}` as MessageKey)} />}
          last={p.placements.length + i === total - 1}
          testID={`fa10e-interview-${iv.id}`}
        />
      ))}
    </Card>
  );
}

function History({ p }: { p: SeekerPage }) {
  const { t } = useI18n();
  return (
    <Card title={t('fa10e.history')} icon="clock" accent="gold" testID="fa10e-history">
      {p.history.map((h, i) => (
        <ListRow
          key={`${h.kind}-${h.at}-${i}`}
          title={t(`fa10e.h.${h.kind}` as MessageKey, { name: h.detail ?? '' })}
          subtitle={`${formatDayIst(h.at)} ${formatTimeIst(h.at)}`}
          leading={<IconTile icon={h.kind === 'paid' || h.kind === 'id_checked' || h.kind === 'guarantee_started' || h.kind === 'placement' ? 'check' : 'clock'} accent={h.kind === 'paid' || h.kind === 'guarantee_started' || h.kind === 'placement' ? 'green' : 'navy'} size={30} />}
          last={i === p.history.length - 1}
        />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  topText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: fonts.display700, fontSize: 20, color: colors.navy, lineHeight: 26 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  buttons: { gap: 8, marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 48 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.border },
  disc: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  discIcon: { fontFamily: fonts.body700, fontSize: 14, lineHeight: 18, textAlign: 'center' },
});
