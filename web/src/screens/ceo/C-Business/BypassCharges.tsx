import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { FormAction } from '../../finance/_kit/kit';

interface Charge {
  id: string;
  code: string;
  invoiceCode: string;
  jobSeeker: { id: string; code: string; name: string } | null;
  hiredOn: string;
  monthlySalaryPaise: number;
  feePaise: number;
  penaltyPaise: number;
  gstPaise: number;
  totalPaise: number;
  penaltyPercent: number;
  reason: string;
  status: 'waiting' | 'paid' | 'cancelled';
  raisedAt: string;
}
interface Candidates {
  agreementSigned?: boolean;
  noBypassMonths: number;
  penaltyPercent: number;
  feePercent: number;
  gstPercent: number;
  rows: { jobSeeker: { id: string; code: string; name: string }; introducedAt: string }[];
}

/**
 * No-bypass charge on C-Business (guide, "No-bypass clause"): the CEO raises
 * the full fee + the penalty percent + GST for someone Laboura introduced to
 * this business within the no-bypass months and hired without paying. It is
 * collected and invoiced like a placement fee (FN-Invoices).
 */
export function BypassChargesCard({ businessId }: { businessId: string }) {
  const charges = useQuery({ queryKey: ['bypass-charges', businessId], queryFn: () => api.get<Charge[]>(`/bypass-charges/business/${businessId}`) });
  const candidates = useQuery({ queryKey: ['bypass-charges', businessId, 'candidates'], queryFn: () => api.get<Candidates>(`/bypass-charges/business/${businessId}/candidates`) });
  const c = candidates.data;
  const options = (c?.rows ?? []).map((r) => ({ value: r.jobSeeker.id, label: `${r.jobSeeker.name} · ${r.jobSeeker.code} · introduced ${formatDateIST(r.introducedAt)}` }));
  return (
    <Card
      title="No-bypass charges"
      aside={
        <FormAction
          key={options.map((o) => o.value).join(',')}
          label="Raise bypass charge"
          variant="danger"
          size="compact"
          title="Raise a no-bypass charge"
          description={
            c
              ? `They hired someone Laboura introduced within ${c.noBypassMonths} months without paying: the full fee (${c.feePercent}% of one month's salary) + ${c.penaltyPercent}% of it, plus ${c.gstPercent}% GST. A payment link goes to the business and a GST invoice number is given.`
              : undefined
          }
          confirmLabel="Raise the charge"
          disabled={!options.length || c?.agreementSigned === false}
          fields={[
            { name: 'jobSeekerId', kind: 'select', label: 'Who they hired', options },
            { name: 'monthlySalaryPaise', kind: 'money', label: 'Their monthly salary', required: true },
            { name: 'hiredOn', kind: 'date', label: 'Hired on', required: true },
            { name: 'reason', kind: 'text', label: 'Reason (how we know)', required: true },
          ]}
          run={(v) =>
            api.post(`/bypass-charges/business/${businessId}`, {
              jobSeekerId: v.jobSeekerId,
              monthlySalaryPaise: v.monthlySalaryPaise,
              hiredOn: v.hiredOn,
              reason: v.reason,
            })
          }
          success="Charge raised · payment link sent · invoice numbered"
        />
      }
    >
      {charges.data && charges.data.length === 0 ? (
        <p className="ceo-sub">
          {c?.agreementSigned === false
            ? 'No charge raised. This business has no signed agreement, so the no-bypass clause does not apply.'
            : options.length
              ? 'No charge raised.'
              : `No charge raised. Nobody introduced in the last ${c?.noBypassMonths ?? 12} months is unpaid.`}
        </p>
      ) : (
        <div className="kv">
          {(charges.data ?? []).map((x) => (
            <Row key={x.id} x={x} />
          ))}
        </div>
      )}
    </Card>
  );
}

function Row({ x }: { x: Charge }) {
  return (
    <>
      <span>
        {x.code} · {x.invoiceCode}
      </span>
      <span>
        {x.jobSeeker ? `${x.jobSeeker.code} · ` : ''}hired {formatDateIST(x.hiredOn)} · {formatINR(x.feePaise)} + {formatINR(x.penaltyPaise)} + {formatINR(x.gstPaise)} GST = <b>{formatINR(x.totalPaise)}</b>{' '}
        <StatusPill tone={x.status === 'paid' ? 'good' : x.status === 'cancelled' ? 'muted' : 'warn'}>{x.status === 'paid' ? 'Paid' : x.status === 'cancelled' ? 'Cancelled' : 'Waiting for payment'}</StatusPill>
        {x.status === 'waiting' && (
          <span style={{ display: 'block', border: 0, padding: '6px 0 0' }}>
            <FormAction
              label="Cancel charge"
              size="compact"
              title={`Cancel ${x.code}`}
              description="The payment link stops working and the invoice number is kept as cancelled. The reason is kept in the history."
              confirmLabel="Cancel the charge"
              fields={[{ name: 'reason', kind: 'text', label: 'Reason', required: true }]}
              run={(v) => api.post(`/bypass-charges/${x.id}/cancel`, { reason: v.reason })}
              success="Charge cancelled · payment link closed"
            />
          </span>
        )}
      </span>
    </>
  );
}
