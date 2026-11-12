import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { ActionButton } from '../../ceo/_kit/actions';

export interface CoachingNote {
  id: string;
  kind: 'note' | 'written_warning' | string;
  text: string;
  createdAt: string;
  author: { id: string; name: string; role: string };
}

/** Coaching notes and written warnings (MG-Agent, MG-TL). */
export function NotesList({ notes }: { notes: CoachingNote[] | undefined }) {
  if (notes && !notes.length) return <p className="ceo-sub">No coaching notes yet.</p>;
  return (
    <div className="mg-notes">
      {notes?.map((n) => (
        <div key={n.id}>
          <span className="ceo-sub">{formatDateIST(n.createdAt)}</span>
          <span className="dot" style={{ background: n.kind === 'written_warning' ? 'var(--tomato)' : 'var(--royal)' }} />
          <span style={{ whiteSpace: 'pre-wrap' }}>
            {n.kind === 'written_warning' && <b>Written warning: </b>}
            {n.text}
          </span>
          <span className="ceo-sub">{n.author.name.split(/\s+/)[0]}</span>
        </div>
      ))}
    </div>
  );
}

export function NoteActions({ staffId, name, who }: { staffId: string; name: string; who: string }) {
  return (
    <>
      <ActionButton
        label="Add note"
        title={`Coaching note about ${name}`}
        description={`${who} can see it.`}
        reason={{ label: 'What you agreed', required: true }}
        run={({ reason }) => api.post(`/manager/people/${staffId}/notes`, { kind: 'note', text: reason })}
        success="Note saved"
        confirmLabel="Save note"
      />
      <ActionButton
        label="Give a written warning"
        variant="danger"
        title={`Written warning for ${name}`}
        description={`A written warning is kept on ${name}'s record. ${who} can see it.`}
        reason={{ label: 'What the warning is for', required: true }}
        run={({ reason }) => api.post(`/manager/people/${staffId}/notes`, { kind: 'written_warning', text: reason })}
        success="Written warning recorded"
        confirmLabel="Give the warning"
      />
    </>
  );
}
