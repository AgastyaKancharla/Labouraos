import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, buttonClass } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DateField, MoneyField, SelectField, TextField } from '../../../components/fields';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { istDateKey } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { FormAction } from './kit';
import { CHANNEL, EXPENSE_CATEGORY, EXPENSE_CATEGORY_OPTIONS, PAID_FROM } from './labels';
import { openWithToken, postForm } from './upload';
import './fin.css';

/** Pieces of the expenses screens shared by FN-Expenses and the CEO's C-Expenses. */
export interface ExpenseRow {
  id: string;
  code: string;
  kind: 'manual';
  category: string;
  supplier: string;
  description: string;
  adChannel: string | null;
  amountPaise: number;
  gstPaise: number;
  billDate: string;
  paidFrom: string | null;
  hasBill: boolean;
  status: 'waiting_finance' | 'waiting_ceo' | 'approved' | 'paid' | 'rejected';
  needsCeo: boolean;
  withinFinanceLimit: boolean;
  enteredBy: { name: string; role: string } | null;
  approvedBy: { name: string; role: string } | null;
  rejectedBy: { name: string; role: string } | null;
  rejectionReason: string | null;
  paidAt: string | null;
  paymentReference: string | null;
}
export interface ExpensesResponse {
  rows: ExpenseRow[];
  auto: { id: string; code: string; category: string; what: string; amountPaise: number; paidAt: string | null }[];
  refundsAgainstRevenue: { count: number; paise: number };
  summary: { spentPaise: number; billsPaise: number; autoPaise: number; budgetPaise: number; toPayCount: number; dueNowPaise: number; waitingCeoCount: number; waitingCeoPaise: number; limitPaise: number };
}

export function approvalText(r: ExpenseRow, limitPaise: number, viewer: 'finance' | 'ceo' = 'finance'): string {
  const by = (p: { name: string; role: string } | null) => (p ? (p.role === 'ceo' ? 'CEO' : p.name) : '');
  if (viewer === 'ceo') {
    if (r.status === 'waiting_finance') return 'Waiting · Finance';
    if (r.status === 'waiting_ceo') return 'Waiting for you';
    if (r.status === 'approved') return `Approved by ${by(r.approvedBy)} · to pay`;
    if (r.status === 'paid') return `Approved by ${by(r.approvedBy)} · paid`;
  }
  switch (r.status) {
    case 'waiting_finance':
      return 'To approve · within your limit';
    case 'waiting_ceo':
      return `Waiting for the CEO (over ${formatINR(limitPaise)})`;
    case 'approved':
      return `To pay · approved by ${by(r.approvedBy)}${r.needsCeo ? ` (over ${formatINR(limitPaise)})` : ''}`;
    case 'paid':
      return `Approved by ${by(r.approvedBy)}${r.needsCeo ? ` (over ${formatINR(limitPaise)})` : ''} · Paid`;
    default:
      return `Rejected by ${by(r.rejectedBy)}${r.rejectionReason ? ` · ${r.rejectionReason}` : ''}`;
  }
}

const PAID_FROM_OPTIONS = Object.entries(PAID_FROM).map(([value, label]) => ({ value, label }));
const payFields = [
  { name: 'paidFrom', kind: 'select' as const, label: 'Paid from', options: PAID_FROM_OPTIONS, required: true },
  { name: 'reference', kind: 'text' as const, label: 'Reference (UTR, UPI or card reference, cash voucher)', required: true },
];

function AttachBill({ id }: { id: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('bill', file);
      return postForm(`/finance/expenses/${id}/bill`, form);
    },
    onSuccess: () => {
      toast.success('Bill attached');
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not attach the bill'),
  });
  return (
    <label className={buttonClass('secondary', 'compact')} style={{ cursor: 'pointer' }}>
      {mutation.isPending ? 'Attaching…' : 'Attach bill'}
      <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && mutation.mutate(e.target.files[0])} />
    </label>
  );
}

