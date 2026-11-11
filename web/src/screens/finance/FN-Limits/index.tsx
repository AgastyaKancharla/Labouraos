import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthProvider';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { MoneyField } from '../../../components/fields';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { Note } from '../_kit/kit';
import '../_kit/fin.css';

/**
 * Approval limits — design FN-Limits.dc.html (guide: Approval limits, kept in
 * Settings, only the CEO changes them). Finance sees them; only the CEO's
 * Save is accepted by the API (PUT /pricing/approval-limits).
 */
interface Limits {
  businessRefundLimitPaise: number;
  expenseLimitPaise: number;
}

export default function ApprovalLimits() {
  const to = useScreenPath();
  const { session } = useAuth();
  const isCeo = session?.staff.role === 'ceo';
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['finance', 'limits'], queryFn: () => api.get<Limits>('/pricing/approval-limits') });
  const [refund, setRefund] = useState<number | null>(null);
  const [expense, setExpense] = useState<number | null>(null);
  useEffect(() => {
    if (query.data) {
      setRefund(query.data.businessRefundLimitPaise);
      setExpense(query.data.expenseLimitPaise);
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api.put('/pricing/approval-limits', { businessRefundLimitPaise: refund, expenseLimitPaise: expense }),
    onSuccess: () => {
      toast.success('Limits saved · logged in the audit log');
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the limits'),
  });
  const d = query.data;
  const money = (value: number | null, set: (v: number | null) => void, label: string, current: number) =>
    isCeo ? (
      <div style={{ maxWidth: 180 }}>
        <MoneyField label={<span className="sr-only">{label}</span>} value={value} onChange={set} />
      </div>
    ) : (
      <span className="fin-strong">Up to {formatINR(current)}</span>
    );
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('FN-Home'), label: 'Money today' }} title="Approval limits" subtitle="Who can approve and pay what, and when the CEO is needed." showSearch={false} />
      {query.isPending ? (
        <SkeletonCard height={320} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : d ? (
        <Card flush>
          <div className="scrollx lb-table__scroll lb-table">
            <table className="fin-limits">
              <caption className="sr-only">Approval limits</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Finance can approve and pay</th>
                  <th scope="col">Needs the CEO</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Job seeker ₹499 refund (system says eligible)</td>
                  <td className="fin-strong">Any</td>
                  <td>—</td>
                  <td>Finance approves and pays</td>
                </tr>
                <tr>
                  <td>Business refund (system says eligible)</td>
                  <td>{money(refund, setRefund, 'Business refund limit', d.businessRefundLimitPaise)}</td>
                  <td>Above that</td>
                  <td>Most are ₹8,000–₹10,000</td>
                </tr>
                <tr>
                  <td>Refund outside the rules (goodwill)</td>
                  <td>Never</td>
                  <td className="fin-strong">Always</td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>Referral payout · joining reward</td>
                  <td className="fin-strong">Any (paid daily, after any 48-hour wait)</td>
                  <td>—</td>
                  <td>Warned when a partner crosses the TDS limit (CA to confirm)</td>
                </tr>
                <tr>
                  <td>Expense or bill</td>
                  <td>{money(expense, setExpense, 'Expense limit', d.expenseLimitPaise)}</td>
                  <td>Above that</td>
                  <td>No bill, no payment</td>
                </tr>
                <tr>
                  <td>Monthly salaries</td>
                  <td>Prepares and pays</td>
                  <td className="fin-strong">Approves the total</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Note>Only the CEO can change these · every change is in the audit log · Managers and Team Leads have no money powers · Finance can always send anything to the CEO</Note>
      {isCeo ? (
        <div>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={refund === null || expense === null}>
            Save limits
          </Button>
        </div>
      ) : (
        <div className="rule" style={{ borderLeftColor: 'var(--royal)', fontSize: 12.5 }}>
          To change a limit, ask the CEO — he changes them in Settings.
        </div>
      )}
    </div>
  );
}
