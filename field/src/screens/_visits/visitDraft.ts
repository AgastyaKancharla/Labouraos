import { useSyncExternalStore } from 'react';
import { readFormDraft, registerDraftStore, subscribeDraftsHydrated, writeFormDraft } from '@/lib/formDraft';

/**
 * The visit in progress while the agent walks through FA20 → FA21 → FA22 → FA07.
 * Kept on the phone too (21 Nov: drafts are kept on the phone), under the
 * signed-in agent, so a reload mid-visit keeps what he typed (shop name, who he
 * spoke to); the screens also read the visit back from the server.
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

/** 21 Nov: the visit in progress is also kept on the phone (with the form drafts), so a reload keeps the shop name. */
const storedKey = (id: string) => `visit:${id}`;

export function saveDraft(draft: VisitDraft): void {
  drafts.set(draft.id, draft);
  writeFormDraft(storedKey(draft.id), draft);
  emit();
}

export function updateDraft(id: string, patch: Partial<VisitDraft>): void {
  const current = getDraft(id);
  if (!current) return;
  saveDraft({ ...current, ...patch });
}

export function getDraft(id: string | undefined): VisitDraft | null {
  if (!id) return null;
  return drafts.get(id) ?? readFormDraft<VisitDraft>(storedKey(id)) ?? null;
}

export function clearDrafts(): void {
  drafts.clear();
  emit();
}
// Log out (or another agent signing in) empties the visits in progress too (fix list A6).
registerDraftStore(clearDrafts);
// Visits read back from the phone after a restart show up in the open screens.
subscribeDraftsHydrated(emit);

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
