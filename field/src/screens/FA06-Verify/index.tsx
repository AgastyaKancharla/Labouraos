import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, CodeInput, EmptyState, ErrorState, IconTile, LoadingState, Screen, SendBySms, StatusChip, Text, TextField } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { useAfterSave } from '@/api/refresh';
import { isApiError } from '@/api/errors';
import { errorCode, visitPaths } from '@/api/endpoints';
import { isNeedsSignalError, useOfflineQueue } from '@/device/offline-queue';
import { useLocation } from '@/device/location/useLocation';
import { distanceMeters } from '@/device/location/location';
import type { CapturedPhoto } from '@/device/camera';
import { newId } from '@/lib/uuid';
import { routes } from '@/navigation/routes';
import { colors, fonts } from '@/theme';
import { AppHeader } from '../_shared/AppHeader';
import { CameraSheet } from '../_visits/CameraSheet';
import { photoRequest } from '../_visits/photo';
import { SAME_SPOT_METERS } from '../FA22-VisitProof';
import { VerificationJobCard } from '../_visits/VerificationJobCard';
import { AGREEMENT_POLL_MS } from '../FA07b-Agreement';

/**
 * FA06 — Verification visit. The agent proves he is at the business with the
 * owner: (1) GPS against the map pin, (2) the live shop photo and a selfie
 * with the shop (both stamped, sent through the offline queue), (3) the
 * owner's OTP read out to him (needs signal), (4) the agreement link sent to
 * the owner, who signs on his own phone — the agent never signs for him.
 */
