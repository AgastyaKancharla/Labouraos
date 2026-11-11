import { formatINR } from '../../common/money/money';
import { GstInvoiceResponse } from './dto/gst-invoice.dto';

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

function istDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(new Date(iso));
}

/**
 * The business's printable GST invoice (opened from the signed invoice link).
 * A tax document, so it is in English; "Print or save as PDF" uses the
 * browser's own print dialog. Every value is escaped.
 */
export function renderInvoicePage(invoice: GstInvoiceResponse): string {
  const line = invoice.lineItems[0];
  const rows = invoice.lineItems.map((item) => `<tr><td>${escapeHtml(item.itemNumber)}</td><td>${escapeHtml(item.description)}<br><small>SAC ${escapeHtml(item.sacCode)}</small></td><td class="r">${escapeHtml(formatINR(item.baseAmountPaise))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tax invoice ${escapeHtml(invoice.invoiceNumber)}</title><style>
body{margin:0;background:#EEF3FC;color:#0B1E4A;font:15px/1.5 'IBM Plex Sans',system-ui,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid #DCE4F3;border-radius:16px;padding:20px;margin-bottom:14px}
h1{font:700 20px Sora,system-ui,sans-serif;color:#032B73;margin:0 0 4px}
h2{font:700 13px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em;color:#49588A;margin:0 0 6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid #DCE4F3;text-align:left;vertical-align:top}
.r{text-align:right;white-space:nowrap}.total td{font-weight:700;border-bottom:0}
small{color:#49588A}button{min-height:44px;padding:10px 16px;border-radius:10px;border:0;background:#0055C0;color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer}
@media print{body{background:#fff}button{display:none}.card{border:0;padding:0}}
</style></head><body><main>
<div class="card"><h1>Tax invoice</h1><div>${escapeHtml(invoice.invoiceNumber)} · ${escapeHtml(istDate(invoice.invoiceDate))}</div></div>
<div class="card grid"><div><h2>From</h2><strong>${escapeHtml(invoice.supplier.legalName)}</strong><br>${escapeHtml(invoice.supplier.address)}<br>GSTIN ${escapeHtml(invoice.supplier.gstin)}<br>${escapeHtml(invoice.supplier.state)} (${escapeHtml(invoice.supplier.stateCode)})</div>
<div><h2>Billed to</h2><strong>${escapeHtml(invoice.customer.businessName)}</strong> (${escapeHtml(invoice.customer.businessCode)})<br>${escapeHtml([invoice.customer.address, invoice.customer.locality, invoice.customer.city].filter(Boolean).join(', '))}<br>${invoice.customer.gstin ? `GSTIN ${escapeHtml(invoice.customer.gstin)}` : 'No GSTIN'}</div></div>
<div class="card"><h2>Placement</h2>${escapeHtml(invoice.placement.placementCode)} · ${escapeHtml(invoice.placement.candidateName)} (${escapeHtml(invoice.placement.candidateCode)}) · ${escapeHtml(invoice.placement.tradeSkill)} · salary ${escapeHtml(formatINR(invoice.placement.monthlySalaryPaise))} a month</div>
<div class="card"><table><thead><tr><th>#</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>${rows}
<tr><td></td><td>CGST ${escapeHtml(line?.cgstRatePercent ?? 0)}%</td><td class="r">${escapeHtml(formatINR(line?.cgstAmountPaise ?? 0))}</td></tr>
<tr><td></td><td>SGST ${escapeHtml(line?.sgstRatePercent ?? 0)}%</td><td class="r">${escapeHtml(formatINR(line?.sgstAmountPaise ?? 0))}</td></tr>
<tr class="total"><td></td><td>Total</td><td class="r">${escapeHtml(formatINR(invoice.summary.totalAmountPaise))}</td></tr></tbody></table></div>
<button type="button" onclick="window.print()">Print or save as PDF</button>
</main></body></html>`;
}
