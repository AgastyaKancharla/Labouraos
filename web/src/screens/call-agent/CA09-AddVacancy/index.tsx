import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { DateField, MoneyField, OtpInput, SelectField, TextField } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { formatDateTimeIST, istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useClock, useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { errorDetail, findTrade, useTrades, type BusinessHit } from '../_registration/api';
import { choiceOptions, DraftNote, SectionHead } from '../_registration/kit';
import { EXPERIENCE_NEEDED, HEADCOUNTS, OTHER_TRADE, VACANCY_EXTRAS, VACANCY_SHIFTS, WEEKLY_OFF } from '../_registration/options';
import { isAboveMarket, isBelowLegalMinimum } from '../_registration/salary';
import { useDraft } from '../_registration/useDraft';
import { draftPatchBody, vacancyBody, vacancyErrors, EMPTY_VACANCY, type VacancyForm } from './payload';
import '../_registration/registration.css';

/**
 * Add a vacancy — design CA09-AddVacancy, plus the owner's confirmation the
 * guide asks for (OTP read out on the call, or a link) and the legal minimum
 * wage acknowledgement. Call agents can add a vacancy to any business; the
 * account agent is told. `?business=<id>` preselects the business and
 * `?draft=<vacancyId>` finishes a draft made from a business's "Staff needed".
 */
interface Saved {
  id: string;
  code: string;
}

interface DraftVacancy {
  id: string;
  code: string;
  tradeSkill: string;
  headcount: number;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string | null;
  shift: string | null;
  startDate: string | null;
  status: string;
  business?: { id: string; code: string; name: string; locality: string | null; verificationStatus: string | null; inPersonOnboardedAt: string | null };
}

export default function AddVacancy() {
  const t = useT();
  const [params] = useSearchParams();
  const draftId = params.get('draft');
  const now = useNow();
  const todayKey = istDateKey(now);
  const trades = useTrades();
  const [form, setForm, draft] = useDraft<VacancyForm>('vacancy', EMPTY_VACANCY, { disabled: Boolean(draftId) });
  const [saved, setSaved] = useState<Saved | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [legalFromApi, setLegalFromApi] = useState<number | null>(null);
  const set = <K extends keyof VacancyForm>(key: K, value: VacancyForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const draftVacancy = useQuery({
    queryKey: ['vacancies', draftId],
    queryFn: () => api.get<DraftVacancy>(`/vacancies/${encodeURIComponent(draftId!)}`),
    enabled: Boolean(draftId),
  });
  const preselected = params.get('business');
  const preselectedBusiness = useQuery({
    queryKey: ['businesses', preselected, 'search'],
    queryFn: () => api.get<BusinessHit[]>('/screens/call-registration/businesses', { query: { q: preselected } }),
    enabled: Boolean(preselected) && !draftId && !form.business,
  });
  useEffect(() => {
    const hit = preselectedBusiness.data?.[0];
    if (hit && !form.business) setForm((f) => ({ ...f, business: hit }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fill once when found
  }, [preselectedBusiness.data]);

  useEffect(() => {
    const v = draftVacancy.data;
    if (!v) return;
    const listed = findTrade(trades.data, v.tradeSkill);
    setForm((f) => ({
      ...f,
      business: v.business
        ? {
            id: v.business.id,
            code: v.business.code,
            name: v.business.name,
            locality: v.business.locality,
            verificationStatus: v.business.verificationStatus,
            canShowCandidates: v.business.verificationStatus === 'verified' || Boolean(v.business.inPersonOnboardedAt),
            contactName: null,
            contactRole: null,
            branches: [],
          }
        : f.business,
      trade: listed ? listed.name : OTHER_TRADE,
      otherTrade: listed ? '' : v.tradeSkill,
      headcount: String(v.headcount),
      salaryMinPaise: v.salaryMinPaise,
      salaryMaxPaise: v.salaryMaxPaise,
      period: v.salaryPeriod === 'daily' ? 'daily' : 'monthly',
      shift: v.shift ?? '',
      startDate: v.startDate ? v.startDate.slice(0, 10) : '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fill once when loaded
  }, [draftVacancy.data, trades.data]);

  const tradeName = form.trade === OTHER_TRADE ? form.otherTrade.trim() : form.trade;
  const trade = findTrade(trades.data, tradeName);
  const belowLegal = isBelowLegalMinimum(trade, form.salaryMinPaise, form.period) || legalFromApi !== null;
  const legalMinimum = trade?.legalMinimumPaise ?? legalFromApi;
  const aboveMarket = isAboveMarket(trade, form.salaryMinPaise, form.period);
  const errors = vacancyErrors(form, tradeName, belowLegal, Boolean(draftId));
  const err = (k: string) => (showErrors && errors.includes(k) ? t('reg.err.required') : undefined);

  const save = useMutation({
    mutationFn: async (): Promise<Saved> => {
      if (draftId) {
        await api.patch(`/vacancies/${draftId}`, draftPatchBody(form, tradeName));
        return api.post<Saved>(`/vacancies/${draftId}/submit-for-confirmation`, { ownerToldMinimumWage: form.ownerTold });
      }
      const body = vacancyBody(form, tradeName);
      return api.post<Saved>('/vacancies', body);
    },
    onSuccess: (v) => {
      draft.clear();
      setSaved({ id: v.id, code: v.code });
    },
    onError: (e) => {
      const legal = errorDetail(e, 'legalMinimumPaise');
      if (typeof legal === 'number') {
        setLegalFromApi(legal);
        setSaveError(t('reg.vac.legalFromApi'));
        return;
      }
      setSaveError(isApiError(e) ? e.message : t('error.server'));
    },
  });

  if (saved) return <ConfirmVacancy vacancy={saved} businessName={form.business?.name ?? ''} />;
  if (draftId && draftVacancy.isLoading) return <div className="reg"><TopBar title={t('screen.CA09-AddVacancy')} /><SkeletonCard height={400} /></div>;
  if (draftId && draftVacancy.error) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA09-AddVacancy')} />
        <ErrorState error={draftVacancy.error} onRetry={() => void draftVacancy.refetch()} />
      </div>
    );
  }

  const onSave = () => {
    setShowErrors(true);
    setSaveError(null);
    if (errors.length) return;
    save.mutate();
  };

  return (
    <div className="reg">
      <TopBar title={draftId ? t('reg.vac.finishTitle') : t('screen.CA09-AddVacancy')} subtitle={t('reg.vac.subtitle')} />
      <DraftNote restored={draft.restored} onDiscard={draft.discard} />
      <Card className="reg-form">
        <fieldset className="sec">
          <SectionHead title={t('reg.vac.whatNeeded')} />
          <div className="fg">
            <BusinessPicker value={form.business} onChange={(b) => setForm((f) => ({ ...f, business: b, branchId: '' }))} error={err('business')} locked={Boolean(draftId)} />
            {form.business && form.business.branches.length > 0 && (
              <SelectField
                label={t('reg.vac.branch')}
                value={form.branchId}
                onChange={(v) => set('branchId', v)}
                options={form.business.branches.map((b) => ({ value: b.id, label: `${b.name}${b.locality ? ` · ${b.locality}` : ''}` }))}
                placeholder={t('reg.vac.mainOutlet')}
              />
            )}
            <SelectField
              label={t('reg.vac.trade')}
              required
              value={form.trade}
              onChange={(v) => set('trade', v)}
              options={[...(trades.data ?? []).map((tr) => ({ value: tr.name, label: tr.name })), { value: OTHER_TRADE, label: t('reg.trade.other') }]}
              placeholder={t('reg.trade.choose')}
              error={err('trade')}
            />
            {form.trade === OTHER_TRADE && (
              <TextField label={t('reg.trade.typeIt')} value={form.otherTrade} onChange={(v) => set('otherTrade', v)} hint={t('reg.trade.newTrade')} />
            )}
            <TextField label={t('reg.vac.jobTitle')} value={form.roleTitle} onChange={(v) => set('roleTitle', v)} />
            {trade && (
              <span className="reg-hint reg-full">
                ⓘ {t('reg.salary.marketHint', { trade: trade.name, from: formatINR(trade.salaryMinPaise), to: formatINR(trade.salaryMaxPaise) })}
              </span>
            )}
            <SelectField label={t('reg.vac.openings')} required value={form.headcount} onChange={(v) => set('headcount', v)} options={HEADCOUNTS.map((n) => ({ value: n, label: n }))} placeholder={null} />
            <MoneyField
              label={form.period === 'daily' ? t('reg.vac.salaryFromDay') : t('reg.vac.salaryFromMonth')}
              required
              value={form.salaryMinPaise}
              onChange={(v) => setForm((f) => ({ ...f, salaryMinPaise: v }))}
              period={form.period === 'daily' ? 'day' : 'month'}
              onPeriodChange={(p) => set('period', p === 'day' ? 'daily' : 'monthly')}
              error={err('salaryMin') ?? err('salaryOrder')}
            />
            <MoneyField label={t('reg.vac.salaryTo')} value={form.salaryMaxPaise} onChange={(v) => set('salaryMaxPaise', v)} />
          </div>
          {aboveMarket && trade && <div className="warn">⚠ {t('reg.vac.aboveMarket', { trade: trade.name, to: formatINR(trade.salaryMaxPaise) })}</div>}
          {belowLegal && (
            <div className="warn" role="alert">
              ⚠ <strong>{t('reg.legal.title')}</strong> {legalMinimum ? t('reg.legal.body', { amount: formatINR(legalMinimum) }) : t('reg.legal.bodyNoAmount')}
              <label>
                <input type="checkbox" checked={form.ownerTold} onChange={(e) => set('ownerTold', e.target.checked)} /> {t('reg.legal.tick')}
              </label>
              {err('ownerTold') && <span className="vno">{t('reg.legal.tickFirst')}</span>}
            </div>
          )}
        </fieldset>

        <fieldset className="sec">
          <SectionHead title={t('reg.vac.hours')} />
          <div className="fg">
            <SelectField label={t('reg.js.shift')} required value={form.shift} onChange={(v) => set('shift', v)} options={choiceOptions(t, VACANCY_SHIFTS)} error={err('shift')} />
            <TimeField label={t('reg.vac.starts')} value={form.startsAt} onChange={(v) => set('startsAt', v)} required error={err('startsAt')} />
            <TimeField label={t('reg.vac.ends')} value={form.endsAt} onChange={(v) => set('endsAt', v)} required error={err('endsAt')} />
            <SelectField label={t('reg.vac.weeklyOff')} required value={form.weeklyOff} onChange={(v) => set('weeklyOff', v)} options={choiceOptions(t, WEEKLY_OFF)} error={err('weeklyOff')} />
            <SelectField label={t('reg.vac.experience')} required value={form.experience} onChange={(v) => set('experience', v)} options={choiceOptions(t, EXPERIENCE_NEEDED)} error={err('experience')} />
            <DateField label={t('reg.vac.startDate')} required value={form.startDate} min={todayKey} onChange={(v) => set('startDate', v)} error={err('startDate')} />
          </div>
          <div className="fld">
            <span className="reg-label">{t('reg.vac.extras')}</span>
            <div className="chk">
              {VACANCY_EXTRAS.map((x) => {
                const on = form.extras.includes(x.value);
                return (
                  <label key={x.value} className={on ? 'on' : ''}>
                    <input type="checkbox" checked={on} onChange={(e) => set('extras', e.target.checked ? [...form.extras, x.value] : form.extras.filter((v) => v !== x.value))} /> {t(x.label)}
                  </label>
                );
              })}
            </div>
          </div>
        </fieldset>

        {!draftId && (
          <fieldset className="sec">
            <SectionHead title={t('reg.vac.interview')} />
            <div className="fg">
              <SelectField
                label={t('reg.vac.interviewType')}
                required
                value={form.interviewType}
                onChange={(v) => set('interviewType', (v || 'walk_in') as VacancyForm['interviewType'])}
                options={[
                  { value: 'walk_in', label: t('reg.vac.walkIn') },
                  { value: 'scheduled', label: t('reg.vac.fixedTime') },
                ]}
                placeholder={null}
              />
              <DateField label={t('reg.vac.interviewDay')} required value={form.interviewDate} min={todayKey} onChange={(v) => set('interviewDate', v)} error={err('interviewDate')} />
              {form.interviewType === 'scheduled' && (
                <>
                  <TimeField label={t('reg.vac.slotFrom')} value={form.slotStart} onChange={(v) => set('slotStart', v)} required error={err('slot')} />
                  <TimeField label={t('reg.vac.slotTo')} value={form.slotEnd} onChange={(v) => set('slotEnd', v)} required error={err('slot')} />
                </>
              )}
              <TextField label={t('reg.vac.contact')} value={form.contactName} onChange={(v) => set('contactName', v)} />
            </div>
          </fieldset>
        )}

        <fieldset className="sec">
          <SectionHead title={t('reg.vac.more')} aside={t('reg.js.extrasOptional')} />
          <div className="fg">
            <SelectField
              label={t('reg.vac.gender')}
              value={form.gender}
              onChange={(v) => set('gender', v)}
              options={[
                { value: 'female', label: t('reg.gender.female') },
                { value: 'male', label: t('reg.gender.male') },
              ]}
              placeholder={t('reg.vac.genderAny')}
            />
            {form.gender && <TextField label={t('reg.vac.genderReason')} required value={form.genderReason} onChange={(v) => set('genderReason', v)} error={err('genderReason')} />}
            <TextField label={t('reg.vac.description')} value={form.description} onChange={(v) => set('description', v)} />
          </div>
        </fieldset>

        {form.business && !form.business.canShowCandidates && <div className="warn">{t('reg.vac.unverified')}</div>}
        {form.business?.canShowCandidates && <div className="warn">{t('reg.vac.verified')}</div>}
        {saveError && (
          <div className="warn" role="alert">
            {saveError}
          </div>
        )}
        <div className="reg-actions">
          <Button variant="primary" onClick={onSave} loading={save.isPending}>
            {t('reg.vac.save')}
          </Button>
          <span className="sub">{t('reg.vac.saveNote')}</span>
        </div>
      </Card>
    </div>
  );
}

function TimeField({ label, value, onChange, required, error }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; error?: string }) {
  return (
    <TextField label={label} type="time" value={value} onChange={onChange} required={required} error={error} />
  );
}

/** Business by name, BZ- ID or the last digits of its number. */
function BusinessPicker({ value, onChange, error, locked }: { value: BusinessHit | null; onChange: (b: BusinessHit | null) => void; error?: string; locked?: boolean }) {
  const t = useT();
  const [q, setQ] = useState('');
  const results = useQuery({
    queryKey: ['businesses', 'search', q],
    queryFn: () => api.get<BusinessHit[]>('/screens/call-registration/businesses', { query: { q } }),
    enabled: q.trim().length >= 2 && !value,
  });
  const statusLabel = (b: BusinessHit) => (b.canShowCandidates ? t('reg.vac.bizVerified') : t('reg.vac.bizLead'));
  if (value) {
    return (
      <div className="fld reg-full">
        <span className="reg-label">
          {t('reg.vac.business')} <span className="req">*</span>
        </span>
        <span className="reg-chip">
          {[value.name, value.locality, statusLabel(value)].filter(Boolean).join(' · ')}
          {!locked && (
            <button type="button" aria-label={t('reg.chip.remove', { item: value.name })} onClick={() => onChange(null)}>
              ×
            </button>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="fld reg-full">
      <TextField label={t('reg.vac.business')} required value={q} onChange={setQ} placeholder={t('reg.vac.businessSearch')} error={error} autoComplete="off" />
      {results.data && results.data.length > 0 && (
        <div className="reg-results" role="list">
          {results.data.map((b) => (
            <button type="button" role="listitem" key={b.id} onClick={() => onChange(b)}>
              <strong>{b.name}</strong> · {b.code}
              {b.locality ? ` · ${b.locality}` : ''} · {statusLabel(b)}
            </button>
          ))}
        </div>
      )}
      {results.data && results.data.length === 0 && <span className="sub">{t('reg.vac.noBusiness')}</span>}
    </div>
  );
}

/**
 * Owner confirms the vacancy: the agent sends a code to the business's
 * contact person and types what they read out (method code_on_call), or
 * sends a 48-hour link instead (vacancy confirmation endpoints).
 */
function ConfirmVacancy({ vacancy, businessName }: { vacancy: Saved; businessName: string }) {
  const t = useT();
  const to = useScreenPath();
  const toast = useToast();
  const clock = useClock();
  const [request, setRequest] = useState<{ otpRequestId: string; sentToLast4: string; contactName: string | null; resendAt: number } | null>(null);
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [linkSent, setLinkSent] = useState<{ expiresAt: string; sentToLast4: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => clock().getTime());
  useEffect(() => {
    if (!request) return;
    const id = setInterval(() => setNowMs(clock().getTime()), 1000);
    return () => clearInterval(id);
  }, [request, clock]);

  const sendCode = useMutation({
    mutationFn: () =>
      api.post<{ otpRequestId: string; sentToLast4: string; contactName: string | null; resendAvailableAt?: string }>(
        `/vacancies/${vacancy.id}/confirmation/send-code`,
        request ? { otpRequestId: request.otpRequestId } : {},
      ),
    onSuccess: (r) => {
      setError(null);
      setCode('');
      setRequest({
        otpRequestId: r.otpRequestId,
        sentToLast4: r.sentToLast4,
        contactName: r.contactName,
        resendAt: r.resendAvailableAt ? new Date(r.resendAvailableAt).getTime() : clock().getTime() + 30_000,
      });
    },
    onError: (e) => setError(isApiError(e) ? e.message : t('error.server')),
  });
  const confirm = useMutation({
    mutationFn: (value: string) => api.post(`/vacancies/${vacancy.id}/confirm`, { otpRequestId: request!.otpRequestId, code: value, method: 'code_on_call' }),
    onSuccess: () => {
      setConfirmed(request?.contactName ?? '');
      toast.success(t('reg.vac.confirmedToast', { code: vacancy.code }));
    },
    onError: (e) => setError(isApiError(e) ? e.message : t('error.server')),
  });
  const sendLink = useMutation({
    mutationFn: () => api.post<{ expiresAt: string; sentToLast4: string }>(`/vacancies/${vacancy.id}/confirmation-link`),
    onSuccess: (r) => {
      setError(null);
      setLinkSent(r);
    },
    onError: (e) => setError(isApiError(e) ? e.message : t('error.server')),
  });

  return (
    <div className="reg">
      <TopBar title={t('reg.vac.confirmTitle')} />
      <div className="ok" role="status">
        ✓ {t('reg.vac.saved', { code: vacancy.code, business: businessName })}
      </div>
      <Card>
        {confirmed !== null ? (
          <div className="ok" role="status">
            ✓ {t('reg.vac.confirmed', { name: confirmed || t('reg.vac.theContact') })}
          </div>
        ) : (
          <>
            <p className="muted">{t('reg.vac.confirmHelp')}</p>
            {!request ? (
              <div className="reg-actions">
                <Button variant="primary" onClick={() => sendCode.mutate()} loading={sendCode.isPending}>
                  {t('reg.vac.sendCode')}
                </Button>
                <Button onClick={() => sendLink.mutate()} loading={sendLink.isPending} disabled={Boolean(linkSent)}>
                  {t('reg.vac.sendLink')}
                </Button>
              </div>
            ) : (
              <div className="sec">
                <span className="sub">{t('reg.vac.codeSent', { name: request.contactName ?? t('reg.vac.theContact'), last4: request.sentToLast4 })}</span>
                <div className="reg-actions">
                  <OtpInput value={code} onChange={setCode} label={t('reg.vac.codeLabel')} autoFocus onComplete={(c) => confirm.mutate(c)} disabled={confirm.isPending} invalid={Boolean(error)} />
                  <Button variant="primary" onClick={() => confirm.mutate(code)} loading={confirm.isPending} disabled={code.length !== 6}>
                    {t('form.otp.verify')}
                  </Button>
                </div>
                <div className="reg-actions">
                  {request.resendAt > nowMs ? (
                    <span className="sub">{t('form.otp.resendIn', { seconds: Math.ceil((request.resendAt - nowMs) / 1000) })}</span>
                  ) : (
                    <Button onClick={() => sendCode.mutate()} loading={sendCode.isPending}>
                      {t('form.otp.resend')}
                    </Button>
                  )}
                  <Button onClick={() => sendLink.mutate()} loading={sendLink.isPending} disabled={Boolean(linkSent)}>
                    {t('reg.vac.sendLinkInstead')}
                  </Button>
                </div>
              </div>
            )}
            {linkSent && (
              <div className="ok" role="status" style={{ marginTop: 12 }}>
                ✓ {t('reg.vac.linkSent', { last4: linkSent.sentToLast4, until: formatDateTimeIST(linkSent.expiresAt) })}
              </div>
            )}
          </>
        )}
        {error && (
          <span className="vno" role="alert">
            {error}
          </span>
        )}
        <div className="reg-actions" style={{ marginTop: 14 }}>
          <ButtonLink variant={confirmed !== null || linkSent ? 'primary' : 'secondary'} to={to('CA03-Home')}>
            {t('reg.backHome')}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
