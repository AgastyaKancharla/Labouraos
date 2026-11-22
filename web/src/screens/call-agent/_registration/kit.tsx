import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PinMap } from '../../../components/PinMap';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { Button, ButtonLink } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { Skeleton } from '../../../components/Skeleton';
import { MobileField, OtpVerification, PincodeField, SelectField, TextField, useStaffOtp } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatDateIST, formatTimeIST } from '../../../lib/format/date';
import { formatMobile } from '../../../lib/format/phone';
import { useClock } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { lookupRecord, useFormOptions, type ExistingRecord, type StepState } from './api';
import type { Choice } from './options';
import { DEFAULT_AREA_AUTO_FILL_MAX_METERS, distanceText, nearestArea } from './nearestArea';
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

/** "Explain … — read this to them" (English only, rev 193). */
export function ExplainScript({
  n,
  title,
  script,
  note,
}: {
  n: number;
  title: ReactNode;
  /** null while the Settings values are loading. */
  script: string | null;
  note: ReactNode;
}) {
  return (
    <fieldset className="sec">
      <SectionHead n={n} title={title} />
      {script ? <div className="script">{script}</div> : <Skeleton height={96} />}
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
  areaFromPin = false,
}: {
  value: PlaceState;
  onChange: (next: PlaceState) => void;
  pinRequired?: boolean;
  errors?: { area?: string; pincode?: string; pin?: string };
  /**
   * Businesses (guide, 14 Nov): setting the map pin fills in the nearest area
   * whose centre is within the Settings distance (1 km); with none that close
   * the agent must pick one, and the picker says so.
   */
  areaFromPin?: boolean;
}) {
  const t = useT();
  const options = useFormOptions();
  const [pinOpen, setPinOpen] = useState(false);
  const [pinText, setPinText] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  // 21 Nov (rev 204): what the typed address, Google Maps link or coordinates point at, to confirm on the map.
  const [found, setFound] = useState<LocatedPin | null>(null);
  const [finding, setFinding] = useState(false);
  // The area name the pin filled in, so a later pin can replace it (never one the agent picked).
  const [autoArea, setAutoArea] = useState<string | null>(null);
  const areas = options.data?.areas ?? [];
  const maxMeters = options.data?.areaAutoFillMaxMeters ?? DEFAULT_AREA_AUTO_FILL_MAX_METERS;
  const city = value.pincode.length === 6 && /^560(\d{3})$/.test(value.pincode) && Number(value.pincode) <= 560300 ? options.data?.city ?? 'Bengaluru' : null;
  const hasPin = value.latitude !== null && value.longitude !== null;
  const near = areaFromPin && hasPin ? nearestArea(areas, { latitude: value.latitude!, longitude: value.longitude! }, maxMeters) : null;
  const noneNear = areaFromPin && hasPin && areas.length > 0 && !near;
  const areaHint = !areaFromPin
    ? undefined
    : autoArea && value.area === autoArea
      ? t('reg.area.fromPin', { distance: distanceText(maxMeters) })
      : noneNear && !value.area
        ? t('reg.area.noneNear', { distance: distanceText(maxMeters) })
        : undefined;
  const placePin = (pin: { latitude: number; longitude: number }, lookedUpPincode?: string | null) => {
    // The lookup's PIN code fills an empty one only; a PIN code already typed stays.
    const base = lookedUpPincode && !value.pincode ? { ...value, pincode: lookedUpPincode } : value;
    if (!areaFromPin) return onChange({ ...base, ...pin });
    const near = nearestArea(areas, pin, maxMeters);
    const picked = value.area && value.area !== autoArea;
    if (picked) return onChange({ ...base, ...pin });
    setAutoArea(near?.name ?? null);
    onChange({ ...base, ...pin, area: near?.name ?? '', pincode: base.pincode || near?.pincode || '' });
  };
  const findPin = async () => {
    const text = pinText.trim();
    setPinError(null);
    setFound(null);
    if (!text) {
      setPinError(t('reg.pin.empty'));
      return;
    }
    setFinding(true);
    try {
      setFound(await locatePin(text));
    } catch (e) {
      // Offline or the lookup is down: plain coordinates still work, as before.
      const local = parseLatLng(text);
      if (local && (!isApiError(e) || e.isNetworkError || e.status >= 500 || e.status === 429)) {
        setFound({ ...local, source: 'coordinates', placeName: null, matched: null, address: null, shortLink: false });
      } else {
        setPinError(isApiError(e) && !e.isNetworkError ? e.message : t('reg.pin.invalid'));
      }
    } finally {
      setFinding(false);
    }
  };
  return (
    <>
      <SelectField
        label={t('reg.area.label')}
        required
        value={value.area}
        onChange={(area) => {
          const found = areas.find((a) => a.name === area);
          setAutoArea(null);
          // A business keeps its own map pin; other forms start the pin at the area's centre.
          const keepPin = areaFromPin && hasPin;
          onChange({
            area,
            pincode: value.pincode || found?.pincode || '',
            latitude: found && !keepPin ? found.latitude : value.latitude,
            longitude: found && !keepPin ? found.longitude : value.longitude,
          });
        }}
        options={areas.map((a) => ({ value: a.name, label: a.name }))}
        placeholder={options.isLoading ? t('common.loading') : t('reg.area.choose')}
        hint={areaHint}
        error={errors?.area ? (noneNear ? t('reg.area.noneNear', { distance: distanceText(maxMeters) }) : errors.area) : undefined}
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
            setFound(null);
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
        width={560}
        footer={
          <>
            <Button onClick={() => setPinOpen(false)}>{t('common.cancel')}</Button>
            {found ? (
              <>
                <Button onClick={() => setFound(null)}>{t('reg.pin.searchAgain')}</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    placePin({ latitude: found.latitude, longitude: found.longitude }, found.address?.pincode ?? null);
                    setPinOpen(false);
                  }}
                >
                  {t('reg.pin.useThis')}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => void findPin()} loading={finding}>
                {t('reg.pin.find')}
              </Button>
            )}
          </>
        }
      >
        <p className="muted">{t('reg.pin.helpAny')}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void findPin();
          }}
        >
          <TextField
            label={t('reg.pin.findLabel')}
            value={pinText}
            onChange={(v) => {
              setPinText(v);
              setFound(null);
              setPinError(null);
            }}
            error={pinError ?? undefined}
            placeholder={t('reg.pin.findPlaceholder')}
            autoComplete="off"
          />
        </form>
        {found && (
          <div className="lb-pin-confirm" data-testid="pin-confirm">
            <PinMap latitude={found.latitude} longitude={found.longitude} label={t('reg.pin.mapLabel')} />
            <strong>{t('reg.pin.isRight')}</strong>
            <span className="sub">
              {found.matched ?? found.placeName ?? t('reg.pin.at', { lat: found.latitude.toFixed(5), lng: found.longitude.toFixed(5) })}
            </span>
            <span className="sub">
              {t(found.source === 'address' ? 'reg.pin.fromAddress' : found.source === 'link' ? 'reg.pin.fromLink' : 'reg.pin.fromCoords', {
                lat: found.latitude.toFixed(5),
                lng: found.longitude.toFixed(5),
              })}
            </span>
          </div>
        )}
      </Modal>
    </>
  );
}

