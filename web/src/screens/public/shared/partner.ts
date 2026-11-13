import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useScreenPath } from '../../../portals/PortalContext';
import { partnerApi, type PartnerOpen, type PartnerStep } from './api';
import { tabMemory, usePersonLanguage } from './ui';

/**
 * The referral partner's one link that resumes (guide, "Registering a
 * partner"): referral terms and call-recording consent → selfie → ID check
 * → UPI. It works exactly like the job seeker's link (shared/registration.ts):
 * the code verified on the first page is kept for this tab only, every step
 * sends it, and when it runs out the partner goes back to the first page for
 * a fresh code — finished steps stay finished.
 */
const otpKey = (token: string) => `laboura_partner_otp:${token}`;

export const partnerSession = {
  requestId: (token: string) => tabMemory.get(otpKey(token)),
  save: (token: string, requestId: string) => tabMemory.set(otpKey(token), requestId),
  clear: (token: string) => tabMemory.remove(otpKey(token)),
};

export const PARTNER_STEP_SCREEN: Record<PartnerStep, string> = {
  terms: 'P-PartnerTerms',
  selfie: 'P-PartnerSelfie',
  id_check: 'P-PartnerIDCheck',
  upi: 'P-PartnerUPI',
  complete: 'P-PartnerDone',
};

export function usePartnerToken(): string {
  return useParams<{ token: string }>().token ?? '';
}

export function usePartnerStatus(token: string) {
  const requestId = partnerSession.requestId(token);
  const query = useQuery({
    queryKey: ['partner-link', token, requestId],
    queryFn: () => partnerApi.status(token, requestId),
    enabled: Boolean(token),
    staleTime: 0,
  });
  usePersonLanguage(query.data?.language, token);
  return { ...query, requestId };
}

/** Number of the four steps already finished (for "You've already done 2 of 4"). */
export function partnerStepsDone(status: PartnerOpen): number {
  return [status.steps.terms, status.steps.selfie, status.steps.id, status.steps.upi].filter((s) => s.state === 'done').length;
}

/**
 * Keeps a step page honest: without a verified code the partner goes back to
 * the first page; on the wrong step, to the first unfinished one. Returns the
 * open status once they may be here.
 */
export function usePartnerStepGuard(step: PartnerStep) {
  const token = usePartnerToken();
  const query = usePartnerStatus(token);
  const navigate = useNavigate();
  const to = useScreenPath();
  const data = query.data;
  const stoppedAtId = step === 'id_check' && data && !data.otpRequired && data.stopped === 'under_18';

  useEffect(() => {
    if (!data) return;
    if (data.otpRequired || !query.requestId) {
      partnerSession.clear(token);
      navigate(to('P-PartnerOpen', { token }), { replace: true });
      return;
    }
    if (data.currentStep !== step && !stoppedAtId) {
      navigate(to(PARTNER_STEP_SCREEN[data.currentStep], { token }), { replace: true });
    }
  }, [data, navigate, query.requestId, step, stoppedAtId, to, token]);

  const backToStart = useCallback(() => {
    partnerSession.clear(token);
    navigate(to('P-PartnerOpen', { token }), { replace: true });
  }, [navigate, to, token]);

  const open = data && !data.otpRequired && (data.currentStep === step || stoppedAtId) ? data : undefined;
  return { token, requestId: query.requestId ?? '', status: open, query, backToStart };
}
