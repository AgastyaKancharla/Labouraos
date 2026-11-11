import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import type { InterviewView } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthProvider';
import { Banner, Button, Card, Screen, Text } from '@/components';
import { RadioGroup, SelectField } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatCountdown } from '@/lib/format';
import { sellingRoutes } from '@/navigation/routes';
import { colors, fonts, radius } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { Note, QueryView, REASON_KEYS, useParam, useSellingSettings } from '../_selling';
import { OtpStep } from '../_selling/OtpStep';

/**
 * FA15f — Owner on the phone. The agent has handed his phone to the owner:
 * the same call, still recorded; this talk is the first interview. Then the
 * owner's decision: Selected now (→ FA15s, salary and joining date by the
 * owner's OTP), Wants to meet in person (→ FA15g), or Not selected (reason
 * confirmed by the owner's OTP; no hit; next candidate).
 */
export default function ThreeWayScreen() {
  const { t } = useI18n();
  const id = useParam('id');
  const { selling } = useEndpoints();
  const interview = useQuery({ queryKey: queryKeys.sellingInterview(id), queryFn: () => selling.interview(id), enabled: !!id });
  return (
    <View style={styles.flex}>
      <AppHeader title={t('fa03.headerTitle')} subtitle={t('fa15e.subtitle')} />
      <Screen testID="screen-FA15f">
        <QueryView query={interview}>{(i) => <Decide interview={i} />}</QueryView>
      </Screen>
    </View>
  );
}

function Decide({ interview: i }: { interview: InterviewView }) {
  const { t } = useI18n();
  const { session } = useAuth();
  const { selling } = useEndpoints();
  const client = useQueryClient();
  const settings = useSellingSettings();
  const [decision, setDecision] = useState<'selected' | 'meet' | 'not_selected' | null>(null);
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const since = i.handedToOwnerAt ? new Date(i.handedToOwnerAt).getTime() : now;
  const owner = i.business.contactName ?? t('fa15f.owner');
  const agent = (session?.staff.name ?? '').split(/\s+/)[0] ?? '';
  const done = i.status !== 'confirmed' || !!i.resultRecordedAt;
  const reasons = settings.data?.notSelectedReasons ?? Object.keys(REASON_KEYS);

  if (done) {
    return (
      <Banner
        tone="info"
        title={t('fa15f.alreadyDecided')}
        message={i.result === 'selected' ? t('fa15f.wasSelected') : t('fa15f.wasOther')}
        action={i.result === 'selected' ? <Button label={t('fa15f.openSelected')} onPress={() => router.replace(sellingRoutes.selected(i.id))} /> : undefined}
        testID="already-decided"
      />
    );
  }

  return (
    <>
      <View style={styles.live} testID="owner-on-call">
        <Text style={styles.liveTitle}>{t('fa15f.talking', { name: i.candidate.firstName, time: formatCountdown(now - since) })}</Text>
        <Text style={styles.liveSub}>{t('fa15f.sameCall')}</Text>
      </View>
      <Card>
        <Text>{t('fa15f.handedTo', { agent, owner })}</Text>
      </Card>
      <RadioGroup
        label={t('fa15f.decision')}
        value={decision}
        onChange={setDecision}
        testID="decision"
        options={[
          { value: 'selected', label: t('fa15f.selected') },
          { value: 'meet', label: t('fa15f.meet') },
          { value: 'not_selected', label: t('fa15f.notSelected'), tone: 'bad' },
        ]}
      />
      {decision === 'selected' ? (
        <Button label={t('fa15f.continueSelected')} onPress={() => router.push(sellingRoutes.selected(i.id))} testID="go-selected" />
      ) : decision === 'meet' ? (
        <Button
          label={t('fa15f.continueMeet')}
          onPress={() => router.push(sellingRoutes.book(i.vacancy.id, i.candidate.id, i.id))}
          testID="go-meet"
        />
      ) : decision === 'not_selected' ? (
        <>
          <SelectField
            label={t('fa15f.reason')}
            required
            value={reason}
            onChange={setReason}
            choices={reasons.map((r) => ({ value: r, label: REASON_KEYS[r] ? t(REASON_KEYS[r]) : r }))}
            testID="reason"
          />
          {reason ? (
            <OtpStep
              testID="not-selected-otp"
              sendLabel={t('fa15f.sendReasonOtp', { owner })}
              verifyLabel={t('fa15f.confirmNotSelected')}
              intro={(s) => t('selling.otpSentTo', { name: s.contactName ?? owner, last4: s.sentToLast4 })}
              send={(prev) => selling.ownerOtp(i.id, { decision: 'not_selected', reason, otpRequestId: prev })}
              verify={async (requestId, code) => {
                await selling.decision(i.id, { decision: 'not_selected', reason, otpRequestId: requestId, code });
                await client.invalidateQueries({ queryKey: ['selling', 'matches', i.vacancy.id] });
                router.replace(sellingRoutes.matches(i.business.id, i.vacancy.id));
              }}
            />
          ) : null}
        </>
      ) : null}
      <Note>{t('fa15f.rules')}</Note>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  live: { borderRadius: radius.lg, borderWidth: 1, borderColor: '#A9DEC7', backgroundColor: colors.green100, padding: 14 },
  liveTitle: { fontFamily: fonts.display700, color: colors.green, fontSize: 15 },
  liveSub: { color: colors.green, fontFamily: fonts.body600, fontSize: 12.5 },
});
