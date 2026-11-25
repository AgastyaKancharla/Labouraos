import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TextField } from '../../../components/fields/TextField';
import { useI18n } from '../../../i18n/I18nProvider';
import { isApiError } from '../../../lib/api/errors';
import { agreementApi, type OwnerPhotoState, type SignedAgreement } from '../shared/api';
import { OwnerPhotos } from './OwnerPhotos';
import { SmallBusinessSteps } from './SmallBusinessSteps';
import { LegalSummary } from '../shared/legal';
import { dateTimeLabel } from '../shared/format';
import { ActionError, Choice, LinkProblem, Loading, Muted, Ok, OtpBlock, PageTitle, Row } from '../shared/ui';

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
  const [agreeAuthority, setAgreeAuthority] = useState(false);
  const [agreeRecording, setAgreeRecording] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // 22 Nov: after a press of "Send code to sign" with something missing, the missing fields are marked.
  const [showMissing, setShowMissing] = useState(false);
  // 25 Nov (rev 211, B1): the owner's live photos, updated as he takes them.
  const [photos, setPhotos] = useState<OwnerPhotoState | null>(null);

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
        {/* B9 (rev 212): a business with few documents finishes its checks on this same link. */}
        <SmallBusinessSteps token={token} ownerName={done.signedName} />
      </>
    );
  }
  if (details.isLoading || (used && signedQuery.isLoading)) return <Loading />;
  if (details.error || !details.data) return <LinkProblem error={signedQuery.error ?? details.error} onRetry={() => void details.refetch()} />;
  const d = details.data;

  // Rev 193: one button. The name and the three ticks come first; "Send code to sign" sends the
  // owner's code, and typing it signs in the same step (no separate "Sign agreement" button).
  const ownerPhotos = photos ?? d.ownerPhotos ?? null;
  const photosDone = !ownerPhotos || (ownerPhotos.selfie && ownerPhotos.shop);
  const ready = name.trim().length >= 2 && agreeTerms && agreeAuthority && agreeRecording && photosDone;
  // What is missing, said next to the button (never a silently disabled button).
  const missingReason = (): string | null => {
    const parts: string[] = [];
    if (!photosDone) parts.push(t('pub.owner.missing'));
    if (name.trim().length < 2) parts.push(t('pub.agree.missingName'));
    const boxes = [agreeTerms, agreeAuthority, agreeRecording].filter((v) => !v).length;
    if (boxes) parts.push(t('pub.agree.missingBoxes', { count: boxes }));
    if (!parts.length) return null;
    return t('pub.agree.missing', { what: parts.join(t('pub.agree.missingAnd')) });
  };
  const sign = async (typed: string) => {
    if (!ready || !requestId || typed.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const result = await agreementApi.sign(token, requestId, typed, name.trim());
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
      <PageTitle emoji="📝">{t('pub.agree.title', { business: d.businessName })}</PageTitle>
      <div className="card">
        {items.map(([title, text]) => (
          <div key={title} className="row lb-pub-row-col">
            <strong>{title}</strong>
            <span className="sub">{text}</span>
          </div>
        ))}
      </div>
      {d.agreementSummaryHtml ? (
        // v1.1 (rev 176): the "In short" box, then the full agreement behind "Read the full terms".
        <LegalSummary summaryHtml={d.agreementSummaryHtml} bodyHtml={d.agreementBodyHtml ?? null} version={d.version} />
      ) : (
        <details className="card lb-pub-terms">
          <summary>{t('pub.agree.readFull')}</summary>
          {/* Rendered by the server from its own template and the frozen numbers; no user text in it. */}
          <div dangerouslySetInnerHTML={{ __html: d.agreementTermsHtml }} />
        </details>
      )}
      {ownerPhotos && <OwnerPhotos token={token} state={ownerPhotos} onChange={setPhotos} />}
      <TextField
        label={t('pub.agree.name')}
        value={name}
        onChange={setName}
        autoComplete="name"
        required
        error={showMissing && name.trim().length < 2 ? t('pub.agree.missingName') : undefined}
      />
      <Choice checked={agreeTerms} onChange={setAgreeTerms} title={t('pub.agree.agreeTerms')} missing={showMissing} />
      <Choice checked={agreeAuthority} onChange={setAgreeAuthority} title={t('legal.agree.authority')} missing={showMissing} />
      <Choice checked={agreeRecording} onChange={setAgreeRecording} title={t('pub.agree.agreeRecording')} missing={showMissing} />
      <OtpBlock
        maskedPhone={d.maskedPhone}
        send={(channel) => agreementApi.sendOtp(token, channel)}
        requestId={requestId}
        onRequestId={setRequestId}
        code={code}
        onCode={setCode}
        invalid={Boolean(error)}
        sendLabel={t('pub.agree.sendToSign')}
        sendDisabled={!ready}
        checkBeforeSend={missingReason}
        onBlocked={() => setShowMissing(true)}
        hint={ready ? t('pub.agree.codeSigns') : t('pub.agree.fillFirst')}
        onComplete={(typed) => void sign(typed)}
        submitting={busy}
        submittingLabel={t('pub.agree.signing')}
      />
      <ActionError error={error} />
    </>
  );
}
