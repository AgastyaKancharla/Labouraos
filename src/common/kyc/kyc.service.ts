import { Inject, Injectable } from '@nestjs/common';
import { KYC_PROVIDER, KycHealthResult, KycProvider, KycVerificationResult } from './kyc.interface';

@Injectable()
export class KycService {
  constructor(
    @Inject(KYC_PROVIDER)
    private readonly provider: KycProvider,
  ) {}

  getProvider(): KycProvider {
    return this.provider;
  }

  async verifyOfflineAadhaar(params: Record<string, unknown>): Promise<KycVerificationResult> {
    return this.provider.verifyOfflineAadhaar(params);
  }

  async checkHealth(): Promise<KycHealthResult> {
    return this.provider.checkHealth();
  }
}
