import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { formatDayMonthIST, formatTimeIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { qk, type BusinessStatus } from '../_registration/api';
import { StepLegend, StepRow } from '../_registration/kit';
import { CONTACT_ROLES } from '../_registration/options';
import { BUSINESS_SCRIPT, type ScriptLanguage } from '../_registration/scripts';
import '../_registration/registration.css';

/**
 * Business saved — design CA13b-BusinessSaved. What is left before
 * candidates can be shown (phone → agreement + recording consent →
 * verification visit → Team Lead approval → verified), and the draft
 * vacancies made from "Staff needed", each finished on CA09. Opened with
 * ?id=<business id or BZ- code>.
 */
export default function BusinessSaved() {
  const t = useT();
  const to = useScreenPath();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const [justSent, setJustSent] = useState(params.get('sent') === '1');
  const [preview, setPreview] = useState(false);
  const business = useQuery({
    queryKey: qk.business(id),
    queryFn: () => api.get<BusinessStatus>(`/screens/call-registration/businesses/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.steps.verified.state === 'done' ? false : 15000),
  });
  const resend = useMutation({
    mutationFn: () => api.post(`/businesses/${business.data!.id}/agreement-links`, { language: business.data!.contactLanguage ?? 'en' }),
    onSuccess: () => {
      setJustSent(true);
      toast.success(t('reg.biz.agreementResent'));
      void queryClient.invalidateQueries({ queryKey: qk.business(id) });
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : t('error.server')),
  });

  if (!id) return <div className="reg"><TopBar title={t('screen.CA13b-BusinessSaved')} /><EmptyState title={t('reg.biz.noneOpen')} /></div>;
  if (business.isLoading) return <div className="reg"><TopBar title={t('screen.CA13b-BusinessSaved')} /><SkeletonCard height={360} /></div>;
  if (business.error || !business.data) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA13b-BusinessSaved')} />
        <ErrorState error={business.error} onRetry={() => void business.refetch()} />
      </div>
    );
  }
  const b = business.data;
  const s = b.steps;
  const role = CONTACT_ROLES.find((r) => r.value === b.contactRole);
  const contact = b.contactName ?? '';
  const first = contact.split(/\s+/)[0];
  const at = (time?: string | null) => (time ? formatTimeIST(time) : null);
  const agreementDetail =
    s.agreement.state === 'done'
      ? t('reg.biz.agreed', { name: s.agreement.signedName ?? contact, time: at(s.agreement.time) ?? '' })
      : s.agreement.state === 'in_progress'
        ? t('reg.biz.agreementWaiting', { time: at(s.agreement.time) ?? '', name: first })
        : s.agreement.state === 'stuck'
          ? t('reg.biz.agreementExpired')
          : t('reg.status.notSent');
  const visitDetail =
    s.visit.state === 'done'
      ? t('reg.biz.visited', { time: at(s.visit.time) ?? '' })
      : s.visit.state === 'in_progress'
        ? s.visit.assignedStaffName
          ? t('reg.biz.visitAssigned', { name: s.visit.assignedStaffName })
          : s.visit.suggestedStaffName
            ? t('reg.biz.visitSuggested', { name: s.visit.suggestedStaffName })
            : t('reg.biz.visitWaiting')
        : t('reg.biz.visitNotYet');
  const tlDetail =
    s.teamLeadApproval.state === 'done'
      ? t('reg.biz.tlApproved')
      : s.teamLeadApproval.state === 'stuck'
        ? t('reg.biz.tlRejected')
        : s.teamLeadApproval.state === 'in_progress'
          ? t('reg.biz.tlWaiting')
          : t('reg.biz.afterVisit');

  return (
    <div className="reg">
      <TopBar title={t('screen.CA13b-BusinessSaved')} />
      <div className="ok" role="status">
        ✓ {justSent ? t('reg.biz.savedSent', { name: b.name, code: b.code, contact }) : t('reg.biz.saved', { name: b.name, code: b.code })}
      </div>
      <Card>
        <div className="reg-panel-head">
          <span className="lbl">{t('reg.biz.panel', { name: b.name, code: b.code })}</span>
          <StepLegend />
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <StepRow
            state={s.phone.state}
            title={t('reg.status.phoneVerified')}
            detail={[role ? `${contact} (${t(role.label).toLowerCase()})` : contact, b.phone, at(s.phone.time)].filter(Boolean).join(' · ')}
          />
          <StepRow
            state={s.agreement.state}
            title={`1 · ${t('reg.biz.stepAgreement')}`}
            detail={agreementDetail}
            action={s.agreement.state !== 'done' ? <Button onClick={() => setPreview(true)}>{t('reg.biz.previewAgreement')}</Button> : undefined}
          />
          <StepRow state={s.visit.state} title={`2 · ${t('reg.biz.stepVisit')}`} detail={visitDetail} />
          <StepRow state={s.teamLeadApproval.state} title={`3 · ${t('reg.biz.stepTl')}`} detail={tlDetail} />
          <StepRow state={s.verified.state} title={t('reg.biz.stepVerified')} detail={s.verified.state === 'done' ? at(s.verified.time) ?? '' : '–'} />
        </ul>
        <div className="reg-actions" style={{ marginTop: 14 }}>
          {s.agreement.state !== 'done' && (
            <Button variant="primary" onClick={() => resend.mutate()} loading={resend.isPending}>
              {s.agreement.state === 'not_started' ? t('reg.biz.sendAgreement') : t('reg.biz.resendAgreement')}
            </Button>
          )}
          <ButtonLink to={to('CA03-Home')}>{t('reg.backHome')}</ButtonLink>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {b.paused ? t('reg.biz.paused') : t('reg.biz.noCandidates')}
        </p>
      </Card>
      <Card>
        <div className="lbl">{t('reg.biz.drafts')}</div>
        {b.draftVacancies.length === 0 ? (
          <p className="muted">{t('reg.biz.noDrafts')}</p>
        ) : (
          b.draftVacancies.map((v) => {
            const salary =
              v.salaryMinPaise != null ? `${formatINR(v.salaryMinPaise)}${v.salaryMaxPaise ? `–${formatINR(v.salaryMaxPaise).replace('₹', '')}` : ''}` : null;
            const href = `${to('CA09-AddVacancy')}?draft=${encodeURIComponent(v.id)}`;
            const text = [`${v.trade} × ${v.headcount}`, salary, v.startDate ? t('reg.biz.from', { date: formatDayMonthIST(v.startDate) }) : null].filter(Boolean).join(' · ');
            return v.status === 'draft' ? (
              <Link className="row" key={v.id} to={href}>
                <span>{text}</span>
                <span className="tag ta">{t('reg.biz.finish')}</span>
              </Link>
            ) : (
              <div className="row" key={v.id}>
                <span>{text}</span>
                <span className="tag tb">{t('reg.biz.awaitingOwner')}</span>
              </div>
            );
          })
        )}
        <div className="reg-actions" style={{ marginTop: 12 }}>
          <ButtonLink to={`${to('CA09-AddVacancy')}?business=${encodeURIComponent(b.code)}`}>{t('reg.biz.addVacancy')}</ButtonLink>
        </div>
      </Card>
      <Modal open={preview} onClose={() => setPreview(false)} title={t('reg.biz.previewAgreement')}>
        <div className="script" lang={b.contactLanguage ?? 'en'} style={{ whiteSpace: 'pre-line' }}>
          {BUSINESS_SCRIPT[(['kn', 'hi', 'en'].includes(b.contactLanguage ?? '') ? b.contactLanguage : 'en') as ScriptLanguage]}
        </div>
        <p className="muted">{t('reg.biz.previewNote')}</p>
      </Modal>
    </div>
  );
}
