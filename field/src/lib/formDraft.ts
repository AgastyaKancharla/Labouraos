import { useCallback, useEffect, useState } from 'react';
import { secureStorage, type KeyValueStore } from './storage';

/**
 * What the agent typed on a form, kept while he moves around the app
 * (Laboura Field redesign: "a back arrow on every inner screen that never
 * loses what was typed"). Going back from a form and opening it again, or
 * leaving a job for later and coming back, finds the same values; cleared
 * once the form is saved.
 *
 * Kept on the phone (Master Guide rev 202, 21 Nov: "drafts are kept on the
 * phone"): every draft is also written to the phone's storage under the
 * agent's staff id, so closing the app or a dead battery loses nothing. When
 * he signs in again the drafts are read back (`setDraftOwner` starts it; an
 * open form that was not typed in yet picks its draft up when it arrives).
 *
 * Every draft belongs to the signed-in agent (fix list A6, 16 Nov): the key
 * is stored under his staff id, so another agent signing in on the same
 * phone never sees it. Log out clears every draft; when someone else signs
 * in, the last agent's drafts are dropped too. The AuthProvider tells this
 * module who is signed in (`setDraftOwner`) and when he logs out
 * (`clearAllDrafts`).
 */
const drafts = new Map<string, unknown>();

/** Where drafts are kept on the phone (tests swap in a memory store). */
let storage: KeyValueStore = secureStorage;
const STORAGE_PREFIX = 'laboura.field.draft';
/** The staff ids that have drafts on this phone (so Log out can remove them all). */
const OWNERS_KEY = `${STORAGE_PREFIX}.owners`;
/** A draft bigger than this stays in memory only (photos never go in a form draft). */
const MAX_STORED_CHARS = 100_000;
/** Phone storage keys allow only letters, digits, ".", "-" and "_" (expo-secure-store). */
const safe = (part: string) => part.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
const indexKey = (staffId: string) => `${STORAGE_PREFIX}.index.${safe(staffId)}`;
const valueKey = (staffId: string, key: string) => `${STORAGE_PREFIX}.v.${safe(staffId)}.${safe(key)}`;
/** Open forms waiting for the drafts read back from the phone. */
const hydrationListeners = new Set<() => void>();
/** Writes are chained so the index never loses a key to a race. */
let writes: Promise<void> = Promise.resolve();

function chain(work: () => Promise<void>): Promise<void> {
  writes = writes.then(work).catch(() => undefined);
  return writes;
}

