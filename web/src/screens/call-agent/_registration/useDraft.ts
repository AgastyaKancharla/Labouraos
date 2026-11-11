import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../auth/AuthProvider';

/**
 * Drafts save automatically, so a dropped call loses nothing (guide, Forms).
 *
 * Kept in sessionStorage, per signed-in staff member and form: it survives a
 * dropped call, a reload or going to another screen and back, and is gone
 * when the browser closes (which also signs the agent out), so personal data
 * is not left on a shared office computer. OTP request ids are never saved —
 * the number is checked again on the call back.
 */
const PREFIX = 'laboura.draft.';

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function draftKey(form: string, staffId: string | undefined): string {
  return `${PREFIX}${form}.${staffId ?? 'anon'}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    /* storage unavailable: nothing to clear */
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
    const id = setTimeout(() => {
      try {
        storage()?.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full or blocked: the form still works */
      }
    }, 400);
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
