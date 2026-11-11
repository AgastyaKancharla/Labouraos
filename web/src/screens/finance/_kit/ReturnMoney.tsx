import { api } from '../../../lib/api/client';
import { formatINR } from '../../../lib/format/money';
import { FormAction } from './kit';

/** "Return the money": unclaimed money goes back to the same UPI ID, with the UTR recorded. */
export function ReturnMoney({ id, amountPaise, to, size = 'compact' }: { id: string; amountPaise: number; to: string | null; size?: 'compact' | 'regular' }) {
  return (
    <FormAction
      label="Return the money"
      variant="danger"
      size={size}
      title={`Return ${formatINR(amountPaise)}`}
      description={`Send it back from the company UPI app to the same UPI ID${to ? ` (${to})` : ''}, then record the UTR. Unclaimed money is never kept or matched by guess.`}
      fields={[{ name: 'utr', kind: 'text', label: 'UTR of the money sent back', required: true, inputMode: 'numeric' }]}
      confirmLabel="Record the return"
      run={(v) => api.post(`/finance/bank-credits/${id}/return`, { utr: v.utr })}
      success="Return recorded"
    />
  );
}
