import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { DateField, MoneyField, SelectField, TextField } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { errorDetail, findTrade, useScriptTerms, useTrades } from '../_registration/api';
import {
  AlreadyRegistered,
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
  BUSINESS_TYPES,
  CONTACT_ROLES,
  EMPLOYEE_BANDS,
  HEADCOUNTS,
  HEARD_FROM,
  HIRING_FREQUENCIES,
  LICENCE_KINDS,
  MESSAGE_LANGUAGES,
  OTHER_TRADE,
  VACANCY_SHIFTS,
  WEEKDAYS,
  YEARS_RUNNING,
} from '../_registration/options';
import { isAboveMarket, isBelowLegalMinimum } from '../_registration/salary';
import { businessScript } from '../_registration/scripts';
import { DEFAULT_AREA_AUTO_FILL_MAX_METERS, distanceText } from '../_registration/nearestArea';
import { useDraft } from '../_registration/useDraft';
import {
  businessBody,
  businessErrors,
  EMPTY_BRANCH,
  EMPTY_BUSINESS,
  EMPTY_STAFF_ROW,
  staffTrade,
  type BranchRow,
  type BusinessForm,
  type StaffRow,
} from './payload';

/**
 * Register a new business — design CA13-BusinessLead. A business that calls
 * in is saved as a lead (a field agent visits to verify it); every field the
 * API requires is sent, including the contact person's role. On save the
 * agreement link goes to the contact person and the status panel opens (CA13b).
 */
