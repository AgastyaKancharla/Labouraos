import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { KycHealthResult, KycProvider, KycVerificationResult } from './kyc.interface';
import { assertNoRawAadhaar } from '../../modules/job-seeker/job-seeker.validator';

export interface RealKycProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  healthCheckUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

@Injectable()
export class RealKycProvider implements KycProvider {
  private readonly logger = new Logger(RealKycProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly healthCheckUrl: string;
  private readonly now: () => Date;

  constructor(options?: RealKycProviderOptions) {
    this.apiKey =
      options?.apiKey ??
      process.env.KYC_API_KEY ??
      'dummy_ovse_api_key';
    this.baseUrl = (
      options?.baseUrl ??
      process.env.KYC_API_URL ??
      'https://api.surepass.io/api/v1'
    ).replace(/\/$/, '');
    this.healthCheckUrl = options?.healthCheckUrl ?? process.env.KYC_HEALTH_URL ?? `${this.baseUrl}/health`;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.now = options?.now ?? (() => new Date());
  }

  async checkHealth(): Promise<KycHealthResult> {
    try {
      const response = await this.fetchFn(this.healthCheckUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return { healthy: response.ok };
    } catch {
      return { healthy: false };
    }
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
        this.logger.warn(`Licensed OVSE vendor returned status ${response.status}`);
        return {
          status: 'failed',
          vendorReference: `ovse_fail_${Date.now()}`,
          error: response.status >= 500 ? 'e-KYC provider is unavailable' : 'e-KYC validation failed',
          failureType: response.status >= 500 ? 'provider' : 'person',
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
          full_name?: string;
          aadhaar_number?: string;
          date_of_birth?: string;
          dob?: string;
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

      const vendorName = data.data?.full_name?.trim();
      const candidateName = typeof params.candidateName === 'string' ? params.candidateName.trim() : '';
      const nameMatches = vendorName && candidateName
        ? vendorName.toLocaleLowerCase('en-IN') === candidateName.toLocaleLowerCase('en-IN')
        : undefined;
      const rawLast4 = data.data?.aadhaar_number?.replace(/\D/g, '').slice(-4);
      const dateOfBirth = data.data?.date_of_birth ?? data.data?.dob;
      const isAdult = dateOfBirth ? this.isAdult(dateOfBirth) : undefined;
      const passedPersonChecks = nameMatches !== false && isAdult !== false;

      // CRITICAL: Strip ALL extra vendor echo fields. Store and return ONLY verification result and vendor reference.
      return {
        status: isVerified && passedPersonChecks ? 'verified' : 'failed',
        vendorReference,
        error: isVerified && passedPersonChecks ? undefined : nameMatches === false ? 'Name mismatch' : isAdult === false ? 'Applicant is under 18' : data.message || 'e-KYC validation failed',
        failureType: 'person',
        ...(rawLast4 && /^\d{4}$/.test(rawLast4) ? { last4: rawLast4 } : {}),
        ...(nameMatches !== undefined ? { nameMatches } : {}),
        ...(isAdult !== undefined ? { isAdult } : {}),
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
        error: 'Network error connecting to e-KYC provider',
        failureType: 'provider',
      };
    }
  }

  private isAdult(value: string): boolean {
    const dob = new Date(value);
    if (Number.isNaN(dob.getTime())) return false;
    const today = this.now();
    let age = today.getUTCFullYear() - dob.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())) age -= 1;
    return age >= 18;
  }
}
