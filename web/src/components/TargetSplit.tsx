import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * The automatic target split (17 Nov), shared by MG-Targets and T-Targets:
 * the small "Automatic" / "Set by hand" tag next to a number, the "Reset"
 * link that puts a hand-set number back to automatic, and the "Transfer
 * target" dialog.
 */

export function SplitTag({ hand }: { hand: boolean }) {
  return <span className={hand ? 'lb-split-tag lb-split-tag--hand' : 'lb-split-tag'}>{hand ? 'Set by hand' : 'Automatic'}</span>;
}

export function ResetLink({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="lb-split-reset" aria-label={label} title="Reset to automatic" onClick={onClick} disabled={disabled}>
      Reset
    </button>
  );
}

export interface TransferPerson {
  id: string;
  name: string;
}

/** "Transfer target": pick who receives what this agent has not reached yet (same work type, in your teams). */
export function TransferDialog({
  from,
  candidates,
  open,
  onClose,
  onConfirm,
  saving,
}: {
  from: TransferPerson | null;
  candidates: TransferPerson[];
  open: boolean;
  onClose: () => void;
  onConfirm: (toStaffId: string) => void;
  saving: boolean;
}) {
  const [to, setTo] = useState('');
  useEffect(() => setTo(''), [from?.id, open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title={from ? `Transfer ${from.name}'s target` : 'Transfer target'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm(to)} disabled={!to} loading={saving}>
            Transfer
          </Button>
        </>
      }
    >
      <p className="lb-split-help">What {from?.name ?? 'this agent'} has not reached yet this month moves to the agent you pick. Both numbers become “Set by hand”.</p>
      {candidates.length ? (
        <label className="lb-split-pick">
          <span>Give it to</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Agent who receives the target">
            <option value="">Pick an agent</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="lb-split-help">No other agent of the same kind in your team to give it to.</p>
      )}
    </Modal>
  );
}
