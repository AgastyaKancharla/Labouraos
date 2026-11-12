/**
 * How a placement invoice splits its GST (the stored invoice, placement.service
 * `getInvoice`): half CGST, half SGST (CGST rounded down), no IGST. The GSTR-1
 * data for the CA uses exactly this split. Place of supply and IGST wait for
 * the CA.
 */
export function invoiceGstSplit(totalTaxPaise: number, gstPercent: number) {
  const cgstRatePercent = Math.floor(gstPercent / 2);
  const cgstAmountPaise = Math.floor(totalTaxPaise / 2);
  return {
    cgstRatePercent,
    sgstRatePercent: gstPercent - cgstRatePercent,
    cgstAmountPaise,
    sgstAmountPaise: totalTaxPaise - cgstAmountPaise,
    igstRatePercent: 0,
    igstAmountPaise: 0,
  };
}
