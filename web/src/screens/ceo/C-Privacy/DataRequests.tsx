import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { StatusPill } from '../../../components/Badge';
import { DateField, SelectField, TextField } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { ActionButton } from '../_kit/actions';

/** One row of the register (GET /data-requests). */
export interface DataRequestRow {
  id: string;
  code: string;
  kind: 'access' | 'correction' | 'erasure';
  subjectType: 'job_seeker' | 'business' | 'referral';
  subjectCode: string;
  details: string | null;
  receivedOn: string;
  dueOn: string;
  daysLeft: number | null;
  overdue: boolean;
  status: 'open' | 'in_progress' | 'closed';
  outcome: 'done' | 'partly_done' | 'refused' | 'withdrawn' | null;
  outcomeNote: string | null;
  loggedBy: { id: string; name: string | null };
  closedBy: { id: string; name: string | null } | null;
  closedAt: string | null;
}
export interface DataRequestList {
  dueDays: number;
  summary: { open: number; overdue: number; closedThisMonth: number };
  rows: DataRequestRow[];
}

export const KIND: Record<DataRequestRow['kind'], string> = {
  access: 'See my data',
  correction: 'Correct my data',
  erasure: 'Delete my data',
};
const SUBJECT: Record<DataRequestRow['subjectType'], string> = { job_seeker: 'Job seeker', business: 'Business', referral: 'Referral partner' };
const OUTCOME: Record<NonNullable<DataRequestRow['outcome']>, string> = {
  done: 'Done',
  partly_done: 'Partly done',
  refused: 'Refused (with reason)',
  withdrawn: 'Withdrawn by the person',
};

/** "In 6 days", "Due today", "3 days late" — the design's Due column. */
export function dueText(row: Pick<DataRequestRow, 'daysLeft' | 'status' | 'closedAt'>): string {
  if (row.status === 'closed') return row.closedAt ? `Closed ${formatDateIST(row.closedAt)}` : 'Closed';
  const d = row.daysLeft ?? 0;
  if (d > 1) return `In ${d} days`;
  if (d === 1) return 'Tomorrow';
  if (d === 0) return 'Due today';
  return `${-d} day${d === -1 ? '' : 's'} late`;
}

export const dataRequestsKey = ['data-requests'] as const;

/**
 * Data requests under India's data law (C-Privacy): every access, correction
 * and erasure request from a job seeker, business or referral partner, with
 * the day it arrived, who logged it, its status, its due date, the outcome
 * and the day it was closed. The CEO logs, handles and closes them here.
 */
