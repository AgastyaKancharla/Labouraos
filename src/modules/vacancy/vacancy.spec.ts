import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 4 Task 2: Vacancy Capture', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let fieldAgentKoramangalaToken: string;
  let fieldAgentIndiranagarToken: string;
  let callAgentToken: string;
  let managerToken: string;

  let faKoramangalaId: string;
  let faIndiranagarId: string;
  let callAgentId: string;
  let managerId: string;

  let koramangalaBusinessId: string;
  let indiranagarBusinessId: string;

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

    const faKora = await prisma.staff.create({
      data: {
        code: `FA-VKORA-${timestamp}`,
        name: 'Field Agent Koramangala Vacancy',
        email: `fa_vkora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    faKoramangalaId = faKora.id;

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-VINDI-${timestamp}`,
        name: 'Field Agent Indiranagar Vacancy',
        email: `fa_vindi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    faIndiranagarId = faIndi.id;

    const ca = await prisma.staff.create({
      data: {
        code: `CA-VAC-${timestamp}`,
        name: 'Call Agent Vacancy',
        email: `ca_vac_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = ca.id;

    const mgr = await prisma.staff.create({
      data: {
        code: `MG-VAC-${timestamp}`,
        name: 'Manager Vacancy',
        email: `mgr_vac_${timestamp}@laboura.local`,
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

    // Create a Koramangala business
    const bizKora = await prisma.business.create({
      data: {
        code: `BZ-VKORA-${timestamp}`,
        name: 'Koramangala Cafe & Resto',
        area: 'Koramangala',
        city: 'Bengaluru',
        phone: `81${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
      },
    });
    koramangalaBusinessId = bizKora.id;

    // Create an Indiranagar business
    const bizIndi = await prisma.business.create({
      data: {
        code: `BZ-VINDI-${timestamp}`,
        name: 'Indiranagar Retail Mart',
        area: 'Indiranagar',
        city: 'Bengaluru',
        phone: `82${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
      },
    });
    indiranagarBusinessId = bizIndi.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.vacancy.deleteMany({
        where: { businessId: { in: [koramangalaBusinessId, indiranagarBusinessId] } },
      });
      await prisma.business.deleteMany({
        where: { id: { in: [koramangalaBusinessId, indiranagarBusinessId] } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [faKoramangalaId, faIndiranagarId, callAgentId, managerId] },
        },
      });
      await prisma.staff.deleteMany({
        where: { id: { in: [faKoramangalaId, faIndiranagarId, callAgentId, managerId] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('rejects vacancy creation if tradeSkill or offeredSalary is missing or invalid', async () => {
    const resNoTrade = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        offeredSalary: 2000000,
        headcount: 2,
      });
    expect(resNoTrade.status).toBe(400);

    const resNegativeSalary = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        tradeSkill: 'Electrician',
        offeredSalary: -500,
      });
    expect(resNegativeSalary.status).toBe(400);

    const resFloatSalary = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        tradeSkill: 'Electrician',
        offeredSalary: 20000.5, // Float money is forbidden per AGENTS.md §2
      });
    expect(resFloatSalary.status).toBe(400);
  });

  it('field agent creates vacancy on a business in their own area', async () => {
    const res = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        tradeSkill: 'Electrician',
        offeredSalary: 2200000, // ₹22,000 in paise
        headcount: 3,
        description: 'Commercial wiring and panel installation',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^VC-\d{5}$/);
    expect(res.body.tradeSkill).toBe('Electrician');
    expect(res.body.offeredSalary).toBe(2200000);
    expect(res.body.headcount).toBe(3);
    expect(res.body.status).toBe('open');
    expect(res.body.businessId).toBe(koramangalaBusinessId);

    // Audit log check
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityCode: res.body.code,
        action: 'vacancy.created',
      },
    });
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe(faKoramangalaId);
  });

  it('field agent cannot create vacancy on a business in another area (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/businesses/${indiranagarBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`) // Koramangala agent targeting Indiranagar
      .send({
        tradeSkill: 'Plumber',
        offeredSalary: 1800000,
        headcount: 1,
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Access denied');
  });

  it('field agent only sees vacancies in their own area, while call agent sees all', async () => {
    // 1. Create a vacancy in Indiranagar by Indiranagar agent
    const indiVacRes = await request(app.getHttpServer())
      .post(`/businesses/${indiranagarBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${fieldAgentIndiranagarToken}`)
      .send({
        tradeSkill: 'Sales Associate',
        offeredSalary: 2500000,
        headcount: 2,
      });
    expect(indiVacRes.status).toBe(201);
    const indiranagarVacancyId = indiVacRes.body.id;

    // 2. Koramangala agent tries to GET /vacancies/:id of Indiranagar vacancy -> 403 Forbidden
    const koraReadRes = await request(app.getHttpServer())
      .get(`/vacancies/${indiranagarVacancyId}`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraReadRes.status).toBe(403);

    // 3. Koramangala agent GET /vacancies list -> only contains Koramangala vacancies
    const koraListRes = await request(app.getHttpServer())
      .get('/vacancies')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraListRes.status).toBe(200);
    const hasIndi = koraListRes.body.some((v: { id: string }) => v.id === indiranagarVacancyId);
    expect(hasIndi).toBe(false);

    // 4. Call agent can read the Indiranagar vacancy
    const caReadRes = await request(app.getHttpServer())
      .get(`/vacancies/${indiranagarVacancyId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);
    expect(caReadRes.status).toBe(200);
    expect(caReadRes.body.tradeSkill).toBe('Sales Associate');

    // 5. Manager can list all vacancies
    const mgrListRes = await request(app.getHttpServer())
      .get('/vacancies')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(mgrListRes.status).toBe(200);
    const mgrHasIndi = mgrListRes.body.some((v: { id: string }) => v.id === indiranagarVacancyId);
    expect(mgrHasIndi).toBe(true);
  });
});
