import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';

/** GET /whatsapp/overview: the Team Lead's team and the unassigned ones (a Manager: their teams; the CEO: all). */
export interface WhatsAppOverviewData {
  open: number;
  waiting: number;
  waitingOver15: number;
  unassigned: number;
  closedLast24h: number;
  referralLeadsOpen: number;
  referralLeadsUnassigned: number;
  onShift: number;
  agents: Array<{ id: string; code: string; name: string; onShift: boolean; open: number; waiting: number }>;
  waitingList: Array<{ id: string; name: string; waitingWorkMinutes: number; waitingSince: string; assignedTo: { id: string; code: string; name: string } | null }>;
}

/**
 * WhatsApp at a glance for the Team Lead (Master Guide rev 202, 21 Nov): what
 * waits and for how long (working minutes, counted only while someone is on
 * shift), who has it, and a one-tap hand-over to a teammate. The bell rings
 * after 15 working minutes; the Manager hears after 2 hours.
 */
export function WhatsAppOverview() {
  const toast = useToast();
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ['whatsapp', 'overview'],
    queryFn: () => api.get<WhatsAppOverviewData>('/whatsapp/overview'),
    refetchInterval: 30_000,
  });
  const [pick, setPick] = useState<Record<string, string>>({});
  const assign = useMutation({
    mutationFn: ({ id, staffId }: { id: string; staffId: string }) => api.post(`/whatsapp/conversations/${encodeURIComponent(id)}/assign`, { staffId }),
    onSuccess: () => {
      toast.success('Handed over');
      void client.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : 'Something went wrong. Try again.'),
  });
  const d = data.data;
  return (
    <Card icon="callCenter" tone="good" title="WhatsApp" aside={d ? <span className="tl-sub">{d.onShift} on shift · {d.closedLast24h} closed in 24 h</span> : undefined}>
      {data.error && <ErrorState error={data.error} compact onRetry={() => void data.refetch()} />}
      {!d && !data.error && <SkeletonCard />}
      {d && (
        <>
          <div className="lb-ca-actions" style={{ marginBottom: 10 }}>
            <StatusPill tone="muted">{d.open} open</StatusPill>
            <StatusPill tone={d.waiting > 0 ? 'warn' : 'good'}>{d.waiting} waiting for a reply</StatusPill>
            {d.waitingOver15 > 0 && <StatusPill tone="danger">{d.waitingOver15} over 15 min</StatusPill>}
            {d.unassigned > 0 && <StatusPill tone="danger">{d.unassigned} not assigned</StatusPill>}
            <StatusPill tone="muted">{d.referralLeadsOpen} partner leads open{d.referralLeadsUnassigned ? ` (${d.referralLeadsUnassigned} not assigned)` : ''}</StatusPill>
          </div>
          {d.waitingList.length === 0 ? (
            <div className="tl-sub">Nobody is waiting for a WhatsApp reply.</div>
          ) : (
            <div className="scrollx">
              <table>
                <caption className="sr-only">WhatsApp messages waiting for a reply</caption>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Waiting</th>
                    <th>With</th>
                    <th>Hand over</th>
                  </tr>
                </thead>
                <tbody>
                  {d.waitingList.map((w) => (
                    <tr key={w.id}>
                      <td>{w.name}</td>
                      <td>
                        <StatusPill tone={w.waitingWorkMinutes >= 15 ? 'danger' : 'warn'}>{w.waitingWorkMinutes} min</StatusPill>
                      </td>
                      <td className="tl-sub">{w.assignedTo ? `${w.assignedTo.code} ${w.assignedTo.name}`.trim() : 'Not assigned'}</td>
                      <td>
                        <div className="lb-ca-actions">
                          <select aria-label={`Hand ${w.name} to`} value={pick[w.id] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [w.id]: e.target.value }))}>
                            <option value="">Choose agent</option>
                            {d.agents.filter((a) => a.id !== w.assignedTo?.id).map((a) => (
                              <option key={a.id} value={a.id}>{a.name}{a.onShift ? '' : ' (off shift)'} · {a.open} open</option>
                            ))}
                          </select>
                          <Button size="compact" disabled={!pick[w.id]} loading={assign.isPending} onClick={() => assign.mutate({ id: w.id, staffId: pick[w.id] })}>Assign</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
