import { useCallback, useState } from 'react';

/**
 * What the agent typed on a form, kept in memory while he moves around the
 * app (Laboura Field redesign: "a back arrow on every inner screen that never
 * loses what was typed"). Going back from a form and opening it again, or
 * leaving a job for later and coming back, finds the same values. Memory
 * only, never written to the phone (the guide: the app keeps nothing on the
 * phone except forms waiting to send); cleared once the form is saved.
 *
 * Every draft belongs to the signed-in agent (fix list A6, 16 Nov): the key
 * is stored under his staff id, so another agent signing in on the same
 * phone never sees it. Log out clears every draft; when someone else signs
 * in, the last agent's drafts are dropped too. The AuthProvider tells this
 * module who is signed in (`setDraftOwner`) and when he logs out
 * (`clearAllDrafts`).
 */
const drafts = new Map<string, unknown>();

/** Other in-memory drafts (the visit in progress) that must go at log out too. */
const otherDrafts = new Set<() => void>();

/** The signed-in agent's staff id, or null while nobody is signed in. */
let owner: string | null = null;
/** The last agent who was signed in (kept after an automatic sign-out so his drafts wait for him). */
let lastOwner: string | null = null;

const fullKey = (key: string) => `${owner ?? '-'}|${key}`;

/**
 * Who is signed in. Called by the AuthProvider on every render, so the
 * screens under it read and write the right agent's drafts. A different
 * agent signing in drops the drafts left from the last one.
 */
export function setDraftOwner(staffId: string | null): void {
  if (staffId === owner) return;
  if (staffId !== null && lastOwner !== null && staffId !== lastOwner) clearAllDrafts();
  owner = staffId;
  if (staffId !== null) lastOwner = staffId;
}

/** Only for tests and the AuthProvider: whose drafts are being read. */
export function draftOwner(): string | null {
  return owner;
}

/** Register another in-memory draft store that must be emptied with the form drafts. */
export function registerDraftStore(clear: () => void): void {
  otherDrafts.add(clear);
}

export function readFormDraft<T>(key: string): T | undefined {
  return drafts.get(fullKey(key)) as T | undefined;
}

export function clearFormDraft(key: string): void {
  drafts.delete(fullKey(key));
}

/** Empties every draft of every agent (log out, or another agent signs in). */
export function clearAllDrafts(): void {
  drafts.clear();
  for (const clear of otherDrafts) clear();
}

/** Only for tests: every form draft gone, nobody signed in. */
export function clearAllFormDrafts(): void {
  drafts.clear();
}

/**
 * Like useState, but the value outlives the screen: `key` names the form and
 * the record it is for (e.g. `fa07:<visitId>`); it is stored under the
 * signed-in agent. Returns [value, set, clear].
 */
export function useFormDraft<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    const k = fullKey(key);
    if (drafts.has(k)) return drafts.get(k) as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        drafts.set(fullKey(key), v);
        return v;
      });
    },
    [key],
  );
  const clear = useCallback(() => drafts.delete(fullKey(key)), [key]);
  return [value, set, clear] as const;
}
