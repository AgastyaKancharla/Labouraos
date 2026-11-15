import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { useScreenPath } from '../../../portals/PortalContext';
import { legalApi, ReconsentForm } from '../shared/legal';
import { PARTNER_STEP_SCREEN, partnerSession, usePartnerStatus, usePartnerToken } from '../shared/partner';
import { LinkProblem, Loading } from '../shared/ui';

/**
 * "We've updated our terms" on the referral partner's link (rev 176): accept
 * Referral Partner Terms v1.0 — the terms, call recording and the separate
 * ID-check consent — with the code verified when the link was opened.
 */
export default function PartnerReconsent() {
  const { language } = useI18n();
  const token = usePartnerToken();
  const status = usePartnerStatus(token);
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
      partnerSession.clear(token);
      navigate(to('P-PartnerOpen', { token }), { replace: true });
    } else if (done && open) {
      navigate(to(PARTNER_STEP_SCREEN[open.currentStep], { token }), { replace: true });
    }
  }, [data, done, needsCode, navigate, open, to, token]);

  if (status.error) return <LinkProblem error={status.error} onRetry={() => void status.refetch()} />;
  if (!open || done) return <Loading />;
  return (
    <ReconsentForm
      documentKey="referral_terms"
      acceptedVersion={open.reconsent?.acceptedVersion ?? null}
      onAccept={async (purposes, textHash) => {
        await legalApi.reconsent(token, status.requestId ?? '', purposes, language, textHash);
        await queryClient.invalidateQueries({ queryKey: ['partner-link', token] });
      }}
    />
  );
}
