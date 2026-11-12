import { calculateGst, calculatePlacementFee } from '../../common/money/money';

export interface BypassChargeAmounts {
  feePaise: number;
  penaltyPaise: number;
  gstPaise: number;
  totalPaise: number;
}

/**
 * The no-bypass charge (guide, "No-bypass clause"): the full fee (fee percent
 * of one month's salary) plus the penalty percent of that fee, plus GST on
 * both. Example: salary ₹15,000 → fee ₹7,500 + ₹3,750 = ₹11,250 + GST ₹2,025
 * = ₹13,275. Integer paise only; every percent comes from PricingPolicy.
 */
export function bypassChargeAmounts(monthlySalaryPaise: number, feePercent: number, penaltyPercent: number, gstPercent: number): BypassChargeAmounts {
  const feePaise = calculatePlacementFee(monthlySalaryPaise, feePercent);
  const penaltyPaise = Math.round((feePaise * penaltyPercent) / 100);
  const gstPaise = calculateGst(feePaise + penaltyPaise, gstPercent);
  return { feePaise, penaltyPaise, gstPaise, totalPaise: feePaise + penaltyPaise + gstPaise };
}
