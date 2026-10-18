import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 4 Task 6: RBAC PII Masking and Seed Verification', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let financeToken: string;
  let managerToken: string;
  let fieldAgentToken: string;

  let testBusinessId: string;
  let testVacancyId: string;

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

    const fin = await prisma.staff.create({
      data: {
        code: `FN-P4-${timestamp}`,
        name: 'Finance P4',
        email: `fn_p4_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    const mgr = await prisma.staff.create({
      data: {
        code: `MG-P4-${timestamp}`,
        name: 'Manager P4',
        email: `mgr_p4_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const fa = await prisma.staff.create({
      data: {
        code: `FA-P4-${timestamp}`,
        name: 'Field Agent P4',
        email: `fa_p4_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await request(server).post('/auth/login').send({ email, password });
      return res.body.accessToken;
    };

    financeToken = await login(fin.email);
    managerToken = await login(mgr.email);
    fieldAgentToken = await login(fa.email);

    // Create Business with sensitive phone number
    const business = await prisma.business.create({
      data: {
        code: `BZ-P4-${timestamp}`,
        name: 'Sensitive Business Corp',
        contactName: 'Secret Contact',
        phone: `96${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
        area: 'Koramangala',
        city: 'Bengaluru',
        latitude: 12.9352,
        longitude: 77.6245,
      },
    });
    testBusinessId = business.id;

    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-P4-${timestamp}`,
        businessId: business.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2500000,
        status: 'open',
      },
    });
    testVacancyId = vacancy.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('masks phone number when finance reads business list (GET /businesses)', async () => {
    const res = await request(app.getHttpServer())
      .get('/businesses')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const target = res.body.find((b: { id: string }) => b.id === testBusinessId);
    expect(target).toBeDefined();
    expect(target.phone).toBe('********');
    expect(target.name).toBe('Sensitive Business Corp');
    expect(target.code).toBeDefined();
  });

  it('masks phone number when finance reads a specific business (GET /businesses/:id)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/businesses/${testBusinessId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(res.body.id).toBe(testBusinessId);
    expect(res.body.phone).toBe('********');
    expect(res.body.name).toBe('Sensitive Business Corp');
  });

  it('masks nested business phone when finance reads vacancies (GET /vacancies and GET /vacancies/:id)', async () => {
    // List
    const listRes = await request(app.getHttpServer())
      .get('/vacancies')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    const targetVac = listRes.body.find((v: { id: string }) => v.id === testVacancyId);
    expect(targetVac).toBeDefined();
    expect(targetVac.business.phone).toBe('********');

    // Single item
    const singleRes = await request(app.getHttpServer())
      .get(`/vacancies/${testVacancyId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(singleRes.body.id).toBe(testVacancyId);
    expect(singleRes.body.business.phone).toBe('********');
  });

  it('does NOT mask phone number when manager or field agent reads business', async () => {
    const mgrRes = await request(app.getHttpServer())
      .get(`/businesses/${testBusinessId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(mgrRes.body.phone).not.toBe('********');
    expect(mgrRes.body.phone).toMatch(/^96/);

    const faRes = await request(app.getHttpServer())
      .get(`/businesses/${testBusinessId}`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .expect(200);

    expect(faRes.body.phone).not.toBe('********');
    expect(faRes.body.phone).toMatch(/^96/);
  });
});
