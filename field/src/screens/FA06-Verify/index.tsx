import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { Banner, Button, Card, CodeInput, EmptyState, ErrorState, LoadingState, Screen, StatusChip, Text } from '@/components';
import { useEndpoints } from '@/api/ApiProvider';
import { queryKeys } from '@/api/queryClient';
import { isApiError } from '@/api/errors';
import { visitPaths } from '@/api/endpoints';
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

/**
 * FA06 — Verification visit. The agent proves he is at the business with the
 * owner: (1) GPS against the map pin, (2) the live shop photo and a selfie
 * with the shop (both stamped, sent through the offline queue), (3) the
 * owner's OTP read out to him (needs signal), (4) the agreement link sent to
 * the owner, who signs on his own phone — the agent never signs for him.
 */
export default function VerifyScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ businessId?: string; assignmentId?: string }>();
  const { fieldWork, visits } = useEndpoints();
  const queue = useOfflineQueue();
  const location = useLocation();
  const { read } = location;
  const business = useQuery({
    queryKey: queryKeys.fieldBusiness(params.businessId ?? ''),
    queryFn: () => fieldWork.business(params.businessId!),
    enabled: Boolean(params.businessId),
  });
  const [visitId] = useState(() => newId());
  const [camera, setCamera] = useState<'board' | 'selfie' | null>(null);
  const [boardDone, setBoardDone] = useState(false);
  const [selfieDone, setSelfieDone] = useState(false);
  const [otp, setOtp] = useState<{ requestId: string; phone: string } | null>(null);
  const [code, setCode] = useState('');
  const [agreementSent, setAgreementSent] = useState(false);
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
    setProblem(isNeedsSignalError(e) ? t('common.needsSignal') : isApiError(e) ? e.message : t('common.error'));
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

  async function sendCode() {
    setProblem(null);
    setBusy('otp');
    try {
      const sent = await queue.live(() => visits.sendOwnerOtp(b.id, params.assignmentId!));
      setOtp({ requestId: sent.requestId, phone: sent.phone });
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  async function sendAgreement() {
    setProblem(null);
    setBusy('agreement');
    try {
      await queue.live(() => visits.sendAgreementLink(b.id));
      setAgreementSent(true);
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
      await queue.live(() => visits.verify(visitId, { ownerOtpRequestId: otp.requestId, ownerOtpCode: code }));
      router.replace({ pathname: routes.visitDone, params: { businessId: b.id, visitId } });
    } catch (e) {
      explain(e);
    } finally {
      setBusy(null);
    }
  }

  const done = <StatusChip tone="green" label={t('fa06.done')} />;
  return (
    <View style={styles.flex} testID="screen-FA06">
      <AppHeader title={t('fa06.title')} />
      <Screen>
        <Text variant="h1">{t('fa06.verify', { name: b.name })}</Text>
        <Card>
          <View style={styles.row}>
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa06.step1')}</Text>
            {atShop ? done : null}
          </View>
          <Text variant="muted" testID="fa06-from-pin">
            {fromPin !== null ? t('fa06.fromPin', { meters: fromPin }) : b.latitude === null ? t('fa06.noPin') : location.errorKey ? t(location.errorKey) : t('fa20.gpsFinding')}
          </Text>
          {!atShop ? <Button label={t('common.retry')} variant="secondary" onPress={() => void read()} /> : null}
        </Card>
        <Card>
          <View style={styles.row}>
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa06.step2')}</Text>
            {boardDone && selfieDone ? done : null}
          </View>
          <Text variant="muted">{t('fa06.cameraOnly')}</Text>
          <View style={styles.buttons}>
            <Button label={boardDone ? `✓ ${t('fa06.shopPhoto')}` : t('fa06.shopPhoto')} variant={boardDone ? 'secondary' : 'primary'} disabled={boardDone} loading={busy === 'board'} onPress={() => setCamera('board')} style={styles.flex1} testID="fa06-board" />
            <Button label={selfieDone ? `✓ ${t('fa06.selfie')}` : t('fa06.selfie')} variant={selfieDone ? 'secondary' : 'primary'} disabled={!boardDone || selfieDone} loading={busy === 'selfie'} onPress={() => setCamera('selfie')} style={styles.flex1} testID="fa06-selfie" />
          </View>
        </Card>
        <Card>
          <Text variant="bodyStrong">{t('fa06.step3')}</Text>
          {otp ? (
            <>
              <Text variant="muted">{t('fa06.otpSent', { phone: otp.phone })}</Text>
              <CodeInput value={code} onChange={setCode} label={t('fa06.ownerCode')} testID="fa06-code" />
            </>
          ) : null}
          <Button label={otp ? t('fa06.resend') : t('fa06.sendCode')} variant="secondary" loading={busy === 'otp'} onPress={() => void sendCode()} testID="fa06-send-code" />
        </Card>
        <Card>
          <View style={styles.row}>
            <Text variant="bodyStrong" style={styles.flex1}>{t('fa06.step4')}</Text>
            {b.agreement ? <StatusChip tone="green" label={t('fa06.signed')} /> : agreementSent ? <StatusChip tone="amber" label={t('fa06.linkSent')} /> : null}
          </View>
          <Text variant="muted">{t('fa06.agreementText')}</Text>
          {!b.agreement ? <Button label={t('fa06.sendAgreement')} variant="secondary" loading={busy === 'agreement'} onPress={() => void sendAgreement()} testID="fa06-agreement" /> : null}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  title: { fontFamily: fonts.display700 },
});
