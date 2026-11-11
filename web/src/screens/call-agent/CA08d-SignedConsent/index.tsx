import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST, formatLongDateIST, formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { qk, type SignedConsent } from '../_registration/api';
import '../_registration/registration.css';

/** Signed consent · read-only — design CA08d-SignedConsent. Nobody can change it. */
const PURPOSE_LABEL: Record<string, MessageKey> = {
  job_matching: 'reg.consent.job_matching',
  profile_sharing: 'reg.consent.profile_sharing',
  call_recording: 'reg.consent.call_recording',
  aadhaar_verification: 'reg.consent.aadhaar_verification',
  job_updates: 'reg.consent.job_updates',
  promotions: 'reg.consent.promotions',
};
const LANGUAGE_LABEL: Record<string, MessageKey> = { kn: 'reg.lang.kn', hi: 'reg.lang.hi', en: 'reg.lang.en' };

export default function SignedConsentCopy() {
  const t = useT();
  const { id = '' } = useParams();
  const to = useScreenPath();
  const consent = useQuery({
    queryKey: qk.signedConsent(id),
    queryFn: () => api.get<SignedConsent>(`/screens/call-registration/job-seekers/${encodeURIComponent(id)}/signed-consent`),
  });
  const back = <ButtonLink to={to('CA08c-InProgress', { id })}>← {t('reg.consent.back')}</ButtonLink>;
  const c = consent.data;
  const title = c ? t('reg.consent.title', { name: c.name }) : t('screen.CA08d-SignedConsent');

  return (
    <div className="reg">
      <TopBar title={title} actions={back} />
      {consent.isLoading && <SkeletonCard height={300} />}
      {consent.error && <ErrorState error={consent.error} onRetry={() => void consent.refetch()} />}
      {c && !c.signed && <EmptyState title={t('reg.consent.none')}>{t('reg.consent.noneBody')}</EmptyState>}
      {c && c.signed && (
        <>
          <Card>
            <div className="lbl">{t('reg.consent.agreed')}</div>
            {c.purposes?.map((p) => (
              <div className="row" key={p.purpose}>
                <span>{t(PURPOSE_LABEL[p.purpose] ?? 'reg.consent.promotions')}</span>
                <span className={`tag ${p.given ? 'tg' : 'tn'}`}>
                  {p.given ? t('reg.consent.given') : p.withdrawnAt ? t('reg.consent.withdrawn', { date: formatDateTimeIST(p.withdrawnAt) }) : t('reg.consent.notGiven')}
                </span>
              </div>
            ))}
          </Card>
          <Card>
            <div className="row">
              <span>{t('reg.consent.givenBy')}</span>
              <span>{t('reg.consent.givenByValue', { name: c.name.split(/\s+/)[0] })}</span>
            </div>
            <div className="row">
              <span>{t('reg.consent.otpChecked')}</span>
              <span>{[c.otpPhone, c.otpVerifiedAt ? formatTimeIST(c.otpVerifiedAt) : null].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="row">
              <span>{t('reg.consent.dateTime')}</span>
              <span>{c.givenAt ? `${formatLongDateIST(c.givenAt)}, ${formatTimeIST(c.givenAt)}` : '–'}</span>
            </div>
            <div className="row">
              <span>{t('reg.consent.language')}</span>
              <span>{c.language && LANGUAGE_LABEL[c.language] ? t(LANGUAGE_LABEL[c.language]) : c.language ?? '–'}</span>
            </div>
            <div className="row">
              <span>{t('reg.consent.notice')}</span>
              <span>{c.noticeVersion ?? '–'}</span>
            </div>
            <div className="row">
              <span>{t('reg.consent.explained')}</span>
              <span>
                {c.explainedOnCall
                  ? t(c.explainedOnCall.recorded ? 'reg.consent.explainedRecorded' : 'reg.consent.explainedCall', {
                      name: c.explainedOnCall.staffName ?? '–',
                      time: c.explainedOnCall.at ? formatTimeIST(c.explainedOnCall.at) : '–',
                    })
                  : t('reg.consent.noCall')}
              </span>
            </div>
          </Card>
          <div className="warn">{t('reg.consent.readOnly')}</div>
        </>
      )}
    </div>
  );
}
