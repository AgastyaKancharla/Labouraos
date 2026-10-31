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
  clockPaused: boolean;
}

export interface RefundDueRow {
  type: RefundDueType;
  id: string;
  code: string;
  city: string;
  amount: number; // integer paise: 49900 or placementFee
  amountOwed: number; // alias for amount (integer paise)
  daysOwed: number; // days elapsed since the refund became owed (longest-owed first)
  daysElapsed: number; // total days elapsed from payment / dropout report
  dueSince: string; // ISO date string when refund obligation began
  // Top-level convenience properties
  name?: string;
  phone?: string;
  tradeSkill?: string;
  paymentReceivedAt?: string;
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
