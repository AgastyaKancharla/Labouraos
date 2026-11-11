import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { MobileField, OtpVerification, PincodeField, SelectField, TextField, useStaffOtp } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatDateIST, formatTimeIST } from '../../../lib/format/date';
import { formatMobile } from '../../../lib/format/phone';
import { useClock } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { lookupRecord, useFormOptions, type ExistingRecord, type StepState } from './api';
import { SCRIPT_LANGUAGE_LABELS, type ScriptLanguage } from './scripts';
import type { Choice } from './options';
import './registration.css';

type OtpPurpose = Parameters<typeof useStaffOtp>[0] | 'branch_contact';

export function SectionHead({ n, title, aside }: { n?: number | string; title: ReactNode; aside?: ReactNode }) {
  return (
    <legend className="sech">
      {n !== undefined && (
        <span className="n" aria-hidden="true">
          {n}
        </span>
      )}
      {title}
      {aside && <span className="sub">· {aside}</span>}
    </legend>
  );
}

const ICON: Record<StepState, { cls: string; glyph: string; label: MessageKey }> = {
  done: { cls: 'g', glyph: '✓', label: 'reg.step.done' },
  confirming: { cls: 'a', glyph: '…', label: 'reg.step.confirming' },
  in_progress: { cls: 'a', glyph: '…', label: 'reg.step.waiting' },
  stuck: { cls: 'r', glyph: '✗', label: 'reg.step.stuck' },
  not_started: { cls: 'n', glyph: '–', label: 'reg.step.notStarted' },
};

/** One row of the status panel: ✓ done · … sent, waiting · ✗ stuck · – not started. */
export function StepRow({ state, title, detail, action }: { state: StepState; title: ReactNode; detail?: ReactNode; action?: ReactNode }) {
  const t = useT();
  const icon = ICON[state];
  return (
    <li className="st">
      <span className={`ic ${icon.cls}`} aria-hidden="true">
        {icon.glyph}
      </span>
      <span>
        <strong>
          {title}
          <span className="sr-only"> — {t(icon.label)}</span>
        </strong>
        {detail && <span className="sub">{detail}</span>}
      </span>
      {action}
    </li>
  );
}

export function StepLegend() {
  const t = useT();
  return <span className="sub">{t('reg.step.legend')}</span>;
}

/** "Explain … — read this to them", with ಕನ್ನಡ / हिंदी / English tabs. */
export function ExplainScript({
  n,
  title,
  scripts,
  language,
  note,
}: {
  n: number;
  title: ReactNode;
  scripts: Record<ScriptLanguage, string>;
  language: string;
  note: ReactNode;
}) {
  const t = useT();
  const initial: ScriptLanguage = language === 'hi' || language === 'en' ? language : 'kn';
  const [lang, setLang] = useState<ScriptLanguage>(initial);
  useEffect(() => setLang(initial), [initial]);
  return (
    <fieldset className="sec">
      <SectionHead n={n} title={title} aside={t('reg.script.inTheirLanguage')} />
      <div className="reg-tabs" role="group" aria-label={t('reg.script.language')}>
        {(['kn', 'hi', 'en'] as const).map((l) => (
          <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} lang={l}>
            {SCRIPT_LANGUAGE_LABELS[l]}
          </button>
        ))}
      </div>
      <div className="script" lang={lang}>
        {scripts[lang]}
      </div>
      <span className="sub">{note}</span>
    </fieldset>
  );
}

export interface MobileState {
  mobile: string;
  requestId: string | null;
  verifiedAt: string | null;
}

/**
 * Mobile + Send OTP → Verify (CA08 → CA08v). Once verified the number is
 * read-only with "✓ Verified" and "Change number (needs a new OTP)".
 */
export function VerifiedMobile({
  purpose,
  value,
  onChange,
  onAlreadyRegistered,
  label,
  error,
}: {
  purpose: OtpPurpose;
  value: MobileState;
  onChange: (next: MobileState) => void;
  onAlreadyRegistered?: (record: { type?: string; code?: string }) => void;
  label?: ReactNode;
  error?: ReactNode;
}) {
  const t = useT();
  const clock = useClock();
  const otp = useStaffOtp(purpose as Parameters<typeof useStaffOtp>[0]);
  if (value.requestId) {
    return (
      <div className="fld lb-field reg-full">
        <span className="lb-field__labelrow">
          <span className="reg-label">
            {label ?? t('form.mobile.label')} <span className="req">*</span>
          </span>
        </span>
        <div className="inrow">
          <input readOnly value={formatMobile(value.mobile)} aria-label={t('form.mobile.label')} />
          <span className="tag tg">✓ {t('reg.mobile.verified')}</span>
        </div>
        <span className="sub">
          {value.verifiedAt ? t('reg.mobile.checkedAt', { time: formatTimeIST(value.verifiedAt) }) : t('form.otp.verified')} ·{' '}
          <button type="button" className="reg-link-btn" onClick={() => onChange({ mobile: value.mobile, requestId: null, verifiedAt: null })}>
            {t('reg.mobile.change')}
          </button>{' '}
          {t('reg.mobile.changeNote')}
        </span>
      </div>
    );
  }
  return (
    <div className="reg-full">
      <MobileField
        label={label}
        value={value.mobile}
        onChange={(mobile) => onChange({ mobile, requestId: null, verifiedAt: null })}
        required
        error={error}
      />
      <OtpVerification
        mobile={value.mobile}
        onSend={otp.send}
        onVerify={otp.verify}
        onVerified={(requestId) => onChange({ mobile: value.mobile, requestId, verifiedAt: clock().toISOString() })}
        onAlreadyRegistered={onAlreadyRegistered}
      />
    </div>
  );
}

