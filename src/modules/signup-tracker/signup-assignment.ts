/**
 * Who gets a "sign-up help" call task (customer app proposal 4.3, question 12,
 * confirmed 14 Nov). Rules, in order:
 *
 *   1. Existing agent: an agent who registered this person earlier or already
 *      spoke to them gets it, when they are on shift.
 *   2. On shift: only agents who started their day and are not on leave. An
 *      owner account has no attendance (owner decision 14 Nov), so it counts as
 *      on shift while it is signed in.
 *   3. Language: an agent who speaks the person's chosen language.
 *   4. Fair share: the fewest open sign-up tasks; ties go to whoever was given
 *      one least recently (round-robin), then by staff code.
 *
 * Pure, so the order is tested on its own. The database loading is in the
 * service.
 */
export interface AssignmentCandidate {
  id: string;
  code: string;
  /** Has an open attendance day today and is not on a full day of leave. */
  onShift: boolean;
  isOwnerAccount: boolean;
  /** Has a live staff session (used for owner accounts only). */
  signedIn: boolean;
  /** Staff.spokenLanguages as the CEO entered them ("Kannada", "kn", …). */
  spokenLanguages: string[];
  openSignupTasks: number;
  lastSignupAssignedAt: Date | null;
}

export type AssignmentReason = 'existing_agent' | 'language' | 'fair_share' | 'handover';

export interface AssignmentPick {
  staffId: string;
  reason: AssignmentReason;
}

const LANGUAGE_ALIASES: Record<string, string> = {
  kn: 'kn',
  kannada: 'kn',
  'ಕನ್ನಡ': 'kn',
  hi: 'hi',
  hindi: 'hi',
  'हिंदी': 'hi',
  'हिन्दी': 'hi',
  en: 'en',
  english: 'en',
};

/** "Kannada", "kn", "ಕನ್ನಡ" → "kn". Unknown names are kept lower-case so they still compare. */
export function languageCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return LANGUAGE_ALIASES[key] ?? key;
}

export function speaks(candidate: Pick<AssignmentCandidate, 'spokenLanguages'>, language: string | null): boolean {
  const wanted = languageCode(language);
  if (!wanted) return true;
  return candidate.spokenLanguages.some((l) => languageCode(l) === wanted);
}

export function isAvailable(c: Pick<AssignmentCandidate, 'onShift' | 'isOwnerAccount' | 'signedIn'>): boolean {
  return c.isOwnerAccount ? c.signedIn : c.onShift;
}

function fairOrder(a: AssignmentCandidate, b: AssignmentCandidate): number {
  if (a.openSignupTasks !== b.openSignupTasks) return a.openSignupTasks - b.openSignupTasks;
  const at = a.lastSignupAssignedAt?.getTime() ?? 0;
  const bt = b.lastSignupAssignedAt?.getTime() ?? 0;
  if (at !== bt) return at - bt;
  return a.code.localeCompare(b.code);
}

export function pickAgent(input: {
  candidates: AssignmentCandidate[];
  /** Agents who registered or already spoke to this person, most relevant first. */
  existingAgentIds: string[];
  /** The person's chosen language (kn, hi, en). */
  language: string | null;
}): AssignmentPick | null {
  const available = input.candidates.filter(isAvailable);
  for (const id of input.existingAgentIds) {
    if (available.some((c) => c.id === id)) return { staffId: id, reason: 'existing_agent' };
  }
  if (available.length === 0) return null;
  const hadAgent = input.existingAgentIds.length > 0;
  const speakers = available.filter((c) => speaks(c, input.language));
  if (speakers.length > 0 && languageCode(input.language)) {
    const pick = [...speakers].sort(fairOrder)[0];
    return { staffId: pick.id, reason: hadAgent ? 'handover' : 'language' };
  }
  const pick = [...available].sort(fairOrder)[0];
  return { staffId: pick.id, reason: hadAgent ? 'handover' : 'fair_share' };
}
