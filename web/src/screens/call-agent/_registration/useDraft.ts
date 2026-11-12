import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../auth/AuthProvider';

/**
 * Drafts save automatically, so a dropped call loses nothing (guide, Forms).
 *
 * Kept in localStorage, per signed-in staff member and form, so a draft
 * survives a dropped call, a reload, going to another screen and back, and
 * closing the tab or the browser (owner request, 12 Nov). It is cleared when
 * the form is submitted or discarded. Never saved: OTP codes and OTP request
 * ids — any field whose name mentions an OTP is stripped before saving, and
 * the number is checked again on the call back. Drafts saved in the tab by
 * the earlier version (sessionStorage) are still picked up once and moved.
 */
const PREFIX = 'laboura.draft.';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The tab-only store the earlier version used; read once so no draft is lost on the update. */
function legacyStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Field names that hold an OTP code or OTP request id: never written to
 * storage (otp, otpCode, otpRequestId, mobileOtp, mobile_otp, OTP, code,
 * verificationCode). Case-sensitive so a word like "notPresent" is left alone.
 */
const OTP_FIELD = /^otp|Otp|OTP|_otp|^code$|^verificationCode$/;

/** A copy of the draft without any OTP field, at any depth. */
export function withoutOtp<T>(value: T, depth = 0): T {
  if (Array.isArray(value)) return value.map((item) => withoutOtp(item, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // A bare "code" is only an OTP at the top of the form; nested ones are record codes (RF-0012).
      if (OTP_FIELD.test(key) && (key !== 'code' || depth === 0)) continue;
      out[key] = withoutOtp(item, depth + 1);
    }
    return out as T;
  }
  return value;
}

export function draftKey(form: string, staffId: string | undefined): string {
  return `${PREFIX}${form}.${staffId ?? 'anon'}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key) ?? legacyStorage()?.getItem(key);
    return raw ? withoutOtp(JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown) {
  try {
    storage()?.setItem(key, JSON.stringify(withoutOtp(value)));
    legacyStorage()?.removeItem(key);
  } catch {
    /* storage full or blocked: the form still works */
  }
}

export function clearDraft(key: string) {
  for (const store of [storage(), legacyStorage()]) {
    try {
      store?.removeItem(key);
    } catch {
      /* storage unavailable: nothing to clear */
    }
  }
}

/**
 * `useDraft('job-seeker', empty)` → `[value, setValue, { restored, discard, clear }]`.
 * Saving is debounced by 400 ms; `clear()` after a successful save.
 */
export function useDraft<T extends object>(form: string, empty: T, opts: { disabled?: boolean } = {}) {
  const { session } = useAuth();
  const key = draftKey(form, session?.staff.id);
  const [restored, setRestored] = useState(false);
  const [value, setValue] = useState<T>(() => {
    if (opts.disabled) return empty;
    const saved = readDraft<T>(key);
    return saved ? { ...empty, ...saved } : empty;
  });
  const firstRender = useRef(true);
  const disabled = Boolean(opts.disabled);

  useEffect(() => {
    if (disabled) return;
    if (readDraft(key)) setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  useEffect(() => {
    if (disabled) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(() => writeDraft(key, value), 400);
    return () => clearTimeout(id);
  }, [value, key, disabled]);

  return [
    value,
    setValue,
    {
      restored,
      discard: () => {
        clearDraft(key);
        setRestored(false);
        setValue(empty);
      },
      clear: () => {
        clearDraft(key);
        setRestored(false);
      },
    },
  ] as const;
}
