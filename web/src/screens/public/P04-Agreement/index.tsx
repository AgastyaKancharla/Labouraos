import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TextField } from '../../../components/fields/TextField';
import { useI18n } from '../../../i18n/I18nProvider';
import { isApiError } from '../../../lib/api/errors';
import { agreementApi, type SignedAgreement } from '../shared/api';
import { dateTimeLabel } from '../shared/format';
import { ActionError, Choice, LinkProblem, Loading, Muted, Ok, OtpBlock, PageTitle, Row, usePersonLanguage } from '../shared/ui';

/**
 * P04-Agreement and P04b-Signed. The owner signs on their own phone by OTP —
 * never the field agent. The numbers are frozen as they were when the link
 * was sent; agreeing to the terms and to call recording are two boxes the
 * owner ticks. After signing (or on opening the used link again) it shows
 * when it was signed and gives the signed copy.
 */
export default function Agreement() {
  const { t, language } = useI18n();
  const token = useParams<{ token: string }>().token ?? '';
  const details = useQuery({ queryKey: ['agreement', token], queryFn: () => agreementApi.details(token), enabled: Boolean(token), retry: false });
  const used = isApiError(details.error) && /already been used/i.test(details.error.message);
  const signedQuery = useQuery({ queryKey: ['agreement-signed', token], queryFn: () => agreementApi.signed(token), enabled: used, retry: false });
  const [signed, setSigned] = useState<SignedAgreement | null>(null);
  const [name, setName] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeRecording, setAgreeRecording] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  usePersonLanguage(details.data?.preferredLanguage ?? signedQuery.data?.preferredLanguage, token);

  const ownerName = details.data?.ownerName;
  useEffect(() => {
    if (ownerName) setName((current) => current || ownerName);
  }, [ownerName]);

  const done = signed ?? signedQuery.data ?? null;
  if (done) {
    return (
      <>
        <Ok>{t('pub.agree.signed', { name: done.signedName })}</Ok>
        <div className="card">
          <Row label={t('pub.agree.signedAt')}>{dateTimeLabel(done.signedAt, language)}</Row>
          <Row label={t('pub.agree.copy')}>
            <a href={agreementApi.copyHref(token)} download>
              {t('pub.agree.download')}
            </a>
          </Row>
        </div>
        <Muted>{t('pub.agree.next')}</Muted>
      </>
    );
  }
  if (details.isLoading || (used && signedQuery.isLoading)) return <Loading />;
  if (details.error || !details.data) return <LinkProblem error={signedQuery.error ?? details.error} onRetry={() => void details.refetch()} />;
  const d = details.data;

  const canSign = name.trim().length >= 2 && agreeTerms && agreeRecording && Boolean(requestId) && code.length === 6;
  const sign = async () => {
    if (!canSign || !requestId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await agreementApi.sign(token, requestId, code, name.trim());
      setSigned({ signedAt: result.signedAt, signedName: name.trim(), businessName: d.businessName, preferredLanguage: d.preferredLanguage });
    } catch (e) {
      setError(e);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const items: [string, string][] = [
    [t('pub.agree.fee'), t('pub.agree.feeText', { fee: d.terms.feePercent, gst: d.terms.gstPercent })],
    [t('pub.agree.replacement'), t('pub.agree.replacementText', { days: d.guarantee.replacementWindowDays, count: d.guarantee.maxFreeReplacements })],
    [t('pub.agree.refund', { days: d.guarantee.replacementSearchDays }), t('pub.agree.refundText')],
    [t('pub.agree.noBypass'), t('pub.agree.noBypassText', { months: d.terms.noBypassMonths, penalty: d.terms.noBypassPenaltyPercent })],
    [t('pub.agree.employer'), t('pub.agree.employerText')],
  ];

  return (
    <>
      <PageTitle>{t('pub.agree.title', { business: d.businessName })}</PageTitle>
      <div className="card">
        {items.map(([title, text]) => (
          <div key={title} className="row lb-pub-row-col">
            <strong>{title}</strong>
            <span className="sub">{text}</span>
          </div>
        ))}
      </div>
      <details className="card lb-pub-terms">
        <summary>{t('pub.agree.readFull')}</summary>
        {/* Rendered by the server from its own template and the frozen numbers; no user text in it. */}
        <div dangerouslySetInnerHTML={{ __html: d.agreementTermsHtml }} />
      </details>
      <TextField label={t('pub.agree.name')} value={name} onChange={setName} autoComplete="name" required />
      <Choice checked={agreeTerms} onChange={setAgreeTerms} title={t('pub.agree.agreeTerms')} />
      <Choice checked={agreeRecording} onChange={setAgreeRecording} title={t('pub.agree.agreeRecording')} />
      <OtpBlock
        maskedPhone={d.maskedPhone}
        send={() => agreementApi.sendOtp(token)}
        requestId={requestId}
        onRequestId={setRequestId}
        code={code}
        onCode={setCode}
        invalid={Boolean(error)}
      />
      <ActionError error={error} />
      <button type="button" className="btn bp full" disabled={!canSign || busy} aria-busy={busy || undefined} onClick={() => void sign()}>
        {t('pub.agree.sign')}
      </button>
    </>
  );
}
