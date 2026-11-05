import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { KYC_PROVIDER, KycProvider } from './kyc.interface';
import { MockKycProvider } from './mock-kyc.provider';
import { KycModule } from './kyc.module';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { JwtService } from '@nestjs/jwt';

describe('Offline Aadhaar e-KYC Stub (Phase 2 Task 7)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
    const loginRes = await enrolledLogin(server, { email: callAgent.email, password });
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

  it('removes POST /job-seekers/:id/kyc for every staff role', async () => {
    const jwt = app.get(JwtService);
    const roles = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance'];

    for (const role of roles) {
      const token = jwt.sign({ sub: `removed-kyc-${role}`, role, code: `TEST-${role}` });
      const res = await request(app.getHttpServer())
        .post('/job-seekers/removed-kyc-test/kyc')
        .set('Authorization', `Bearer ${token}`)
        .send({ kycStatus: 'verified', kycReference: 'hand-entered-ref' });

      expect(res.status).toBe(404);
    }
  });
});
