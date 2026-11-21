import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiBaseUrl } from '@/api/config';
import { Banner, Button, Card, ErrorState, ListRow, LoadingState, Text, TextField } from '@/components';
import { Checkbox } from '@/components/form';
import { useI18n } from '@/i18n';
import { formatStampIst } from '@/lib/format';
import { stepErrorText } from '@/verify/errors';
import { LegalBox } from '@/verify/LegalBox';
import { useStepsApi } from '@/verify/StepsApiProvider';
import { agreementCopyUrl, isLinkUsed } from '@/verify/stepsApi';
import type { SignedAgreement } from '@/verify/types';
import type { FlowProps } from './JobSeekerSteps';
import { OtpCodeCard } from '../shared/OtpCodeCard';

/**
 * The business agreement inside the app (P04 / P04b). The owner signs on
 * their own phone by a code sent to the business's number for this link —
 * never the field agent. The numbers are the ones frozen on the link. Their
 * name and three ticks (terms, authority, call recording; v1.1) come first;
 * "Send code to sign" sends the code and typing it signs (rev 193: one
 * button). After signing it shows when, and the signed copy.
 */
export function AgreementSteps({ token, onFinished }: FlowProps) {
  const { t } = useI18n();
  const api = useStepsApi();
  const details = useQuery({ queryKey: ['verify', 'agreement', token], queryFn: () => api.agreementDetails(token), retry: false });
  const used = isLinkUsed(details.error);
  const signedQuery = useQuery({ queryKey: ['verify', 'agreement-signed', token], queryFn: () => api.agreementSigned(token), enabled: used, retry: false });
  const [signed, setSigned] = useState<SignedAgreement | null>(null);
  // The owner's name from the link is filled in; they can change it.
  const [typedName, setName] = useState<string | null>(null);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeAuthority, setAgreeAuthority] = useState(false);
  const [agreeRecording, setAgreeRecording] = useState(false);
  const name = typedName ?? details.data?.ownerName ?? '';

  const done = signed ?? signedQuery.data ?? null;
  if (done) {
    return (
      <View style={styles.gap} testID="agree-signed">
        <Banner tone="ok" title={t('agree.signed', { name: done.signedName })} />
        <Card>
          <ListRow title={t('agree.signedAt')} subtitle={formatStampIst(done.signedAt)} />
          <ListRow title={t('agree.download')} onPress={() => void Linking.openURL(agreementCopyUrl(apiBaseUrl(), token))} last testID="agree-copy" />
        </Card>
        <Text variant="muted">{t('agree.next')}</Text>
        <Button label={t('verify.backHome')} onPress={onFinished} testID="agree-home" />
      </View>
    );
  }
  if (details.isLoading || (used && signedQuery.isLoading)) return <LoadingState />;
  if (details.isError || !details.data) return <ErrorState error={signedQuery.error ?? details.error} onRetry={() => void details.refetch()} />;
  const d = details.data;
  const ready = name.trim().length >= 2 && agreeTerms && agreeAuthority && agreeRecording;
  const items: [string, string][] = [
    [t('agree.fee'), t('agree.feeText', { fee: d.terms.feePercent, gst: d.terms.gstPercent })],
    [t('agree.replacement'), t('agree.replacementText', { days: d.guarantee.replacementWindowDays, count: d.guarantee.maxFreeReplacements })],
    [t('agree.refund', { days: d.guarantee.replacementSearchDays }), t('agree.refundText')],
    [t('agree.noBypass'), t('agree.noBypassText', { months: d.terms.noBypassMonths, penalty: d.terms.noBypassPenaltyPercent })],
    [t('agree.employer'), t('agree.employerText')],
  ];

  return (
    <View style={styles.gap} testID="agree">
      <Text variant="h1">{t('agree.title', { business: d.businessName })}</Text>
      <Card>
        {items.map(([title, text], i) => (
          <ListRow key={title} title={title} subtitle={text} last={i === items.length - 1} />
        ))}
      </Card>
      <LegalBox summaryHtml={d.agreementSummaryHtml} bodyHtml={d.agreementBodyHtml ?? d.agreementTermsHtml} version={d.version} testID="agree-legal" />
      <TextField label={t('agree.name')} value={name} onChangeText={setName} autoComplete="name" maxLength={80} testID="agree-name" />
      <Checkbox label={t('agree.agreeTerms')} checked={agreeTerms} onChange={setAgreeTerms} testID="agree-tick-terms" />
      <Checkbox label={t('agree.authority')} checked={agreeAuthority} onChange={setAgreeAuthority} testID="agree-tick-authority" />
      <Checkbox label={t('agree.agreeRecording')} checked={agreeRecording} onChange={setAgreeRecording} testID="agree-tick-recording" />
      <Text variant="muted">{ready ? t('agree.codeSigns', { phone: d.maskedPhone }) : t('agree.fillFirst')}</Text>
      <OtpCodeCard
        testID="agree-otp"
        send={() => api.sendLinkOtp(token)}
        submit={async (proof) => {
          if (!ready) throw new Error('NOT_READY');
          const result = await api.signAgreement(token, proof.requestId, proof.code, name.trim());
          setSigned({ signedAt: result.signedAt, signedName: name.trim(), businessName: d.businessName });
        }}
        sendLabel={t('agree.sendToSign')}
        submitLabel={t('agree.sendToSign')}
        sentText={t('agree.codeSigns', { phone: d.maskedPhone })}
        disabled={!ready}
        codeSubmits
        describeError={(err) => stepErrorText(t, err)}
      />
    </View>
  );
}

const styles = StyleSheet.create({ gap: { gap: 14 } });
