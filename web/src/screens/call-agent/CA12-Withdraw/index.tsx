import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { TextField } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import '../_registration/registration.css';

/**
 * He asked to withdraw consent — design CA12-Withdraw. Only during (or just
 * after) an answered, recorded call with him by this agent, so a Team Lead
 * can always check he asked. Withdrawing call recording, job matching or
 * profile sharing pauses the profile and, once he has paid, ends the ₹499
 * refund (guide, decided 7 Nov). Opened from the call screen with
 * ?jobSeeker=<id or JS- code>.
 */
const PURPOSES: { value: string; label: MessageKey; endsRefund: boolean }[] = [
  { value: 'call_recording', label: 'reg.withdraw.call_recording', endsRefund: true },
  { value: 'job_matching', label: 'reg.withdraw.job_matching', endsRefund: true },
  { value: 'profile_sharing', label: 'reg.withdraw.profile_sharing', endsRefund: true },
  { value: 'job_updates', label: 'reg.withdraw.job_updates', endsRefund: false },
  { value: 'promotions', label: 'reg.withdraw.promotions', endsRefund: false },
];

interface Seeker {
  id: string;
  code: string;
  name: string;
  gender: string | null;
  paymentReceivedAt: string | null;
}

export default function WithdrawConsent() {
  const t = useT();
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const ref = params.get('jobSeeker') ?? '';
  const [lookup, setLookup] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const seeker = useQuery({
    queryKey: ['job-seekers', ref, 'withdraw'],
    queryFn: () => api.get<Seeker>(`/job-seekers/${encodeURIComponent(ref)}`),
    enabled: Boolean(ref),
  });
  const eligibility = useQuery({
    queryKey: ['consent', 'withdrawal-eligibility', seeker.data?.id],
    queryFn: () => api.get<{ eligible: boolean; callRecordId: string | null }>('/consent/withdrawal-eligibility', { query: { jobSeekerId: seeker.data!.id } }),
    enabled: Boolean(seeker.data?.id),
  });
  const withdraw = useMutation({
    mutationFn: () =>
      api.post<{ withdrawn: boolean; purposes: string[] }>('/consent/withdraw', {
        jobSeekerId: seeker.data!.id,
        purposes: selected,
        callRecordId: eligibility.data!.callRecordId,
      }),
    onSuccess: (res) => {
      toast.success(res.withdrawn ? t('reg.withdraw.done') : t('reg.withdraw.nothing'));
      navigate(to('CA03-Home'));
    },
    onError: (e) => setError(isApiError(e) ? e.message : t('error.server')),
  });

  const cancel = () => (window.history.length > 1 ? navigate(-1) : navigate(to('CA03-Home')));

  if (!ref) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA12-Withdraw')} />
        <Card>
          <p className="muted">{t('reg.withdraw.pick')}</p>
          <div className="reg-actions">
            <TextField label={t('reg.withdraw.idLabel')} value={lookup} onChange={setLookup} placeholder="JS-01042" />
            <Button variant="primary" disabled={lookup.trim().length < 4} onClick={() => setParams({ jobSeeker: lookup.trim().toUpperCase() })}>
              {t('reg.withdraw.open')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  if (seeker.isLoading) return <div className="reg"><TopBar title={t('screen.CA12-Withdraw')} /><SkeletonCard height={260} /></div>;
  if (seeker.error || !seeker.data) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA12-Withdraw')} />
        <ErrorState error={seeker.error} onRetry={() => void seeker.refetch()} />
      </div>
    );
  }

  const s = seeker.data;
  const first = s.name.split(/\s+/)[0];
  const pronoun = s.gender === 'female' ? 'she' : s.gender === 'male' ? 'he' : 'they';
  const eligible = eligibility.data?.eligible === true;
  const endsRefund = selected.some((p) => PURPOSES.find((x) => x.value === p)?.endsRefund);
  const paid = Boolean(s.paymentReceivedAt);

  return (
    <div className="reg">
      <TopBar title={t('reg.withdraw.title', { name: first })} />
      {eligibility.isLoading ? (
        <SkeletonCard height={48} />
      ) : eligible ? (
        <div className="ok" role="status">
          {t('reg.withdraw.allowed', { name: first })}
        </div>
      ) : (
        <div className="warn" role="alert">
          <strong>{t('reg.withdraw.notAllowedTitle')}</strong> {t('reg.withdraw.notAllowed', { name: first })}
        </div>
      )}
      <Card>
        <fieldset className="sec">
          <legend className="lbl">{t(`reg.withdraw.what.${pronoun}`)}</legend>
          {PURPOSES.map((p) => {
            const on = selected.includes(p.value);
            return (
              <label key={p.value} className={`reg-check${on ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!eligible}
                  onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, p.value] : cur.filter((x) => x !== p.value)))}
                />{' '}
                {t(p.label)}
              </label>
            );
          })}
        </fieldset>
        <div className="warn" style={{ marginTop: 14 }}>
          {endsRefund ? (paid ? t('reg.withdraw.endsRefundPaid') : t('reg.withdraw.endsRefundUnpaid')) : t('reg.withdraw.warnGeneral')} {t('reg.withdraw.sms')}
        </div>
        {error && (
          <div className="warn" role="alert" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
        <div className="reg-actions" style={{ marginTop: 14 }}>
          <Button variant="danger" onClick={() => withdraw.mutate()} loading={withdraw.isPending} disabled={!eligible || selected.length === 0}>
            {t('reg.withdraw.submit')}
          </Button>
          <Button onClick={cancel}>{t('common.cancel')}</Button>
        </div>
      </Card>
    </div>
  );
}
