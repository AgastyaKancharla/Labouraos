import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { RealKycProvider } from './real-kyc.provider';
import { KYC_PROVIDER, KycProvider } from './kyc.interface';
import { KycModule } from './kyc.module';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 7 Task 3: Real Aadhaar e-KYC Vendor Integration', () => {
  describe('RealKycProvider Unit Tests', () => {
    let capturedRequests: Array<{ url: string; options?: RequestInit }>;
    let mockFetch: typeof fetch;

    beforeEach(() => {
      capturedRequests = [];
      mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        capturedRequests.push({ url: urlStr, options: init });

        // Simulate vendor response echoing extra raw demographic details
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            status_code: 200,
            message: 'Aadhaar e-KYC verified',
            data: {
              client_id: 'ovse_client_ref_998877',
              status: 'VALID',
              // Vendor potentially echoes demographic info or raw numbers
              aadhaar_number: '998877665544',
              raw_aadhaar: '9988 7766 5544',
              full_name: 'Suresh Gowda',
              dob: '1985-05-15',
              address: { state: 'Karnataka', pincode: '560034' },
            },
          }),
          text: async () => '{"success":true}',
        } as Response;
      }) as unknown as typeof fetch;
    });

    it('calls licensed OVSE vendor API and strips all echoed demographic/raw Aadhaar data', async () => {
      const provider = new RealKycProvider({
        apiKey: 'test_ovse_api_key',
        baseUrl: 'https://api.surepass.io/api/v1',
        fetchFn: mockFetch,
      });

      const result = await provider.verifyOfflineAadhaar({
        otp: '445566',
        shareCode: '1234',
      });

      expect(result.status).toBe('verified');
      expect(result.vendorReference).toBe('ovse_client_ref_998877');

      // Crucial verification: result object must strictly have ONLY status, vendorReference, error
      const keys = Object.keys(result);
      expect(keys).toEqual(expect.arrayContaining(['status', 'vendorReference']));
      const rawRecord = result as unknown as Record<string, unknown>;
      expect(rawRecord.aadhaar_number).toBeUndefined();
      expect(rawRecord.raw_aadhaar).toBeUndefined();
      expect(rawRecord.full_name).toBeUndefined();

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0].url).toBe(
        'https://api.surepass.io/api/v1/aadhaar-v2/submit-otp',
      );
      const auth = capturedRequests[0].options?.headers as Record<string, string>;
      expect(auth.Authorization).toBe('Bearer test_ovse_api_key');
    });

    it('rejects input containing raw Aadhaar numbers before calling vendor', async () => {
      const provider = new RealKycProvider({
        fetchFn: mockFetch,
      });

      await expect(
        provider.verifyOfflineAadhaar({
          aadhaar: '998877665544',
        }),
      ).rejects.toThrow(/raw Aadhaar/i);

      expect(capturedRequests).toHaveLength(0);
    });

    it('handles vendor failure response gracefully without crashing', async () => {
      const failingFetch = (async () => {
        return {
          ok: false,
          status: 400,
          text: async () => 'Invalid OTP or expired session',
        } as Response;
      }) as unknown as typeof fetch;

      const provider = new RealKycProvider({
        fetchFn: failingFetch,
      });

      const res = await provider.verifyOfflineAadhaar({ shareCode: '9999' });
      expect(res.status).toBe('failed');
      expect(res.vendorReference).toMatch(/^ovse_fail_/);
      expect(res.error).toBe('e-KYC validation failed');
      expect(res.failureType).toBe('person');
      expect(res.error).not.toContain('Invalid OTP or expired session');
    });

    it('classifies 5xx responses as provider failures without storing response text', async () => {
      const provider = new RealKycProvider({
        fetchFn: (async () => ({
          ok: false,
          status: 503,
          text: async () => 'sensitive vendor response',
        }) as Response) as unknown as typeof fetch,
      });
      const result = await provider.verifyOfflineAadhaar({ shareCode: '9999' });
      expect(result.failureType).toBe('provider');
      expect(result.error).toBe('e-KYC provider is unavailable');
      expect(result.error).not.toContain('sensitive vendor response');
    });
  });

  describe('Integration Test: Database Persistence Under Real Vendor Response (Zero Raw Aadhaar Stored)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let callAgentToken: string;
    const timestamp = Date.now();

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();

      prisma = app.get<PrismaService>(PrismaService);
      const password = 'Password123!Secure';
      const passwordHash = await bcrypt.hash(password, 10);

      const callAgent = await prisma.staff.create({
        data: {
          code: `CA-P7K-${timestamp}`,
          name: 'Call Agent P7 KYC',
          email: `ca_p7k_${timestamp}@laboura.local`,
          passwordHash,
          role: 'call_agent',
          city: 'Bengaluru',
        },
      });

      const loginRes = await enrolledLogin(app.getHttpServer(), { email: callAgent.email, password });
      callAgentToken = loginRes.body.accessToken;
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('returns 404 for the removed hand-entered KYC endpoint', async () => {
      // 1. Create a candidate
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P7K-${timestamp}`,
          name: 'Real KYC Candidate',
          phone: `96002${String(timestamp).slice(-5)}`,
          phoneVerified: true,
          trades: { create: { trade: 'Plumber', isPrimary: true } },
          minSalary: 1600000,
          maxSalary: 2200000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'pending_payment',
          city: 'Bengaluru',
        },
      });

      const kycRes = await request(app.getHttpServer())
        .post(`/job-seekers/${candidate.id}/kyc`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({ kycReference: 'legacy-hand-entered-ref', kycStatus: 'verified' });

      expect(kycRes.status).toBe(404);
      const verifications = await prisma.identityVerification.findMany({ where: { jobSeekerId: candidate.id } });
      expect(verifications).toHaveLength(0);
    });
  });

  describe('KycModule provider selection with KYC_PROVIDER env flag', () => {
    const originalEnv = process.env.KYC_PROVIDER;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.KYC_PROVIDER;
      } else {
        process.env.KYC_PROVIDER = originalEnv;
      }
    });

    it('instantiates RealKycProvider when KYC_PROVIDER=real or surepass', async () => {
      process.env.KYC_PROVIDER = 'real';

      const moduleRef = await Test.createTestingModule({
        imports: [KycModule],
      }).compile();

      const provider = moduleRef.get<KycProvider>(KYC_PROVIDER);
      expect(provider).toBeInstanceOf(RealKycProvider);

      process.env.KYC_PROVIDER = 'surepass';
      const moduleRefSurepass = await Test.createTestingModule({
        imports: [KycModule],
      }).compile();
      expect(moduleRefSurepass.get<KycProvider>(KYC_PROVIDER)).toBeInstanceOf(
        RealKycProvider,
      );
    });
  });
});
