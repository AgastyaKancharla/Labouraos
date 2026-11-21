import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiBaseUrl } from '@/api/config';
import { Banner, Button, Card, ErrorState, ListRow, LoadingState, Text, TextField } from '@/components';
import { Checkbox, MobileField } from '@/components/form';
import { useI18n, type MessageKey } from '@/i18n';
import { formatDayIst, formatStampIst } from '@/lib/format';
import { rupees } from '@/lib/money';
import { stepErrorText } from '@/verify/errors';
import { IdCheckPanel } from '@/verify/IdCheckPanel';
import { LegalBox } from '@/verify/LegalBox';
import { LiveCapture } from '@/verify/LiveCapture';
import { StepHeader } from '@/verify/StepHeader';
import { useStepsApi } from '@/verify/StepsApiProvider';
import { isCodeExpired, receiptUrl } from '@/verify/stepsApi';
import type { AadhaarQrResult, OtherIdResult, RegistrationOpen } from '@/verify/types';
import { useRun } from '@/verify/useRun';
import { DoneChip, LinkCode } from './LinkCode';

/**
 * The job seeker's registration steps inside the app (proposal 8.2; the same
 * order and checks as the SMS link P00 → P02b): the code to his own number,
 * consent, a live selfie, the ID check, his guarantee terms and the ₹499,
 * then "Paid — confirming" until the bank confirms. Every step calls the
 * link endpoints with his own link token, so the server checks exactly what
 * it checks on the link page (the code bound to this link, live camera, the
 * Aadhaar QR's signature, the terms' text hash, the payment by the bank).
 */
export interface FlowProps {
  token: string;
  /** Opens this same step on the Laboura page in the browser sheet (e-Aadhaar PDF). */
  openInBrowser: () => void;
  browserBusy: boolean;
  onFinished: () => void;
}

export function JobSeekerSteps({ token, openInBrowser, browserBusy, onFinished }: FlowProps) {
  const { t } = useI18n();
  const api = useStepsApi();
  const client = useQueryClient();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [codeRanOut, setCodeRanOut] = useState(false);
  const [resumeSeen, setResumeSeen] = useState(false);
  const [paidTapped, setPaidTapped] = useState(false);
  const key = ['verify', 'registration', token, requestId] as const;
  const status = useQuery({
    queryKey: key,
    queryFn: () => api.registrationStatus(token, requestId),
    staleTime: 0,
    // While "Paid — confirming": ask again every 5 seconds until the bank confirms.
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && !d.otpRequired && paidTapped && d.payment.state !== 'confirmed' && d.payment.state !== 'failed' ? 5_000 : false;
    },
  });
  const codeExpired = useCallback(() => {
    setRequestId(null);
    setCodeRanOut(true);
  }, []);
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: ['verify', 'registration', token] }), [client, token]);

  if (status.isLoading) return <LoadingState />;
  if (status.isError || !status.data) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const data = status.data;

  if (data.otpRequired || !requestId) {
    return (
      <LinkCode
        testID="reg-code"
        title={t('reg.title')}
        intro={t('reg.intro')}
        steps={[t('reg.step1'), t('reg.step2'), t('reg.step3'), t('reg.step4Plain')]}
        maskedPhone={data.maskedPhone}
        warning={data.otpRequired && data.registrationComplete ? t('reg.alreadyComplete') : null}
        // A code that ran out while on a step (the status answers "locked" again).
        codeRanOut={codeRanOut || requestId !== null}
        send={() => api.sendLinkOtp(token)}
        verify={async (id, code) => {
          const opened = await api.verifyRegistrationOtp(token, id, code);
          client.setQueryData(['verify', 'registration', token, id], opened);
          // A first visit goes straight to consent; a return visit first shows what is done.
          const anyDone = opened.steps.consent || opened.steps.selfie || opened.steps.idCheck || opened.steps.payment;
          setResumeSeen(!anyDone || opened.currentStep === 'complete');
          setCodeRanOut(false);
          setRequestId(id);
        }}
      />
    );
  }

  if (data.reconsent?.needsReconsent) {
    return (
      <View style={styles.gap}>
        <Banner tone="warn" message={t('verify.reconsent')} testID="reg-reconsent" />
        <Button label={t('verify.backHome')} onPress={onFinished} />
      </View>
    );
  }

  const step = data.currentStep;
  if (!resumeSeen && step !== 'complete' && !paidTapped) {
    return <Resume status={data} onContinue={() => setResumeSeen(true)} />;
  }

  if (step === 'complete' || (paidTapped && step === 'payment')) {
    return <Paid status={data} onBackToPay={() => setPaidTapped(false)} onFinished={onFinished} />;
  }
  const common = { token, requestId, status: data, onCodeExpired: codeExpired, refresh };
  if (step === 'consent') return <ConsentStep {...common} />;
  if (step === 'selfie') return <SelfieStep {...common} />;
  if (step === 'id_check') return <IdStep {...common} openInBrowser={openInBrowser} browserBusy={browserBusy} />;
  return <PaymentStep {...common} onPaid={() => setPaidTapped(true)} />;
}

