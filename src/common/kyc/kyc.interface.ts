export const KYC_PROVIDER = 'KYC_PROVIDER';

export interface KycVerificationResult {
  status: 'verified' | 'failed';
  vendorReference: string;
  error?: string;
  failureType?: 'person' | 'provider';
}

export interface KycHealthResult {
  healthy: boolean;
}

export interface KycProvider {
  verifyOfflineAadhaar(params: Record<string, unknown>): Promise<KycVerificationResult>;
  checkHealth(): Promise<KycHealthResult>;
}
