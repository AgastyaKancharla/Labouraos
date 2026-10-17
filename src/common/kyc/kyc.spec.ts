import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../otp/otp.service';
import { MockOtpProvider } from '../otp/mock-otp.provider';
import { KYC_PROVIDER, KycProvider } from './kyc.interface';
import { MockKycProvider } from './mock-kyc.provider';
import { KycModule } from './kyc.module';

describe('Offline Aadhaar e-KYC Stub (Phase 2 Task 7)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let callAgentToken: string;
  let callAgentId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-KYC-${timestamp}`,
        name: 'Call Agent KYC',
        email: `call_agent_kyc_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const server = app.getHttpServer();
    const loginRes = await request(server)
      .post('/auth/login')
      .send({ email: callAgent.email, password });
    callAgentToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: callAgentId },
            { entityType: 'job_seeker' },
          ],
        },
      });
      await prisma.jobSeeker.deleteMany({
        where: {
          phone: { contains: `${timestamp.toString().slice(-8)}` },
        },
      });
      await prisma.staff.deleteMany({
        where: { id: callAgentId },
      });
    }
    if (app) {
      await app.close();
    }
  });

  async function createPendingJobSeeker(phoneSuffix: string) {
    const phone = `61${phoneSuffix}`;
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: `KYC Candidate ${phoneSuffix}`,
        phone,
        otpRequestId: requestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      });

    return res.body;
  }

  describe('MockKycProvider & Provider Selection', () => {
    const originalEnv = process.env.KYC_PROVIDER;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.KYC_PROVIDER;
      } else {
        process.env.KYC_PROVIDER = originalEnv;
      }
    });

    it('defaults to MockKycProvider when KYC_PROVIDER is unset', async () => {
      delete process.env.KYC_PROVIDER;

      const moduleRef = await Test.createTestingModule({
        imports: [KycModule],
      }).compile();

      const provider = moduleRef.get<KycProvider>(KYC_PROVIDER);
      expect(provider).toBeInstanceOf(MockKycProvider);
    });

    it('selects MockKycProvider when KYC_PROVIDER=mock', async () => {
      process.env.KYC_PROVIDER = 'mock';

      const moduleRef = await Test.createTestingModule({
        imports: [KycModule],
      }).compile();

      const provider = moduleRef.get<KycProvider>(KYC_PROVIDER);
      expect(provider).toBeInstanceOf(MockKycProvider);
    });

    it('throws error when unsupported KYC_PROVIDER is specified', async () => {
      process.env.KYC_PROVIDER = 'unknown_kyc';

      await expect(
        Test.createTestingModule({
          imports: [KycModule],
        }).compile(),
      ).rejects.toThrow('Unsupported KYC provider: unknown_kyc');
    });

    it('MockKycProvider produces verified result with vendorReference', async () => {
      const mockProvider = new MockKycProvider();
      const res = await mockProvider.verifyOfflineAadhaar({ shareCode: '1234' });
      expect(res.status).toBe('verified');
      expect(res.vendorReference).toMatch(/^mock_kyc_ref_/);
    });
  });

  describe('POST /job-seekers/:id/kyc endpoint', () => {
    it('accepts vendor reference and verified result, updating kycStatus and audit logging', async () => {
      const seeker = await createPendingJobSeeker(timestamp.toString().slice(-8));

      const vendorRef = `vendor_ref_${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${seeker.id}/kyc`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          kycReference: vendorRef,
          kycStatus: 'verified',
        });

      expect(res.status).toBe(201);
      expect(res.body.kycStatus).toBe('verified');
      expect(res.body.kycReference).toBe(vendorRef);

      // Verify in DB
      const dbSeeker = await prisma.jobSeeker.findUnique({
        where: { id: seeker.id },
      });
      expect(dbSeeker?.kycStatus).toBe('verified');
      expect(dbSeeker?.kycReference).toBe(vendorRef);

      // Verify audit log
      const logs = await prisma.auditLog.findMany({
        where: {
          entityCode: seeker.code,
          action: 'job_seeker.kyc',
        },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorId).toBe(callAgentId);
    });

    it('accepts vendor reference and failed result', async () => {
      const phoneSuffix = (timestamp + 1).toString().slice(-8);
      const seeker = await createPendingJobSeeker(phoneSuffix);

      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${seeker.id}/kyc`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          kycReference: 'vendor_ref_failed_123',
          kycStatus: 'failed',
        });

      expect(res.status).toBe(201);
      expect(res.body.kycStatus).toBe('failed');
      expect(res.body.kycReference).toBe('vendor_ref_failed_123');
    });

    it('MANDATORY SECURITY: rejects submitting a 12-digit number under any field name', async () => {
      const phoneSuffix = (timestamp + 2).toString().slice(-8);
      const seeker = await createPendingJobSeeker(phoneSuffix);

      // Attempt 1: Field named aadhaar
      const res1 = await request(app.getHttpServer())
        .post(`/job-seekers/${seeker.id}/kyc`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          kycReference: 'vendor_ref_123',
          kycStatus: 'verified',
          aadhaar: '123456789012',
        });
      expect(res1.status).toBe(400);
      expect(res1.body.message).toContain('Aadhaar');

      // Attempt 2: 12-digit number string in an arbitrary field name
      const res2 = await request(app.getHttpServer())
        .post(`/job-seekers/${seeker.id}/kyc`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          kycReference: 'vendor_ref_123',
          kycStatus: 'verified',
          documentNumber: '987654321098',
        });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toContain('Aadhaar');

      // Attempt 3: 12-digit number with spaces "1234 5678 9012"
      const res3 = await request(app.getHttpServer())
        .post(`/job-seekers/${seeker.id}/kyc`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          kycReference: 'vendor_ref_123',
          kycStatus: 'verified',
          arbitraryKey: '1234 5678 9012',
        });
      expect(res3.status).toBe(400);
      expect(res3.body.message).toContain('Aadhaar');

      // Verify DB record was NOT modified with any 12-digit number
      const dbSeeker = await prisma.jobSeeker.findUnique({
        where: { id: seeker.id },
      });
      expect(dbSeeker?.kycReference).toBeNull();
    });
  });
});
