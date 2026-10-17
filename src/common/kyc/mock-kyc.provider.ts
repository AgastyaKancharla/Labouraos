import { Injectable, Logger } from '@nestjs/common';
import { KycProvider, KycVerificationResult } from './kyc.interface';
import { assertNoRawAadhaar } from '../../modules/job-seeker/job-seeker.validator';

@Injectable()
export class MockKycProvider implements KycProvider {
  private readonly logger = new Logger(MockKycProvider.name);

  async verifyOfflineAadhaar(params: Record<string, unknown>): Promise<KycVerificationResult> {
    assertNoRawAadhaar(params);

    if (params.simulateFailure) {
      return {
        status: 'failed',
        vendorReference: `mock_kyc_fail_${Date.now()}`,
        error: 'Offline e-KYC validation failed at vendor',
      };
    }

    const vendorReference = `mock_kyc_ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.logger.log(`[MOCK KYC] Offline Aadhaar verified with vendor reference: ${vendorReference}`);

    return {
      status: 'verified',
      vendorReference,
    };
  }
}
