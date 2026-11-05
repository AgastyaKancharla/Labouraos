export interface CreateIdentityVerificationDto {
  method: string;
  vendor?: string;
  vendorReference?: string;
  status?: string;
  last4?: string;
  nameMatches?: boolean;
  isAdult?: boolean;
  failureReason?: string;
}
