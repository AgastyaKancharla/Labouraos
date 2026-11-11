import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { DateField, MoneyField, SelectField, TextField } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { ageOn, istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { errorDetail, findTrade, useFormOptions, useScriptTerms, useTrades } from '../_registration/api';
import {
  AlreadyRegistered,
  ChipPicker,
  choiceOptions,
  DraftNote,
  ExplainScript,
  PlaceFields,
  RequiredNote,
  SectionHead,
  VerifiedMobile,
  WhatsAppField,
  type MobileState,
} from '../_registration/kit';
import {
  BEST_TIME,
  GENDERS,
  HEARD_FROM,
  JOB_TYPES,
  LICENCES,
  MESSAGE_LANGUAGES,
  OTHER_TRADE,
  QUALIFICATIONS,
  SHIFT_PREFERENCES,
  SPOKEN_LANGUAGES,
  TRAVEL_KM,
  YEARS,
} from '../_registration/options';
import { guaranteeFloorPaise, isAboveMarket } from '../_registration/salary';
import { jobSeekerConsentScript } from '../_registration/scripts';
import { useDraft } from '../_registration/useDraft';
import { createBody, EMPTY_FORM, profileBody, tradeName, validate, type FieldError, type JobSeekerForm, type TradeRow } from './payload';

/**
 * Register a job seeker — designs CA08-Register, CA08v-Verified,
 * CA08w-SalaryWarning and CA08x-Duplicate. One form for everyone; Save
 * unlocks after the mobile is checked by OTP; on save it opens the step
 * panel (CA08b) where the agent sends the one registration link.
 */
const ERROR_TEXT: Record<FieldError, MessageKey> = {
  name: 'reg.err.name',
  dateOfBirth: 'reg.err.dateOfBirth',
  gender: 'reg.err.required',
  messageLanguage: 'reg.err.required',
  bestTime: 'reg.err.required',
  heardFrom: 'reg.err.required',
  area: 'reg.err.area',
  pincode: 'form.pincode.invalid',
  pin: 'reg.err.pin',
  travelKm: 'reg.err.required',
  trade: 'reg.err.trade',
  years: 'reg.err.years',
  duplicateTrade: 'reg.err.duplicateTrade',
  lookingSince: 'reg.err.required',
  minSalary: 'reg.err.salary',
  maxSalary: 'reg.err.salary',
  salaryOrder: 'reg.err.salaryOrder',
  availableFrom: 'reg.err.required',
  shift: 'reg.err.required',
  jobType: 'reg.err.required',
  spoken: 'reg.err.spoken',
  whatsapp: 'form.mobile.invalid',
};

export default function RegisterJobSeeker() {
  const t = useT();
  const scriptTerms = useScriptTerms();
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow();
  const todayKey = istDateKey(now);
  const [form, setForm, draft] = useDraft<JobSeekerForm>('job-seeker', EMPTY_FORM);
  const [mobile, setMobile] = useState<MobileState>({ mobile: form.mobile, requestId: null, verifiedAt: null });
  const [duplicate, setDuplicate] = useState<{ type?: string; code?: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const trades = useTrades();
  const options = useFormOptions();

  const set = <K extends keyof JobSeekerForm>(key: K, value: JobSeekerForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setTrade = (i: number, patch: Partial<TradeRow>) =>
    setForm((f) => ({ ...f, trades: f.trades.map((row, j) => (j === i ? { ...row, ...patch } : row)) }));

  const errors = validate(form);
  const err = (key: FieldError) => (showErrors && errors.includes(key) ? t(ERROR_TEXT[key]) : undefined);
  const primaryTrade = findTrade(trades.data, tradeName(form.trades[0] ?? { trade: '', other: '', years: '' }));
  const aboveMarket = isAboveMarket(primaryTrade, form.minSalaryPaise, form.period);
  const tradeOptions = [
    ...(trades.data ?? []).map((tr) => ({ value: tr.name, label: tr.name })),
    { value: OTHER_TRADE, label: t('reg.trade.other') },
  ];
  const age = form.dateOfBirth ? ageOn(form.dateOfBirth, todayKey) : null;

  const save = useMutation({
    mutationFn: async () => {
      const created = await api.post<{ id: string; code: string }>('/job-seekers', createBody({ ...form, mobile: mobile.mobile }, mobile.requestId!));
      const extras = profileBody({ ...form, mobile: mobile.mobile });
      if (extras) {
        try {
          await api.patch(`/job-seekers/${created.id}/profile`, extras);
        } catch {
          toast.error(t('reg.js.extrasFailed'));
        }
      }
      return created;
    },
    onSuccess: (created) => {
      draft.clear();
      toast.success(t('reg.js.saved', { code: created.code }));
      navigate(to('CA08c-InProgress', { id: created.id }));
    },
    onError: (e) => {
      const code = errorDetail(e, 'existingJobSeekerCode');
      if (typeof code === 'string') {
        setDuplicate({ type: 'job_seeker', code });
        return;
      }
      const message = isApiError(e) ? e.message : t('error.server');
      if (isApiError(e) && /OTP/i.test(e.message)) setMobile((m) => ({ ...m, requestId: null, verifiedAt: null }));
      setSaveError(message);
    },
  });

  const onSave = () => {
    setShowErrors(true);
    setSaveError(null);
    if (!mobile.requestId) return;
    if (errors.length > 0) return;
    if (aboveMarket && !form.keepHighSalary) return;
    save.mutate();
  };

  if (duplicate) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA08-Register')} />
        <AlreadyRegistered
          record={duplicate}
          what="number"
          onUseDifferent={() => {
            setDuplicate(null);
            setMobile({ mobile: '', requestId: null, verifiedAt: null });
            set('mobile', '');
          }}
        />
      </div>
    );
  }

  const canAddTrade = form.trades.length < 3;
  const pronoun = form.gender === 'male' ? 'he' : form.gender === 'female' ? 'she' : 'they';

  return (
    <div className="reg">
      <TopBar title={t('screen.CA08-Register')} subtitle={t('reg.js.subtitle')} />
      <DraftNote restored={draft.restored} onDiscard={() => {
        draft.discard();
        setMobile({ mobile: '', requestId: null, verifiedAt: null });
      }} />
      <Card className="reg-form">
        <RequiredNote />

        <fieldset className="sec">
          <SectionHead n={1} title={t('reg.js.basics')} />
          <div className="fg">
            <TextField label={t('reg.js.fullName')} required value={form.name} onChange={(v) => set('name', v)} error={err('name')} autoComplete="off" />
            <VerifiedMobile
              purpose="job_seeker"
              value={mobile}
              onChange={(next) => {
                setMobile(next);
                set('mobile', next.mobile);
              }}
              onAlreadyRegistered={(record) => setDuplicate(record)}
            />
            {mobile.requestId && (
              <WhatsAppField same={form.whatsappSame} onSame={(v) => set('whatsappSame', v)} value={form.whatsapp} onChange={(v) => set('whatsapp', v)} />
            )}
            <DateField
              label={t('reg.js.dob')}
              mode="dob"
              required
              value={form.dateOfBirth}
              onChange={(v) => set('dateOfBirth', v)}
              hint={age !== null ? t('reg.js.dobHintAge', { age }) : t('reg.js.dobHint')}
              error={err('dateOfBirth')}
            />
            <SelectField label={t('reg.js.gender')} required value={form.gender} onChange={(v) => set('gender', v)} options={choiceOptions(t, GENDERS)} error={err('gender')} hint={t('reg.js.genderHint')} />
            <SelectField label={t('reg.messageLanguage')} required value={form.messageLanguage} onChange={(v) => set('messageLanguage', v)} options={choiceOptions(t, MESSAGE_LANGUAGES)} error={err('messageLanguage')} />
            <SelectField label={t('reg.js.bestTime')} required value={form.bestTime} onChange={(v) => set('bestTime', v)} options={choiceOptions(t, BEST_TIME)} error={err('bestTime')} />
            <SelectField label={t('reg.heardFrom')} required value={form.referredBy ? 'referral_partner' : form.heardFrom} onChange={(v) => set('heardFrom', v)} options={choiceOptions(t, HEARD_FROM)} error={err('heardFrom')} disabled={Boolean(form.referredBy)} />
          </div>
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={2} title={t(`reg.js.where.${pronoun}`)} />
          <div className="fg">
            <PlaceFields value={form.place} onChange={(p) => set('place', p)} errors={{ area: err('area'), pincode: err('pincode'), pin: err('pin') }} />
            <SelectField label={t('reg.js.travel')} required value={form.travelKm} onChange={(v) => set('travelKm', v)} options={choiceOptions(t, TRAVEL_KM)} error={err('travelKm')} />
          </div>
          <ChipPicker
            label={t('reg.js.preferredAreas')}
            values={form.preferredAreas}
            options={(options.data?.areas ?? []).map((a) => ({ value: a.name, label: a.name }))}
            onChange={(v) => set('preferredAreas', v)}
            addLabel={t('reg.js.addArea')}
          />
          <div className="fld">
            <span className="reg-label">{t('reg.js.willingTo')}</span>
            <div className="chk">
              <label className={form.relocate ? 'on' : ''}>
                <input type="checkbox" checked={form.relocate} onChange={(e) => set('relocate', e.target.checked)} /> {t('reg.js.relocate')}
              </label>
              <label className={form.accommodation ? 'on' : ''}>
                <input type="checkbox" checked={form.accommodation} onChange={(e) => set('accommodation', e.target.checked)} /> {t('reg.js.accommodation')}
              </label>
            </div>
          </div>
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={3} title={t('reg.js.work')} />
          {form.trades.map((row, i) => {
            const isOther = row.trade === OTHER_TRADE;
            return (
              <div className="reg-box" key={i}>
                <div className="reg-box__head">
                  <span className="lbl">{i === 0 ? t(`reg.js.tradeLooking.${pronoun}`) : t('reg.js.tradeN', { n: i + 1 })}</span>
                  {i > 0 && (
                    <button type="button" className="reg-link-btn danger" onClick={() => setForm((f) => ({ ...f, trades: f.trades.filter((_, j) => j !== i) }))}>
                      {t('reg.remove')}
                    </button>
                  )}
                </div>
                <div className="fg">
                  <SelectField
                    label={t('reg.trade.label')}
                    required={i === 0}
                    value={row.trade}
                    onChange={(v) => setTrade(i, { trade: v })}
                    options={tradeOptions}
                    placeholder={t('reg.trade.choose')}
                    error={i === 0 ? err('trade') : undefined}
                  />
                  {isOther && (
                    <TextField
                      label={t('reg.trade.typeIt')}
                      value={row.other}
                      onChange={(v) => setTrade(i, { other: v })}
                      hint={<span style={{ color: 'var(--amber)', fontWeight: 600 }}>{t('reg.trade.newTrade')}</span>}
                    />
                  )}
                  <SelectField
                    label={t('reg.js.years')}
                    required={i === 0}
                    value={row.years}
                    onChange={(v) => setTrade(i, { years: v })}
                    options={choiceOptions(t, YEARS)}
                    error={tradeName(row) && !row.years ? err('years') : undefined}
                  />
                </div>
              </div>
            );
          })}
          {err('duplicateTrade') && <span className="vno" role="alert">{err('duplicateTrade')}</span>}
          {canAddTrade && (
            <Button onClick={() => setForm((f) => ({ ...f, trades: [...f.trades, { trade: '', other: '', years: '' }] }))} style={{ alignSelf: 'flex-start' }}>
              {t('reg.js.addTrade', { count: 3 - form.trades.length })}
            </Button>
          )}
          <div className="fg">
            <SelectField
              label={t('reg.js.workingNow')}
              value={form.workingNow}
              onChange={(v) => set('workingNow', v as JobSeekerForm['workingNow'])}
              options={[
                { value: 'no', label: t('reg.no') },
                { value: 'yes', label: t('reg.yes') },
              ]}
            />
            <TextField label={form.workingNow === 'yes' ? t('reg.js.currentEmployer') : t('reg.js.lastEmployer')} value={form.lastEmployer} onChange={(v) => set('lastEmployer', v)} />
            <SelectField label={form.workingNow === 'yes' ? t('reg.js.currentRole') : t('reg.js.lastRole')} value={form.lastRole} onChange={(v) => set('lastRole', v)} options={tradeOptions.filter((o) => o.value !== OTHER_TRADE)} placeholder={t('reg.trade.choose')} />
            <MoneyField label={form.workingNow === 'yes' ? t('reg.js.currentSalary') : t('reg.js.lastSalary')} value={form.lastSalaryPaise} onChange={(v) => set('lastSalaryPaise', v)} />
            <DateField label={t('reg.js.lookingSince')} required value={form.lookingSince} max={todayKey} onChange={(v) => set('lookingSince', v)} error={err('lookingSince')} />
          </div>
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={4} title={t('reg.js.salaryTiming')} />
          <div className="fg">
            {primaryTrade && (
              <span className="reg-hint reg-full">
                ⓘ{' '}
                {t('reg.salary.marketHint', {
                  trade: primaryTrade.name,
                  from: formatINR(primaryTrade.salaryMinPaise),
                  to: formatINR(primaryTrade.salaryMaxPaise),
                })}
              </span>
            )}
            <MoneyField
              label={t('reg.js.minSalary')}
              required
              value={form.minSalaryPaise}
              onChange={(v) => setForm((f) => ({ ...f, minSalaryPaise: v, keepHighSalary: false }))}
              error={err('minSalary')}
            />
            <MoneyField label={t('reg.js.maxSalary')} required value={form.maxSalaryPaise} onChange={(v) => set('maxSalaryPaise', v)} error={err('maxSalary') ?? err('salaryOrder')} />
            <SelectField
              label={t('reg.js.per')}
              required
              value={form.period}
              onChange={(v) => set('period', (v || 'monthly') as JobSeekerForm['period'])}
              options={[
                { value: 'monthly', label: t('reg.per.month') },
                { value: 'daily', label: t('reg.per.day') },
              ]}
              placeholder={null}
            />
            <DateField label={t('reg.js.availableFrom')} required value={form.availableFrom} min={todayKey} onChange={(v) => set('availableFrom', v)} error={err('availableFrom')} />
            <SelectField label={t('reg.js.shift')} required value={form.shift} onChange={(v) => set('shift', v)} options={choiceOptions(t, SHIFT_PREFERENCES)} error={err('shift')} />
            <SelectField label={t('reg.js.jobType')} required value={form.jobType} onChange={(v) => set('jobType', v)} options={choiceOptions(t, JOB_TYPES)} error={err('jobType')} />
          </div>
          {aboveMarket && primaryTrade && form.minSalaryPaise && (
            <div className="warn" role="alert">
              <strong>⚠ {t('reg.salary.aboveTitle')}</strong>{' '}
              {t('reg.salary.aboveBody', {
                trade: primaryTrade.name,
                from: formatINR(primaryTrade.salaryMinPaise),
                to: formatINR(primaryTrade.salaryMaxPaise),
                asked: formatINR(form.minSalaryPaise),
              })}
              <br />
              <br />
              {t('reg.salary.aboveGuarantee', {
                asked: formatINR(form.minSalaryPaise),
                floor: formatINR(guaranteeFloorPaise(primaryTrade, form.minSalaryPaise) ?? 0),
              })}
              <div className="reg-actions" style={{ marginTop: 12 }}>
                <Button variant="primary" onClick={() => document.getElementById('reg-min-salary-anchor')?.scrollIntoView({ block: 'center' })}>
                  {t('reg.salary.lowered')}
                </Button>
                <Button onClick={() => set('keepHighSalary', true)} aria-pressed={form.keepHighSalary}>
                  {form.keepHighSalary ? '✓ ' : ''}
                  {t('reg.salary.keep', { asked: formatINR(form.minSalaryPaise) })}
                </Button>
              </div>
            </div>
          )}
          <span id="reg-min-salary-anchor" />
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={5} title={t(`reg.js.languages.${pronoun}`)} />
          <ChipPicker
            label={t('reg.js.speaks')}
            required
            values={form.spoken}
            options={SPOKEN_LANGUAGES.map((l) => ({ value: l, label: l }))}
            onChange={(v) => set('spoken', v)}
            addLabel={t('reg.js.addLanguage')}
            error={err('spoken')}
          />
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={6} title={t('reg.js.extras')} aside={t('reg.js.extrasOptional')} />
          <div className="fg">
            <div className="fld">
              <SelectField label={t('reg.js.qualification')} value={form.noQualification ? '' : form.qualification} onChange={(v) => set('qualification', v)} options={choiceOptions(t, QUALIFICATIONS)} disabled={form.noQualification} />
              <label className={`reg-check${form.noQualification ? ' on' : ''}`}>
                <input type="checkbox" checked={form.noQualification} onChange={(e) => set('noQualification', e.target.checked)} /> {t('reg.js.noQualification')}
              </label>
            </div>
            <SelectField label={t('reg.js.licence')} value={form.licence} onChange={(v) => set('licence', v)} options={choiceOptions(t, LICENCES)} />
            <div className="fld">
              <span className="reg-label">{t('reg.js.has')}</span>
              <div className="chk">
                {(['ownVehicle', 'police', 'smartphone'] as const).map((key) => (
                  <label key={key} className={form[key] ? 'on' : ''}>
                    <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} /> {t(`reg.js.has.${key}`)}
                  </label>
                ))}
              </div>
            </div>
            <ReferredBy form={form} setForm={setForm} />
          </div>
        </fieldset>

        <ExplainScript
          n={7}
          title={t(`reg.js.explain.${pronoun}`)}
          scripts={scriptTerms ? jobSeekerConsentScript(scriptTerms) : null}
          language={form.messageLanguage}
          note={t('reg.js.explainNote')}
        />

        {saveError && (
          <div className="warn" role="alert">
            {saveError}
          </div>
        )}
        {showErrors && errors.length > 0 && (
          <div className="warn" role="alert">
            {t('reg.err.fixFields', { count: errors.length })}
          </div>
        )}
        <div className="reg-actions">
          <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!mobile.requestId} aria-describedby="reg-save-note">
            {t('reg.js.save')}
          </Button>
          <span className="sub" id="reg-save-note">
            {!mobile.requestId
              ? t('reg.js.saveLocked')
              : aboveMarket && !form.keepHighSalary
                ? t('reg.salary.decideFirst')
                : t('reg.js.saveNote')}
          </span>
        </div>
      </Card>
    </div>
  );
}