interface StepProps {
  token: string;
  requestId: string;
  status: RegistrationOpen;
  onCodeExpired: () => void;
  refresh: () => Promise<void>;
}

function Resume({ status, onContinue }: { status: RegistrationOpen; onContinue: () => void }) {
  const { t } = useI18n();
  const done = [status.steps.consent, status.steps.selfie, status.steps.idCheck, status.steps.payment].filter(Boolean).length;
  const payLabel = status.payment.state === 'failed' ? t('reg.lastTryFailed') : status.payment.state === 'confirming' ? t('reg.confirming') : status.payment.state === 'pending' ? t('reg.notPaidYet') : undefined;
  const next: Record<string, MessageKey> = { consent: 'reg.continueConsent', selfie: 'reg.continueSelfie', id_check: 'reg.continueId', payment: 'reg.continuePayment' };
  return (
    <View style={styles.gap} testID="reg-resume">
      <Text variant="h1">{t('reg.welcomeBack', { name: status.firstName })}</Text>
      <Text variant="muted">{t('reg.doneOf', { done })}</Text>
      <Card>
        <ListRow title={t('reg.step1')} trailing={<DoneChip done={status.steps.consent} />} />
        <ListRow title={t('reg.step2')} trailing={<DoneChip done={status.steps.selfie} />} />
        <ListRow title={t('reg.step3')} trailing={<DoneChip done={status.steps.idCheck} />} />
        <ListRow title={t('reg.step4', { amount: rupees(status.payment.amountPaise) })} trailing={<DoneChip done={status.steps.payment} label={status.steps.payment ? undefined : payLabel} />} last />
      </Card>
      <Button label={t(next[status.currentStep] ?? 'rp.continue')} onPress={onContinue} testID="reg-resume-continue" />
    </View>
  );
}

