import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { SelectField, TextField } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { errorDetail, useScriptTerms, type BusinessHit } from '../_registration/api';
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
import { BUSINESS_TYPES, HEARD_FROM, INDIVIDUAL_ROLES, MESSAGE_LANGUAGES } from '../_registration/options';
import { referralScript } from '../_registration/scripts';
import { useDraft } from '../_registration/useDraft';
import { EMPTY_REFERRAL, referralBody, referralErrors, type ReferralForm } from './payload';

/**
 * Register a referral partner — design CA15-RegisterReferral. Mobile by OTP,
 * individual or business, area, pincode and optional pin, language. Saving
 * creates the RF- ID, sends it by SMS and sends the one resumable link
 * (terms → selfie → ID → UPI); then CA15b shows the steps.
 */
export default function RegisterReferral() {
  const t = useT();
  const scriptTerms = useScriptTerms();
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm, draft] = useDraft<ReferralForm>('referral', EMPTY_REFERRAL);
  const [mobile, setMobile] = useState<MobileState>({ mobile: form.mobile, requestId: null, verifiedAt: null });
  const [duplicate, setDuplicate] = useState<{ type?: string; code?: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bizQuery, setBizQuery] = useState('');
  const set = <K extends keyof ReferralForm>(key: K, value: ReferralForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const errors = referralErrors(form);
  const err = (k: string) => (showErrors && errors.includes(k) ? t('reg.err.required') : undefined);
  const businesses = useQuery({
    queryKey: ['businesses', 'search', bizQuery],
    queryFn: () => api.get<BusinessHit[]>('/screens/call-registration/businesses', { query: { q: bizQuery } }),
    enabled: form.type === 'business' && !form.business && bizQuery.trim().length >= 2,
  });

  const save = useMutation({
    mutationFn: () => api.post<{ id: string; code: string; registrationLinkSent?: boolean }>('/referrals', referralBody({ ...form, mobile: mobile.mobile }, mobile.requestId!)),
    onSuccess: (r) => {
      draft.clear();
      toast.success(t('reg.ref.savedToast', { code: r.code }));
      navigate(`${to('CA15b-ReferralSaved')}?id=${encodeURIComponent(r.id)}&new=1`);
    },
    onError: (e) => {
      const code = errorDetail(e, 'existingReferralCode');
      if (typeof code === 'string') {
        setDuplicate({ type: 'referral', code });
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
        <TopBar title={t('screen.CA15-RegisterReferral')} />
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

  return (
    <div className="reg">
      <TopBar title={t('screen.CA15-RegisterReferral')} subtitle={t('reg.ref.subtitle')} />
      <DraftNote restored={draft.restored} onDiscard={() => {
        draft.discard();
        setMobile({ mobile: '', requestId: null, verifiedAt: null });
      }} />
      <Card className="reg-form">
        <RequiredNote />
        <fieldset className="sec">
          <SectionHead n={1} title={t('reg.ref.partner')} />
          <div className="fg">
            <TextField label={t('reg.js.fullName')} required value={form.name} onChange={(v) => set('name', v)} error={err('name')} />
            <VerifiedMobile
              purpose="referral"
              value={mobile}
              onChange={(next) => {
                setMobile(next);
                set('mobile', next.mobile);
              }}
              onAlreadyRegistered={(record) => setDuplicate(record)}
            />
            {mobile.requestId && <WhatsAppField same={form.whatsappSame} onSame={(v) => set('whatsappSame', v)} value={form.whatsapp} onChange={(v) => set('whatsapp', v)} required />}
            <SelectField label={t('reg.messageLanguage')} required value={form.language} onChange={(v) => set('language', v)} options={choiceOptions(t, MESSAGE_LANGUAGES)} error={err('language')} />
          </div>
          <div className="fld" role="radiogroup" aria-label={t('reg.ref.partnerIs')}>
            <span className="reg-label">{t('reg.ref.partnerIs')}</span>
            <div className="chk">
              {(['individual', 'business'] as const).map((type) => (
                <label key={type} className={form.type === type ? 'on' : ''}>
                  <input type="radio" name="partner-type" checked={form.type === type} onChange={() => set('type', type)} /> {t(`reg.ref.type.${type}`)}
                </label>
              ))}
            </div>
          </div>
          <div className="fg">
            {form.type === 'individual' ? (
              <SelectField label={t('reg.ref.whatTheyDo')} required value={form.individualRole} onChange={(v) => set('individualRole', v)} options={choiceOptions(t, INDIVIDUAL_ROLES)} error={err('individualRole')} />
            ) : form.business ? (
              <div className="fld">
                <span className="reg-label">{t('reg.ref.registeredBusiness')}</span>
                <span className="reg-chip">
                  {form.business.name} · {form.business.code}
                  <button type="button" aria-label={t('reg.chip.remove', { item: form.business.name })} onClick={() => set('business', null)}>
                    ×
                  </button>
                </span>
              </div>
            ) : (
              <>
                <div className="fld reg-full">
                  <TextField label={t('reg.ref.searchBusiness')} value={bizQuery} onChange={setBizQuery} placeholder={t('reg.vac.businessSearch')} />
                  {businesses.data && businesses.data.length > 0 && (
                    <div className="reg-results" role="list">
                      {businesses.data.map((b) => (
                        <button type="button" role="listitem" key={b.id} onClick={() => set('business', b)}>
                          <strong>{b.name}</strong> · {b.code}
                          {b.locality ? ` · ${b.locality}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="sub">{t('reg.ref.orType')}</span>
                </div>
                <TextField label={t('reg.ref.businessName')} required value={form.partnerBusinessName} onChange={(v) => set('partnerBusinessName', v)} error={err('business')} />
                <SelectField label={t('reg.biz.type')} required value={form.partnerBusinessType} onChange={(v) => set('partnerBusinessType', v)} options={choiceOptions(t, BUSINESS_TYPES)} error={err('business')} />
              </>
            )}
          </div>
        </fieldset>

        <fieldset className="sec">
          <SectionHead n={2} title={t('reg.ref.location')} />
          <div className="fg">
            <PlaceFields value={form.place} onChange={(p) => set('place', p)} pinRequired={false} errors={{ area: err('area'), pincode: err('pincode') }} />
            <SelectField label={t('reg.heardFrom')} required value={form.heardFrom} onChange={(v) => set('heardFrom', v)} options={choiceOptions(t, HEARD_FROM)} error={err('heardFrom')} />
          </div>
        </fieldset>

        <ExplainScript n={3} title={t('reg.ref.explain')} scripts={scriptTerms ? referralScript(scriptTerms) : null} language={form.language} note={t('reg.ref.explainNote')} />

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
            {t('reg.ref.save')}
          </Button>
          {!mobile.requestId && <span className="sub">{t('reg.js.saveLocked')}</span>}
        </div>
      </Card>
    </div>
  );
}
