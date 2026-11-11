import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useScreenPath } from '../../../portals/PortalContext';
import { registrationApi, type RegistrationOpen, type RegistrationStep } from './api';
import { tabMemory, usePersonLanguage } from './ui';

/**
 * The one registration link (P00 → P02b). The OTP he verified on P00 is kept
 * for this tab only; every step sends it, and the API checks it is still a
 * verified code for his own number. When it lapses, he is sent back to P00
 * for a fresh code — finished steps stay finished.
 */
const otpKey = (token: string) => `laboura_reg_otp:${token}`;
export const paidTappedKey = (token: string) => `laboura_reg_paid_tapped:${token}`;

export const registrationSession = {
  requestId: (token: string) => tabMemory.get(otpKey(token)),
  save: (token: string, requestId: string) => tabMemory.set(otpKey(token), requestId),
  clear: (token: string) => tabMemory.remove(otpKey(token)),
};

export const STEP_SCREEN: Record<RegistrationStep, string> = {
  consent: 'P01-Consent',
  selfie: 'P01c-Selfie',
  id_check: 'P01d-IDCheck',
  payment: 'P02-Payment',
  complete: 'P02b-Paid',
};

export function useRegistrationToken(): string {
  return useParams<{ token: string }>().token ?? '';
}

export function useRegistrationStatus(token: string, options: { poll?: boolean } = {}) {
  const requestId = registrationSession.requestId(token);
  const query = useQuery({
    queryKey: ['registration', token, requestId],
    queryFn: () => registrationApi.status(token, requestId),
    enabled: Boolean(token),
    refetchInterval: options.poll ? 10_000 : false,
    staleTime: 0,
  });
  usePersonLanguage(query.data?.language, token);
  return { ...query, requestId };
}

/**
 * Keeps a step page honest: without a verified code he goes back to P00; on
 * the wrong step he goes to the first unfinished one. Returns the open status
 * once he may be here.
 */
export function useStepGuard(step: RegistrationStep): {
  token: string;
  requestId: string;
  status: RegistrationOpen | undefined;
  query: ReturnType<typeof useRegistrationStatus>;
  backToStart: () => void;
} {
  const token = useRegistrationToken();
  const query = useRegistrationStatus(token);
  const navigate = useNavigate();
  const to = useScreenPath();
  const data = query.data;

  useEffect(() => {
    if (!data) return;
    if (data.otpRequired || !query.requestId) {
      registrationSession.clear(token);
      navigate(to('P00-Open', { token }), { replace: true });
      return;
    }
    if (data.currentStep !== step && !(step === 'id_check' && data.stopped === 'under_18')) {
      navigate(to(STEP_SCREEN[data.currentStep], { token }), { replace: true });
    }
  }, [data, navigate, query.requestId, step, to, token]);

  const backToStart = useCallback(() => {
    registrationSession.clear(token);
    navigate(to('P00-Open', { token }), { replace: true });
  }, [navigate, to, token]);

  const open = data && !data.otpRequired && data.currentStep === step ? data : data && !data.otpRequired && step === 'id_check' && data.stopped ? data : undefined;
  return {
    token,
    requestId: query.requestId ?? '',
    status: open,
    query,
    backToStart,
  };
}
