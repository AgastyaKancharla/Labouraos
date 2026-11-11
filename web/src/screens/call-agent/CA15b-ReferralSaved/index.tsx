import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { qk, type ReferralHeader, type ReferralStatus, type Step } from '../_registration/api';
import { StepLegend, StepRow } from '../_registration/kit';
import '../_registration/registration.css';

/**
 * Referral partner saved — design CA15b-ReferralSaved. RF- ID, then the same
 * one-link journey as job seekers: terms + call-recording consent → selfie →
 * ID check → UPI. Opened with ?id=<referral id or RF- code>.
 */
export default function ReferralSaved() {
  const t = useT();
  const to = useScreenPath();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const header = useQuery({
    queryKey: qk.referral(id),
    queryFn: () => api.get<ReferralHeader>(`/screens/call-registration/referrals/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
  const referralId = header.data?.id;
  const status = useQuery({
    queryKey: qk.referralStatus(referralId ?? ''),
    queryFn: () => api.get<ReferralStatus>(`/referrals/${referralId}/registration-status`),
    enabled: Boolean(referralId),
    refetchInterval: (q) => (q.state.data?.currentStep === 'complete' ? false : 5000),
  });
  const resend = useMutation({
    mutationFn: () => api.post(`/referrals/${referralId}/terms-links`, { language: header.data?.language ?? 'en' }),
    onSuccess: () => {
      toast.success(t('reg.ref.linkResent'));
      void queryClient.invalidateQueries({ queryKey: qk.referral(id) });
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : t('error.server')),
  });

  if (!id) return <div className="reg"><TopBar title={t('screen.CA15b-ReferralSaved')} /><EmptyState title={t('reg.ref.noneOpen')} /></div>;
  if (header.isLoading) return <div className="reg"><TopBar title={t('screen.CA15b-ReferralSaved')} /><SkeletonCard height={320} /></div>;
  if (header.error || !header.data) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA15b-ReferralSaved')} />
        <ErrorState error={header.error} onRetry={() => void header.refetch()} />
      </div>
    );
  }
  const r = header.data;
  const first = r.name.split(/\s+/)[0];
  const steps = status.data?.steps;
  const at = (s?: Step) => (s?.time ? formatTimeIST(s.time) : null);
  const link = r.registrationLink;
  const detail = (s: Step | undefined, done: string, waitingText: string) =>
    !s
      ? '–'
      : s.state === 'done'
        ? [done, at(s)].filter(Boolean).join(' · ')
        : s.state === 'stuck' && s.reason
          ? t('reg.status.stuck', { reason: s.reason })
          : s.state === 'in_progress'
            ? t('reg.status.inProgress')
            : waitingText;
  const termsWaiting = link ? t('reg.ref.linkSentAt', { time: formatTimeIST(link.sentAt) }) : t('reg.status.notSent');

  return (
    <div className="reg">
      <TopBar title={t('screen.CA15b-ReferralSaved')} />
      <div className="ok" role="status">
        ✓ {t('reg.ref.saved', { code: r.code, name: first })}
      </div>
      <Card>
        <div className="reg-panel-head">
          <span className="lbl">{t('reg.ref.panel', { name: r.name, code: r.code })}</span>
          <StepLegend />
        </div>
        {status.error && <ErrorState error={status.error} compact onRetry={() => void status.refetch()} />}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <StepRow state={r.phoneVerifiedAt ? 'done' : 'not_started'} title={t('reg.status.phoneVerified')} detail={[r.phone, r.phoneVerifiedAt ? formatTimeIST(r.phoneVerifiedAt) : null].filter(Boolean).join(' · ')} />
          <StepRow state="done" title={t('reg.ref.idCreated')} detail={t('reg.ref.idSent', { code: r.code, name: first })} />
          <StepRow state={steps?.terms.state === 'done' ? 'done' : link?.live ? 'in_progress' : steps?.terms.state ?? 'not_started'} title={`1 · ${t('reg.ref.stepTerms')}`} detail={detail(steps?.terms, t('reg.ref.termsDone'), termsWaiting)} />
          <StepRow state={steps?.selfie.state === 'stuck' ? 'not_started' : steps?.selfie.state ?? 'not_started'} title={`2 · ${t('reg.status.step.selfie')}`} detail={detail(steps?.selfie && steps.selfie.state === 'stuck' ? { ...steps.selfie, state: 'not_started' } : steps?.selfie, t('reg.status.selfieDone'), '–')} />
          <StepRow state={steps?.id.state ?? 'not_started'} title={`3 · ${t('reg.status.step.idCheck')}`} detail={detail(steps?.id, t('reg.status.idDone'), t('reg.ref.idHint'))} />
          <StepRow state={steps?.upi.state ?? 'not_started'} title={`4 · ${t('reg.ref.stepUpi')}`} detail={detail(steps?.upi, t('reg.ref.upiDone'), t('reg.ref.upiHint'))} />
        </ul>
        <div className="reg-actions" style={{ marginTop: 14 }}>
          {status.data?.currentStep !== 'complete' && (
            <Button variant="primary" onClick={() => resend.mutate()} loading={resend.isPending}>
              {t('reg.ref.resend')}
            </Button>
          )}
          <ButtonLink to={to('CA03-Home')}>{t('reg.backHome')}</ButtonLink>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {t('reg.ref.note', { name: first, code: r.code })}
        </p>
      </Card>
    </div>
  );
}