export default function RegisterBusiness() {
  const t = useT();
  const scriptTerms = useScriptTerms();
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const todayKey = istDateKey(useNow());
  const trades = useTrades();
  const [form, setForm, draft] = useDraft<BusinessForm>('business', EMPTY_BUSINESS);
  const [mobile, setMobile] = useState<MobileState>({ mobile: form.mobile, requestId: null, verifiedAt: null });
  const [branchMobiles, setBranchMobiles] = useState<MobileState[]>(() => form.branches.map((b) => ({ mobile: b.mobile, requestId: null, verifiedAt: null })));
  const [duplicate, setDuplicate] = useState<{ record: { type?: string; code?: string }; what: 'number' | 'document' } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = <K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setStaff = (i: number, patch: Partial<StaffRow>) => setForm((f) => ({ ...f, staff: f.staff.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const setBranch = (i: number, patch: Partial<BranchRow>) => setForm((f) => ({ ...f, branches: f.branches.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const rowTrade = (row: StaffRow) => findTrade(trades.data, staffTrade(row));
  const belowLegal = (row: StaffRow) => isBelowLegalMinimum(rowTrade(row), row.salaryMinPaise, row.period);
  const errors = businessErrors(form, branchMobiles.map((m) => Boolean(m.requestId)), belowLegal);
  const err = (k: string, text = 'reg.err.required' as const) => (showErrors && errors.includes(k) ? t(text) : undefined);
  const household = form.businessType === 'household';
  const tradeOptions = [...(trades.data ?? []).map((tr) => ({ value: tr.name, label: tr.name })), { value: OTHER_TRADE, label: t('reg.trade.other') }];

  const save = useMutation({
    mutationFn: async () => {
      const created = await api.post<{ id: string; code: string }>(
        '/businesses',
        businessBody({ ...form, mobile: mobile.mobile }, mobile.requestId!, branchMobiles.map((m) => m.requestId ?? '')),
      );
      let agreementSent = true;
      try {
        await api.post(`/businesses/${created.id}/agreement-links`, { language: form.language });
      } catch {
        agreementSent = false;
      }
      return { ...created, agreementSent };
    },
    onSuccess: (created) => {
      draft.clear();
      if (!created.agreementSent) toast.error(t('reg.biz.agreementFailed'));
      navigate(`${to('CA13b-BusinessSaved')}?id=${encodeURIComponent(created.id)}${created.agreementSent ? '&sent=1' : ''}`);
    },
    onError: (e) => {
      const code = errorDetail(e, 'existingBusinessCode');
      if (typeof code === 'string') {
        const matched = errorDetail(e, 'matchedOn');
        setDuplicate({ record: { type: 'business', code }, what: Array.isArray(matched) && !matched.includes('phone') ? 'document' : 'number' });
        return;
      }
      if (errorDetail(e, 'code') === 'area_required') {
        // No area picked and none within the Settings distance of the pin (guide, 14 Nov).
        const meters = errorDetail(e, 'maxMeters');
        setShowErrors(true);
        setSaveError(t('reg.area.noneNear', { distance: distanceText(typeof meters === 'number' ? meters : DEFAULT_AREA_AUTO_FILL_MAX_METERS) }));
        return;
      }
      if (isApiError(e) && /OTP/i.test(e.message)) setMobile((m) => ({ ...m, requestId: null, verifiedAt: null }));
      setSaveError(isApiError(e) ? e.message : t('error.server'));
    },
  });

  const onSave = () => {
    setShowErrors(true);
    setSaveError(null);
    if (!mobile.requestId || errors.length) return;
    save.mutate();
  };

  if (duplicate) {
    return (
      <div className="reg">
        <TopBar title={t('screen.CA13-BusinessLead')} />
        <AlreadyRegistered
          record={duplicate.record}
          what={duplicate.what}
          onUseDifferent={() => {
            if (duplicate.what === 'number') {
              setMobile({ mobile: '', requestId: null, verifiedAt: null });
              set('mobile', '');
            }
            setDuplicate(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="reg">
      <TopBar title={t('screen.CA13-BusinessLead')} subtitle={t('reg.biz.subtitle')} />
      <DraftNote restored={draft.restored} onDiscard={() => {
        draft.discard();
        setMobile({ mobile: '', requestId: null, verifiedAt: null });
        setBranchMobiles([]);
      }} />
      <Card className="reg-form">
        <RequiredNote />

        <fieldset className="sec">
          <SectionHead n={1} title={t('reg.biz.contact')} aside={t('reg.biz.contactAside')} />
          <div className="fg">
            <TextField label={t('reg.biz.contactName')} required value={form.contactName} onChange={(v) => set('contactName', v)} error={err('contactName')} />
            <SelectField label={t('reg.biz.role')} required value={form.contactRole} onChange={(v) => set('contactRole', v)} options={choiceOptions(t, CONTACT_ROLES)} error={err('contactRole')} />
            <VerifiedMobile
              purpose="business_contact"
              value={mobile}
              onChange={(next) => {
                setMobile(next);
                set('mobile', next.mobile);
              }}
              onAlreadyRegistered={(record) => setDuplicate({ record, what: 'number' })}
            />
            {mobile.requestId && <WhatsAppField same={form.whatsappSame} onSame={(v) => set('whatsappSame', v)} value={form.whatsapp} onChange={(v) => set('whatsapp', v)} />}
            <SelectField label={t('reg.messageLanguage')} required value={form.language} onChange={(v) => set('language', v)} options={choiceOptions(t, MESSAGE_LANGUAGES)} error={err('language')} />
            <TextField label={t('reg.biz.billingEmail')} type="email" value={form.billingEmail} onChange={(v) => set('billingEmail', v)} error={showErrors && errors.includes('billingEmail') ? t('reg.err.email') : undefined} />
            <SelectField label={t('reg.heardFrom')} required value={form.heardFrom} onChange={(v) => set('heardFrom', v)} options={choiceOptions(t, HEARD_FROM)} error={err('heardFrom')} />
          </div>
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={2} title={t('reg.biz.business')} />
          <div className="fg">
            <TextField label={household ? t('reg.biz.householdName') : t('reg.biz.boardName')} required value={form.boardName} onChange={(v) => set('boardName', v)} error={err('boardName')} />
            {household ? (
              <TextField label={t('reg.biz.familyName')} required value={form.familyName} onChange={(v) => set('familyName', v)} error={err('familyName')} />
            ) : (
              <TextField label={t('reg.biz.legalName')} value={form.legalName} onChange={(v) => set('legalName', v)} />
            )}
            <SelectField label={t('reg.biz.type')} required value={form.businessType} onChange={(v) => set('businessType', v)} options={choiceOptions(t, BUSINESS_TYPES)} error={err('businessType')} />
            <SelectField label={t('reg.biz.employees')} required value={form.employees} onChange={(v) => set('employees', v)} options={choiceOptions(t, EMPLOYEE_BANDS)} error={err('employees')} />
            <SelectField label={t('reg.biz.running')} value={form.running} onChange={(v) => set('running', v)} options={choiceOptions(t, YEARS_RUNNING)} />
            <SelectField label={t('reg.biz.hiring')} value={form.hiring} onChange={(v) => set('hiring', v)} options={choiceOptions(t, HIRING_FREQUENCIES)} />
            <TextField label={t('reg.biz.opens')} type="time" value={form.opensAt} onChange={(v) => set('opensAt', v)} />
            <TextField label={t('reg.biz.closes')} type="time" value={form.closesAt} onChange={(v) => set('closesAt', v)} />
          </div>
          <div className="fld">
            <span className="reg-label">{t('reg.biz.workingDays')}</span>
            <div className="chk">
              {WEEKDAYS.map((d) => {
                const on = form.workingDays.includes(d.value);
                return (
                  <label key={d.value} className={on ? 'on' : ''}>
                    <input type="checkbox" checked={on} onChange={(e) => set('workingDays', e.target.checked ? [...form.workingDays, d.value] : form.workingDays.filter((x) => x !== d.value))} /> {t(d.label)}
                  </label>
                );
              })}
            </div>
          </div>
          <span className="sub">{t('reg.biz.householdNote')}</span>
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={3} title={t('reg.biz.address')} />
          <div className="fg">
            <TextField label={t('reg.biz.shopNumber')} required value={form.shopNumber} onChange={(v) => set('shopNumber', v)} error={err('shopNumber')} />
            <TextField label={t('reg.biz.street')} required value={form.street} onChange={(v) => set('street', v)} error={err('street')} />
            <TextField label={t('reg.biz.landmark')} required value={form.landmark} onChange={(v) => set('landmark', v)} error={err('landmark')} />
            <PlaceFields areaFromPin value={form.place} onChange={(p) => set('place', p)} errors={{ area: err('area'), pincode: err('pincode'), pin: err('pin') }} />
          </div>
          {form.branches.map((b, i) => (
            <div className="reg-box" key={i}>
              <div className="reg-box__head">
                <span className="lbl">{t('reg.biz.branchN', { n: i + 1 })}</span>
                <button
                  type="button"
                  className="reg-link-btn danger"
                  onClick={() => {
                    setForm((f) => ({ ...f, branches: f.branches.filter((_, j) => j !== i) }));
                    setBranchMobiles((m) => m.filter((_, j) => j !== i));
                  }}
                >
                  {t('reg.remove')}
                </button>
              </div>
              <div className="fg">
                <TextField label={t('reg.biz.branchName')} required value={b.name} onChange={(v) => setBranch(i, { name: v })} />
                <TextField label={t('reg.biz.shopNumber')} value={b.shopNumber} onChange={(v) => setBranch(i, { shopNumber: v })} />
                <TextField label={t('reg.biz.street')} value={b.street} onChange={(v) => setBranch(i, { street: v })} />
                <TextField label={t('reg.biz.landmark')} value={b.landmark} onChange={(v) => setBranch(i, { landmark: v })} />
                <PlaceFields value={b.place} onChange={(p) => setBranch(i, { place: p })} pinRequired={false} />
                <TextField label={t('reg.biz.contactName')} required value={b.contactName} onChange={(v) => setBranch(i, { contactName: v })} />
                <SelectField label={t('reg.biz.role')} required value={b.contactRole} onChange={(v) => setBranch(i, { contactRole: v })} options={choiceOptions(t, CONTACT_ROLES)} />
                <SelectField label={t('reg.messageLanguage')} value={b.language} onChange={(v) => setBranch(i, { language: v })} options={choiceOptions(t, MESSAGE_LANGUAGES)} />
                <VerifiedMobile
                  purpose="branch_contact"
                  label={t('reg.biz.branchMobile')}
                  value={branchMobiles[i] ?? { mobile: '', requestId: null, verifiedAt: null }}
                  onChange={(next) => {
                    setBranchMobiles((m) => m.map((x, j) => (j === i ? next : x)));
                    setBranch(i, { mobile: next.mobile });
                  }}
                />
              </div>
              {err(`branch${i}`) && <span className="vno" role="alert">{t('reg.biz.branchIncomplete')}</span>}
            </div>
          ))}
          <div className="reg-actions">
            <span className="sub">
              <strong>{t('reg.biz.branches')}</strong> · {t('reg.biz.branchesNote')}
            </span>
            <Button
              onClick={() => {
                setForm((f) => ({ ...f, branches: [...f.branches, EMPTY_BRANCH] }));
                setBranchMobiles((m) => [...m, { mobile: '', requestId: null, verifiedAt: null }]);
              }}
            >
              {t('reg.biz.addBranch')}
            </Button>
          </div>
        </fieldset>

        {!household && (
          <fieldset className="sec">
            <SectionHead n={4} title={t('reg.biz.documents')} aside={t('reg.biz.allOptional')} />
            <div className="fg">
              <TextField label={t('reg.biz.gstin')} value={form.gstin} onChange={(v) => set('gstin', v.toUpperCase())} disabled={form.noDocuments} maxLength={15} error={showErrors && errors.includes('gstin') ? t('reg.err.gstin') : undefined} />
              <TextField label={t('reg.biz.fssai')} value={form.fssai} onChange={(v) => set('fssai', v.replace(/\D/g, ''))} disabled={form.noDocuments} inputMode="numeric" maxLength={14} />
              <SelectField label={t('reg.biz.licenceKind')} value={form.licenceKind} onChange={(v) => set('licenceKind', (v || 'shopEstablishmentNumber') as BusinessForm['licenceKind'])} options={choiceOptions(t, LICENCE_KINDS)} placeholder={null} disabled={form.noDocuments} />
              <TextField label={t('reg.biz.licenceNumber')} value={form.licenceNumber} onChange={(v) => set('licenceNumber', v)} placeholder={t('reg.biz.ifTheyHave')} disabled={form.noDocuments} />
              <TextField label={t('reg.biz.pan')} value={form.pan} onChange={(v) => set('pan', v.toUpperCase())} placeholder={t('reg.biz.ifTheyHave')} disabled={form.noDocuments} maxLength={10} error={showErrors && errors.includes('pan') ? t('reg.err.pan') : undefined} />
            </div>
            <label className={`reg-check${form.noDocuments ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={form.noDocuments}
                onChange={(e) => setForm((f) => ({ ...f, noDocuments: e.target.checked, ...(e.target.checked ? { gstin: '', fssai: '', licenceNumber: '', pan: '' } : {}) }))}
              />{' '}
              {t('reg.biz.noDocuments')}
            </label>
          </fieldset>
        )}

        <fieldset className="sec">
          <SectionHead n={household ? 4 : 5} title={t('reg.biz.staff')} aside={t('reg.biz.staffAside')} />
          {form.staff.map((row, i) => {
            const trade = rowTrade(row);
            const below = belowLegal(row);
            return (
              <div className="reg-box" key={i}>
                <div className="reg-box__head">
                  <span className="lbl">{t('reg.biz.roleN', { n: i + 1 })}</span>
                  <button type="button" className="reg-link-btn danger" onClick={() => setForm((f) => ({ ...f, staff: f.staff.filter((_, j) => j !== i) }))}>
                    {t('reg.remove')}
                  </button>
                </div>
                <div className="fg">
                  <SelectField label={t('reg.biz.staffRole')} required value={row.trade} onChange={(v) => setStaff(i, { trade: v })} options={tradeOptions} placeholder={t('reg.trade.choose')} />
                  {row.trade === OTHER_TRADE && <TextField label={t('reg.trade.typeIt')} value={row.other} onChange={(v) => setStaff(i, { other: v })} hint={t('reg.trade.newTrade')} />}
                  <SelectField label={t('reg.biz.howMany')} required value={row.headcount} onChange={(v) => setStaff(i, { headcount: v })} options={HEADCOUNTS.map((n) => ({ value: n, label: n }))} placeholder={null} />
                  <MoneyField
                    label={row.period === 'daily' ? t('reg.vac.salaryFromDay') : t('reg.vac.salaryFromMonth')}
                    required
                    value={row.salaryMinPaise}
                    onChange={(v) => setStaff(i, { salaryMinPaise: v })}
                    period={row.period === 'daily' ? 'day' : 'month'}
                    onPeriodChange={(p) => setStaff(i, { period: p === 'day' ? 'daily' : 'monthly' })}
                  />
                  <MoneyField label={t('reg.vac.salaryTo')} value={row.salaryMaxPaise} onChange={(v) => setStaff(i, { salaryMaxPaise: v })} />
                  <SelectField label={t('reg.js.shift')} required value={row.shift} onChange={(v) => setStaff(i, { shift: v })} options={choiceOptions(t, VACANCY_SHIFTS)} />
                  <DateField label={t('reg.biz.neededFrom')} required value={row.startDate} min={todayKey} onChange={(v) => setStaff(i, { startDate: v })} />
                  {trade && (
                    <span className="reg-hint reg-full">
                      ⓘ {t('reg.salary.marketHint', { trade: trade.name, from: formatINR(trade.salaryMinPaise), to: formatINR(trade.salaryMaxPaise) })}
                    </span>
                  )}
                </div>
                {isAboveMarket(trade, row.salaryMinPaise, row.period) && trade && <div className="warn">⚠ {t('reg.vac.aboveMarket', { trade: trade.name, to: formatINR(trade.salaryMaxPaise) })}</div>}
                {below && trade && (
                  <div className="warn" role="alert">
                    ⚠ <strong>{t('reg.legal.title')}</strong> {t('reg.legal.body', { amount: formatINR(trade.legalMinimumPaise) })}
                    <label>
                      <input type="checkbox" checked={row.ownerTold} onChange={(e) => setStaff(i, { ownerTold: e.target.checked })} /> {t('reg.legal.tick')}
                    </label>
                    {showErrors && errors.includes(`staffLegal${i}`) && <span className="vno">{t('reg.legal.tickFirst')}</span>}
                  </div>
                )}
                {showErrors && errors.includes(`staff${i}`) && <span className="vno" role="alert">{t('reg.biz.staffIncomplete')}</span>}
              </div>
            );
          })}
          <Button onClick={() => setForm((f) => ({ ...f, staff: [...f.staff, EMPTY_STAFF_ROW] }))} style={{ alignSelf: 'flex-start' }}>
            {form.staff.length ? t('reg.biz.addAnotherRole') : t('reg.biz.addRole')}
          </Button>
        </fieldset>

        <ExplainScript n={household ? 5 : 6} title={t('reg.biz.explain')} scripts={scriptTerms ? businessScript(scriptTerms) : null} language={form.language} note={t('reg.biz.explainNote')} />

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
          <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!mobile.requestId}>
            {t('reg.biz.save')}
          </Button>
          <span className="sub">{mobile.requestId ? t('reg.biz.saveNote') : t('reg.js.saveLocked')}</span>
        </div>
      </Card>
    </div>
  );
}
