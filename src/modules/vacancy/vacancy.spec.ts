import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

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
    const login = async (email: string | null) => {
      const res = await enrolledLogin(server, { email, password });
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
        accountAgentId: faKora.id,
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
        accountAgentId: faIndi.id,
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

  it('rejects vacancy creation if tradeSkill or salaryMinPaise is missing or invalid', async () => {
    const resNoTrade = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        salaryMinPaise: 2000000,
        headcount: 2,
      });
    expect(resNoTrade.status).toBe(400);

    const resNegativeSalary = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        tradeSkill: 'Electrician',
        salaryMinPaise: -500,
      });
    expect(resNegativeSalary.status).toBe(400);

    const resFloatSalary = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        tradeSkill: 'Electrician',
        salaryMinPaise: 20000.5, // Float money is forbidden per AGENTS.md §2
      });
    expect(resFloatSalary.status).toBe(400);
  });

  it('field agent creates vacancy for their account business regardless of legacy area', async () => {
    const res = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        tradeSkill: 'Electrician',
        salaryMinPaise: 2200000, // ₹22,000 in paise
        headcount: 3,
        description: 'Commercial wiring and panel installation',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^VC-\d{5}$/);
    expect(res.body.tradeSkill).toBe('Electrician');
    expect(res.body.salaryMinPaise).toBe(2200000);
    expect(res.body.offeredSalary).toBeNull();
    expect(res.body.headcount).toBe(3);
    expect(res.body.status).toBe('open');
    expect(res.body.businessId).toBe(koramangalaBusinessId);

    // Audit log check
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityCode: res.body.code,
        action: 'vacancy.created',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe(faKoramangalaId);
  });

  it('requires a reason for a gender requirement and creates a walk-in slot using current policy times', async () => {
    const policy = await prisma.pricingPolicy.findFirstOrThrow({ orderBy: { effectiveFrom: 'desc' } });
    const originalStart = policy.walkInStart;
    const originalEnd = policy.walkInEnd;
    await prisma.pricingPolicy.update({
      where: { id: policy.id },
      data: { walkInStart: '11:15', walkInEnd: '17:45' },
    });

    try {
      const rejected = await request(app.getHttpServer())
        .post(`/businesses/${koramangalaBusinessId}/vacancies`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          tradeSkill: 'Electrician',
          salaryMinPaise: 2200000,
          genderRequirement: 'women',
        })
        .expect(400);
      expect(rejected.body.message).toContain('genderReason');

      const rejectedExtra = await request(app.getHttpServer())
        .post(`/businesses/${koramangalaBusinessId}/vacancies`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({ tradeSkill: 'Electrician', salaryMinPaise: 2200000, extras: ['cash_bonus'] })
        .expect(400);
      expect(rejectedExtra.body.message).toContain('extras');

      const created = await request(app.getHttpServer())
        .post(`/businesses/${koramangalaBusinessId}/vacancies`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          tradeSkill: 'Electrician',
          salaryMinPaise: 2200000,
          genderRequirement: 'women',
          genderReason: 'Role requirement supplied by the business',
          walkInDate: '2026-12-05',
        })
        .expect(201);

      expect(created.body.tradeSkill).toBe('Electrician');
      expect(created.body.salaryMinPaise).toBe(2200000);
      expect(created.body.offeredSalary).toBeNull();
      expect(created.body.interviewSlots).toHaveLength(1);
      expect(created.body.interviewSlots[0].startsAt).toBe(
        new Date('2026-12-05T11:15:00+05:30').toISOString(),
      );
      expect(created.body.interviewSlots[0].endsAt).toBe(
        new Date('2026-12-05T17:45:00+05:30').toISOString(),
      );
    } finally {
      await prisma.pricingPolicy.update({
        where: { id: policy.id },
        data: { walkInStart: originalStart, walkInEnd: originalEnd },
      });
    }
  });

  it('accepts manually entered scheduled interview slots', async () => {
    const created = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        tradeSkill: 'Electrician',
        salaryMinPaise: 2200000,
        interviewType: 'scheduled',
        interviewSlots: [
          {
            startsAt: '2026-12-05T04:30:00.000Z',
            endsAt: '2026-12-05T05:00:00.000Z',
            capacity: 4,
          },
        ],
      })
      .expect(201);

    expect(created.body.interviewType).toBe('scheduled');
    expect(created.body.interviewSlots).toHaveLength(1);
    expect(created.body.interviewSlots[0].capacity).toBe(4);
  });

  it('field agent cannot create vacancy for another account business (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/businesses/${indiranagarBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`) // Koramangala agent targeting Indiranagar
      .send({
        tradeSkill: 'Plumber',
        salaryMinPaise: 1800000,
        headcount: 1,
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('business is outside your account');
  });

  it('notifies another account agent when a call agent adds a vacancy', async () => {
    await prisma.business.update({
      where: { id: koramangalaBusinessId },
      data: { accountAgentId: faKoramangalaId },
    });

    const created = await request(app.getHttpServer())
      .post(`/businesses/${koramangalaBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ tradeSkill: 'Electrician', salaryMinPaise: 2200000 })
      .expect(201);

    const notice = await prisma.reviewFlag.findFirst({
      where: {
        kind: 'vacancy_captured_for_account_business',
        subjectId: created.body.id,
        raisedForStaffId: faKoramangalaId,
      },
    });
    expect(notice).toBeDefined();
  });

  it('field agents read all vacancies, while call agents see all', async () => {
    // 1. Create a vacancy in Indiranagar by Indiranagar agent
    const indiVacRes = await request(app.getHttpServer())
      .post(`/businesses/${indiranagarBusinessId}/vacancies`)
      .set('Authorization', `Bearer ${fieldAgentIndiranagarToken}`)
      .send({
        tradeSkill: 'Sales Associate',
        salaryMinPaise: 2500000,
        headcount: 2,
      });
    expect(indiVacRes.status).toBe(201);
    const indiranagarVacancyId = indiVacRes.body.id;

    // 2. Koramangala agent can GET /vacancies/:id of an unrelated account
    const koraReadRes = await request(app.getHttpServer())
      .get(`/vacancies/${indiranagarVacancyId}`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraReadRes.status).toBe(200);

    // 3. Koramangala agent GET /vacancies list -> includes vacancies in both localities
    const koraListRes = await request(app.getHttpServer())
      .get('/vacancies')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraListRes.status).toBe(200);
    const hasIndi = koraListRes.body.some((v: { id: string }) => v.id === indiranagarVacancyId);
    expect(hasIndi).toBe(true);

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
