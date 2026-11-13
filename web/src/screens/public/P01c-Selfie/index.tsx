import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi } from '../shared/api';
import { LiveSelfie } from '../shared/LiveSelfie';
import { useStepGuard } from '../shared/registration';
import { ActionError, isOtpExpired, LinkProblem, Loading, PageTitle, StepsBar } from '../shared/ui';

/**
 * P01c-Selfie: a live camera picture only — there is no file picker, so a
 * gallery photo can't be sent (the API refuses anything not marked as a
 * live capture). It becomes his profile photo.
 */
export default function Selfie() {
  const t = useT();
  const { token, requestId, status, query, backToStart } = useStepGuard('selfie');
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  if (query.error) return <LinkProblem error={query.error} onRetry={() => void query.refetch()} />;
  if (!status) return <Loading />;

  const upload = async (photo: Blob): Promise<'done' | 'retry'> => {
    setError(null);
    try {
      await registrationApi.selfie(token, requestId, photo);
      await queryClient.invalidateQueries({ queryKey: ['registration', token] });
      navigate(to('P01d-IDCheck', { token }));
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
      <LiveSelfie active onCapture={upload} tips={t('pub.selfie.tips')} error={<ActionError error={error} />} />
    </>
  );
}
