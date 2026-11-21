import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Card, ErrorState, ListRow, LoadingState, Text, TextField } from '@/components';
import { Checkbox, RadioGroup } from '@/components/form';
import { useI18n, type MessageKey } from '@/i18n';
import { rupees } from '@/lib/money';
import { IdCheckPanel } from '@/verify/IdCheckPanel';
import { LegalBox } from '@/verify/LegalBox';
import { LiveCapture } from '@/verify/LiveCapture';
import { StepHeader } from '@/verify/StepHeader';
import { useStepsApi } from '@/verify/StepsApiProvider';
import { isLinkUsed } from '@/verify/stepsApi';
import type { AadhaarQrResult, OtherIdResult, PartnerOpen, PartnerPayout, PartnerStepState } from '@/verify/types';
import { useRun } from '@/verify/useRun';
import type { FlowProps } from './JobSeekerSteps';
import { DoneChip, LinkCode } from './LinkCode';

/**
 * The referral partner's steps inside the app (guide, "Registering a
 * partner"; the same checks as the SMS link): the code to their own number,
 * the terms with three ticks (terms, call recording, the separate ID-check
 * consent S2), a live selfie, the ID check, then UPI or a bank account in
 * their own name. Saving the payout details finishes the link.
 */
export const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
export const ACCOUNT_PATTERN = /^\d{9,18}$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const done = (s: PartnerStepState) => s === 'done';

export function PartnerSteps({ token, openInBrowser, browserBusy, onFinished }: FlowProps) {
  const { t } = useI18n();
  const api = useStepsApi();
  const client = useQueryClient();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [codeRanOut, setCodeRanOut] = useState(false);
  const [resumeSeen, setResumeSeen] = useState(false);
  const [saved, setSaved] = useState<{ maskedValue: string; status: string } | null>(null);
  const status = useQuery({ queryKey: ['verify', 'partner', token, requestId], queryFn: () => api.partnerStatus(token, requestId), staleTime: 0, retry: false, enabled: !saved });
  const codeExpired = useCallback(() => {
    setRequestId(null);
    setCodeRanOut(true);
  }, []);
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: ['verify', 'partner', token] }), [client, token]);

  if (saved && status.data && !status.data.otpRequired) {
    return <Received code={status.data.referralCode} maskedValue={saved.maskedValue} nameMismatch={saved.status === 'flagged'} onFinished={onFinished} />;
  }
  if (status.isLoading) return <LoadingState />;
  // The payout details finish the link: opening it again says so plainly.
  if (isLinkUsed(status.error)) {
    return (
      <View style={styles.gap} testID="rp-used">
        <Text variant="h1">{t('rp.title')}</Text>
        <Banner tone="ok" message={t('rp.used')} />
        <Button label={t('verify.backHome')} onPress={onFinished} />
      </View>
    );
  }
  if (status.isError || !status.data) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const data = status.data;

  if (data.otpRequired || !requestId) {
    return (
      <LinkCode
        testID="rp-code"
        title={t('rp.title')}
        intro={t('rp.intro')}
        steps={[t('rp.step1'), t('rp.step2'), t('rp.step3'), t('rp.step4')]}
        maskedPhone={data.maskedPhone}
        warning={data.otpRequired && data.registrationComplete ? t('reg.alreadyComplete') : null}
        codeRanOut={codeRanOut}
        send={() => api.sendLinkOtp(token)}
        verify={async (id, code) => {
          const opened = await api.verifyPartnerOtp(token, id, code);
          client.setQueryData(['verify', 'partner', token, id], opened);
          // A first visit goes straight to the terms; a return visit first shows what is done.
          const o = opened.steps;
          setResumeSeen(!(done(o.terms.state) || done(o.selfie.state) || done(o.id.state) || done(o.upi.state)));
          setCodeRanOut(false);
          setRequestId(id);
        }}
      />
    );
  }

  if (data.reconsent?.needsReconsent) {
    return (
      <View style={styles.gap}>
        <Banner tone="warn" message={t('verify.reconsent')} testID="rp-reconsent" />
        <Button label={t('verify.backHome')} onPress={onFinished} />
      </View>
    );
  }

  if (data.currentStep === 'complete' || data.payout) {
    return <Received code={data.referralCode} maskedValue={data.payout?.maskedValue ?? '—'} nameMismatch={data.payout?.nameMatches === false} onFinished={onFinished} />;
  }

  const s = data.steps;
  if (!resumeSeen) {
    const count = [s.terms, s.selfie, s.id, s.upi].filter((x) => done(x.state)).length;
    return (
      <View style={styles.gap} testID="rp-resume">
        <Text variant="h1">{t('reg.welcomeBack', { name: data.firstName })}</Text>
        <Text variant="muted">{t('reg.doneOf', { done: count })}</Text>
        <Card>
          <ListRow title={t('rp.step1')} trailing={<DoneChip done={done(s.terms.state)} />} />
          <ListRow title={t('rp.step2')} trailing={<DoneChip done={done(s.selfie.state)} />} />
          <ListRow title={t('rp.step3')} trailing={<DoneChip done={done(s.id.state)} />} />
          <ListRow title={t('rp.step4')} trailing={<DoneChip done={done(s.upi.state)} />} last />
        </Card>
        <Button label={t('rp.continue')} onPress={() => setResumeSeen(true)} testID="rp-resume-continue" />
      </View>
    );
  }

  const common = { token, requestId, status: data, onCodeExpired: codeExpired, refresh };
  if (data.currentStep === 'terms') return <TermsStep {...common} />;
  if (data.currentStep === 'selfie') return <SelfieStep {...common} />;
  if (data.currentStep === 'id_check') return <IdStep {...common} openInBrowser={openInBrowser} browserBusy={browserBusy} />;
  return <PayoutStep {...common} onSaved={setSaved} />;
}