export default function VerifyScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ businessId?: string; assignmentId?: string; visitId?: string }>();
  const { fieldWork, visits, fieldOps, redesign } = useEndpoints();
  const client = useQueryClient();
  const queue = useOfflineQueue();
  const afterSave = useAfterSave();
  const location = useLocation();
  const { read } = location;
  const business = useQuery({
    queryKey: queryKeys.fieldBusiness(params.businessId ?? ''),
    queryFn: () => fieldWork.business(params.businessId!),
    enabled: Boolean(params.businessId),
  });
  const [visitId] = useState(() => params.visitId || newId());
  const [camera, setCamera] = useState<'board' | 'selfie' | null>(null);
  const [boardTaken, setBoardDone] = useState(false);
  const [selfieTaken, setSelfieDone] = useState(false);
  // A started visit (from Today or Planned): what was already taken is not asked again.
  const resumed = useQuery({ queryKey: queryKeys.visit(visitId), queryFn: () => visits.get(visitId), enabled: Boolean(params.visitId) });
  const boardDone = boardTaken || Boolean(resumed.data?.hasBoardPhoto);
  const selfieDone = selfieTaken || Boolean(resumed.data?.hasSelfie);
  const jobs = useQuery({ queryKey: queryKeys.verificationVisits, queryFn: () => fieldOps.verificationVisits(), enabled: Boolean(params.assignmentId) });
  const job = jobs.data?.find((j) => j.assignmentId === params.assignmentId) ?? null;
  const [pinOpen, setPinOpen] = useState(false);
  const [pinReason, setPinReason] = useState('');
  const [pinMoved, setPinMoved] = useState<number | null | 'new'>(null);
  const movePin = useMutation({
    mutationFn: async () => {
      const reading = location.fix ?? (await read());
      if (!reading) throw new Error(t('fa16.needGps'));
      return queue.live(() =>
        fieldOps.updatePin(params.assignmentId!, { latitude: reading.latitude, longitude: reading.longitude, accuracy: reading.accuracy, reason: pinReason.trim() }),
      );
    },
    onSuccess: (r) => {
      setPinMoved(r.movedMeters === null ? 'new' : r.movedMeters);
      setPinOpen(false);
      void client.invalidateQueries({ queryKey: ['field-work'] });
      void business.refetch();
    },
  });
  const [otp, setOtp] = useState<{ requestId: string; phone: string; sentAt: number } | null>(null);
  const [code, setCode] = useState('');
  const [agreementSent, setAgreementSent] = useState(false);
  // One button, and "Signed" turns green live when the owner signs on his phone.
  const agreement = useQuery({
    queryKey: queryKeys.agreement(params.businessId ?? ''),
    queryFn: () => redesign.agreement(params.businessId!),
    enabled: Boolean(params.businessId) && agreementSent,
    refetchInterval: (query) => (query.state.data?.state === 'signed' ? false : AGREEMENT_POLL_MS),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void read();
  }, [read]);

  if (!params.businessId || !params.assignmentId) return <EmptyState message={t('common.error')} />;
  if (business.isPending) return <LoadingState />;
  if (business.isError) return <ErrorState error={business.error} onRetry={() => void business.refetch()} />;
  const b = business.data;
  const fix = location.fix;
  const fromPin = fix && b.latitude !== null && b.longitude !== null ? Math.round(distanceMeters(fix, { latitude: b.latitude, longitude: b.longitude })) : null;
  const atShop = fromPin !== null && fromPin <= SAME_SPOT_METERS;

  function explain(e: unknown) {
    setProblem(
      isNeedsSignalError(e)
        ? t('common.needsSignal')
        : errorCode(e) === 'AGREEMENT_SMS_FAILED'
          ? t('common.smsFailed')
          : isApiError(e)
            ? e.isNetworkError ? t('common.networkError') : e.message
            : t('common.error'),
    );
  }

  async function onPhoto(kind: 'board' | 'selfie', photo: CapturedPhoto) {
    setProblem(null);
    setBusy(kind);
    try {
      if (kind === 'board') {
        await queue.submit(`${t('fa20.queueLabel')} · ${b.name}`, photoRequest(visitPaths.start, photo, { id: visitId, businessId: b.id, assignmentId: params.assignmentId! }, 'shop.jpg'));
        setBoardDone(true);
      } else {
        await queue.submit(`${t('fa22.queueLabel')} · ${b.name}`, photoRequest(visitPaths.proof(visitId), photo, {}, 'selfie.jpg'));
        setSelfieDone(true);
      }
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  async function sendCode(channel?: 'sms') {
    setProblem(null);
    setBusy('otp');
    try {
      const sent = await queue.live(() => visits.sendOwnerOtp(b.id, params.assignmentId!, channel));
      setOtp({ requestId: sent.requestId, phone: sent.phone, sentAt: Date.now() });
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  async function sendBoth() {
    await sendCode();
    if (!signed && !agreementSent) await sendAgreement(false);
  }

  async function sendAgreement(resetProblem = true) {
    if (resetProblem) setProblem(null);
    setBusy('agreement');
    try {
      await queue.live(() => visits.sendAgreementLink(b.id));
      setAgreementSent(true);
      afterSave();
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    if (!otp || code.length !== 6) return setProblem(t('fa06.enterCode'));
    setProblem(null);
    setBusy('complete');
    try {
      await queue.flush();
      const done = await queue.live(() => visits.verify(visitId, { ownerOtpRequestId: otp.requestId, ownerOtpCode: code }));
      afterSave(['field-visits'], ['selling']);
      // A business with no account agent gets the verifying agent (server S1): say so only then, and
      // go on to the agreement while it is unsigned (he may act on it now), else to the finish step.
      const next = { businessId: b.id, visitId, ...(done?.becameAccountAgent ? { accountAgent: 'new' } : {}) };
      const mine = Boolean(done?.isAccountAgent || done?.becameAccountAgent);
      router.replace({ pathname: mine && !b.agreement && agreement.data?.state !== 'signed' ? routes.visitAgreement : routes.visitDone, params: next });
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  const done = <StatusChip tone="green" label={t('fa06.done')} />;
  const signed = Boolean(b.agreement) || agreement.data?.state === 'signed';
  return (
    <View style={styles.flex} testID="screen-FA06">
      <AppHeader title={t('fa06.title')} />
      <Screen>
        <Text variant="h1">{t('fa06.verify', { name: b.name })}</Text>
        {job ? <VerificationJobCard job={job} showVerify={false} testID="fa06-job" /> : null}
        <Card stripe accent="royal">
          <View style={styles.row}>
            <IconTile icon="location" accent="royal" size={30} />
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa06.step1')}</Text>
            {atShop ? done : null}
          </View>
          <Text variant="muted" testID="fa06-from-pin">
            {fromPin !== null ? t('fa06.fromPin', { meters: fromPin }) : b.latitude === null ? t('fa06.noPin') : location.errorKey ? t(location.errorKey) : t('fa20.gpsFinding')}
          </Text>
          {!atShop ? (
            <Button
              label={t('common.retry')}
              variant="secondary"
              onPress={() => {
                movePin.reset();
                void read();
              }}
            />
          ) : null}
          {pinMoved !== null ? (
            <Banner tone="ok" message={pinMoved === 'new' ? t('fa06.pinMovedNew') : t('fa06.pinMoved', { meters: pinMoved })} testID="fa06-pin-moved" />
          ) : null}
          {!atShop && fix && params.assignmentId && pinMoved === null ? (
            pinOpen ? (
              <View style={styles.pin} testID="fa06-pin-form">
                <Text variant="muted">{t('fa06.updatePinHelp')}</Text>
                <TextField label={t('fa06.pinReason')} value={pinReason} onChangeText={setPinReason} testID="fa06-pin-reason" />
                {movePin.error ? <Banner tone="error" message={isApiError(movePin.error) ? movePin.error.message : movePin.error instanceof Error ? movePin.error.message : t('common.error')} testID="fa06-pin-error" /> : null}
                <Button label={t('fa06.pinSave')} disabled={pinReason.trim().length < 5} loading={movePin.isPending} onPress={() => movePin.mutate()} testID="fa06-pin-save" />
              </View>
            ) : (
              <Button
                label={t('fa06.updatePin')}
                variant="secondary"
                onPress={() => {
                  movePin.reset();
                  setPinOpen(true);
                }}
                testID="fa06-update-pin"
              />
            )
          ) : null}
        </Card>
        <Card stripe accent="cyan">
          <View style={styles.row}>
            <IconTile icon="camera" accent="cyan" size={30} />
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa06.step2')}</Text>
            {boardDone && selfieDone ? done : null}
          </View>
          <Text variant="muted">{t('fa06.cameraOnly')}</Text>
          <View style={styles.buttons}>
            <Button label={boardDone ? `✓ ${t('fa06.shopPhoto')}` : t('fa06.shopPhoto')} variant={boardDone ? 'secondary' : 'primary'} disabled={boardDone} loading={busy === 'board'} onPress={() => setCamera('board')} style={styles.flex1} testID="fa06-board" />
            <Button label={selfieDone ? `✓ ${t('fa06.selfie')}` : t('fa06.selfie')} variant={selfieDone ? 'secondary' : 'primary'} disabled={!boardDone || selfieDone} loading={busy === 'selfie'} onPress={() => setCamera('selfie')} style={styles.flex1} testID="fa06-selfie" />
          </View>
        </Card>
        {/* 17 Nov rule (21 Nov review): one button sends the owner his code and the agreement link together. */}
        <Card stripe accent="gold" testID="fa06-owner-step">
          <View style={styles.row}>
            <IconTile icon="phone" accent="gold" size={30} />
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa06.ownerStep')}</Text>
            {signed ? <StatusChip tone="green" label={t('fa06.signed')} /> : agreementSent ? <StatusChip tone="amber" label={t('fa06.linkSent')} /> : null}
          </View>
          <Text variant="muted">{t('fa06.agreementText')}</Text>
          {otp ? (
            <>
              <Text variant="muted">{t('fa06.otpSent', { phone: otp.phone })}</Text>
              <CodeInput value={code} onChange={setCode} label={t('fa06.ownerCode')} testID="fa06-code" />
            </>
          ) : null}
          <Button
            label={otp ? t('fa06.resend') : t('fa06.sendBoth')}
            variant="secondary"
            loading={busy === 'otp' || busy === 'agreement'}
            onPress={() => void (otp ? sendCode() : sendBoth())}
            testID="fa06-send-code"
          />
          {/* Rev 211: the code goes on WhatsApp first; "Send by SMS" after 30 seconds. */}
          <SendBySms sentAt={otp?.sentAt ?? null} disabled={busy !== null} onPress={() => void sendCode('sms')} testID="fa06-sms" />
          {/* The code went but the agreement SMS did not: send the link again on its own. */}
          {otp && !signed && !agreementSent ? (
            <Button label={t('fa06.sendAgreement')} variant="secondary" loading={busy === 'agreement'} onPress={() => void sendAgreement()} testID="fa06-agreement" />
          ) : null}
        </Card>
        <Text variant="muted">{t('fa06.help')}</Text>
        {problem ? <Banner tone="error" message={problem} testID="fa06-problem" /> : null}
        <Button label={t('fa06.complete')} disabled={!boardDone || !selfieDone || !otp} loading={busy === 'complete'} onPress={() => void complete()} testID="fa06-complete" />
        <Button
          label={t('fa06.couldntFinish')}
          variant="secondary"
          onPress={() => (boardDone ? router.push({ pathname: routes.visitOutcome, params: { id: visitId } }) : router.replace(routes.visits))}
          testID="fa06-couldnt"
        />
      </Screen>
      <CameraSheet
        open={camera !== null}
        facing={camera === 'selfie' ? 'front' : 'back'}
        label={b.code}
        onCapture={(p) => void onPhoto(camera ?? 'board', p)}
        onClose={() => setCamera(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  pin: { gap: 8, marginTop: 8 },
  title: { fontFamily: fonts.display700 },
});
