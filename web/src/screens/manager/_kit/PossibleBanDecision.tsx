import { api } from '../../../lib/api/client';
import { ActionButton } from '../../ceo/_kit/actions';

/** The review item's kind: an ID card (voter ID, licence or PAN) matched a banned person's on type, last 4 and name. */
export const POSSIBLE_BAN_KIND = 'possible_banned_person';

/** Words for the "What happened" cell: which profile matched which ban, and on what. */
export function possibleBanWords(details: unknown): string {
  const d = (details && typeof details === 'object' ? details : {}) as Record<string, unknown>;
  const id = typeof d.idType === 'string' ? d.idType.replace(/_/g, ' ') : 'ID card';
  const who = typeof d.subjectCode === 'string' ? d.subjectCode : 'This person';
  const banned = typeof d.bannedCode === 'string' ? ` banned ${d.bannedCode}` : ' a banned person';
  return `${who}'s ${id} matches${banned} (type, last 4 and name). Their ID check and fee wait for your decision.`;
}

/**
 * Rev 181 (H2): the two decisions on a "possibly the same person as a banned person" item, for a
 * Manager or the CEO. Confirm covers the profile under the ban; "Not the same person" clears the
 * item. Both need a reason and are audited. Until one is chosen the person sees only "under review".
 */
export function PossibleBanDecision({ flagId }: { flagId: string }) {
  return (
    <>
      <ActionButton
        label="Confirm — same person"
        variant="danger"
        title="Confirm: the same person as the banned person"
        description="Their profile is placed under the same permanent ban. This is recorded in the audit log."
        reason={{ label: 'Why you are sure', required: true }}
        run={({ reason }) => api.post(`/permanent-bans/possible-matches/${flagId}/confirm`, { reason })}
        success="Covered by the ban"
        confirmLabel="Confirm — same person"
      />
      <ActionButton
        label="Not the same person"
        variant="success"
        title="Not the same person"
        description="The item is cleared and their ID check and fee go ahead. This is recorded in the audit log."
        reason={{ label: 'Why they are a different person', required: true }}
        run={({ reason }) => api.post(`/permanent-bans/possible-matches/${flagId}/not-same`, { reason })}
        success="Cleared"
        confirmLabel="Not the same person"
      />
    </>
  );
}
