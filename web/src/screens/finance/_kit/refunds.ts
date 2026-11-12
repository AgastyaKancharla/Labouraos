import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';

/** A row of GET /finance/refunds. */
export interface RefundRow {
  ref: string;
  kind: 'job_seeker' | 'business';
  subject: { id: string | null; code: string | null; name: string | null };
  placement: { id: string; code: string } | null;
  amountPaise: number;
  why: string;
  check: { eligible: boolean; text: string };
  approval: 'within_limit' | 'needs_ceo' | 'with_ceo';
  approvalText: string;
  state: 'due' | 'to_pay' | 'with_ceo' | 'failed' | 'processing';
  paymentId: string | null;
  paymentCode: string | null;
  jobSeekerId: string | null;
  placementId: string | null;
  daysOwed: number | null;
  since: string | null;
}

export interface PayValues {
  utr: string;
  receiverNameShown: string;
}

/**
 * Approve (if not yet raised) and pay one refund with the existing endpoints:
 * POST /job-seekers/:id/refund or POST /placements/:id/refund raise it (every
 * rule and limit is checked there), then POST /finance/payouts/:id/pay records
 * the UTR. A business refund above Finance's limit is passed to the CEO by the
 * API instead — that comes back as `{ sentToCeo: true }`.
 */
export async function approveAndPay(row: Pick<RefundRow, 'state' | 'kind' | 'paymentId' | 'jobSeekerId' | 'placementId'>, pay: PayValues): Promise<{ sentToCeo: boolean; message?: string }> {
  let paymentId = row.paymentId;
  if (!paymentId) {
    try {
      const raised =
        row.kind === 'job_seeker'
          ? await api.post<{ id: string }>(`/job-seekers/${row.jobSeekerId}/refund`, {})
          : await api.post<{ id: string; message?: string; ceoApprovalReason?: string | null; status?: string }>(`/placements/${row.placementId}/refund`, {});
      paymentId = raised.id;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /sent to the CEO/i.test(e.message)) return { sentToCeo: true, message: e.message };
      throw e;
    }
  }
  await api.post(`/finance/payouts/${paymentId}/pay`, { utr: pay.utr, receiverNameShown: pay.receiverNameShown });
  return { sentToCeo: false };
}

/** Finance can always send a business refund to the CEO instead of approving it. */
export function sendToCeo(placementId: string, reason: string) {
  return api.post<{ message?: string }>(`/placements/${placementId}/refund`, { sendToCeo: true, reason });
}
