import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { FormAction } from './kit';

/**
 * Payment and payout flags Finance may close (GET /payments/review-flags,
 * POST /payments/review-flags/:id/resolve — Finance and CEO, a written
 * resolution is required, audited). The CEO closes the same flags from Flags
 * (C-Audit-Flags).
 */
export interface MoneyFlag {
  id: string;
  code: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  details: unknown;
  status: string;
  raisedAt: string;
  raisedForStaff: { name: string } | null;
}

export const PAYMENT_FLAG_KINDS = ['payment_mismatch'];
export const PAYOUT_FLAG_KINDS = ['payout_shared_account', 'payout_matches_staff', 'payout_name_mismatch'];

const KIND: Record<string, string> = {
  payment_mismatch: 'Payment does not match',
  payout_shared_account: 'Payout account used by someone else too',
  payout_matches_staff: 'Payout UPI ID is a staff member’s number',
  payout_name_mismatch: 'Name in the UPI app did not match',
};

const SUBJECT: Record<string, string> = { bank_credit: 'Bank credit', payment: 'Payment', job_seeker: 'Job seeker', business: 'Business', referral: 'Referral partner' };

function words(key: string): string {
  const s = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A short line from the flag's details: its readable text and number fields (ids left out). */
export function flagEvidence(details: unknown): string {
  if (!details || typeof details !== 'object') return '—';
  const parts = Object.entries(details as Record<string, unknown>)
    .filter(([k, v]) => (typeof v === 'string' || typeof v === 'number') && !/id$/i.test(k))
    .slice(0, 3)
    .map(([k, v]) => `${words(k).toLowerCase()}: ${String(v)}`);
  return parts.length ? parts.join(' · ') : '—';
}

export function useMoneyFlags(kinds: string[]) {
  const query = useQuery({
    queryKey: ['payments', 'review-flags', 'open'],
    queryFn: () => api.get<MoneyFlag[]>('/payments/review-flags', { query: { status: 'open' } }),
  });
  const rows = (query.data ?? []).filter((f) => kinds.includes(f.kind));
  return { query, rows };
}

export function ResolveFlag({ flag, label = 'Resolve' }: { flag: MoneyFlag; label?: string }) {
  return (
    <FormAction
      label={label}
      variant="success"
      size="compact"
      title={`Resolve ${flag.code}`}
      description={
        <>
          <strong>{KIND[flag.kind] ?? words(flag.kind)}</strong> · {flagEvidence(flag.details)}
          <br />
          Write what you checked and what was done. It is logged with your name.
        </>
      }
      fields={[{ name: 'resolution', kind: 'text', label: 'What you found and did', required: true }]}
      confirmLabel="Resolve the flag"
      run={(v) => api.post(`/payments/review-flags/${encodeURIComponent(flag.id)}/resolve`, { resolution: String(v.resolution).trim() })}
      success={`${flag.code} resolved`}
    />
  );
}

/** The open flags of these kinds, each with Resolve. Hidden when there are none. */
export function MoneyFlagsCard({ kinds, title }: { kinds: string[]; title: string }) {
  const { query, rows } = useMoneyFlags(kinds);
  if (!rows.length && !query.isError) return null;
  const columns: Column<MoneyFlag>[] = [
    {
      key: 'flag',
      header: 'Flag',
      cell: (f) => (
        <>
          <span className="fin-strong">{KIND[f.kind] ?? words(f.kind)}</span>
          <span className="fin-sub">
            {f.code} · {formatDateTimeIST(f.raisedAt)}
          </span>
        </>
      ),
      csv: (f) => `${f.code} ${f.kind}`,
    },
    { key: 'about', header: 'About', cell: (f) => [SUBJECT[f.subjectType] ?? words(f.subjectType), f.raisedForStaff?.name].filter(Boolean).join(' · '), csv: (f) => f.subjectType, hideOnPhone: true },
    { key: 'evidence', header: 'Evidence', cell: (f) => flagEvidence(f.details), csv: (f) => flagEvidence(f.details) },
    {
      key: 'act',
      header: 'Status',
      cell: (f) => (
        <>
          <StatusPill tone="warn">Open</StatusPill>
          <span className="fin-row-actions">
            <ResolveFlag flag={f} />
          </span>
        </>
      ),
      csv: () => 'open',
    },
  ];
  return (
    <Card title={`${title} · ${rows.length}`} flush>
      <DataTable columns={columns} rows={rows} rowKey={(f) => f.id} caption={title} error={query.error} onRetry={() => void query.refetch()} pageSize={20} emptyTitle="No open flags." />
    </Card>
  );
}
