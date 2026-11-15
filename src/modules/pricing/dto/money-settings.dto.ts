export interface UpdateApprovalLimitsDto {
  businessRefundLimitPaise: number;
  expenseLimitPaise: number;
}

export interface UpdateCompanyDetailsDto {
  /** Legal documents (rev 176): shown on every legal text and public page footer. */
  cin?: string | null;
  grievanceOfficerName?: string | null;
  grievanceOfficerPhone?: string | null;
  grievanceOfficerEmail?: string | null;
  legalName: string;
  gstin?: string | null;
  address?: string | null;
}
