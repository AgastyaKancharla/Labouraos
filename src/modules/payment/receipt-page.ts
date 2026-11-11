import { formatINR } from '../../common/money/money';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

/**
 * What the payer sees when the receipt link from the SMS opens in a browser.
 * It shows "received" only for money confirmed in Laboura's bank.
 */
export function renderReceiptPage(receipt: {
  paymentCode: string;
  amountPaise: number;
  status: string;
  confirmedAt: Date | null;
  type: string;
}): string {
  const received = ['succeeded', 'completed'].includes(receipt.status) && receipt.confirmedAt;
  const when = receipt.confirmedAt
    ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(receipt.confirmedAt)
    : '';
  const what = receipt.type === 'activation' ? 'Laboura registration · ₹499 · no GST added' : 'Laboura payment';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Receipt ${escapeHtml(receipt.paymentCode)}</title><style>body{margin:0;background:#EEF3FC;color:#0B1E4A;font:15px/1.5 system-ui,sans-serif}main{max-width:480px;margin:0 auto;padding:16px}.card{background:#fff;border:1px solid #DCE4F3;border-radius:16px;padding:18px}h1{font:700 19px system-ui,sans-serif;color:#032B73;margin:0 0 10px}.row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #DCE4F3}.row:last-child{border:0}.ok{color:#1C9A6C;font-weight:700}.wait{color:#92670A;font-weight:700}</style></head><body><main><div class="card"><h1>Receipt</h1>
<div class="row"><span>For</span><span>${escapeHtml(what)}</span></div>
<div class="row"><span>Amount</span><strong>${escapeHtml(formatINR(receipt.amountPaise))}</strong></div>
<div class="row"><span>Reference</span><span>${escapeHtml(receipt.paymentCode)}</span></div>
<div class="row"><span>Status</span>${received ? `<span class="ok">Received by the bank · ${escapeHtml(when)}</span>` : '<span class="wait">Not received yet</span>'}</div>
</div></main></body></html>`;
}
