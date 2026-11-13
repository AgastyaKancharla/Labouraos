import { Link } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { usePartnerStepGuard } from '../shared/partner';
import { LinkProblem, Loading, Muted, Ok, Row } from '../shared/ui';

/**
 * The partner's link once every step is done (terms, selfie, ID, and payout
 * details checked against the ID). Shows the RF- ID they give to the people
 * they refer and where payouts go — masked, never the full UPI ID or account.
 */
export default function PartnerDonePage() {
  const { t, language } = useI18n();
  const to = useScreenPath();
  const { status, query } = usePartnerStepGuard('complete');

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  return (
    <>
      <Ok>
        <strong>{t('partner.done.title')}</strong>
      </Ok>
      <div className="card">
        <Row label={t('partner.done.code')}>
          <span className="mono">{status.referralCode}</span>
        </Row>
        {status.payout && (
          <Row label={t('partner.done.payout')}>
            <span>
              <span className="mono">{status.payout.maskedValue}</span> <span className="tag tg">{t('partner.done.verified')}</span>
            </span>
          </Row>
        )}
      </div>
      <Muted>{t('partner.done.body')}</Muted>
      <Link className="lb-pub-link" to={`${to('P-ReferralTerms')}?lang=${language}`}>
        {t('partner.done.terms')}
      </Link>
    </>
  );
}
