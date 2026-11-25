import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TextField } from '../../../components/fields/TextField';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { IdCheckPanel } from '../shared/IdCheckPanel';
import { LiveSelfie } from '../shared/LiveSelfie';
import { ownerStepsApi, type AadhaarQrResult, type SmallBusinessState } from '../shared/api';
import { ActionError, Muted, Ok } from '../shared/ui';

const PROOF_KINDS = ['gst', 'udyam', 'fssai', 'licence', 'other_registration', 'bank_upi', 'website_listing'] as const;
const ADDRESS_TYPES = ['bank_statement', 'electricity_bill', 'rent_agreement', 'other'] as const;

/** The QR answer in the shape the shared ID panel shows (only the result matters here). */
function asQrResult(r: { result: AadhaarQrResult['result']; verified: boolean; failureReason: string | null; offerOtherId: boolean }): AadhaarQrResult {
  return {
    verificationId: null, method: 'aadhaar_qr', status: r.verified ? 'verified' : 'failed', result: r.result, verifiedByUidai: r.verified,
    nameMatches: null, isAdult: null, phoneLinked: null, maskedReference: null, person: null, failureReason: r.failureReason, offerOtherId: r.offerOtherId,
  };
}

/**
 * B9 (Master Guide rev 212): a business with fewer than 2 proofs — after signing, on the same
 * link — gives the owner's government ID (Aadhaar QR checked in-house, or a live photo of PAN,
 * driving licence or voter ID for the Team Lead), one business proof and one address proof
 * photo (deleted after the check). The Team Lead then calls on video and decides.
 */
export function SmallBusinessSteps({ token, ownerName }: { token: string; ownerName: string }) {
  const t = useT();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['small-business', token], queryFn: () => ownerStepsApi.smallBusiness(token), retry: false });
  const [qr, setQr] = useState<AadhaarQrResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [proofKind, setProofKind] = useState<string>('bank_upi');
  const [proofValue, setProofValue] = useState('');
  const [docType, setDocType] = useState<string>('electricity_bill');
  const s = state.data;
  if (!s || !s.required) return null;
  const set = (next: SmallBusinessState) => qc.setQueryData(['small-business', token], next);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const idDone = s.ownerId.result === 'verified' || s.ownerId.result === 'pending';
  const addressDone = s.addressProof.result === 'pending' || s.addressProof.result === 'checked';
  const allSent = idDone && addressDone && s.businessProof.given;

  return (
    <div className="card lb-pub-card" data-testid="small-business-steps">
      <strong>{t('pub.sb.title')}</strong>
      <Muted>{t('pub.sb.body')}</Muted>

      <h3>{t('pub.sb.id')}</h3>
      {s.ownerId.result === 'verified' ? (
        <Ok>{t('pub.sb.idVerified')}</Ok>
      ) : s.ownerId.result === 'pending' ? (
        <Ok>{t('pub.sb.idPending')}</Ok>
      ) : (
        <>
          {s.ownerId.result === 'rejected' && <Muted>{t('pub.sb.idRejected')}</Muted>}
          <IdCheckPanel
            busy={busy}
            qrResult={qr}
            otherIdFailed={null}
            onQr={(qrText) => void run(async () => {
              const res = await ownerStepsApi.aadhaarQr(token, qrText);
              setQr(asQrResult(res));
              set(res.state);
            })}
            onOtherId={async (method, idNumber, photo) => {
              try {
                set(await ownerStepsApi.otherId(token, method, idNumber, ownerName, photo));
                return 'done';
              } catch (e) {
                setError(e);
                return 'retry';
              }
            }}
            onContinue={() => void state.refetch()}
          />
        </>
      )}

      <h3>{t('pub.sb.proof')}</h3>
      {s.businessProof.given ? (
        <Ok>{t('pub.sb.proofDone')}</Ok>
      ) : (
        <>
          <label className="field">
            <span>{t('pub.sb.proofKind')}</span>
            <select value={proofKind} onChange={(e) => setProofKind(e.target.value)} aria-label={t('pub.sb.proofKind')}>
              {PROOF_KINDS.map((k) => (
                <option key={k} value={k}>{t(`pub.sb.proof.${k}` as MessageKey)}</option>
              ))}
            </select>
          </label>
          <TextField label={t('pub.sb.proofValue')} value={proofValue} onChange={setProofValue} />
          <button type="button" className="btn bp full" disabled={busy || proofValue.trim().length < 3} onClick={() => void run(async () => { set(await ownerStepsApi.businessProof(token, proofKind, proofValue.trim())); })}>
            {t('pub.sb.proofSave')}
          </button>
        </>
      )}

      <h3>{t('pub.sb.address')}</h3>
      {s.addressProof.result === 'checked' ? (
        <Ok>{t('pub.sb.addressChecked')}</Ok>
      ) : s.addressProof.result === 'pending' ? (
        <Ok>{t('pub.sb.addressPending')}</Ok>
      ) : (
        <>
          <Muted>{t('pub.sb.addressBody')}</Muted>
          <label className="field">
            <span>{t('pub.sb.addressType')}</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label={t('pub.sb.addressType')}>
              {ADDRESS_TYPES.map((k) => (
                <option key={k} value={k}>{t(`pub.sb.address.${k}` as MessageKey)}</option>
              ))}
            </select>
          </label>
          <LiveSelfie
            active
            facing="environment"
            takeLabel={t('pub.owner.take')}
            onCapture={async (photo) => {
              try {
                set(await ownerStepsApi.addressProof(token, docType, photo));
                return 'done';
              } catch (e) {
                setError(e);
                return 'retry';
              }
            }}
          />
        </>
      )}

      <Muted>{allSent ? t('pub.sb.allSent') : t('pub.sb.video')}</Muted>
      <ActionError error={error} />
    </div>
  );
}