/** What POST /maps-link/locate answers (21 Nov, rev 204). */
export interface LocatedPin {
  latitude: number;
  longitude: number;
  source: 'coordinates' | 'link' | 'address';
  placeName: string | null;
  matched: string | null;
  address: {
    pincode: string | null;
    area: string | null;
    city: string | null;
    displayName: string | null;
    /** 22 Nov: the road (and neighbourhood), the house number and the area in words. */
    street?: string | null;
    shopNumber?: string | null;
    locality?: string | null;
  } | null;
  shortLink: boolean;
}

/**
 * The one reader for every map pin (rev 204): a typed address (OpenStreetMap,
 * Bengaluru first), any Google Maps link (short links opened on the server)
 * or coordinates.
 */
export function locatePin(text: string): Promise<LocatedPin> {
  return api.post<LocatedPin>('/maps-link/locate', { text });
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

/** What "Yes, fill the address" hands the form (22 Nov). */
export interface AddressFill {
  street: string | null;
  place: PlaceState;
  filled: string[];
}

/**
 * The address step in the consoles (Master Guide rev 208, 22 Nov): the call
 * agent is not at the shop, so he types the address or pastes the Google Maps
 * link the owner shared (the server tries shorter and shorter queries, and
 * Google Places when its key is set), checks the pin and the address in words
 * on a small map, and "Yes, fill the address" fills the street, area, PIN code
 * and pin. He then adds the shop number, floor or street himself.
 */
export function AddressFinder({ value, onUse }: { value: PlaceState; onUse: (fill: AddressFill) => void }) {
  const t = useT();
  const options = useFormOptions();
  const [text, setText] = useState('');
  const [found, setFound] = useState<LocatedPin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const areas = options.data?.areas ?? [];
  const maxMeters = options.data?.areaAutoFillMaxMeters ?? DEFAULT_AREA_AUTO_FILL_MAX_METERS;
  const find = async () => {
    setError(null);
    setFound(null);
    setNote(null);
    if (!text.trim()) return setError(t('reg.addr.empty'));
    setBusy(true);
    try {
      setFound(await locatePin(text.trim()));
    } catch (e) {
      setError(isApiError(e) && !e.isNetworkError ? e.message : t('reg.pin.invalid'));
    } finally {
      setBusy(false);
    }
  };
  const use = (pin: LocatedPin) => {
    const a = pin.address;
    const words = [a?.area, a?.locality].filter((x): x is string => Boolean(x)).map((x) => x.toLowerCase());
    const listed =
      areas.find((x) => words.some((w) => w === x.name.toLowerCase())) ??
      areas.find((x) => words.some((w) => w.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(w))) ??
      nearestArea(areas, pin, maxMeters);
    const filled: string[] = [];
    if (a?.street) filled.push(t('reg.biz.street'));
    if (listed) filled.push(t('reg.area.label'));
    if (a?.pincode || listed?.pincode) filled.push(t('form.pincode.label'));
    filled.push(t('reg.pin.label'));
    onUse({
      street: a?.street ?? null,
      place: { area: listed?.name ?? value.area, pincode: a?.pincode ?? listed?.pincode ?? value.pincode, latitude: pin.latitude, longitude: pin.longitude },
      filled,
    });
    setNote(t('reg.addr.filled', { fields: filled.join(', ') }));
    setFound(null);
  };
  return (
    <div className="fld reg-addr-finder" data-testid="address-finder">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <TextField
          label={t('reg.addr.findLabel')}
          value={text}
          onChange={(v) => {
            setText(v);
            setFound(null);
            setError(null);
          }}
          error={error ?? undefined}
          placeholder={t('reg.pin.findPlaceholder')}
          autoComplete="off"
        />
      </form>
      {found ? (
        <div className="lb-pin-confirm" data-testid="address-preview">
          <PinMap latitude={found.latitude} longitude={found.longitude} label={t('reg.pin.mapLabel')} />
          <strong>{t('reg.addr.check')}</strong>
          <span className="sub" data-testid="address-words">
            {found.matched ?? found.address?.displayName ?? found.placeName ?? t('reg.pin.at', { lat: found.latitude.toFixed(5), lng: found.longitude.toFixed(5) })}
          </span>
          <div className="reg-row">
            <Button onClick={() => setFound(null)}>{t('reg.addr.again')}</Button>
            <Button variant="primary" onClick={() => use(found)}>
              {t('reg.addr.use')}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => void find()} loading={busy}>
          📍 {busy ? t('reg.addr.finding') : t('reg.addr.find')}
        </Button>
      )}
      {note ? (
        <span className="sub" role="status" data-testid="address-filled">
          {note}
        </span>
      ) : null}
    </div>
  );
}