function ConsentStep({ token, requestId, status, onCodeExpired, refresh }: StepProps) {
  const { t } = useI18n();
  const api = useStepsApi();
  const doc = useQuery({ queryKey: ['verify', 'legal', 'job_seeker_terms'], queryFn: () => api.legalDocument('job_seeker_terms'), staleTime: 10 * 60_000 });
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const { busy, error, run } = useRun(onCodeExpired);

  if (doc.isLoading) return <LoadingState />;
  if (doc.isError || !doc.data) return <ErrorState error={doc.error} onRetry={() => void doc.refetch()} />;
  const d = doc.data;
  // An item he already gave on an earlier link is shown as given, not asked again (17 Nov).
  const given = new Set(status.consentGiven ?? []);
  const toAsk = d.consents.filter((c) => !given.has(c.purpose));
  const allRequired = toAsk.filter((c) => c.required).every((c) => ticked[c.purpose]);

  return (
    <View style={styles.gap} testID="reg-consent">
      <StepHeader current={1} total={4} label={t('consent.label')} title={t('consent.title')} />
      <Text variant="muted">{t('consent.intro')}</Text>
      <LegalBox summaryHtml={d.summaryHtml} bodyHtml={d.bodyHtml} version={d.version} testID="reg-consent-legal" />
      {given.size > 0 ? <Text variant="muted">{t('verify.givenNote')}</Text> : null}
      {d.consents.map((c) =>
        given.has(c.purpose) ? (
          <ListRow key={c.purpose} title={c.title} subtitle={c.description} trailing={<DoneChip done label={t('verify.given')} />} testID={`reg-consent-given-${c.purpose}`} />
        ) : (
          <Checkbox
            key={c.purpose}
            label={`${c.title}${c.required ? '' : ` (${t('consent.optional')})`} — ${c.description}`}
            checked={Boolean(ticked[c.purpose])}
            onChange={(v) => setTicked((prev) => ({ ...prev, [c.purpose]: v }))}
            testID={`reg-consent-tick-${c.purpose}`}
          />
        ),
      )}
      {!allRequired ? <Text variant="muted">{t('verify.needAll')}</Text> : null}
      {error ? <Banner tone="error" message={error} testID="reg-consent-error" /> : null}
      <Button
        label={t('verify.agreeContinue')}
        disabled={!allRequired}
        loading={busy}
        onPress={() =>
          void run(async () => {
            await api.submitConsent(token, requestId, toAsk.filter((c) => ticked[c.purpose]).map((c) => c.purpose), d.hash);
            await refresh();
          })
        }
        testID="reg-consent-agree"
      />
    </View>
  );
}

function SelfieStep({ token, requestId, onCodeExpired, refresh }: StepProps) {
  const { t } = useI18n();
  const api = useStepsApi();
  const { error, run } = useRun(onCodeExpired);
  return (
    <View style={styles.gap} testID="reg-selfie">
      <StepHeader current={2} total={4} label={t('selfie.label')} title={t('selfie.title')} />
      {error ? <Banner tone="error" message={error} testID="reg-selfie-error" /> : null}
      <LiveCapture
        kind="selfie"
        tips={t('selfie.tips')}
        takeLabel={t('selfie.take')}
        savingLabel={t('selfie.saving')}
        onCapture={async (photo) => {
          const ok = await run(async () => {
            await api.registrationSelfie(token, requestId, photo);
            await refresh();
          });
          return ok ? 'done' : 'retry';
        }}
        testID="reg-selfie-camera"
      />
    </View>
  );
}

function IdStep({ token, requestId, status, onCodeExpired, refresh, openInBrowser, browserBusy }: StepProps & { openInBrowser: () => void; browserBusy: boolean }) {
  const { t } = useI18n();
  const api = useStepsApi();
  const { busy, error, run } = useRun(onCodeExpired);
  const [qrResult, setQrResult] = useState<AadhaarQrResult | null>(null);
  const [otherResult, setOtherResult] = useState<OtherIdResult | null>(null);

  if (status.stopped === 'under_18' || qrResult?.isAdult === false) {
    return (
      <View style={styles.gap} testID="reg-id-stopped">
        <StepHeader current={3} total={4} label={t('id.label')} title={t('id.title')} />
        <Banner tone="warn" title={t('id.under18Title')} message={t(qrResult?.dateOfBirthUnreadable ? 'id.dobUnreadable' : 'id.under18Body')} />
      </View>
    );
  }

  const pending = !qrResult && (otherResult?.status === 'pending' || status.idCheck.lastResult === 'pending');
  const last = status.idCheck.lastResult;
  const otherIdFailed: MessageKey | null = qrResult ? null : last === 'name_mismatch' ? 'id.nameMismatch' : last === 'photo_expired' ? 'id.photoExpired' : last === 'failed' ? 'id.failed' : null;

  return (
    <View style={styles.gap} testID="reg-id">
      <StepHeader current={3} total={4} label={t('id.label')} title={t('id.title')} />
      <IdCheckPanel
        busy={busy}
        qrResult={qrResult}
        otherIdFailed={otherIdFailed}
        pending={pending}
        onQr={(text) =>
          void run(async () => {
            setOtherResult(null);
            // The green result stays on screen until he taps Continue.
            setQrResult(await api.registrationAadhaarQr(token, requestId, text));
          })
        }
        getCaptureNonce={async () => (await api.registrationCaptureNonce(token, requestId)).captureNonce}
        onOtherId={async (method, idNumber, photo, nonce) => {
          const ok = await run(async () => {
            setQrResult(null);
            setOtherResult(await api.registrationOtherId(token, requestId, method, idNumber, photo, nonce));
            await refresh();
          });
          return ok ? 'done' : 'retry';
        }}
        onNonceFailed={(e) =>
          void run(async () => {
            throw e;
          })
        }
        onContinue={() => void refresh()}
        onOpenPdf={openInBrowser}
        pdfBusy={browserBusy}
      />
      {error ? <Banner tone="error" message={error} testID="reg-id-error" /> : null}
    </View>
  );
}

