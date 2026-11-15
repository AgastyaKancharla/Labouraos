import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { legalApi, ReconsentForm } from '../shared/legal';
import { registrationSession, STEP_SCREEN, useRegistrationStatus, useRegistrationToken } from '../shared/registration';
import { LinkProblem, Loading } from '../shared/ui';

/**
 * "We've updated our terms" on the job seeker's link (rev 176): someone who
 * accepted an older version of the terms or consent notice reads the "In
 * short", can open the full terms, ticks each permission and accepts with the
 * code he verified when he opened the link. A guarantee already paid keeps the
 * terms it was paid under. Then he carries on where he was.
 */
export default function Reconsent() {
  const { language } = useI18n();
  const token = useRegistrationToken();
  const status = useRegistrationStatus(token);
  const navigate = useNavigate();
  const to = useScreenPath();
  const queryClient = useQueryClient();
  const data = status.data;
  const open = data && !data.otpRequired ? data : null;
  const needsCode = Boolean(data?.otpRequired) || !status.requestId;
  const done = open && !open.reconsent?.needsReconsent;

  useEffect(() => {
    if (!data) return;
    if (needsCode) {
      registrationSession.clear(token);
      navigate(to('P00-Open', { token }), { replace: true });
    } else if (done && open) {
      navigate(to(STEP_SCREEN[open.currentStep], { token }), { replace: true });
    }
  }, [data, done, needsCode, navigate, open, to, token]);

  if (status.error) return <LinkProblem error={status.error} onRetry={() => void status.refetch()} />;
  if (!open || done) return <Loading />;
  return (
    <ReconsentForm
      documentKey="job_seeker_terms"
      acceptedVersion={open.reconsent?.acceptedVersion ?? null}
      onAccept={async (purposes, textHash) => {
        await legalApi.reconsent(token, status.requestId ?? '', purposes, language, textHash);
        await queryClient.invalidateQueries({ queryKey: ['registration', token] });
      }}
    />
  );
}
