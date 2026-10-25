import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { KycProvider, KycVerificationResult } from './kyc.interface';
import { assertNoRawAadhaar } from '../../modules/job-seeker/job-seeker.validator';

export interface RealKycProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

@Injectable()
export class RealKycProvider implements KycProvider {
  private readonly logger = new Logger(RealKycProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: RealKycProviderOptions) {
    this.apiKey =
      options?.apiKey ??
      process.env.KYC_API_KEY ??
      process.env.OVSE_API_KEY ??
      'dummy_ovse_api_key';
    this.baseUrl = (
      options?.baseUrl ??
      process.env.KYC_API_URL ??
      process.env.OVSE_API_URL ??
      'https://api.surepass.io/api/v1'
    ).replace(/\/$/, '');
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  async verifyOfflineAadhaar(
    params: Record<string, unknown>,
  ): Promise<KycVerificationResult> {
    // 1. Mandatory Legal Rule (AGENTS.md §2 rule 3): Never accept or pass raw Aadhaar number
    assertNoRawAadhaar(params);

    try {
      const response = await this.fetchFn(`${this.baseUrl}/aadhaar-v2/submit-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Licensed OVSE vendor returned status ${response.status}: ${errorText}`);
        return {
          status: 'failed',
          vendorReference: `ovse_fail_${Date.now()}`,
          error: `e-KYC vendor error: ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        success?: boolean;
        status_code?: number;
        message?: string;
        data?: {
          client_id?: string;
          status?: string;
          reference_id?: string;
          // Note: Vendor response might echo demographic details or raw fields
        };
      };

      const isVerified =
        data.success === true ||
        data.status_code === 200 ||
        data.data?.status === 'VALID' ||
        data.data?.status === 'success';

      const vendorReference =
        data.data?.client_id ||
        data.data?.reference_id ||
        `ovse_ref_${Date.now()}`;

      // CRITICAL: Strip ALL extra vendor echo fields. Store and return ONLY verification result and vendor reference.
      return {
        status: isVerified ? 'verified' : 'failed',
        vendorReference,
        error: isVerified ? undefined : data.message || 'e-KYC validation failed',
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Network failure communicating with licensed OVSE vendor: ${msg}`);
      return {
        status: 'failed',
        vendorReference: `ovse_err_${Date.now()}`,
        error: `Network error connecting to e-KYC vendor: ${msg}`,
      };
    }
  }
}
