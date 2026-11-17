import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { Skeleton } from '../../../components/Skeleton';
import { Tabs } from '../../../components/Tabs';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { useRecordsPortal } from './records';

/**
 * "My team" / "Not assigned" and "Assign" on the Team Lead's and the Manager's
 * pipeline lists and profiles (Master Guide rev 194 and rev 196). The section
 * is kept in the address (?section=unassigned) so Back from a profile and the
 * numbers on the Team Lead's home land on the right one. The server decides
 * what is in each section and who may receive an assignment.
 */
export type RecordSection = 'team' | 'unassigned';
export type AssignKind = 'job_seeker' | 'referral' | 'business';

export interface Assignment {
  section: RecordSection;
  assignedTo: { id: string; name: string } | null;
  canAssign: boolean;
}

interface Assignee {
  id: string;
  code: string;
  name: string;
  role: string;
  me: boolean;
  canHoldBusiness: boolean;
}

const ROLE_WORD: Record<string, string> = { call_agent: 'Call agent', field_agent: 'Field agent', team_lead: 'Team Lead', manager: 'Manager' };

/** The list's section from the address; "My team" when none is given. Only used where `sections` is on. */
export function useSection(): [RecordSection, (next: RecordSection) => void] {
  const [params, setParams] = useSearchParams();
  const section: RecordSection = params.get('section') === 'unassigned' ? 'unassigned' : 'team';
  const set = (next: RecordSection) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === 'team') copy.delete('section');
        else copy.set('section', next);
        return copy;
      },
      { replace: true },
    );
  return [section, set];
}

/** The query parameter a list sends: nothing for the CEO, the section for a Team Lead or Manager. */
export function sectionQuery(sections: boolean, section: RecordSection): Record<string, string> {
  return sections ? { section } : {};
}

/** The two sections as tabs above a list. */
export function SectionSwitch({ value, onChange, noun }: { value: RecordSection; onChange: (next: RecordSection) => void; noun: string }) {
  const { teamLead } = useRecordsPortal();
  return (
    <div className="ceo-section-switch" style={{ marginBottom: 12 }}>
      <Tabs<RecordSection>
        label={`Which ${noun}`}
        value={value}
        onChange={onChange}
        items={[
          { key: 'team', label: teamLead ? 'My team' : 'My teams' },
          { key: 'unassigned', label: 'Not assigned' },
        ]}
      />
      <p className="ceo-sub" style={{ margin: '6px 0 0' }}>
        {value === 'team'
          ? teamLead
            ? `${noun[0].toUpperCase()}${noun.slice(1)} you or your agents own.`
            : `${noun[0].toUpperCase()}${noun.slice(1)} owned by someone in your teams.`
          : `${noun[0].toUpperCase()}${noun.slice(1)} nobody owns yet in ${teamLead ? 'your city' : "your teams' cities"}. Assign them to put them to work.`}
      </p>
    </div>
  );
}

/**
 * "Assign" → pick yourself or someone of your team → "Assigned to <name>".
 * Lists and the profile refresh, so the row moves to "My team".
 */
export function AssignButton({ kind, id, name, label = 'Assign', variant = 'secondary' }: { kind: AssignKind; id: string; name: string; label?: ReactNode; variant?: 'primary' | 'secondary' }) {
  const { api: base, teamLead } = useRecordsPortal();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const people = useQuery({ queryKey: [base, 'assignees'], queryFn: () => api.get<{ rows: Assignee[] }>(`${base}/assignees`), enabled: open });
  const rows = (people.data?.rows ?? []).filter((p) => kind !== 'business' || p.canHoldBusiness);
  const save = useMutation({
    mutationFn: (toStaffId: string) => api.post<{ to: { id: string; name: string } }>(`${base}/assign`, { kind, id, toStaffId }),
    onSuccess: (res) => {
      toast.success(`Assigned to ${res.to.name}`);
      setOpen(false);
      setPick('');
      void qc.invalidateQueries({ queryKey: ['ceo'] });
      void qc.invalidateQueries({ queryKey: [base] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not assign. Try again.'),
  });
  const noun = kind === 'job_seeker' ? 'job seeker' : kind === 'referral' ? 'referral partner' : 'business';

  // Inside a clickable table row: the row must not open the profile (React events bubble out of the dialog's portal too).
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
      <Button variant={variant} onClick={() => setOpen(true)} aria-label={`Assign ${name}`}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!save.isPending}
        title={`Assign ${name}`}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => save.mutate(pick)} disabled={!pick} loading={save.isPending}>
              Assign
            </Button>
          </>
        }
      >
        <p className="ceo-sub" style={{ marginTop: 0 }}>
          Who takes this {noun}? {teamLead ? 'Yourself or an agent of your team.' : 'Anyone active in your teams.'}
          {kind === 'business' ? ' A business goes to a field agent.' : ''} They get a notification.
        </p>
        {people.isPending ? (
          <Skeleton height={80} />
        ) : people.isError ? (
          <ErrorState error={people.error} onRetry={() => void people.refetch()} compact />
        ) : (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <legend className="sr-only">Assign to</legend>
            {rows.map((p) => (
              <label key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name={`assign-${id}`} value={p.id} checked={pick === p.id} onChange={() => setPick(p.id)} />
                <span>
                  <b>{p.me ? `${p.name} (you)` : p.name}</b> <span className="ceo-sub">· {ROLE_WORD[p.role] ?? p.role}</span>
                </span>
              </label>
            ))}
            {rows.length === 0 && <p className="ceo-sub">Nobody in your team can take this yet.</p>}
          </fieldset>
        )}
      </Modal>
    </span>
  );
}

/** On a profile: who holds the record and the Assign button (Team Lead and Manager only). */
export function AssignmentLine({ assignment, kind, id, name }: { assignment?: Assignment; kind: AssignKind; id: string; name: string }) {
  if (!assignment) return null;
  const holder = kind === 'business' ? 'Account agent' : 'Assigned to';
  return (
    <div className="ceo-assignment" data-testid="assignment" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="ceo-sub">
        {assignment.section === 'unassigned' ? 'Not assigned yet' : assignment.assignedTo ? `${holder}: ${assignment.assignedTo.name}` : 'Your team’s'}
      </span>
      {assignment.canAssign && <AssignButton kind={kind} id={id} name={name} variant={assignment.section === 'unassigned' ? 'primary' : 'secondary'} label={assignment.section === 'unassigned' ? 'Assign' : 'Move to…'} />}
    </div>
  );
}