export function BillLink({ r }: { r: ExpenseRow }) {
  const toast = useToast();
  if (!r.hasBill) return <AttachBill id={r.id} />;
  return (
    <button
      type="button"
      className="lb-link"
      style={{ background: 'none', border: 0, padding: 0, color: 'var(--royal)', cursor: 'pointer', fontWeight: 600 }}
      onClick={() => openWithToken(`/finance/expenses/${r.id}/bill`).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Could not open the bill'))}
    >
      {r.category === 'rent' ? 'Agreement' : r.category === 'field_travel' ? 'Receipts' : 'Bill attached'}
    </button>
  );
}

export function ExpenseActions({ r, role, limitPaise }: { r: ExpenseRow; role: string | undefined; limitPaise: number }) {
  const canApprove = r.status === 'waiting_finance' || (r.status === 'waiting_ceo' && role === 'ceo');
  return (
    <span className="fin-row-actions">
      {canApprove && (
        <FormAction
          label="Approve and pay"
          variant="success"
          size="compact"
          title={`Approve and pay ${formatINR(r.amountPaise)}`}
          description={`${r.supplier} · ${r.description}. ${r.hasBill ? '' : 'Attach the bill first — no bill, no payment.'}`}
          fields={payFields}
          confirmLabel="Approve and record"
          run={(v) => api.post(`/finance/expenses/${r.id}/approve`, { pay: { paidFrom: v.paidFrom, reference: v.reference } })}
          success={`${r.code} approved and paid`}
          disabled={!r.hasBill}
        />
      )}
      {r.status === 'waiting_ceo' && role === 'ceo' && (
        <FormAction label="Approve" size="compact" title={`Approve ${formatINR(r.amountPaise)}`} description="Finance then pays it and records the reference." run={() => api.post(`/finance/expenses/${r.id}/approve`, {})} success={`${r.code} approved`} disabled={!r.hasBill} />
      )}
      {r.status === 'approved' && (
        <FormAction label="Pay and record" variant="success" size="compact" title={`Pay ${formatINR(r.amountPaise)}`} fields={payFields} confirmLabel="Record payment" run={(v) => api.post(`/finance/expenses/${r.id}/pay`, { paidFrom: v.paidFrom, reference: v.reference })} success={`${r.code} paid`} disabled={!r.hasBill} />
      )}
      {canApprove && (
        <FormAction
          label="Reject"
          variant="danger"
          size="compact"
          title="Reject this expense"
          fields={[{ name: 'reason', kind: 'text', label: 'Reason', required: true }]}
          run={(v) => api.post(`/finance/expenses/${r.id}/reject`, { reason: v.reason })}
          success={`${r.code} rejected`}
        />
      )}
      {r.status === 'waiting_ceo' && role !== 'ceo' && <span className="fin-sub">Over {formatINR(limitPaise)} · the CEO approves</span>}
    </span>
  );
}

/** "Add a bill" — Finance or the CEO, with the bill attached. */
export function AddBill({ prefill }: { prefill?: { category?: string; supplier?: string; description?: string } }) {
  const now = useNow(60_000);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState(prefill?.category ?? 'office_other');
  const [supplier, setSupplier] = useState(prefill?.supplier ?? '');
  const [description, setDescription] = useState(prefill?.description ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [gst, setGst] = useState<number | null>(null);
  const [date, setDate] = useState(istDateKey(now));
  const [channel, setChannel] = useState('social_media');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const mutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('category', category);
      form.append('supplier', supplier.trim());
      form.append('description', description.trim());
      form.append('amountPaise', String(amount ?? ''));
      if (gst) form.append('gstPaise', String(gst));
      form.append('billDate', date);
      if (category === 'ads_marketing') form.append('adChannel', channel);
      if (file) form.append('bill', file);
      return postForm<ExpenseRow>('/finance/expenses', form);
    },
    onSuccess: (row) => {
      toast.success(row.status === 'waiting_ceo' ? `${row.code} added · sent to the CEO (over the limit)` : row.status === 'approved' ? `${row.code} added and approved` : `${row.code} added · approve and pay it when ready`);
      setSupplier('');
      setDescription('');
      setAmount(null);
      setGst(null);
      setFile(null);
      setFileKey((k) => k + 1);
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not add the bill'),
  });
  const ready = supplier.trim() && description.trim() && amount && amount > 0 && date;
  return (
    <Card title="Add a bill">
      <div className="fin-form">
        <SelectField label="Category" value={category} onChange={setCategory} options={EXPENSE_CATEGORY_OPTIONS.map((c) => ({ value: c, label: EXPENSE_CATEGORY[c] }))} />
        {category === 'ads_marketing' && (
          <SelectField label="Channel" value={channel} onChange={setChannel} options={Object.entries(CHANNEL).map(([value, label]) => ({ value, label }))} />
        )}
        <TextField label="Supplier" value={supplier} onChange={setSupplier} placeholder="Exotel, landlord, petrol pump…" required />
        <TextField label="What" value={description} onChange={setDescription} placeholder="What it was for" required />
        <MoneyField label="Amount (₹)" value={amount} onChange={setAmount} required />
        <MoneyField label="GST in it (₹, if any)" value={gst} onChange={setGst} />
        <DateField label="Bill date" value={date} onChange={setDate} max={istDateKey(now)} />
        <label className="field">
          Bill
          <input key={fileKey} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button variant="primary" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!ready}>
          Add bill
        </Button>
      </div>
      {!file && <p className="fin-note">No bill yet? You can add it now and attach the bill later — it cannot be approved or paid until then.</p>}
    </Card>
  );
}