async function readList(key: string): Promise<string[]> {
  try {
    const raw = await storage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function persist(staffId: string, key: string, value: unknown): void {
  void chain(async () => {
    let text: string;
    try {
      text = JSON.stringify(value);
    } catch {
      return;
    }
    if (text === undefined || text.length > MAX_STORED_CHARS) return;
    await storage.setItem(valueKey(staffId, key), text);
    const index = await readList(indexKey(staffId));
    if (!index.includes(key)) await storage.setItem(indexKey(staffId), JSON.stringify([...index, key]));
    const owners = await readList(OWNERS_KEY);
    if (!owners.includes(staffId)) await storage.setItem(OWNERS_KEY, JSON.stringify([...owners, staffId]));
  });
}

function unpersist(staffId: string, key: string): void {
  void chain(async () => {
    await storage.removeItem(valueKey(staffId, key));
    const index = await readList(indexKey(staffId));
    if (index.includes(key)) await storage.setItem(indexKey(staffId), JSON.stringify(index.filter((k) => k !== key)));
  });
}

/** Reads the agent's drafts back from the phone into memory (a value typed meanwhile wins). */
function hydrate(staffId: string): Promise<void> {
  return chain(async () => {
    // 21 Nov review: another agent signing in on this phone (even after the app restarted, when
    // memory no longer knows who was here before) never finds the last agent's drafts.
    const owners = await readList(OWNERS_KEY);
    for (const other of owners.filter((o) => o !== staffId)) {
      for (const key of await readList(indexKey(other))) await storage.removeItem(valueKey(other, key));
      await storage.removeItem(indexKey(other));
    }
    if (owners.some((o) => o !== staffId)) await storage.setItem(OWNERS_KEY, JSON.stringify(owners.filter((o) => o === staffId)));
    const index = await readList(indexKey(staffId));
    for (const key of index) {
      const raw = await storage.getItem(valueKey(staffId, key));
      if (raw === null) continue;
      const full = `${staffId}|${key}`;
      if (drafts.has(full)) continue;
      try {
        drafts.set(full, JSON.parse(raw));
      } catch {
        /* a broken draft is skipped */
      }
    }
  }).then(() => {
    for (const l of [...hydrationListeners]) l();
  });
}

/** Only for tests: where drafts are kept on the phone. */
export function setDraftStorage(next: KeyValueStore): void {
  storage = next;
}

/** Only for tests: waits until every write and read of the phone's storage is done. */
export function draftStorageIdle(): Promise<void> {
  return writes;
}

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
  if (staffId !== null) {
    lastOwner = staffId;
    void hydrate(staffId);
  }
}

/** Only for tests and the AuthProvider: whose drafts are being read. */
export function draftOwner(): string | null {
  return owner;
}

/** Register another in-memory draft store that must be emptied with the form drafts. */
export function registerDraftStore(clear: () => void): void {
  otherDrafts.add(clear);
}

/** Writes a draft for the signed-in agent outside a form hook (the visit in progress): memory and the phone. */
export function writeFormDraft(key: string, value: unknown): void {
  drafts.set(fullKey(key), value);
  if (owner) persist(owner, key, value);
}

/** Called when the agent's drafts have been read back from the phone. */
export function subscribeDraftsHydrated(listener: () => void): () => void {
  hydrationListeners.add(listener);
  return () => {
    hydrationListeners.delete(listener);
  };
}

export function readFormDraft<T>(key: string): T | undefined {
  return drafts.get(fullKey(key)) as T | undefined;
}

export function clearFormDraft(key: string): void {
  drafts.delete(fullKey(key));
  if (owner) unpersist(owner, key);
}

/** Empties every draft of every agent, in memory and on the phone (log out, or another agent signs in). */
export function clearAllDrafts(): void {
  drafts.clear();
  for (const clear of otherDrafts) clear();
  void chain(async () => {
    const owners = await readList(OWNERS_KEY);
    for (const staffId of owners) {
      for (const key of await readList(indexKey(staffId))) await storage.removeItem(valueKey(staffId, key));
      await storage.removeItem(indexKey(staffId));
    }
    await storage.removeItem(OWNERS_KEY);
  });
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
  // `touched`: the form holds a draft or something he typed, so a draft read back later never overwrites it.
  const [state, setState] = useState<{ value: T; touched: boolean }>(() => {
    const k = fullKey(key);
    if (drafts.has(k)) return { value: drafts.get(k) as T, touched: true };
    return { value: typeof initial === 'function' ? (initial as () => T)() : initial, touched: false };
  });
  // A draft read back from the phone after the form opened fills it, unless he typed already.
  useEffect(() => {
    const onHydrated = () => {
      const k = fullKey(key);
      if (!drafts.has(k)) return;
      setState((prev) => (prev.touched ? prev : { value: drafts.get(k) as T, touched: true }));
    };
    hydrationListeners.add(onHydrated);
    onHydrated();
    return () => {
      hydrationListeners.delete(onHydrated);
    };
  }, [key]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev.value) : next;
        drafts.set(fullKey(key), v);
        if (owner) persist(owner, key, v);
        return { value: v, touched: true };
      });
    },
    [key],
  );
  const clear = useCallback(() => clearFormDraft(key), [key]);
  return [state.value, set, clear] as const;
}
