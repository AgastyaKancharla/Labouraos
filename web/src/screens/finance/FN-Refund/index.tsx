import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/Badge';
import { TextField } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { FormAction, Note } from '../_kit/kit';
import { approveAndPay, sendToCeo, type RefundRow } from '../_kit/refunds';
import '../_kit/fin.css';

/**
 * One refund — design FN-Refund.dc.html. Every check the system did, and
 * paying it: "Approve and record payment" raises it on the existing approve
 * endpoint (all rules and limits run there) and records the UTR; "Send to
 * CEO" passes a business refund to the CEO instead.
 */
interface Detail {
  ref: string;
  kind: 'business' | 'job_seeker';
  row: RefundRow | null;
  decided: { status: string; paidAt: string | null; utr: string | null; approvedAt: string | null } | null;
  business?: { id: string; code: string; name: string };
  placement?: { id: string; code: string; role: string | null; workerName: string | null; joinedDate: string | null; dropoutReportedAt: string | null; status: string };
  fee?: { feePaise: number; gstPaise: number; totalPaise: number };
  jobSeeker?: { id: string; code: string; name: string; status: string };
  why: string;
  amountPaise: number;
  percent?: number | null;
  checks: { ok: boolean; text: string }[];
  payTo: { method: string; masked: string; verifiedName: string | null; status: string } | null;
  withinLimit: boolean;
  limitPaise: number;
}

export default function RefundDetail() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['finance', 'refund', id], queryFn: () => api.get<Detail>(`/finance/refunds/${id}`) });
  const d = query.data;
  const [utr, setUtr] = useState('');
  const [name, setName] = useState('');
  const pay = useMutation({
    mutationFn: () => approveAndPay(d!.row!, { utr: utr.trim(), receiverNameShown: name.trim() }),
    onSuccess: (res) => {
      toast.success(res.sentToCeo ? (res.message ?? 'Sent to the CEO') : 'Refund paid and recorded');
      void queryClient.invalidateQueries();
      navigate(to('FN-Refunds'));
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'),
  });
  const title = d ? `Refund · ${d.kind === 'business' ? (d.business?.name ?? '') : (d.jobSeeker?.name ?? '')}` : 'Refund';
  const row = d?.row ?? null;
  const payable = Boolean(row && row.approval === 'within_limit' && (row.state === 'due' || row.state === 'to_pay'));
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Refunds'), label: 'Refunds' }} title={title} subtitle="One refund with every check, ready to pay." showSearch={false} />
      {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.isPending && <SkeletonCard height={320} />}
      {d && (
        <>
          <div className="two-col fin-two">
            <Card title="Refund">
              <div className="fin-kv">
                {d.kind === 'business' ? (
                  <>
                    <span>Business</span>
                    <span>
                      {d.business?.name} · {d.business?.code}
                    </span>
                    <span>Placement</span>
                    <span>
                      {d.placement?.code}
                      {d.placement?.role ? ` · ${d.placement.role}` : ''}
                      {d.placement?.dropoutReportedAt ? ` · left, reported ${formatDateIST(d.placement.dropoutReportedAt)}` : ''}
                    </span>
                    <span>Fee paid</span>
                    <span>{d.fee ? `${formatINR(d.fee.totalPaise)} (${formatINR(d.fee.feePaise)} + ${formatINR(d.fee.gstPaise)} GST)` : '—'}</span>
                  </>
                ) : (
                  <>
                    <span>Job seeker</span>
                    <span>
                      {d.jobSeeker?.name} · {d.jobSeeker?.code}
                    </span>
                  </>
                )}
                <span>Why it's owed</span>
                <span>{d.why}</span>
                <span>Refund</span>
                <span>
                  {formatINR(d.amountPaise)}
                  {d.percent ? ` · ${d.percent}%` : ''}
                </span>
                {d.decided && (
                  <>
                    <span>Now</span>
                    <span>
                      {d.decided.paidAt ? `Paid ${formatDateIST(d.decided.paidAt)}${d.decided.utr ? ` · UTR ${d.decided.utr}` : ''}` : d.decided.status.replace(/_/g, ' ')}
                    </span>
                  </>
                )}
              </div>
            </Card>
            <Card title="Checks done by the system">
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
                {d.checks.map((c) => (
                  <li key={c.text} className={c.ok ? 'fin-good' : 'fin-crit'}>
                    <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> <span className="sr-only">{c.ok ? 'Passed:' : 'Not passed:'}</span> {c.text}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="Pay it">
            {!row && <p className="fin-sub">{d.decided?.paidAt ? 'This refund is paid.' : 'This refund is not waiting for Finance.'}</p>}
            {row && row.approval !== 'within_limit' && (
              <p>
                <StatusPill tone="warn">{row.approvalText}</StatusPill> The CEO decides this one on Refund approvals.
              </p>
            )}
            {payable && (
              <>
                <div className="fin-form">
                  <TextField label="Paid to" value={d.payTo ? `${d.payTo.verifiedName ?? ''} · ${d.payTo.masked}${d.payTo.status === 'verified' ? ' (verified)' : ''}` : 'No payout details yet'} onChange={() => undefined} readOnly />
                  <TextField label="Name the UPI app showed" value={name} onChange={setName} required />
                  <TextField label="UTR from the bank" value={utr} onChange={setUtr} placeholder="12-digit UTR" inputMode="numeric" required />
                </div>
                <div className="fin-row-actions" style={{ marginTop: 12 }}>
                  <Button variant="success" onClick={() => pay.mutate()} loading={pay.isPending} disabled={!utr.trim() || !name.trim()}>
                    Approve and record payment
                  </Button>
                  {d.kind === 'business' && d.placement && row?.state === 'due' && (
                    <FormAction
                      label="Send to CEO"
                      title="Send this refund to the CEO"
                      description="Not sure? The CEO decides it on Refund approvals. Write what the CEO should look at."
                      fields={[{ name: 'reason', kind: 'text', label: 'Why', required: true }]}
                      run={(v) => sendToCeo(d.placement!.id, String(v.reason))}
                      success="Sent to the CEO"
                    />
                  )}
                </div>
              </>
            )}
            <Note>On recording: the money goes from the company account, the UTR is kept, and the CEO sees it in the month-end review · a business refund returns the fee only — its GST stays owed until the CA answers · not sure? Send it to the CEO</Note>
          </Card>
        </>
      )}
    </div>
  );
}
