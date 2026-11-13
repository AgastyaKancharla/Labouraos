import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import { partnerApi, type PartnerOpen, type PartnerPayout } from '../shared/api';
import { usePartnerStepGuard } from '../shared/partner';
import { ActionError, Choice, isOtpExpired, LinkProblem, Loading, Muted, PageTitle, Row, StepsBar, Warn } from '../shared/ui';

/**
 * Step 4 of the partner's link: where the ₹ rewards go (guide, "Bank and UPI
 * details"): a UPI ID preferred, a bank account as the alternative, in the
 * partner's own name — the API checks it against the name on the ID and
 * flags a mismatch for Finance. It keeps the full value encrypted; this page
 * only ever shows the masked version the API returns. Until the name check
 * finishes, the page says the details were received.
 */
const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const ACCOUNT_PATTERN = /^\d{9,18}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export default function PartnerUpiPage() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = usePartnerStepGuard('upi');
  const queryClient = useQueryClient();
  const ids = { upi: useId(), account: useId(), ifsc: useId() };
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [upiId, setUpiId] = useState('');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;
  if (status.payout) return <Received status={status} />;

  const cleanUpi = upiId.trim();
  const cleanIfsc = ifsc.trim().toUpperCase();
  const valid = method === 'upi' ? UPI_PATTERN.test(cleanUpi) : ACCOUNT_PATTERN.test(account) && IFSC_PATTERN.test(cleanIfsc);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    const details: PartnerPayout = method === 'upi' ? { method: 'upi', upiId: cleanUpi } : { method: 'bank', accountNumber: account, ifsc: cleanIfsc };
    try {
      await partnerApi.payout(token, requestId, details);
      setUpiId('');
      setAccount('');
      await queryClient.invalidateQueries({ queryKey: ['partner-link', token] });
    } catch (e) {
      if (isOtpExpired(e)) backToStart();
      else setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <StepsBar current={4} label={t('partner.upi.stepLabel')} />
      <PageTitle>{t('partner.upi.title')}</PageTitle>
      <Muted>{t('partner.upi.intro')}</Muted>
      <fieldset className="lb-pub-fieldset">
        <legend className="lbl">{t('partner.upi.method')}</legend>
        <Choice type="radio" name="payout-method" checked={method === 'upi'} onChange={() => setMethod('upi')} title={t('partner.upi.methodUpi')} />
        <Choice type="radio" name="payout-method" checked={method === 'bank'} onChange={() => setMethod('bank')} title={t('partner.upi.methodBank')} />
      </fieldset>
      <form
        className="fld"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {method === 'upi' ? (
          <>
            <label htmlFor={ids.upi}>{t('partner.upi.upiLabel')}</label>
            <input
              id={ids.upi}
              value={upiId}
              autoCapitalize="none"
              autoComplete="off"
              inputMode="email"
              maxLength={320}
              onChange={(e) => setUpiId(e.target.value)}
              aria-invalid={upiId.length > 3 && !UPI_PATTERN.test(cleanUpi) ? true : undefined}
            />
          </>
        ) : (
          <>
            <label htmlFor={ids.account}>{t('partner.upi.accountLabel')}</label>
            <input
              id={ids.account}
              value={account}
              inputMode="numeric"
              autoComplete="off"
              maxLength={18}
              onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 18))}
              aria-invalid={account.length > 0 && !ACCOUNT_PATTERN.test(account) ? true : undefined}
            />
            <label htmlFor={ids.ifsc}>{t('partner.upi.ifscLabel')}</label>
            <input
              id={ids.ifsc}
              value={ifsc}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={11}
              onChange={(e) => setIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
              aria-invalid={ifsc.length === 11 && !IFSC_PATTERN.test(cleanIfsc) ? true : undefined}
            />
          </>
        )}
        <ActionError error={error} />
        <button type="submit" className="btn bp full" disabled={!valid || saving} aria-busy={saving || undefined}>
          {t('partner.upi.save')}
        </button>
      </form>
    </>
  );
}

function Received({ status }: { status: PartnerOpen }) {
  const t = useT();
  const payout = status.payout!;
  return (
    <>
      <StepsBar current={4} label={t('partner.upi.stepLabel')} />
      <PageTitle>{t('partner.upi.title')}</PageTitle>
      {payout.nameMatches === false ? (
        <Warn>{t('partner.upi.nameMismatch')}</Warn>
      ) : (
        <Warn>
          <strong>{t('partner.upi.checkingTitle')}</strong> {t('partner.upi.checkingBody')}
        </Warn>
      )}
      <div className="card">
        <Row label={t('partner.done.code')}>
          <span className="mono">{status.referralCode}</span>
        </Row>
        <Row label={t('partner.done.payout')}>
          <span className="mono">{payout.maskedValue}</span>
        </Row>
      </div>
    </>
  );
}
