export interface UpdateApprovalLimitsDto {
  businessRefundLimitPaise: number;
  expenseLimitPaise: number;
}

export interface UpdateCompanyDetailsDto {
  legalName: string;
  gstin?: string | null;
  address?: string | null;
}
