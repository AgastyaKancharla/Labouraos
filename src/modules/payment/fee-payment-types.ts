/** A placement fee, or a replacement's salary-upgrade difference (D3, rev 176): a fee plus GST on its placement. */
export const FEE_PAYMENT_TYPES = ['placement_fee', 'replacement_upgrade'] as const;

export const isFeePaymentType = (type: string): boolean => (FEE_PAYMENT_TYPES as readonly string[]).includes(type);
