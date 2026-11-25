import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MobileField } from '../../../components/fields/MobileField';
import { TextField } from '../../../components/fields/TextField';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isValidMobile } from '../../../lib/format/phone';
import { ActionError, Choice, Loading, Muted, Ok, OtpBlock, PageTitle, Warn } from '../shared/ui';

const PUBLIC = { auth: false } as const;

interface LinkPage {
  valid: boolean;
  partnerFirstName: string;
}

/**
 * A referral partner's personal share link (/p/ref/:slug, Master Guide rev
 * 202, 21 Nov; no design file, built like the other public pages). The
 * person leaves their name and own number, checked by a code sent from this
 * page; the lead goes to a call agent and registering them fills "referred by"
 * with this partner. The answer never says whether the number is already
 * registered.
 */
export default function ReferralLinkPage() {
  const t = useT();
  const { slug = '' } = useParams();
  const page = useQuery({
    queryKey: ['referral-link', slug],
    queryFn: () => api.get<LinkPage>(`/referral-links/${encodeURIComponent(slug)}`, PUBLIC),
    retry: false,
  });
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [lookingFor, setLookingFor] = useState<'job' | 'staff' | ''>('');
  const [area, setArea] = useState('');
  const [consent, setConsent] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  if (page.isLoading) return <Loading />;
  if (page.error || !page.data) {
    return (
      <>
        <PageTitle emoji="🤝">{t('ref.page.title')}</PageTitle>
        <Warn>{t('ref.page.inactive')}</Warn>
      </>
    );
  }
  const p = page.data;
  if (done) {
    return (
      <>
        <PageTitle emoji="🙏">{t('ref.page.title')}</PageTitle>
        <Ok>{t('ref.page.done')}</Ok>
      </>
    );
  }
  const ready = name.trim().length >= 2 && isValidMobile(mobile) && Boolean(lookingFor) && consent;
  const submit = async (typed: string) => {
    if (!requestId || typed.length !== 6) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/referral-links/${encodeURIComponent(slug)}/leads`, { name, phone: mobile, lookingFor, area, consent, requestId, code: typed }, PUBLIC);
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <PageTitle emoji="🤝">{t('ref.page.title')}</PageTitle>
      <Ok>{t('ref.page.invited', { name: p.partnerFirstName })}</Ok>
      <Muted>{t('ref.page.lead')}</Muted>
      <TextField label={t('ref.page.name')} value={name} onChange={setName} required maxLength={80} autoComplete="name" disabled={Boolean(requestId)} />
      <MobileField label={t('ref.page.phone')} value={mobile} onChange={setMobile} required disabled={Boolean(requestId)} />
      <div className="fld" role="radiogroup" aria-label={t('ref.page.lookingFor')}>
        <span className="lbl">{t('ref.page.lookingFor')}</span>
        <Choice type="radio" checked={lookingFor === 'job'} onChange={() => setLookingFor('job')} name="lookingFor" title={t('ref.page.job')} disabled={Boolean(requestId)} />
        <Choice type="radio" checked={lookingFor === 'staff'} onChange={() => setLookingFor('staff')} name="lookingFor" title={t('ref.page.staff')} disabled={Boolean(requestId)} />
      </div>
      <TextField label={t('ref.page.area')} value={area} onChange={setArea} maxLength={80} disabled={Boolean(requestId)} />
      <Choice checked={consent} onChange={setConsent} title={t('ref.page.consent')} disabled={Boolean(requestId)} />
      <OtpBlock
        maskedPhone={`******${mobile.slice(-4)}`}
        sendLabel={t('ref.page.sendCode')}
        sendDisabled={!ready}
        send={(channel) => api.post<{ requestId: string; phone: string }>(`/referral-links/${encodeURIComponent(slug)}/send-code`, { phone: mobile, ...(channel ? { channel } : {}) }, PUBLIC)}
        requestId={requestId}
        onRequestId={setRequestId}
        code={code}
        onCode={setCode}
        onComplete={(typed) => void submit(typed)}
        submitting={sending}
        submittingLabel={t('ref.page.submit')}
      />
      <ActionError error={error} />
      <Muted>{t('ref.page.app')}</Muted>
    </>
  );
}
