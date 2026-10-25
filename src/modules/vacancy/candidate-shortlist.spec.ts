import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 4 Task 3: Candidate Shortlist', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let fieldAgentKoramangalaToken: string;
  let fieldAgentIndiranagarToken: string;
  let callAgentToken: string;
  let financeToken: string;

  let koramangalaVacancyId: string;
  let indiranagarVacancyId: string;

  let matchingCandidate1Id: string;
  let matchingCandidate2Id: string;

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
        code: `FA-CSKORA-${timestamp}`,
        name: 'FA Kora Shortlist',
        email: `fa_cskora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-CSINDI-${timestamp}`,
        name: 'FA Indi Shortlist',
        email: `fa_csindi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-CS-${timestamp}`,
        name: 'CA Shortlist',
        email: `ca_cs_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const fin = await prisma.staff.create({
      data: {
        code: `FN-CS-${timestamp}`,
        name: 'Finance Shortlist',
        email: `fn_cs_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    fieldAgentKoramangalaToken = await login(faKora.email);
    fieldAgentIndiranagarToken = await login(faIndi.email);
    callAgentToken = await login(ca.email);
    financeToken = await login(fin.email);

    // Create Business in Koramangala
    const koraBiz = await prisma.business.create({
      data: {
        code: `BZ-CSK-${timestamp}`,
        name: 'Kora Tech Services',
        city: 'Bengaluru',
        area: 'Koramangala',
        contactName: 'Mr. Raman',
        phone: `91${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
      },
    });

    // Create Vacancy in Koramangala: Electrician, offeredSalary: 2500000 (₹25,000)
    const koraVac = await prisma.vacancy.create({
      data: {
        code: `VC-CSK-${timestamp}`,
        city: 'Bengaluru',
        businessId: koraBiz.id,
        capturedByStaffId: faKora.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2500000,
        headcount: 2,
        status: 'open',
      },
    });
    koramangalaVacancyId = koraVac.id;

    // Create Business in Indiranagar
    const indiBiz = await prisma.business.create({
      data: {
        code: `BZ-CSI-${timestamp}`,
        name: 'Indi Cafe',
        city: 'Bengaluru',
        area: 'Indiranagar',
        contactName: 'Ms. Priya',
        phone: `91${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
      },
    });

    // Create Vacancy in Indiranagar
    const indiVac = await prisma.vacancy.create({
      data: {
        code: `VC-CSI-${timestamp}`,
        city: 'Bengaluru',
        businessId: indiBiz.id,
        capturedByStaffId: faIndi.id,
        tradeSkill: 'Barista',
        offeredSalary: 2000000,
        headcount: 1,
        status: 'open',
      },
    });
    indiranagarVacancyId = indiVac.id;

    // Candidate 1: Matches trade and salary range, active (earlier createdAt)
    const c1 = await prisma.jobSeeker.create({
      data: {
        code: `JS-CS1-${timestamp}`,
        name: 'Candidate One - Electrician Match',
        phone: `92${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        createdAt: new Date(Date.now() - 100000),
      },
    });
    matchingCandidate1Id = c1.id;

    // Candidate 2: Matches trade and salary range, active (later createdAt)
    const c2 = await prisma.jobSeeker.create({
      data: {
        code: `JS-CS2-${timestamp}`,
        name: 'Candidate Two - Electrician Match 2',
        phone: `92${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
        tradeSkill: 'electrician', // case insensitive check
        minSalary: 2200000,
        maxSalary: 2800000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        createdAt: new Date(Date.now() - 50000),
      },
    });
    matchingCandidate2Id = c2.id;

    // Candidate 3: Mismatched trade ('Painter'), salary matches, active -> excluded
    await prisma.jobSeeker.create({
      data: {
        code: `JS-CS3-${timestamp}`,
        name: 'Candidate Three - Mismatched Trade',
        phone: `92${timestamp.toString().slice(-8)}3`,
        phoneVerified: true,
        tradeSkill: 'Painter',
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });

    // Candidate 4: Electrician, minSalary too high (2600000 > 2500000), active -> excluded
    await prisma.jobSeeker.create({
      data: {
        code: `JS-CS4-${timestamp}`,
        name: 'Candidate Four - Salary Too High',
        phone: `92${timestamp.toString().slice(-8)}4`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 2600000,
        maxSalary: 3500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });

    // Candidate 5: Electrician, maxSalary too low (2400000 < 2500000), active -> excluded
    await prisma.jobSeeker.create({
      data: {
        code: `JS-CS5-${timestamp}`,
        name: 'Candidate Five - Salary Too Low',
        phone: `92${timestamp.toString().slice(-8)}5`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1500000,
        maxSalary: 2400000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });

    // Candidate 6: Electrician, salary matches, but status: pending_activation -> excluded
    await prisma.jobSeeker.create({
      data: {
        code: `JS-CS6-${timestamp}`,
        name: 'Candidate Six - Pending Activation',
        phone: `92${timestamp.toString().slice(-8)}6`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'pending_activation',
      },
    });

    // Candidate 7: Electrician, salary matches, but status: deactivated -> excluded
    await prisma.jobSeeker.create({
      data: {
        code: `JS-CS7-${timestamp}`,
        name: 'Candidate Seven - Deactivated',
        phone: `92${timestamp.toString().slice(-8)}7`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'deactivated',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('filters active candidates matching trade and salary range in stable order (never ranked)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/vacancies/${koramangalaVacancyId}/candidates`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const candidateIds = res.body.map((c: { id: string }) => c.id);

    // Matching candidates must be included
    expect(candidateIds).toContain(matchingCandidate1Id);
    expect(candidateIds).toContain(matchingCandidate2Id);

    // Candidate 1 was registered before Candidate 2 -> stable order by registration date
    const idx1 = candidateIds.indexOf(matchingCandidate1Id);
    const idx2 = candidateIds.indexOf(matchingCandidate2Id);
    expect(idx1).toBeLessThan(idx2);

    // Verify excluded candidates are not present in the returned list
    const names = res.body.map((c: { name: string }) => c.name);
    expect(names).not.toContain('Candidate Three - Mismatched Trade');
    expect(names).not.toContain('Candidate Four - Salary Too High');
    expect(names).not.toContain('Candidate Five - Salary Too Low');
    expect(names).not.toContain('Candidate Six - Pending Activation');
    expect(names).not.toContain('Candidate Seven - Deactivated');
  });

  it('enforces area-scoping: field agent cannot view candidates for vacancy in another area (403)', async () => {
    // Indiranagar field agent attempts to read candidate shortlist for Koramangala vacancy
    await request(app.getHttpServer())
      .get(`/vacancies/${koramangalaVacancyId}/candidates`)
      .set('Authorization', `Bearer ${fieldAgentIndiranagarToken}`)
      .expect(403);

    // Indiranagar field agent can read candidates for their own area vacancy
    const res = await request(app.getHttpServer())
      .get(`/vacancies/${indiranagarVacancyId}/candidates`)
      .set('Authorization', `Bearer ${fieldAgentIndiranagarToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('allows call agent to view candidates across any area', async () => {
    const res = await request(app.getHttpServer())
      .get(`/vacancies/${koramangalaVacancyId}/candidates`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const candidateIds = res.body.map((c: { id: string }) => c.id);
    expect(candidateIds).toContain(matchingCandidate1Id);
  });

  it('masks candidate PII when requested by finance role', async () => {
    const res = await request(app.getHttpServer())
      .get(`/vacancies/${koramangalaVacancyId}/candidates`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const candidate1 = res.body.find((c: { id: string }) => c.id === matchingCandidate1Id);
    expect(candidate1).toBeDefined();
    expect(candidate1.phone).toBe('********');
    expect(candidate1.name).toBe('Candidate One - Electrician Match');
  });

  it('returns 404 for a non-existent vacancy', async () => {
    await request(app.getHttpServer())
      .get('/vacancies/00000000-0000-0000-0000-000000000000/candidates')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(404);
  });
});
