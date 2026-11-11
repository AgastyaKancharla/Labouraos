import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { formatDateIST, formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { qk, useJobSeekerStatus, type JobSeekerStatus, type Step } from '../_registration/api';
import { StepLegend, StepRow } from '../_registration/kit';
import { GENDERS, PAYER_RELATIONS, SHIFT_PREFERENCES } from '../_registration/options';
import '../_registration/registration.css';

/**
 * Registration step panel — designs CA08b-Registered (saved, nothing sent),
 * CA08c-InProgress (ticks update live while he works through the link) and
 * CA08f-Active (every step green, 30 days running). Polls every 5 s until
 * the registration is complete.
 */
const NEXT_STEP_LABEL: Record<JobSeekerStatus['nextStep'], MessageKey> = {
  consent: 'reg.status.step.consent',
  selfie: 'reg.status.step.selfie',
  id_check: 'reg.status.step.idCheck',
  payment: 'reg.status.step.payment',
  complete: 'reg.status.step.payment',
};

function time(step: Step) {
  return step.time ? formatTimeIST(step.time) : null;
}

export default function RegistrationProgress() {
  const t = useT();
  const { id = '' } = useParams();
  const to = useScreenPath();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useJobSeekerStatus(id);
  const [sent, setSent] = useState<{ expiresAt: string } | null>(null);
  const [preview, setPreview] = useState(false);

  const sendLink = useMutation({
    mutationFn: () => api.post<{ expiresAt: string }>('/consent/links', { jobSeekerId: status.data!.id }),
    onSuccess: (res) => {
      setSent(res);
      toast.success(t('reg.status.linkSentToast'));
      void queryClient.invalidateQueries({ queryKey: qk.jobSeeker(id) });
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : t('error.server')),
  });

  if (status.isLoading) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA08c-InProgress')} />
        <SkeletonCard height={120} />
        <SkeletonCard height={320} />
      </div>
    );
  }
  if (status.error || !status.data) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA08c-InProgress')} />
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      </div>
    );
  }

  const s = status.data;
  const { steps } = s;
  const pronoun = s.gender === 'male' ? 'he' : s.gender === 'female' ? 'she' : 'they';
  const genderLabel = GENDERS.find((g) => g.value === s.gender);
  const shiftLabel = SHIFT_PREFERENCES.find((g) => g.value === s.shiftPreference);
  const tradeText = s.trades
    .map((tr) => `${tr.trade} ${t('reg.status.years', { n: tr.yearsExperience })}${tr.listed ? '' : ` (${t('reg.status.newTrade')})`}`)
    .join(' · ');
  const salaryText =
    s.minSalary !== undefined && s.maxSalary !== undefined
      ? `${formatINR(s.minSalary)}–${formatINR(s.maxSalary).replace('₹', '')}/${s.salaryPeriod === 'daily' ? t('reg.per.dayShort') : t('reg.per.monthShort')}`
      : null;
  const summary = [
    tradeText,
    s.locality ? t('reg.status.travel', { area: s.locality, km: s.travelDistanceKm ?? 0 }) : null,
    salaryText,
    shiftLabel ? t('reg.status.shift', { shift: t(shiftLabel.label) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const reachedPayment = [steps.consent, steps.selfie, steps.idCheck].every((step) => step.state === 'done');
  const linkLiveUntil = sent?.expiresAt ?? s.registrationLinkExpiresAt;
  const anySent = Boolean(linkLiveUntil) || s.stage !== 'registered';
  const notSent = t('reg.status.notSent');
  const waiting = t('reg.status.waiting');
  const relation = s.paymentOnlyLink?.relation ? PAYER_RELATIONS.find((r) => r.value === s.paymentOnlyLink!.relation) : undefined;
  const payerText = s.paymentOnlyLink
    ? t('reg.status.payer', { who: relation ? t(relation.label).toLowerCase() : t('reg.status.someoneElse'), phone: s.paymentOnlyLink.payerPhone ?? '' })
    : null;

  const consentDetail =
    steps.consent.state === 'done'
      ? [t('reg.status.consentDone', { n: s.consent.requiredGiven }), s.stage !== 'active' ? t(s.consent.promotions ? 'reg.status.offersYes' : 'reg.status.offersNo') : null, time(steps.consent)].filter(Boolean).join(' · ')
      : steps.consent.state === 'in_progress'
        ? t('reg.status.consentPartial', { n: s.consent.requiredGiven, total: s.consent.requiredTotal })
        : anySent
          ? waiting
          : notSent;
  const plainDetail = (step: Step, doneText: string) =>
    step.state === 'done'
      ? [doneText, time(step)].filter(Boolean).join(' · ')
      : step.state === 'stuck'
        ? t('reg.status.stuck', { reason: step.reason ?? t('reg.status.stuckUnknown') })
        : step.state === 'in_progress'
          ? step.reason ?? t('reg.status.inProgress')
          : anySent
            ? '–'
            : notSent;
  const paymentDetail = (() => {
    const p = steps.payment;
    if (p.state === 'done') {
      const at = s.paymentConfirmedAt ?? p.time;
      return [s.paymentOnlyLink?.used ? payerText : null, at ? t('reg.status.bankConfirmed', { time: formatTimeIST(at) }) : t('reg.status.bankConfirmedNoTime')].filter(Boolean).join(' · ');
    }
    if (p.state === 'confirming') return t('reg.status.paidConfirming');
    if (p.state === 'stuck') return t('reg.status.stuck', { reason: p.reason ?? t('reg.status.stuckUnknown') });
    if (s.paymentOnlyLink?.live) return t('reg.status.otherPayerLive', { payer: payerText ?? '', time: formatTimeIST(s.paymentOnlyLink.expiresAt) });
    if (p.state === 'in_progress') return t('reg.status.paymentWaiting');
    return anySent ? '–' : notSent;
  })();

  return (
    <div className="reg">
      <TopBar title={t('screen.CA08c-InProgress')} />
      {s.stage === 'active' ? (
        <div className="ok" role="status">
          ✓ {t('reg.status.complete', { name: s.name })}
        </div>
      ) : linkLiveUntil ? (
        <div className="ok" role="status">
          ✓ {t('reg.status.linkSent', { phone: s.phone, until: formatDateTimeIST(linkLiveUntil) })}
        </div>
      ) : (
        <div className="ok" role="status">
          ✓ {t('reg.status.saved', { name: s.name, code: s.code })}
        </div>
      )}

      <Card className="reg-summary" as="div">
        <span>
          <span className="nm">
            {[s.name, s.age !== null ? String(s.age) : null, genderLabel ? t(genderLabel.label) : null].filter(Boolean).join(' · ')}
          </span>
          <span className="sub">{summary}</span>
        </span>
        <ButtonLink to={to('CA04-Profile', { id: s.id })}>{t('reg.status.edit')}</ButtonLink>
      </Card>

      <Card as="section" aria-label={t('reg.status.panel', { name: s.name, code: s.code })}>
        <div className="reg-panel-head">
          <span className="lbl">{t('reg.status.panel', { name: s.name, code: s.code })}</span>
          <StepLegend />
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <StepRow
            state={steps.phone.state}
            title={t('reg.status.phoneVerified')}
            detail={[s.phone.startsWith('+') ? s.phone : `+91 ${s.phone}`, s.phoneVerifiedAt ? t('reg.status.otpChecked', { time: formatTimeIST(s.phoneVerifiedAt) }) : null].filter(Boolean).join(' · ')}
          />
          <StepRow
            state={steps.consent.state}
            title={`1 · ${t('reg.status.step.consent')}`}
            detail={consentDetail}
            action={
              steps.consent.state === 'done' ? <ButtonLink to={to('CA08d-SignedConsent', { id: s.id })}>{t('reg.status.viewConsent')}</ButtonLink> : undefined
            }
          />
          <StepRow state={steps.selfie.state} title={`2 · ${t('reg.status.step.selfie')}`} detail={plainDetail(steps.selfie, s.stage === 'active' ? '' : t('reg.status.selfieDone'))} />
          <StepRow state={steps.idCheck.state} title={`3 · ${t('reg.status.step.idCheck')}`} detail={plainDetail(steps.idCheck, t('reg.status.idDone'))} />
          <StepRow state={steps.payment.state} title={`4 · ${t('reg.status.step.payment')}`} detail={paymentDetail} />
        </ul>

        <div className="reg-actions" style={{ marginTop: 14 }}>
          {s.stage === 'active' ? (
            <ButtonLink variant="primary" to={to('CA03-Home')}>
              {t('reg.backHome')}
            </ButtonLink>
          ) : (
            <>
              <Button variant="primary" onClick={() => sendLink.mutate()} loading={sendLink.isPending}>
                {anySent ? t('reg.status.resendFrom', { step: t(NEXT_STEP_LABEL[s.nextStep]) }) : t('reg.status.sendLink')}
              </Button>
              {reachedPayment && steps.payment.state !== 'done' && (
                <ButtonLink to={to('CA08e-OtherPayer', { id: s.id })}>{t('reg.status.otherNumber')}</ButtonLink>
              )}
              <Button onClick={() => setPreview(true)}>{t(`reg.status.preview.${pronoun}`)}</Button>
            </>
          )}
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {s.stage === 'active'
            ? t('reg.status.activeNote', { name: s.name.split(/\s+/)[0], date: s.guaranteeEndsAt ? formatDateIST(s.guaranteeEndsAt) : '–' })
            : anySent
              ? t('reg.status.resendNote')
              : t('reg.status.sendNote')}
        </p>
      </Card>

      <Modal open={preview} onClose={() => setPreview(false)} title={t(`reg.status.preview.${pronoun}`)}>
        <ol className="reg-preview">
          <li>
            <strong>{t('reg.status.step.consent')}</strong> — {t('reg.preview.consent')}
          </li>
          <li>
            <strong>{t('reg.status.step.selfie')}</strong> — {t('reg.preview.selfie')}
          </li>
          <li>
            <strong>{t('reg.status.step.idCheck')}</strong> — {t('reg.preview.id')}
          </li>
          <li>
            <strong>{t('reg.status.step.payment')}</strong> — {t('reg.preview.payment')}
          </li>
        </ol>
        <p className="muted">{t('reg.preview.note')}</p>
      </Modal>
    </div>
  );
}
