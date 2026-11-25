export type RefundDueType = 'job_seeker' | 'placement';

export interface RefundDueJobSeekerDetails {
  id: string;
  code: string;
  name: string;
  phone: string;
  tradeSkill: string;
  paymentReceivedAt: string;
}

export interface RefundDuePlacementDetails {
  id: string;
  code: string;
  joinedDate: string | null;
  dropoutReportedAt: string | null;
  dropoutDateCallerSupplied: boolean;
  businessName: string;
  candidateName: string;
  candidatePhone?: string;
  placementFee: number;
}

export interface RefundDueRow {
  type: RefundDueType;
  id: string;
  code: string;
  city: string;
  amount: number; // integer paise: activationFee or placementFee
  amountOwed: number; // alias for amount (integer paise)
  daysOwed: number; // days elapsed since the refund became owed (longest-owed first)
  daysElapsed: number; // total days elapsed from payment / dropout report
  dueSince: string; // ISO date string when refund obligation began
  /** M4 (rev 178): a business refund's parts — the first placement fee and each paid salary difference, each with its GST. */
  refundParts?: { placementId: string; kind: 'placement_fee' | 'salary_difference'; feePaise: number; gstPaise: number }[];
  // Top-level convenience properties
  name?: string;
  phone?: string;
  tradeSkill?: string;
  paymentReceivedAt?: string;
  /** Rev 211: when his 30 days started (paid and ID passed); the day-30 refund counts from here. */
  guaranteeStartsAt?: string;
  joinedDate?: string | null;
  dropoutReportedAt?: string | null;
  dropoutDateCallerSupplied?: boolean;
  businessName?: string;
  candidateName?: string;
  candidatePhone?: string;
  // Nested details
  jobSeeker?: RefundDueJobSeekerDetails;
  placement?: RefundDuePlacementDetails;
}