interface StepProps {
  token: string;
  requestId: string;
  status: PartnerOpen;
  onCodeExpired: () => void;
  refresh: () => Promise<void>;
}

function TermsStep({ token, requestId, onCodeExpired, refresh }: StepProps) {
  const { t } = useI18n();
  const api = useStepsApi();
  const terms = useQuery({ queryKey: ['verify', 'partner-terms', token, requestId], queryFn: () => api.partnerTerms(token, requestId), retry: false });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeRecording, setAgreeRecording] = useState(false);
  const [agreeIdCheck, setAgreeIdCheck] = useState(false);
  const { busy, error, run } = useRun(onCodeExpired);

  if (terms.isLoading) return <LoadingState />;
  if (terms.isError || !terms.data) return <ErrorState error={terms.error} onRetry={() => void terms.refetch()} />;
  const d = terms.data;
  const vars = { reward: rupees(d.referralPayoutPaise), fee: rupees(d.activationFeePaise) };
  const points: MessageKey[] = ['rp.earnJoin', 'rp.earnNotPay', 'rp.earnBusiness', 'rp.earnSelf', 'rp.paidQueued', 'rp.paidHow'];
  const all = agreeTerms && agreeRecording && agreeIdCheck;

  return (
    <View style={styles.gap} testID="rp-terms">
      <StepHeader current={1} total={4} label={t('rp.termsLabel')} title={t('rp.termsTitle')} />
      <Text variant="muted">{t('rp.termsIntro')}</Text>
      <Card>
        <View style={styles.gap}>
          {points.map((key) => (
            <Text key={key}>• {t(key, vars)}</Text>
          ))}
        </View>
      </Card>
      <LegalBox summaryHtml={d.summaryHtml} bodyHtml={d.bodyHtml ?? d.termsHtml} version={d.version} testID="rp-terms-legal" />
      <Checkbox label={t('rp.agreeTerms')} checked={agreeTerms} onChange={setAgreeTerms} testID="rp-terms-tick-terms" />
      <Checkbox label={t('rp.agreeRecording')} checked={agreeRecording} onChange={setAgreeRecording} testID="rp-terms-tick-recording" />
      <Checkbox label={t('rp.agreeIdCheck')} checked={agreeIdCheck} onChange={setAgreeIdCheck} testID="rp-terms-tick-id" />
      {!all ? <Text variant="muted">{t('verify.needAll')}</Text> : null}
      {error ? <Banner tone="error" message={error} testID="rp-terms-error" /> : null}
      <Button
        label={t('verify.agreeContinue')}
        disabled={!all}
        loading={busy}
        onPress={() =>
          void run(async () => {
            await api.acceptPartnerTerms(token, requestId);
            await refresh();
          })
        }
        testID="rp-terms-agree"
      />
    </View>
  );
}

