import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { partnerApi } from '../shared/api';
import { LiveSelfie } from '../shared/LiveSelfie';
import { usePartnerStepGuard } from '../shared/partner';
import { ActionError, isOtpExpired, LinkProblem, Loading, PageTitle, StepsBar } from '../shared/ui';

/**
 * Step 2 of the partner's link: a live camera selfie, as on the job seeker's
 * link (P01c) — no file picker, the API refuses anything but a live capture.
 * It becomes the partner's profile photo.
 */
export default function PartnerSelfiePage() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = usePartnerStepGuard('selfie');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const upload = async (photo: Blob): Promise<'done' | 'retry'> => {
    setError(null);
    try {
      await partnerApi.selfie(token, requestId, photo);
      await queryClient.invalidateQueries({ queryKey: ['partner-link', token] });
      navigate(to('P-PartnerIDCheck', { token }));
      return 'done';
    } catch (e) {
      if (isOtpExpired(e)) {
        backToStart();
        return 'done';
      }
      setError(e);
      return 'retry';
    }
  };

  return (
    <>
      <StepsBar current={2} label={t('pub.selfie.stepLabel')} />
      <PageTitle>{t('pub.selfie.title')}</PageTitle>
      <LiveSelfie active onCapture={upload} tips={t('partner.selfie.tips')} error={<ActionError error={error} />} />
    </>
  );
}