/** "Referred by (RF- ID or partner's mobile)" — looked up, then linked by id. */
function ReferredBy({ form, setForm }: { form: JobSeekerForm; setForm: (fn: (f: JobSeekerForm) => JobSeekerForm) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const find = useMutation({
    mutationFn: (q: string) =>
      api.get<{ partner: { id: string; code: string; name: string } | null }>('/screens/call-registration/referral-partners', { query: { q } }),
    onSuccess: ({ partner }) => {
      if (!partner) {
        setError(t('reg.js.referralNotFound'));
        return;
      }
      setError(null);
      setForm((f) => ({ ...f, referredBy: partner, heardFrom: 'referral_partner' }));
    },
    onError: () => setError(t('error.server')),
  });
  if (form.referredBy) {
    return (
      <div className="fld">
        <span className="reg-label">{t('reg.js.referredBy')}</span>
        <span className="reg-chip">
          {form.referredBy.code} · {form.referredBy.name}
          <button type="button" aria-label={t('reg.chip.remove', { item: form.referredBy.code })} onClick={() => setForm((f) => ({ ...f, referredBy: null, referredByQuery: '' }))}>
            ×
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="fld">
      <TextField
        label={t('reg.js.referredBy')}
        value={form.referredByQuery}
        onChange={(v) => setForm((f) => ({ ...f, referredByQuery: v }))}
        placeholder="RF-00042"
        error={error ?? undefined}
      />
      <Button onClick={() => find.mutate(form.referredByQuery.trim())} loading={find.isPending} disabled={form.referredByQuery.trim().length < 4}>
        {t('reg.js.findPartner')}
      </Button>
    </div>
  );
}