function SelfieStep({ token, requestId, onCodeExpired, refresh }: StepProps) {
  const { t } = useI18n();
  const api = useStepsApi();
  const { error, run } = useRun(onCodeExpired);
  return (
    <View style={styles.gap} testID="rp-selfie">
      <StepHeader current={2} total={4} label={t('selfie.label')} title={t('selfie.title')} />
      {error ? <Banner tone="error" message={error} testID="rp-selfie-error" /> : null}
      <LiveCapture
        kind="selfie"
        tips={t('rp.selfieTips')}
        takeLabel={t('selfie.take')}
        savingLabel={t('selfie.saving')}
        onCapture={async (photo) => {
          const ok = await run(async () => {
            await api.partnerSelfie(token, requestId, photo);
            await refresh();
          });
          return ok ? 'done' : 'retry';
        }}
        testID="rp-selfie-camera"
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
      <View style={styles.gap} testID="rp-id-stopped">
        <StepHeader current={3} total={4} label={t('id.label')} title={t('id.title')} />
        <Banner tone="warn" title={t('id.under18Title')} message={t(qrResult?.dateOfBirthUnreadable ? 'id.dobUnreadable' : 'id.under18Body')} />
      </View>
    );
  }
  const pending = !qrResult && (otherResult?.status === 'pending' || status.idCheck.lastResult === 'pending');
  const last = status.idCheck.lastResult;
  const otherIdFailed: MessageKey | null = qrResult ? null : last === 'name_mismatch' ? 'id.nameMismatch' : last === 'photo_expired' ? 'id.photoExpired' : last === 'failed' ? 'id.failed' : null;

  return (
    <View style={styles.gap} testID="rp-id">
      <StepHeader current={3} total={4} label={t('id.label')} title={t('id.title')} />
      <IdCheckPanel
        busy={busy}
        qrResult={qrResult}
        otherIdFailed={otherIdFailed}
        pending={pending}
        onQr={(text) =>
          void run(async () => {
            setOtherResult(null);
            setQrResult(await api.partnerAadhaarQr(token, requestId, text));
          })
        }
        getCaptureNonce={async () => (await api.partnerCaptureNonce(token, requestId)).captureNonce}
        onOtherId={async (method, idNumber, photo, nonce) => {
          const ok = await run(async () => {
            setQrResult(null);
            setOtherResult(await api.partnerOtherId(token, requestId, method, idNumber, photo, nonce));
            await refresh();
          });
          return ok ? 'done' : 'retry';
        }}
        onContinue={() => void refresh()}
        onOpenPdf={openInBrowser}
        pdfBusy={browserBusy}
      />
      {error ? <Banner tone="error" message={error} testID="rp-id-error" /> : null}
    </View>
  );
}

function PayoutStep({ token, requestId, onCodeExpired, onSaved }: StepProps & { onSaved: (s: { maskedValue: string; status: string }) => void }) {
  const { t } = useI18n();
  const api = useStepsApi();
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [upiId, setUpiId] = useState('');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const { busy, error, run } = useRun(onCodeExpired);
  const cleanUpi = upiId.trim();
  const cleanIfsc = ifsc.trim().toUpperCase();
  const valid = method === 'upi' ? UPI_PATTERN.test(cleanUpi) : ACCOUNT_PATTERN.test(account) && IFSC_PATTERN.test(cleanIfsc);

  return (
    <View style={styles.gap} testID="rp-upi">
      <StepHeader current={4} total={4} label={t('rp.upiLabel')} title={t('rp.upiTitle')} />
      <Text variant="muted">{t('rp.upiIntro')}</Text>
      <RadioGroup
        label={t('rp.method')}
        value={method}
        onChange={setMethod}
        options={[
          { value: 'upi', label: t('rp.methodUpi') },
          { value: 'bank', label: t('rp.methodBank') },
        ]}
        testID="rp-upi-method"
      />
      {method === 'upi' ? (
        <TextField label={t('rp.upiId')} value={upiId} onChangeText={setUpiId} autoCapitalize="none" autoCorrect={false} autoComplete="off" keyboardType="email-address" maxLength={320} testID="rp-upi-id" />
      ) : (
        <>
          <TextField label={t('rp.account')} value={account} onChangeText={(v) => setAccount(v.replace(/\D/g, '').slice(0, 18))} keyboardType="number-pad" autoComplete="off" maxLength={18} testID="rp-upi-account" />
          <TextField label={t('rp.ifsc')} value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={11} testID="rp-upi-ifsc" />
        </>
      )}
      {error ? <Banner tone="error" message={error} testID="rp-upi-error" /> : null}
      <Button
        label={t('rp.save')}
        disabled={!valid}
        loading={busy}
        onPress={() => {
          const details: PartnerPayout = method === 'upi' ? { method: 'upi', upiId: cleanUpi } : { method: 'bank', accountNumber: account, ifsc: cleanIfsc };
          void run(async () => {
            const result = await api.partnerPayout(token, requestId, details);
            // The full value is never kept on the phone: clear it and show only the masked one.
            setUpiId('');
            setAccount('');
            onSaved({ maskedValue: result.maskedValue, status: result.status });
          });
        }}
        testID="rp-upi-save"
      />
    </View>
  );
}

function Received({ code, maskedValue, nameMismatch, onFinished }: { code: string; maskedValue: string; nameMismatch: boolean; onFinished: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.gap} testID="rp-done">
      <Text variant="h1">{t('rp.upiTitle')}</Text>
      {nameMismatch ? <Banner tone="warn" message={t('rp.nameMismatch')} /> : <Banner tone="ok" title={t('rp.receivedTitle')} message={t('rp.receivedBody')} />}
      <Card>
        <ListRow title={t('rp.code')} subtitle={code} />
        <ListRow title={t('rp.payoutTo')} subtitle={maskedValue} last />
      </Card>
      <Button label={t('verify.backHome')} onPress={onFinished} testID="rp-done-home" />
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 14 } });