/** "WhatsApp number — ☑ Same as mobile", or a second mobile box. */
export function WhatsAppField({
  same,
  onSame,
  value,
  onChange,
  required,
}: {
  same: boolean;
  onSame: (same: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const t = useT();
  return (
    <div className="fld">
      <span className="reg-label">
        {t('reg.whatsapp.label')}
        {required && <span className="req"> *</span>}
      </span>
      <label className={`reg-check${same ? ' on' : ''}`}>
        <input type="checkbox" checked={same} onChange={(e) => onSame(e.target.checked)} /> {t('reg.whatsapp.same')}
      </label>
      {!same && <MobileField label={t('reg.whatsapp.number')} value={value} onChange={onChange} required={required} />}
    </div>
  );
}

export function choiceOptions(t: ReturnType<typeof useT>, list: readonly Choice[]) {
  return list.map((c) => ({ value: c.value, label: t(c.label) }));
}

export interface PlaceState {
  area: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

/** Parses "12.91, 77.61" or a Google Maps link (…@12.91,77.61… / ?q=12.91,77.61). */
export function parseLatLng(text: string): { latitude: number; longitude: number } | null {
  const m = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/**
 * Area (from the list) · Pincode (fills the city) · Map pin. Picking an area
 * fills its usual pincode and starts the pin at the area's centre; "change"
 * takes exact coordinates or a shared maps link.
 */
export function PlaceFields({
  value,
  onChange,
  pinRequired = true,
  errors,
}: {
  value: PlaceState;
  onChange: (next: PlaceState) => void;
  pinRequired?: boolean;
  errors?: { area?: string; pincode?: string; pin?: string };
}) {
  const t = useT();
  const options = useFormOptions();
  const [pinOpen, setPinOpen] = useState(false);
  const [pinText, setPinText] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const areas = options.data?.areas ?? [];
  const city = value.pincode.length === 6 && /^560(\d{3})$/.test(value.pincode) && Number(value.pincode) <= 560300 ? options.data?.city ?? 'Bengaluru' : null;
  const hasPin = value.latitude !== null && value.longitude !== null;
  return (
    <>
      <SelectField
        label={t('reg.area.label')}
        required
        value={value.area}
        onChange={(area) => {
          const found = areas.find((a) => a.name === area);
          onChange({
            area,
            pincode: value.pincode || found?.pincode || '',
            latitude: found ? found.latitude : value.latitude,
            longitude: found ? found.longitude : value.longitude,
          });
        }}
        options={areas.map((a) => ({ value: a.name, label: a.name }))}
        placeholder={options.isLoading ? t('common.loading') : t('reg.area.choose')}
        error={errors?.area}
      />
      <PincodeField
        required
        value={value.pincode}
        onChange={(pincode) => onChange({ ...value, pincode })}
        resolvedLabel={city ?? undefined}
        error={errors?.pincode}
      />
      <div className="fld">
        <span className="reg-label">
          {t('reg.pin.label')}
          {pinRequired ? <span className="req"> *</span> : <span className="sub"> ({t('common.optional')})</span>}
        </span>
        <Button
          onClick={() => {
            setPinText(hasPin ? `${value.latitude}, ${value.longitude}` : '');
            setPinError(null);
            setPinOpen(true);
          }}
        >
          📍 {hasPin ? t('reg.pin.setChange') : pinRequired ? t('reg.pin.set') : t('reg.pin.setOptional')}
        </Button>
        {hasPin && <span className="sub">{t('reg.pin.at', { lat: value.latitude!.toFixed(4), lng: value.longitude!.toFixed(4) })}</span>}
        {errors?.pin && (
          <span className="vno" role="alert">
            {errors.pin}
          </span>
        )}
      </div>
      <Modal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        title={t('reg.pin.title')}
        footer={
          <>
            <Button onClick={() => setPinOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const parsed = parseLatLng(pinText);
                if (!parsed) {
                  setPinError(t('reg.pin.invalid'));
                  return;
                }
                onChange({ ...value, ...parsed });
                setPinOpen(false);
              }}
            >
              {t('reg.pin.use')}
            </Button>
          </>
        }
      >
        <p className="muted">{t('reg.pin.help')}</p>
        <TextField label={t('reg.pin.coords')} value={pinText} onChange={setPinText} error={pinError ?? undefined} placeholder="12.9166, 77.6101" />
      </Modal>
    </>
  );
}

/** Chips with × and a "+ Add" picker (preferred areas, spoken languages, extras…). */
export function ChipPicker({
  label,
  values,
  options,
  onChange,
  addLabel,
  required,
  max,
  error,
}: {
  label: ReactNode;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
  addLabel: string;
  required?: boolean;
  max?: number;
  error?: ReactNode;
}) {
  const t = useT();
  const remaining = options.filter((o) => !values.includes(o.value));
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="fld" role="group" aria-label={typeof label === 'string' ? label : undefined}>
      <span className="reg-label">
        {label}
        {required && <span className="req"> *</span>}
      </span>
      <div className="chk">
        {values.map((v) => (
          <span key={v} className="reg-chip">
            {labelOf(v)}
            <button type="button" aria-label={t('reg.chip.remove', { item: labelOf(v) })} onClick={() => onChange(values.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
        {remaining.length > 0 && (max === undefined || values.length < max) && (
          <span className="reg-chip-add">
            <select
              aria-label={addLabel}
              value=""
              onChange={(e) => {
                if (e.target.value) onChange([...values, e.target.value]);
              }}
            >
              <option value="">+ {addLabel}</option>
              {remaining.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>
      {error && (
        <span className="vno" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Where "Already registered — open it" goes for each kind of record. */
export function useRecordPath() {
  const to = useScreenPath();
  return (type: string | undefined, code: string, id?: string) => {
    if (type === 'business') return `${to('CA13b-BusinessSaved')}?id=${encodeURIComponent(id ?? code)}`;
    if (type === 'referral') return `${to('CA15b-ReferralSaved')}?id=${encodeURIComponent(id ?? code)}`;
    return to('CA08c-InProgress', { id: id ?? code });
  };
}

/** CA08x: "This number is already registered" with the record it belongs to. */
export function AlreadyRegistered({
  record,
  what,
  onUseDifferent,
}: {
  record: { type?: string; code?: string };
  what: 'number' | 'document';
  onUseDifferent: () => void;
}) {
  const t = useT();
  const pathFor = useRecordPath();
  const found = useQuery({
    queryKey: ['screens-call-registration', 'record', record.code],
    queryFn: () => lookupRecord(record.code!),
    enabled: Boolean(record.code),
    retry: false,
  });
  const r: ExistingRecord | undefined = found.data;
  const typeLabel =
    record.type === 'business' ? t('reg.dup.business') : record.type === 'referral' ? t('reg.dup.referral') : t('reg.dup.jobSeeker');
  return (
    <div className="reg-dup" role="alert">
      <div className="warn">
        <strong>{what === 'number' ? t('reg.dup.title') : t('reg.dup.titleDocument')}</strong>
        {record.code ? (
          <>
            {' · '}
            {t('reg.dup.belongsTo', { type: typeLabel })} <strong>{r ? `${r.name} · ${r.code}` : record.code}</strong>
            {r && (
              <>
                {' '}
                ({r.registeredBy
                  ? t('reg.dup.registeredBy', { date: formatDateIST(r.registeredAt), name: r.registeredBy })
                  : t('reg.dup.registeredOn', { date: formatDateIST(r.registeredAt) })}
                )
              </>
            )}
          </>
        ) : (
          <> · {t('reg.dup.notVisible')}</>
        )}
      </div>
      <div className="reg-actions" style={{ marginTop: 12 }}>
        {record.code && (
          <ButtonLink variant="primary" to={pathFor(record.type, record.code, r?.id)}>
            {r ? t('reg.dup.openNamed', { name: r.name.split(/\s+/)[0] }) : t('form.otp.alreadyRegistered')}
          </ButtonLink>
        )}
        <Button onClick={onUseDifferent}>{what === 'number' ? t('reg.dup.useDifferent') : t('reg.dup.edit')}</Button>
      </div>
      <p className="muted">{t('reg.dup.note')}</p>
    </div>
  );
}

/** "Draft restored" note with Discard. */
export function DraftNote({ restored, onDiscard }: { restored: boolean; onDiscard: () => void }) {
  const t = useT();
  if (!restored) return null;
  return (
    <div className="reg-hint reg-draft" role="status">
      <span>{t('reg.draft.restored')}</span>
      <button type="button" className="reg-link-btn danger" onClick={onDiscard}>
        {t('reg.draft.discard')}
      </button>
    </div>
  );
}

export function RequiredNote() {
  const t = useT();
  return (
    <span className="sub">
      <span className="req">*</span> {t('reg.requiredNote')}
    </span>
  );
}