const SHIFT: Record<string, MessageKey> = { day: 'pay.shift.day', night: 'pay.shift.night', rotational: 'pay.shift.rotational', any: 'pay.shift.any' };
const JOB_TYPE: Record<string, MessageKey> = { full_time: 'pay.job.fullTime', part_time: 'pay.job.partTime', live_in: 'pay.job.liveIn' };

function PaymentStep({ token, requestId, status, onCodeExpired, refresh, onPaid }: StepProps & { onPaid: () => void }) {
  const { t } = useI18n();
  const api = useStepsApi();
  const blocked = status.waitingForTrade || status.stopped !== null;
  const terms = useQuery({ queryKey: ['verify', 'reg-terms', token, requestId], queryFn: () => api.registrationTerms(token, requestId), enabled: !blocked, retry: false });
  const legal = useQuery({ queryKey: ['verify', 'legal', 'job_seeker_terms'], queryFn: () => api.legalDocument('job_seeker_terms'), staleTime: 10 * 60_000, enabled: !blocked });
  // INF-1: the pay page token from his code-verified status, never the UPI reference.
  const payPageToken = status.payPageToken ?? null;
  const summary = useQuery({ queryKey: ['verify', 'pay-summary', payPageToken], queryFn: () => api.paymentSummary(payPageToken!), enabled: Boolean(payPageToken) });
  const { busy, error, run } = useRun(onCodeExpired);
  const other = useRun(onCodeExpired);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherPhone, setOtherPhone] = useState('');
  const [otherSent, setOtherSent] = useState(false);
  const [noUpiApp, setNoUpiApp] = useState(false);
  const termsCodeExpired = terms.isError && isCodeExpired(terms.error);
  useEffect(() => {
    if (termsCodeExpired) onCodeExpired();
  }, [termsCodeExpired, onCodeExpired]);

  const header = <StepHeader current={4} total={4} label={t('pay.label')} title={t('pay.title', { amount: rupees(status.payment.amountPaise) })} />;
  if (status.waitingForTrade) {
    return (
      <View style={styles.gap} testID="reg-pay">
        {header}
        <Banner tone="warn" message={t('pay.waitingForTrade')} testID="reg-pay-waiting-trade" />
      </View>
    );
  }
  if (terms.isError && !termsCodeExpired) return <ErrorState error={terms.error} onRetry={() => void terms.refetch()} />;
  if (!terms.data) return <LoadingState />;
  if (summary.data?.underReview) {
    return (
      <View style={styles.gap} testID="reg-pay">
        {header}
        <Banner tone="warn" message={t('pay.underReview')} testID="reg-pay-review" />
      </View>
    );
  }

  const tr = terms.data;
  const suitable = [
    tr.trade,
    tr.travelDistanceKm !== null ? (tr.locality ? t('pay.withinKmOf', { km: tr.travelDistanceKm, area: tr.locality }) : t('pay.withinKm', { km: tr.travelDistanceKm })) : null,
    tr.shiftPreference ? t(SHIFT[tr.shiftPreference] ?? 'pay.shift.any') : null,
    tr.jobType && JOB_TYPE[tr.jobType] ? t(JOB_TYPE[tr.jobType]!) : null,
    t('pay.atLeast', { amount: rupees(tr.guaranteeFloorPaise) }),
  ]
    .filter(Boolean)
    .join(' · ');
  const accepted = Boolean(status.termsAcceptedAt) && Boolean(payPageToken);
  const pay = summary.data?.pay ?? null;
  const minutes = summary.data?.paymentOnlyLinkMinutes ?? 15;

  const payWithUpi = async () => {
    if (!pay) return;
    setNoUpiApp(false);
    try {
      await Linking.openURL(pay.upiUri);
      onPaid();
    } catch {
      setNoUpiApp(true);
    }
  };

  return (
    <View style={styles.gap} testID="reg-pay">
      {header}
      <Card title={t('pay.guarantee')} accent="good">
        <View style={styles.gap}>
          <Text variant="bodyStrong">{t('pay.guaranteeLine', { days: tr.guaranteeDays, amount: rupees(tr.amountPaise) })}</Text>
          <Text variant="small">{t('pay.suitableTitle')}</Text>
          <Text variant="muted">{suitable}</Text>
          <Text variant="muted">{t('pay.rules')}</Text>
        </View>
      </Card>
      {legal.data ? <LegalBox summaryHtml={legal.data.summaryHtml} bodyHtml={legal.data.bodyHtml} version={legal.data.version} testID="reg-pay-legal" /> : null}
      <Checkbox
        label={t('pay.agree')}
        checked={accepted}
        disabled={busy || accepted}
        onChange={(v) => {
          // Once agreed it is recorded; the box stays ticked.
          if (v && !accepted)
            void run(async () => {
              await api.acceptRegistrationTerms(token, requestId);
              await refresh();
            });
        }}
        testID="reg-pay-agree"
      />
      {error ? <Banner tone="error" message={error} testID="reg-pay-error" /> : null}
      {accepted && pay ? (
        <>
          <Card testID="reg-pay-qr">
            <View style={styles.qr} accessible accessibilityLabel={t('pay.qrLabel', { amount: rupees(pay.amountPaise) })}>
              <SvgXml xml={pay.qrSvg} width={220} height={220} />
            </View>
            <Text variant="muted" align="center">
              {t('pay.payee', { payee: pay.payeeName, reference: pay.upiReference })}
            </Text>
          </Card>
          <Button label={t('pay.payUpi')} onPress={() => void payWithUpi()} testID="reg-pay-upi" />
          {noUpiApp ? <Banner tone="warn" message={t('pay.noUpiApp')} testID="reg-pay-no-upi" /> : null}
          <Button label={t('pay.paidButton')} variant="secondary" onPress={onPaid} testID="reg-pay-paid" />
          <Button label={t('pay.someoneElse')} variant="secondary" onPress={() => setOtherOpen((o) => !o)} accessibilityState={{ expanded: otherOpen }} testID="reg-pay-other" />
          {otherOpen ? (
            <Card testID="reg-pay-other-form">
              {otherSent ? (
                <Banner tone="ok" message={t('pay.otherSent', { minutes })} testID="reg-pay-other-sent" />
              ) : (
                <View style={styles.gap}>
                  <MobileField label={t('pay.otherPhone')} value={otherPhone} onChange={setOtherPhone} hint={t('pay.otherHint', { minutes })} required testID="reg-pay-other-phone" />
                  {other.error ? <Banner tone="error" message={other.error} /> : null}
                  <Button
                    label={t('pay.otherSend')}
                    disabled={otherPhone.length !== 10}
                    loading={other.busy}
                    onPress={() =>
                      void other.run(async () => {
                        await api.sendPaymentOnlyLink(token, requestId, `+91${otherPhone}`);
                        setOtherSent(true);
                      })
                    }
                    testID="reg-pay-other-send"
                  />
                </View>
              )}
            </Card>
          ) : null}
          <Text variant="muted">{t('pay.bankNote')}</Text>
        </>
      ) : (
        <Card>
          <Text variant="muted">{busy || summary.isLoading ? t('common.loading') : t('pay.tickFirst')}</Text>
        </Card>
      )}
    </View>
  );
}

