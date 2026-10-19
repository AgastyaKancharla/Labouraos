import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 5 Task 1: Placement Creation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let faKoraToken: string;
  let faIndiToken: string;
  let caToken: string;

  let koraVacancyId: string;
  let indiVacancyId: string;
  let activeJobSeekerId: string;
  let placedJobSeekerId: string;

  let staffIds: string[] = [];

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const koraArea = `Area-P5K-${timestamp}`;
  const indiArea = `Area-P5I-${timestamp}`;

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
        code: `FA-P5K-${timestamp}`,
        name: 'Field Agent Kora P5',
        email: `fa_p5k_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: koraArea,
        city: 'Bengaluru',
      },
    });

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-P5I-${timestamp}`,
        name: 'Field Agent Indi P5',
        email: `fa_p5i_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: indiArea,
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-P5-${timestamp}`,
        name: 'Call Agent P5',
        email: `ca_p5_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    staffIds = [faKora.id, faIndi.id, ca.id];

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await request(server).post('/auth/login').send({ email, password });
      return res.body.accessToken;
    };

    faKoraToken = await login(faKora.email);
    faIndiToken = await login(faIndi.email);
    caToken = await login(ca.email);

    // Businesses in respective areas
    const koraBiz = await prisma.business.create({
      data: {
        code: `BZ-P5K-${timestamp}`,
        name: 'Kora Tech Solutions',
        area: koraArea,
        city: 'Bengaluru',
        phone: `91${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
      },
    });

    const indiBiz = await prisma.business.create({
      data: {
        code: `BZ-P5I-${timestamp}`,
        name: 'Indi Retail Hub',
        area: indiArea,
        city: 'Bengaluru',
        phone: `91${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
      },
    });

    // Vacancies
    const koraVac = await prisma.vacancy.create({
      data: {
        code: `VC-P5K-${timestamp}`,
        businessId: koraBiz.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2000000,
        status: 'open',
      },
    });
    koraVacancyId = koraVac.id;

    const indiVac = await prisma.vacancy.create({
      data: {
        code: `VC-P5I-${timestamp}`,
        businessId: indiBiz.id,
        tradeSkill: 'Plumber',
        offeredSalary: 2500000,
        status: 'open',
      },
    });
    indiVacancyId = indiVac.id;

    // Job Seekers
    const activeJs = await prisma.jobSeeker.create({
      data: {
        code: `JS-P5ACT-${timestamp}`,
        name: 'Active Candidate',
        phone: `92${timestamp.toString().slice(-8)}1`,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2400000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    activeJobSeekerId = activeJs.id;

    const placedJs = await prisma.jobSeeker.create({
      data: {
        code: `JS-P5PLC-${timestamp}`,
        name: 'Already Placed Candidate',
        phone: `92${timestamp.toString().slice(-8)}2`,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2400000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'placed',
      },
    });
    placedJobSeekerId = placedJs.id;
  });

  afterAll(async () => {
    // Teardown in correct FK dependency order
    await prisma.placement.deleteMany({
      where: {
        vacancy: {
          code: { in: [`VC-P5K-${timestamp}`, `VC-P5I-${timestamp}`] },
        },
      },
    });
    await prisma.vacancy.deleteMany({
      where: {
        code: { in: [`VC-P5K-${timestamp}`, `VC-P5I-${timestamp}`] },
      },
    });
    await prisma.jobSeeker.deleteMany({
      where: {
        code: { in: [`JS-P5ACT-${timestamp}`, `JS-P5PLC-${timestamp}`] },
      },
    });
    await prisma.business.deleteMany({
      where: {
        code: { in: [`BZ-P5K-${timestamp}`, `BZ-P5I-${timestamp}`] },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        actorId: { in: staffIds },
      },
    });
    await prisma.staff.deleteMany({
      where: {
        id: { in: staffIds },
      },
    });
    await app.close();
  });

  it('creates a placement in offered status with agreed monthly salary and PL- code', async () => {
    const agreedSalary = 2200000; // ₹22,000 in paise
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${koraVacancyId}/placements`)
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^PL-\d{5}$/);
    expect(res.body.status).toBe('offered');
    expect(res.body.agreedSalary).toBe(2200000);
    // 50% placement fee = 1100000 paise
    expect(res.body.placementFee).toBe(1100000);
    // 18% GST on 1100000 = 198000 paise
    expect(res.body.gstAmount).toBe(198000);

    // Job seeker status must remain 'active', NOT 'placed'
    const js = await prisma.jobSeeker.findUnique({ where: { id: activeJobSeekerId } });
    expect(js?.status).toBe('active');

    // Audit log entry created
    const audit = await prisma.auditLog.findFirst({
      where: { entityCode: res.body.code },
    });
    expect(audit).toBeDefined();
    expect(audit?.action).toBe('placement_created');
  });

  it('enforces field agent area scoping: denied for vacancy outside assigned area (403)', async () => {
    // faKora tries to place into indiVacancy
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${indiVacancyId}/placements`)
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary: 2000000,
      });

    expect(res.status).toBe(403);
  });

  it('allows field agent to create placement within their own assigned area', async () => {
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${indiVacancyId}/placements`)
      .set('Authorization', `Bearer ${faIndiToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary: 2400000,
      })
      .expect(201);

    expect(res.body.code).toMatch(/^PL-\d{5}$/);
    expect(res.body.status).toBe('offered');
  });

  it('allows call agent to create placement across any area', async () => {
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${indiVacancyId}/placements`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary: 2500000,
      })
      .expect(201);

    expect(res.body.code).toMatch(/^PL-\d{5}$/);
    expect(res.body.status).toBe('offered');
  });

  it('rejects placement if candidate is already placed (400)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${koraVacancyId}/placements`)
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        jobSeekerId: placedJobSeekerId,
        agreedSalary: 2000000,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already placed');
  });
});
