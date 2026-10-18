import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';

import { MockOtpProvider } from '../../common/otp/mock-otp.provider';

describe('Phase 4 Task 1: Business Onboarding', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let fieldAgentKoramangalaToken: string;
  let fieldAgentIndiranagarToken: string;
  let callAgentToken: string;
  let managerToken: string;

  let faKoramangalaId: string;
  let faIndiranagarId: string;
  let callAgentId: string;
  let managerId: string;

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

    const faKora = await prisma.staff.create({
      data: {
        code: `FA-KORA-${timestamp}`,
        name: 'Field Agent Koramangala',
        email: `fa_kora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    faKoramangalaId = faKora.id;

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-INDI-${timestamp}`,
        name: 'Field Agent Indiranagar',
        email: `fa_indi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    faIndiranagarId = faIndi.id;

    const ca = await prisma.staff.create({
      data: {
        code: `CA-BIZ-${timestamp}`,
        name: 'Call Agent Biz',
        email: `ca_biz_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = ca.id;

    const mgr = await prisma.staff.create({
      data: {
        code: `MG-BIZ-${timestamp}`,
        name: 'Manager Biz',
        email: `mgr_biz_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    managerId = mgr.id;

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await request(server).post('/auth/login').send({ email, password });
      return res.body.accessToken;
    };

    fieldAgentKoramangalaToken = await login(faKora.email);
    fieldAgentIndiranagarToken = await login(faIndi.email);
    callAgentToken = await login(ca.email);
    managerToken = await login(mgr.email);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.business.deleteMany({
        where: {
          phone: {
            in: [
              `91${timestamp.toString().slice(-8)}`,
              `92${timestamp.toString().slice(-8)}`,
              `93${timestamp.toString().slice(-8)}`,
              `94${timestamp.toString().slice(-8)}`,
              `95${timestamp.toString().slice(-8)}`,
            ],
          },
        },
      });
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [faKoramangalaId, faIndiranagarId, callAgentId, managerId] },
        },
      });
      await prisma.staff.deleteMany({
        where: {
          id: { in: [faKoramangalaId, faIndiranagarId, callAgentId, managerId] },
        },
      });
    }
    if (app) {
      await app.close();
    }
  });

  const getVerifiedOtp = async (phone: string) => {
    const sendRes = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(sendRes.requestId)!;
    await otpService.verifyOtp(sendRes.requestId, code);
    return sendRes.requestId;
  };

  it('rejects business registration if OTP is missing or unverified', async () => {
    const phone = `91${timestamp.toString().slice(-8)}`;

    const resNoOtp = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'No OTP Cafe',
        phone,
        area: 'Koramangala',
      });
    expect(resNoOtp.status).toBe(400);

    const resUnverifiedOtp = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Unverified Cafe',
        phone,
        otpRequestId: 'random_unverified_request_id',
        area: 'Koramangala',
      });
    expect(resUnverifiedOtp.status).toBe(400);
  });

  it('field agent creates business stamped automatically with their own area', async () => {
    const phone = `92${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Koramangala Bakers',
        address: '80 Feet Road, 4th Block',
        contactPerson: 'Ramesh Patel',
        phone,
        otpRequestId,
        gstNumber: '29ABCDE1234F1Z5',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^BZ-\d{5}$/);
    expect(res.body.name).toBe('Koramangala Bakers');
    expect(res.body.area).toBe('Koramangala'); // Stamped with agent's area automatically
    expect(res.body.phone).toBe(phone);
    expect(res.body.contactName).toBe('Ramesh Patel');
    expect(res.body.gstNumber).toBe('29ABCDE1234F1Z5');
    expect(res.body.phoneVerified).toBe(true);

    // Assert audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityCode: res.body.code,
        action: 'business.created',
      },
    });
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe(faKoramangalaId);
  });

  it('field agent cannot write a business in another agent area (403)', async () => {
    const phone = `93${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Indiranagar Boutique',
        address: '100 Feet Road',
        contactPerson: 'Sunita Rao',
        phone,
        otpRequestId,
        area: 'Indiranagar', // Different from Koramangala
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Access denied');
  });

  it('field agent cannot read a business in another area (403), but call agent and manager can', async () => {
    // 1. Create a business in Indiranagar by Indiranagar field agent
    const phoneIndi = `94${timestamp.toString().slice(-8)}`;
    const otpIndi = await getVerifiedOtp(phoneIndi);

    const createRes = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentIndiranagarToken}`)
      .send({
        name: 'Indiranagar Tech Labs',
        address: '12th Main Indiranagar',
        contactPerson: 'Deepak Verma',
        phone: phoneIndi,
        otpRequestId: otpIndi,
      });

    expect(createRes.status).toBe(201);
    const indiranagarBusinessId = createRes.body.id;

    // 2. Koramangala field agent tries to GET /businesses/:id of Indiranagar business -> 403 Forbidden
    const koraAgentReadRes = await request(app.getHttpServer())
      .get(`/businesses/${indiranagarBusinessId}`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraAgentReadRes.status).toBe(403);

    // 3. Koramangala field agent GET /businesses list -> does NOT include Indiranagar business
    const koraListRes = await request(app.getHttpServer())
      .get('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraListRes.status).toBe(200);
    const found = koraListRes.body.find((b: { id: string }) => b.id === indiranagarBusinessId);
    expect(found).toBeUndefined();

    // 4. Call agent can read any business regardless of area
    const caReadRes = await request(app.getHttpServer())
      .get(`/businesses/${indiranagarBusinessId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);
    expect(caReadRes.status).toBe(200);
    expect(caReadRes.body.name).toBe('Indiranagar Tech Labs');

    // 5. Manager can read any business
    const mgrReadRes = await request(app.getHttpServer())
      .get(`/businesses/${indiranagarBusinessId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(mgrReadRes.status).toBe(200);
    expect(mgrReadRes.body.name).toBe('Indiranagar Tech Labs');
  });

  it('call agent can create a business in any area', async () => {
    const phone = `95${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Whitefield Logistics Hub',
        address: 'ITPL Main Road',
        contactPerson: 'Anil Deshmukh',
        phone,
        otpRequestId,
        area: 'Whitefield',
      });

    expect(res.status).toBe(201);
    expect(res.body.area).toBe('Whitefield');
    expect(res.body.code).toMatch(/^BZ-\d{5}$/);
  });
});
