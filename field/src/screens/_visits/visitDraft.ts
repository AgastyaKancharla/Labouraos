import { useSyncExternalStore } from 'react';

/**
 * The visit in progress, kept in memory only while the agent walks through
 * FA20 → FA21 → FA22 → FA07 (the guide: the app keeps nothing on the phone
 * except forms waiting to send). If the app is closed mid-visit, the screens
 * read the visit back from the server instead.
 */
export interface VisitDraft {
  id: string;
  startedAt: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  shopName: string;
  businessId: string | null;
  businessName: string | null;
  spokeTo: string;
  contactPhone: string;
  endedAt: string | null;
  proofDistance: number | null;
  proofAt: string | null;
}

const drafts = new Map<string, VisitDraft>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const l of listeners) l();
}

export function saveDraft(draft: VisitDraft): void {
  drafts.set(draft.id, draft);
  emit();
}

export function updateDraft(id: string, patch: Partial<VisitDraft>): void {
  const current = drafts.get(id);
  if (!current) return;
  drafts.set(id, { ...current, ...patch });
  emit();
}

export function getDraft(id: string | undefined): VisitDraft | null {
  return id ? (drafts.get(id) ?? null) : null;
}

export function clearDrafts(): void {
  drafts.clear();
  emit();
}

export function useDraft(id: string | undefined): VisitDraft | null {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
  return getDraft(id);
}
