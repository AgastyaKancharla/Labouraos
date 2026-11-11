import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ButtonLink } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST, formatTimeIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { FormAction } from '../_kit/kit';
import { ReturnMoney } from '../_kit/ReturnMoney';
import '../_kit/fin.css';

/**
 * Match a payment — design FN-Match.dc.html. Finds what an unclaimed bank
 * credit was for: waiting payments of the same amount, best first, with why
 * each might be it. Matching confirms the payment with this credit (POST
 * /payments/:id/confirm); nothing matches → the money goes back.
 */
interface Candidate {
  paymentId: string;
  paymentCode: string;
  type: string;
  who: { code: string; name: string } | null;
  invoiceCode: string | null;
  placementCode: string | null;
  linkSentAt: string;
  expectedPaise: number;
  reference: string | null;
  score: number;
  reasons: string[];
  shortByPaise: number;
}
interface Response {
  credit: { id: string; utr: string; amountPaise: number; at: string; payerName: string | null; payerVpaMasked: string | null; remark: string | null; status: string; returnedUtr: string | null };
  candidates: Candidate[];
}

const TYPE: Record<string, string> = { placement_fee: 'Placement fee', activation: 'Registration fee', reactivation: 'Registration fee (again)' };

function MatchButton({ c, creditId, onDone }: { c: Candidate; creditId: string; onDone: () => void }) {
  if (c.shortByPaise > 0) {
    return (
      <FormAction
        label="Match as TDS short"
        variant="success"
        size="compact"
        title={`Match and record ${formatINR(c.shortByPaise)} as TDS`}
        description="The business paid less than the invoice, by the TDS it deducted. The certificate is then collected (shown on Invoices)."
        fields={[{ name: 'tdsNote', kind: 'text', label: 'TDS section or note', required: true }]}
        run={async (v) => {
          await api.post(`/payments/${c.paymentId}/confirm`, { bankCreditId: creditId, tdsDeductedPaise: c.shortByPaise, tdsNote: v.tdsNote });
          onDone();
        }}
        success={`Matched to ${c.paymentCode}`}
      />
    );
  }
  return (
    <FormAction
      label="Match to this"
      variant="success"
      size="compact"
      title={`Match to ${c.who ? `${c.who.code} · ${c.who.name}` : c.paymentCode}`}
      description="The payment is confirmed with this bank credit, as if it had been matched automatically. It is logged with your name."
      run={async () => {
        await api.post(`/payments/${c.paymentId}/confirm`, { bankCreditId: creditId });
        onDone();
      }}
      success={`Matched to ${c.paymentCode}`}
    />
  );
}

export default function MatchPayment() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const creditId = params.get('credit') ?? '';
  const query = useQuery({
    queryKey: ['finance', 'match', creditId],
    queryFn: () => api.get<Response>(`/finance/bank-credits/${encodeURIComponent(creditId)}/matches`),
    enabled: Boolean(creditId),
  });
  const d = query.data;
  const back = { to: to('FN-MoneyIn'), label: 'Money in' };
  const columns: Column<Candidate>[] = [
    {
      key: 'who',
      header: 'Waiting for',
      cell: (c) => (
        <>
          <span className="fin-strong">{c.who ? `${c.who.code} · ${c.who.name}` : c.paymentCode}</span>
          <span className="fin-sub">
            {TYPE[c.type] ?? c.type}
            {c.invoiceCode ? ` · ${c.invoiceCode}` : c.placementCode ? ` · ${c.placementCode}` : ''} · link sent {formatTimeIST(c.linkSentAt)}
          </span>
        </>
      ),
    },
    { key: 'expected', header: 'Expected', cell: (c) => formatINR(c.expectedPaise) },
    { key: 'ref', header: 'Reference', cell: (c) => c.reference ?? '—', hideOnPhone: true },
    { key: 'why', header: 'Why it might be this', cell: (c) => c.reasons.join(' · ') },
    { key: 'act', header: '', cell: (c) => <MatchButton c={c} creditId={creditId} onDone={() => navigate(to('FN-MoneyIn'))} /> },
  ];
  if (!creditId) {
    return (
      <div className="lb-page">
        <TopBar back={back} title="Match a payment" subtitle="Find what an unclaimed bank credit was for." showSearch={false} />
        <Card>
          <EmptyState title="Choose a bank credit to match.">Open Money in and press Match on a credit nobody claimed.</EmptyState>
          <ButtonLink to={`${to('FN-MoneyIn')}?status=not_matched`}>See credits not matched</ButtonLink>
        </Card>
      </div>
    );
  }
  return (
    <div className="lb-page">
      <TopBar back={back} title="Match a payment" subtitle="Find what an unclaimed bank credit was for." showSearch={false} />
      {query.isPending ? (
        <SkeletonCard height={240} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : d ? (
        <>
          <div className="rule" style={{ borderLeftColor: 'var(--gold-raw)', fontSize: 13 }}>
            <strong>Bank credit: {formatINR(d.credit.amountPaise)}</strong> · {formatDateTimeIST(d.credit.at)} · {d.credit.payerVpaMasked ? `UPI ${d.credit.payerVpaMasked}` : (d.credit.payerName ?? 'unknown payer')} · UTR {d.credit.utr} ·{' '}
            {d.credit.remark ? `note: “${d.credit.remark}”` : 'no reference in the note'}
          </div>
          {d.credit.status !== 'unmatched' ? (
            <Card>
              <EmptyState title={`This credit is already ${d.credit.status}.`}>{d.credit.returnedUtr ? `Returned with UTR ${d.credit.returnedUtr}.` : 'Nothing more to do here.'}</EmptyState>
            </Card>
          ) : (
            <>
              <Card title="Possible matches" flush>
                <DataTable columns={columns} rows={d.candidates} rowKey={(c) => c.paymentId} caption="Possible matches" pageSize={10} emptyTitle="No waiting payment has this amount." />
              </Card>
              <Card title="Nothing matches?">
                <p style={{ marginTop: 0 }}>Return the money to the same UPI ID. Unclaimed money is never kept or matched by guess.</p>
                <ReturnMoney id={d.credit.id} amountPaise={d.credit.amountPaise} to={d.credit.payerVpaMasked} size="regular" />
              </Card>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
