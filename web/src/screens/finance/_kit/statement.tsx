import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Modal } from '../../../components/Modal';
import { DateField, FieldShell, MoneyField, TextField } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatINR } from '../../../lib/format/money';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { FormAction } from './kit';

/**
 * "Add from statement" — Finance types one credit from the bank statement
 * (POST /payments/bank-credits, Finance and CEO only, audited). Until the
 * bank sends its statement automatically, this is how money that landed is
 * put in the books. The same UTR twice is refused by the server; the credit
 * is then matched (FN-Match), returned, or set aside like any other.
 */
export function AddFromStatement({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const now = useNow(60_000);
  const today = istDateKey(now);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [amountPaise, setAmountPaise] = useState<number | null>(null);
  const [utr, setUtr] = useState('');
  const [payerName, setPayerName] = useState('');
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const reset = () => {
    setDate(today);
    setTime('');
    setAmountPaise(null);
    setUtr('');
    setPayerName('');
    setRemark('');
    setError(null);
  };
  const mutation = useMutation({
    mutationFn: () =>
      api.post('/payments/bank-credits', {
        bankUtr: utr.trim(),
        amountPaise,
        // The statement's date and time are Indian time; with no time, midday that day.
        receivedAt: `${date}T${time || '12:00'}:00+05:30`,
        payerName: payerName.trim() || undefined,
        remark: remark.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(`${formatINR(amountPaise ?? 0)} added from the statement · UTR ${utr.trim()}`);
      setOpen(false);
      reset();
      void queryClient.invalidateQueries();
    },
    onError: (e) => setError(e instanceof ApiError ? (e.status === 409 ? `UTR ${utr.trim()} is already in the books. Each statement line is added once.` : e.message) : 'Something went wrong. Try again.'),
  });
  const future = date > today;
  const missing = !date || !utr.trim() || !amountPaise || amountPaise <= 0 || future;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        Add from statement
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a credit from the bank statement"
        dismissible={!mutation.isPending}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => { setError(null); mutation.mutate(); }} loading={mutation.isPending} disabled={missing}>
              Add the credit
            </Button>
          </>
        }
      >
        <div style={{ marginTop: 0, marginBottom: 12, fontSize: 13.5 }}>
          Copy one line from the statement exactly. It is matched automatically if the note carries a payment reference; otherwise it waits under Money in for you to match, return or set aside. It is logged with your name.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="fin-form">
            <DateField label="Date on the statement" value={date} onChange={setDate} max={today} required error={future ? 'The date cannot be in the future' : undefined} />
            <FieldShell label="Time (if shown)" hint="Leave empty if the statement shows no time">
              {({ inputId, describedBy }) => <input id={inputId} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-describedby={describedBy} />}
            </FieldShell>
          </div>
          <MoneyField label="Amount credited" value={amountPaise} onChange={setAmountPaise} required />
          <TextField label="UTR / reference" value={utr} onChange={setUtr} required inputMode="numeric" placeholder="12-digit UTR" hint="The bank's reference for this line. The same UTR is never added twice." />
          <TextField label="Payer name (if shown)" value={payerName} onChange={setPayerName} />
          <TextField label="Narration / note" value={remark} onChange={setRemark} hint="Copy it as written; a payment reference here matches it automatically" />
          {error && (
            <p className="vno" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * "Set aside" — the credit is not Laboura's money (a personal transfer, a
 * wrong account): POST /payments/bank-credits/:id/ignore with a required
 * reason (Finance and CEO, audited; its open mismatch flags close with the
 * same reason). It cannot be undone, and a matched credit can't be set aside.
 */
export function SetAside({ id, amountPaise, size = 'compact' }: { id: string; amountPaise: number; size?: 'compact' | 'regular' }) {
  return (
    <FormAction
      label="Set aside"
      size={size}
      title={`Set ${formatINR(amountPaise)} aside`}
      description="Only for money that is not Laboura's (a personal transfer, a payment meant for another account). If someone paid Laboura by mistake, return it instead. Setting aside can't be undone; it is logged with your name and reason."
      fields={[{ name: 'reason', kind: 'text', label: 'Why this is not Laboura’s money', required: true, placeholder: 'e.g. owner’s rent sent to the wrong account' }]}
      confirmLabel="Set it aside"
      run={(v) => api.post(`/payments/bank-credits/${encodeURIComponent(id)}/ignore`, { reason: String(v.reason).trim() })}
      success="Set aside — not Laboura's money"
    />
  );
}