function Paid({ status, onBackToPay, onFinished }: { status: RegistrationOpen; onBackToPay: () => void; onFinished: () => void }) {
  const { t } = useI18n();
  const api = useStepsApi();
  const [utr, setUtr] = useState('');
  const [utrSaved, setUtrSaved] = useState(false);
  const [utrBusy, setUtrBusy] = useState(false);
  const [utrError, setUtrError] = useState<string | null>(null);

  if (status.payment.state === 'confirmed') {
    const p = status.payment;
    return (
      <View style={styles.gap} testID="reg-paid">
        <Banner tone="ok" title={t('paid.done', { amount: rupees(p.amountPaise) })} />
        <Card>
          {p.confirmedAt ? <ListRow title={t('paid.confirmedBy')} subtitle={formatStampIst(p.confirmedAt)} /> : null}
          {p.guaranteeEndsAt ? <ListRow title={t('paid.daysEnd')} subtitle={formatDayIst(p.guaranteeEndsAt)} last={!(p.paymentId && status.receiptToken)} /> : null}
          {p.paymentId && status.receiptToken ? (
            <ListRow title={t('paid.viewReceipt')} onPress={() => void Linking.openURL(receiptUrl(apiBaseUrl(), p.paymentId!, status.receiptToken!))} last testID="reg-paid-receipt" />
          ) : null}
        </Card>
        <Text variant="muted">{t('paid.next')}</Text>
        <Button label={t('verify.backHome')} onPress={onFinished} testID="reg-paid-home" />
      </View>
    );
  }

  const payPageToken = status.payPageToken ?? null;
  return (
    <View style={styles.gap} testID="reg-confirming">
      <Banner tone="warn" title={t('paid.confirmingTitle')} message={t('paid.confirmingBody')} />
      <Text variant="muted">{t('paid.noScreenshot')}</Text>
      {payPageToken && !utrSaved ? (
        <View style={styles.gap}>
          <TextField label={t('paid.utrLabel')} value={utr} onChangeText={(v) => setUtr(v.replace(/\D/g, '').slice(0, 12))} keyboardType="number-pad" maxLength={12} testID="reg-paid-utr" />
          {utrError ? <Banner tone="error" message={utrError} /> : null}
          <Button
            label={t('paid.utrSend')}
            variant="secondary"
            disabled={utr.length !== 12}
            loading={utrBusy}
            onPress={() => {
              setUtrBusy(true);
              setUtrError(null);
              api
                .utrHint(payPageToken, utr)
                .then(() => setUtrSaved(true))
                .catch((e: unknown) => setUtrError(stepErrorText(t, e)))
                .finally(() => setUtrBusy(false));
            }}
            testID="reg-paid-utr-send"
          />
        </View>
      ) : null}
      {utrSaved ? <Banner tone="ok" message={t('paid.utrSaved')} /> : null}
      {status.currentStep === 'payment' ? <Button label={t('paid.backToPay')} variant="secondary" onPress={onBackToPay} testID="reg-paid-back" /> : null}
      <Button label={t('verify.backHome')} variant="secondary" onPress={onFinished} />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 14 },
  qr: { alignItems: 'center', paddingVertical: 8 },
});
