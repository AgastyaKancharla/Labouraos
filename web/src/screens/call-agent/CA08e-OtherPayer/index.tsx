import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Modal } from '../../../components/Modal';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { MobileField, SelectField } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { isValidMobile } from '../../../lib/format/phone';
import { useScreenPath } from '../../../portals/PortalContext';
import { qk, useJobSeekerStatus } from '../_registration/api';
import { choiceOptions } from '../_registration/kit';
import { PAYER_RELATIONS } from '../_registration/options';
import '../_registration/registration.css';

/**
 * Send payment link to another number — design CA08e-OtherPayer. The payer
 * sees only his first name, JS- ID and ₹499; the link works for the minutes set
 * in Settings (15 by default).
 */
export default function OtherPayer() {
  const t = useT();
  const { id = '' } = useParams();
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useJobSeekerStatus(id);
  const [mobile, setMobile] = useState('');
  const [relation, setRelation] = useState('');
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = status.data;
  const first = s?.name.split(/\s+/)[0] ?? '';
  const minutes = s?.paymentOnlyLinkMinutes ?? 15;
  const reached = s ? [s.steps.consent, s.steps.selfie, s.steps.idCheck].every((step) => step.state === 'done') : true;

  const send = useMutation({
    mutationFn: () => api.post<{ expiresAt: string; validMinutes?: number }>(`/job-seekers/${s!.id}/payment-only-link`, { phone: mobile, relation: relation || undefined }),
    onSuccess: (res) => {
      toast.success(t('reg.payer.sent', { minutes: res?.validMinutes ?? minutes }));
      void queryClient.invalidateQueries({ queryKey: qk.jobSeeker(id) });
      navigate(to('CA08c-InProgress', { id }));
    },
    onError: (e) => setError(isApiError(e) ? e.message : t('error.server')),
  });

  return (
    <div className="reg">
      <TopBar title={t('reg.payer.title')} subtitle={t('reg.payer.subtitle', { name: first || '…' })} />
      <Card className="fg" as="div">
        <MobileField label={t('reg.payer.mobile')} value={mobile} onChange={setMobile} required />
        <SelectField label={t('reg.payer.who')} value={relation} onChange={setRelation} options={choiceOptions(t, PAYER_RELATIONS)} />
      </Card>
      <div className="warn">{t('reg.payer.warn', { minutes })}</div>
      {!reached && (
        <div className="warn" role="alert">
          {t('reg.payer.notYet')}
        </div>
      )}
      {error && (
        <div className="warn" role="alert">
          {error}
        </div>
      )}
      <div className="reg-actions">
        <Button variant="primary" onClick={() => send.mutate()} loading={send.isPending} disabled={!s || !reached || !isValidMobile(mobile)}>
          {t('reg.payer.send')}
        </Button>
        <Button onClick={() => setPreview(true)}>{t('reg.payer.see')}</Button>
        <ButtonLink to={to('CA08c-InProgress', { id })}>{t('common.cancel')}</ButtonLink>
      </div>
      <Modal open={preview} onClose={() => setPreview(false)} title={t('reg.payer.see')}>
        <p>{t('reg.payer.preview', { name: first, code: s?.code ?? '' })}</p>
      </Modal>
    </div>
  );
}
