import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, IconTile, StatusChip, Text } from '@/components';
import { Checkbox } from '@/components/form';
import { useEndpoints } from '@/api/ApiProvider';
import { errorCode, type PageVacancy } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useOfflineQueue } from '@/device/offline-queue';
import { useI18n, type MessageKey } from '@/i18n';
import { formatTimeIst } from '@/lib/format';
import type { SellingRoutes } from '@/navigation/routes';
import { colors, radius } from '@/theme';
import { formatRupees, SHIFT_KEYS } from '../_selling';
import { formatDateKey } from '../_visits/format';

const MISSING_KEYS: Record<string, MessageKey> = {
  tradeSkill: 'vac.missing.trade',
  salaryMinPaise: 'vac.missing.salary',
  headcount: 'vac.missing.headcount',
  shift: 'vac.missing.shift',
  startDate: 'vac.missing.startDate',
};

/** "Cook × 2 · ₹15,000–18,000 · Day shift". */
export function vacancyLine(v: PageVacancy, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  return [
    v.headcount > 1 ? `${v.trade} × ${v.headcount}` : v.trade,
    v.salaryMinPaise ? `${formatRupees(v.salaryMinPaise)}${v.salaryMaxPaise && v.salaryMaxPaise !== v.salaryMinPaise ? `–${formatRupees(v.salaryMaxPaise).replace('₹', '')}` : ''}` : null,
    v.shift && SHIFT_KEYS[v.shift] ? t(SHIFT_KEYS[v.shift]) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * One vacancy with its one next step (redesign, 16 Nov):
 * draft → "Check and send to owner" (one tap; the owner then confirms by code
 * or link) · waiting → "Enter owner's code" or "Resend link" · confirmed →
 * "Show candidates". View-only businesses show the status only.
 */
export function VacancyStep({ vacancy: v, businessId, sr, canAct, last }: {
  vacancy: PageVacancy;
  businessId: string;
  sr: SellingRoutes;
  canAct: boolean;
  last?: boolean;
}) {
  const { t } = useI18n();
  const { redesign, selling } = useEndpoints();
  const queue = useOfflineQueue();
  const client = useQueryClient();
  const [told, setTold] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['field-work'] });
    void client.invalidateQueries({ queryKey: ['selling'] });
  };
  const send = useMutation({
    mutationFn: () => queue.live(() => redesign.submitDraft(v.id, told || undefined)),
    onSuccess: (r) => {
      refresh();
      const sent = r.confirmation && 'otpRequestId' in r.confirmation ? r.confirmation : null;
      router.push(`${sr.confirmVacancy(v.id)}${sent ? `?otp=${encodeURIComponent(sent.otpRequestId)}&last4=${sent.sentToLast4}` : ''}`);
    },
  });
  const link = useMutation({ mutationFn: () => queue.live(() => selling.vacancyLink(v.id)), onSettled: refresh });
  const step = v.nextStep;
  const tone = v.status === 'open' ? 'green' : v.status === 'draft' ? 'neutral' : 'amber';
  const statusKey: MessageKey = v.status === 'open' ? 'vac.status.open' : v.status === 'draft' ? 'vac.status.draft' : v.status === 'awaiting_confirmation' ? 'vac.status.waiting' : 'vac.status.other';
  const sendError = send.error ? draftErrorText(send.error, t) : null;

  return (
    <View style={[styles.box, !last && styles.line]} testID={`vacancy-${v.id}`}>
      <View style={styles.head}>
        <IconTile icon="briefcase" accent={v.status === 'open' ? 'royal' : v.status === 'draft' ? 'navy' : 'gold'} size={34} />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{vacancyLine(v, t)}</Text>
          <Text variant="muted">{[v.code, v.startDate ? t('vac.from', { date: formatDateKey(v.startDate.slice(0, 10)) }) : null].filter(Boolean).join(' · ')}</Text>
        </View>
        <StatusChip tone={tone} label={t(statusKey)} />
      </View>
      {!canAct ? null : step.kind === 'send_to_owner' ? (
        <View style={styles.actions}>
          {step.missing.length > 0 ? (
            <Banner tone="warn" message={t('vac.missing', { fields: step.missing.map((m) => t(MISSING_KEYS[m] ?? 'vac.missing.other')).join(', ') })} testID={`vacancy-${v.id}-missing`} />
          ) : null}
          {step.needsMinimumWageTick ? (
            <>
              <Banner
                tone="warn"
                title={t('fa17.belowTitle')}
                message={step.legalMinimumPaise ? t('fa17.belowBody', { amount: formatRupees(step.legalMinimumPaise) }) : undefined}
              />
              <Checkbox label={t('fa17.ownerTold')} checked={told} onChange={setTold} testID={`vacancy-${v.id}-told`} />
            </>
          ) : null}
          <Button
            label={t('vac.checkAndSend')}
            loading={send.isPending}
            disabled={step.missing.length > 0 || (step.needsMinimumWageTick && !told)}
            onPress={() => send.mutate()}
            testID={`vacancy-${v.id}-send`}
          />
          <Text variant="muted">{t('vac.checkAndSendHint')}</Text>
          {sendError ? <Banner tone="error" message={sendError} testID={`vacancy-${v.id}-error`} /> : null}
        </View>
      ) : step.kind === 'enter_code' ? (
        <View style={styles.actions}>
          <Text variant="muted">
            {step.linkSentAt ? t('vac.linkSentAt', { time: formatTimeIst(step.linkSentAt), last4: step.sentToLast4 ?? '—' }) : t('vac.waitingOwner')}
          </Text>
          <View style={styles.row}>
            <Button label={t('vac.enterCode')} style={styles.flex} onPress={() => router.push(sr.confirmVacancy(v.id))} testID={`vacancy-${v.id}-code`} />
            <Button
              label={link.isSuccess ? t('vac.linkResent') : t('vac.resendLink')}
              variant="secondary"
              style={styles.flex}
              loading={link.isPending}
              disabled={link.isSuccess}
              onPress={() => link.mutate()}
              testID={`vacancy-${v.id}-link`}
            />
          </View>
          {link.error ? <Banner tone="error" message={isApiError(link.error) ? link.error.message : t('common.error')} /> : null}
        </View>
      ) : step.kind === 'show_candidates' ? (
        <Button
          label={step.shown > 0 ? t('vac.showMore', { count: step.shown }) : t('vac.showCandidates')}
          onPress={() => router.push(sr.matches(businessId, v.id))}
          testID={`vacancy-${v.id}-show`}
        />
      ) : null}
    </View>
  );
}

function draftErrorText(error: unknown, t: (key: MessageKey) => string): string {
  switch (errorCode(error)) {
    case 'DRAFT_INCOMPLETE':
      return t('vac.err.incomplete');
    case 'MINIMUM_WAGE_TICK_REQUIRED':
      return t('vac.err.tick');
    case 'DRAFT_CHANGED':
      return t('vac.err.changed');
    case 'NOT_A_DRAFT':
      return t('vac.err.notDraft');
    default:
      return isApiError(error) ? error.message : t('common.error');
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: { gap: 10, paddingVertical: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.blue100 },
  row: { flexDirection: 'row', gap: 8 },
});
