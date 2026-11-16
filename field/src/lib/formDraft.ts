import { useCallback, useState } from 'react';

/**
 * What the agent typed on a form, kept in memory while he moves around the
 * app (Laboura Field redesign: "a back arrow on every inner screen that never
 * loses what was typed"). Going back from a form and opening it again, or
 * leaving a job for later and coming back, finds the same values. Memory
 * only, never written to the phone (the guide: the app keeps nothing on the
 * phone except forms waiting to send); cleared once the form is saved.
 */
const drafts = new Map<string, unknown>();

export function readFormDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined;
}

export function clearFormDraft(key: string): void {
  drafts.delete(key);
}

/** Only for tests. */
export function clearAllFormDrafts(): void {
  drafts.clear();
}

/**
 * Like useState, but the value outlives the screen: `key` names the form and
 * the record it is for (e.g. `fa07:<visitId>`). Returns [value, set, clear].
 */
export function useFormDraft<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    if (drafts.has(key)) return drafts.get(key) as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        drafts.set(key, v);
        return v;
      });
    },
    [key],
  );
  const clear = useCallback(() => drafts.delete(key), [key]);
  return [value, set, clear] as const;
}
