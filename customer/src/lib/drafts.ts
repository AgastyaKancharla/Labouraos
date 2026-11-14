import { useEffect, useRef, useState } from 'react';
import { secureStorage, type KeyValueStore } from '@/lib/storage';

/**
 * Registration forms save as the person types (guide: "Drafts save
 * automatically, so a dropped call loses nothing"). Drafts stay on this
 * phone only, in the encrypted store, and are deleted when the form is sent
 * and on sign-out.
 */
export type DraftKind = 'job_seeker' | 'business' | 'referral_partner' | 'vacancy';
const KINDS: DraftKind[] = ['job_seeker', 'business', 'referral_partner', 'vacancy'];
export const draftKey = (kind: DraftKind) => `laboura_draft_${kind}`;

export async function clearDraft(kind: DraftKind, storage: KeyValueStore = secureStorage): Promise<void> {
  await storage.removeItem(draftKey(kind));
}

export async function clearAllDrafts(storage: KeyValueStore = secureStorage): Promise<void> {
  await Promise.all(KINDS.map((k) => storage.removeItem(draftKey(k))));
}

/**
 * `const [form, setForm, ready] = useDraft('job_seeker', initial)` — like
 * useState, but restored from and saved to the phone (debounced 500 ms).
 */
export function useDraft<T extends object>(kind: DraftKind, initial: T, storage: KeyValueStore = secureStorage) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void storage.getItem(draftKey(kind)).then((raw) => {
      if (cancelled) return;
      if (raw) {
        try {
          setValue({ ...initial, ...(JSON.parse(raw) as Partial<T>) });
        } catch {
          /* corrupt draft: start fresh */
        }
      }
      loaded.current = true;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // initial is only the starting shape; reading it once is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, storage]);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => void storage.setItem(draftKey(kind), JSON.stringify(value)), 500);
    return () => clearTimeout(timer);
  }, [kind, storage, value]);

  return [value, setValue, ready] as const;
}
