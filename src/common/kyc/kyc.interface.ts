export const KYC_PROVIDER = 'KYC_PROVIDER';

export interface KycVerificationResult {
  status: 'verified' | 'failed';
  vendorReference: string;
  error?: string;
}

export interface KycProvider {
  verifyOfflineAadhaar(params: Record<string, unknown>): Promise<KycVerificationResult>;
}
