export const KYC_PROVIDER = 'KYC_PROVIDER';

export interface KycVerificationResult {
  status: 'verified' | 'failed';
  vendorReference: string;
  error?: string;
  failureType?: 'person' | 'provider';
  last4?: string;
  nameMatches?: boolean;
  isAdult?: boolean;
}

export interface KycHealthResult {
  healthy: boolean;
}

/**
 * The ID-check adapter (KYC_PROVIDER_MODE: mock by default). Since 14 Nov it
 * checks only another government ID — PAN, driving licence or voter ID; the
 * Aadhaar Secure QR is checked in-house (modules/aadhaar-qr), with no outside
 * company. The method name is the original one.
 */
export interface KycProvider {
  verifyOfflineAadhaar(params: Record<string, unknown>): Promise<KycVerificationResult>;
  checkHealth(): Promise<KycHealthResult>;
}