export function DataRequestsCard() {
  const list = useQuery({ queryKey: dataRequestsKey, queryFn: () => api.get<DataRequestList>('/data-requests') });
  const [logging, setLogging] = useState(false);
  const d = list.data;
  return (
    <Card
      title="Data requests under India's data law"
      aside={
        <Button variant="primary" onClick={() => setLogging(true)}>
          + Log a request
        </Button>
      }
    >
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : d && !d.rows.length ? (
        <p className="ceo-sub">No data requests yet. When someone asks to see, correct or delete their data, log it here — it is due {d.dueDays} days after it arrived.</p>
      ) : (
        <div className="scrollx">
          <table aria-label="Data requests">
            <thead>
              <tr>
                <th>Asked</th>
                <th>Who</th>
                <th>Request</th>
                <th>Due</th>
                <th>Status</th>
                <th>Logged by</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {d?.rows.map((r) => (
                <tr key={r.id} data-testid={`data-request-${r.code}`}>
                  <td>{formatDateIST(`${r.receivedOn}T06:30:00Z`)}</td>
                  <td>
                    <span className="code">{r.subjectCode}</span>
                    <div className="ceo-cell-sub">{SUBJECT[r.subjectType]}</div>
                  </td>
                  <td>
                    {KIND[r.kind]}
                    {r.details ? <div className="ceo-cell-sub">{r.details}</div> : null}
                  </td>
                  <td>
                    <div style={r.overdue ? { color: 'var(--crit, #c62828)', fontWeight: 600 } : undefined}>{dueText(r)}</div>
                    <div className="ceo-cell-sub">{r.status === 'closed' ? `was due ${formatDateIST(`${r.dueOn}T06:30:00Z`)}` : formatDateIST(`${r.dueOn}T06:30:00Z`)}</div>
                  </td>
                  <td>
                    {r.status === 'closed' ? (
                      <>
                        <StatusPill tone={r.outcome === 'refused' ? 'warn' : 'good'}>{r.outcome ? OUTCOME[r.outcome] : 'Closed'}</StatusPill>
                        {r.outcomeNote ? <div className="ceo-cell-sub">{r.outcomeNote}</div> : null}
                      </>
                    ) : r.overdue ? (
                      <StatusPill tone="crit">Overdue</StatusPill>
                    ) : r.status === 'in_progress' ? (
                      <StatusPill tone="info">In progress</StatusPill>
                    ) : (
                      <StatusPill tone="muted">Open</StatusPill>
                    )}
                  </td>
                  <td>
                    {r.loggedBy.name ?? '—'}
                    {r.closedBy ? <div className="ceo-cell-sub">closed by {r.closedBy.name ?? '—'}</div> : null}
                  </td>
                  <td>
                    {r.status !== 'closed' ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.status === 'open' ? (
                          <ActionButton
                            label="Start"
                            title={`Start ${r.code}`}
                            description={`Mark ${KIND[r.kind].toLowerCase()} for ${r.subjectCode} as being worked on.`}
                            confirmLabel="Mark in progress"
                            run={() => api.patch(`/data-requests/${r.id}`, { status: 'in_progress' })}
                            success={`${r.code} is in progress`}
                          />
                        ) : null}
                        <ActionButton
                          label="Handle"
                          variant="success"
                          title={`Close ${r.code}`}
                          description={`${KIND[r.kind]} · ${r.subjectCode}. Say what was done; the request closes today.`}
                          choice={{ label: 'Outcome', options: Object.entries(OUTCOME).map(([value, label]) => ({ value, label })) }}
                          reason={{ label: 'What was done', required: true }}
                          confirmLabel="Close the request"
                          run={({ reason, choice }) => api.post(`/data-requests/${r.id}/close`, { outcome: choice, outcomeNote: reason })}
                          success={`${r.code} closed`}
                        />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ceo-sub" style={{ marginTop: 10 }}>
        A request is due {d?.dueDays ?? 30} days after it arrived. Name the person only by their JS-, BZ- or RF- code; never write a phone, Aadhaar or account number.
      </p>
      <LogRequestModal open={logging} onClose={() => setLogging(false)} />
    </Card>
  );
}

function LogRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const today = istDateKey(useNow());
  const [kind, setKind] = useState<DataRequestRow['kind'] | ''>('');
  const [code, setCode] = useState('');
  const [receivedOn, setReceivedOn] = useState(today);
  const [details, setDetails] = useState('');
  const toast = useToast();
  const queryClient = useQueryClient();
  const codeOk = /^(JS|BZ|RF)-\d+$/i.test(code.trim());
  const reset = () => {
    setKind('');
    setCode('');
    setReceivedOn(today);
    setDetails('');
  };
  const mutation = useMutation({
    mutationFn: () => api.post<DataRequestRow>('/data-requests', { kind, subjectCode: code.trim().toUpperCase(), receivedOn, details: details.trim() || null }),
    onSuccess: (row) => {
      toast.success(`${row.code} logged · due ${formatDateIST(`${row.dueOn}T06:30:00Z`)}`);
      reset();
      onClose();
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a data request"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!kind || !codeOk || !receivedOn}>
            Log the request
          </Button>
        </>
      }
    >
      <SelectField
        label="What they asked for"
        value={kind}
        onChange={setKind}
        options={(Object.keys(KIND) as DataRequestRow['kind'][]).map((value) => ({ value, label: KIND[value] }))}
        required
      />
      <TextField
        label="Who asked (their code)"
        value={code}
        onChange={setCode}
        placeholder="JS-00104, BZ-00019 or RF-00007"
        hint="Job seeker, business or referral partner"
        error={code.trim() && !codeOk ? 'Use their JS-, BZ- or RF- code' : undefined}
        required
      />
      <DateField label="Received on" value={receivedOn} onChange={setReceivedOn} max={today} required />
      <TextField label="Details (optional)" value={details} onChange={setDetails} hint="A few words — no phone, Aadhaar or account numbers" />
    </Modal>
  );
}
