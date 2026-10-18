import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 4 Task 5: Priority Dashboard API', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let faKoraToken: string;
  let faIndiToken: string;
  let callAgentToken: string;
  let managerToken: string;

  let faKoraId: string;
  let faIndiId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const baseTime = new Date('2026-07-01T10:00:00.000Z');

  let oppUrgentRefundCandidateId: string;
  let oppLaterRefundCandidateId: string;
  let oppHighFeeCandidateId: string;
  let oppLowFeeCandidateId: string;

  let koraVacancyId: string;
  let indiVacancyId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const koraAgent = await prisma.staff.create({
      data: {
        code: `FA-PDKORA-${timestamp}`,
        name: 'Field Agent Kora Dashboard',
        email: `fa_pdkora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    faKoraId = koraAgent.id;

    const indiAgent = await prisma.staff.create({
      data: {
        code: `FA-PDINDI-${timestamp}`,
        name: 'Field Agent Indi Dashboard',
        email: `fa_pdindi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    faIndiId = indiAgent.id;

    const ca = await prisma.staff.create({
      data: {
        code: `CA-PD-${timestamp}`,
        name: 'Call Agent Dashboard',
        email: `ca_pd_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const mgr = await prisma.staff.create({
      data: {
        code: `MG-PD-${timestamp}`,
        name: 'Manager Dashboard',
        email: `mgr_pd_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await request(server).post('/auth/login').send({ email, password });
      return res.body.accessToken;
    };

    faKoraToken = await login(koraAgent.email);
    faIndiToken = await login(indiAgent.email);
    callAgentToken = await login(ca.email);
    managerToken = await login(mgr.email);

    // Business 1 in Koramangala
    const koraBiz = await prisma.business.create({
      data: {
        code: `BZ-PDK-${timestamp}`,
        name: 'Kora Tech Hub',
        area: 'Koramangala',
        city: 'Bengaluru',
        phone: `94${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
      },
    });

    // Business 2 in Indiranagar
    const indiBiz = await prisma.business.create({
      data: {
        code: `BZ-PDI-${timestamp}`,
        name: 'Indi Retail Mart',
        area: 'Indiranagar',
        city: 'Bengaluru',
        phone: `94${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
      },
    });

    // Vacancy 1 in Koramangala: Carpenter, offeredSalary: 2000000 paise (fee = 1000000 paise)
    const vac1 = await prisma.vacancy.create({
      data: {
        code: `VC-PDK1-${timestamp}`,
        businessId: koraBiz.id,
        capturedByStaffId: faKoraId,
        tradeSkill: 'Carpenter',
        offeredSalary: 2000000,
        status: 'open',
      },
    });
    koraVacancyId = vac1.id;

    // Vacancy 2 in Koramangala: High fee carpenter, offeredSalary: 4000000 paise (fee = 2000000 paise)
    await prisma.vacancy.create({
      data: {
        code: `VC-PDK2-${timestamp}`,
        businessId: koraBiz.id,
        capturedByStaffId: faKoraId,
        tradeSkill: 'Carpenter',
        offeredSalary: 4000000,
        status: 'open',
      },
    });

    // Vacancy 3 in Indiranagar: Carpenter, offeredSalary: 2000000 paise
    const vac3 = await prisma.vacancy.create({
      data: {
        code: `VC-PDI1-${timestamp}`,
        businessId: indiBiz.id,
        capturedByStaffId: faIndiId,
        tradeSkill: 'Carpenter',
        offeredSalary: 2000000,
        status: 'open',
      },
    });
    indiVacancyId = vac3.id;

    // Candidate 1: Urgent refund guarantee deadline (paid 28 days ago -> 2 days left)
    // Salary range covers 2000000 paise (Vacancy 1)
    const paidUrgentAt = new Date(baseTime.getTime() - 28 * 24 * 60 * 60 * 1000);
    const cUrgent = await prisma.jobSeeker.create({
      data: {
        code: `JS-PDU-${timestamp}`,
        name: 'Urgent Refund Candidate',
        phone: `95${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
        tradeSkill: 'Carpenter',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: paidUrgentAt,
      },
    });
    oppUrgentRefundCandidateId = cUrgent.id;

    // Candidate 2: Later refund guarantee deadline (paid 5 days ago -> 25 days left)
    // Salary range covers 2000000 paise (Vacancy 1)
    const paidLaterAt = new Date(baseTime.getTime() - 5 * 24 * 60 * 60 * 1000);
    const cLater = await prisma.jobSeeker.create({
      data: {
        code: `JS-PDL-${timestamp}`,
        name: 'Later Refund Candidate',
        phone: `95${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
        tradeSkill: 'Carpenter',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: paidLaterAt,
      },
    });
    oppLaterRefundCandidateId = cLater.id;

    // Candidate 3 & Candidate 4 for fee value tiebreak:
    // Both paid on the exact same date (10 days ago), so refund deadline is identical!
    const samePaymentDate = new Date(baseTime.getTime() - 10 * 24 * 60 * 60 * 1000);

    // Candidate 3 matches Vacancy 2 (offeredSalary 4000000 -> fee 2000000)
    const cHighFee = await prisma.jobSeeker.create({
      data: {
        code: `JS-PDH-${timestamp}`,
        name: 'High Fee Tiebreak Candidate',
        phone: `95${timestamp.toString().slice(-8)}3`,
        phoneVerified: true,
        tradeSkill: 'Carpenter',
        minSalary: 3500000,
        maxSalary: 4500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: samePaymentDate,
      },
    });
    oppHighFeeCandidateId = cHighFee.id;

    // Candidate 4 matches Vacancy 1 (offeredSalary 2000000 -> fee 1000000)
    const cLowFee = await prisma.jobSeeker.create({
      data: {
        code: `JS-PDS-${timestamp}`,
        name: 'Low Fee Tiebreak Candidate',
        phone: `95${timestamp.toString().slice(-8)}4`,
        phoneVerified: true,
        tradeSkill: 'Carpenter',
        minSalary: 1800000,
        maxSalary: 2200000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: samePaymentDate,
      },
    });
    oppLowFeeCandidateId = cLowFee.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('scopes vacancies to the field agent assigned area while candidates are city-wide', async () => {
    const res = await request(app.getHttpServer())
      .get('/field-agent/priority-dashboard')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    // All opportunities returned must belong to Koramangala vacancies only
    for (const opp of res.body) {
      expect(opp.businessArea).toBe('Koramangala');
      expect(opp.vacancyId).not.toBe(indiVacancyId);
    }

    // Candidate visibility is city-wide (all active matching candidates in the city appear)
    const candidateIds = res.body.map((opp: { candidateId: string }) => opp.candidateId);
    expect(candidateIds).toContain(oppUrgentRefundCandidateId);
    expect(candidateIds).toContain(oppLaterRefundCandidateId);

    // Indiranagar field agent only sees Indiranagar vacancies
    const indiRes = await request(app.getHttpServer())
      .get('/field-agent/priority-dashboard')
      .set('Authorization', `Bearer ${faIndiToken}`)
      .expect(200);
    for (const opp of indiRes.body) {
      expect(opp.businessArea).toBe('Indiranagar');
      expect(opp.vacancyId).not.toBe(koraVacancyId);
    }
    const indiVacancyIds = indiRes.body.map((opp: { vacancyId: string }) => opp.vacancyId);
    expect(indiVacancyIds).toContain(indiVacancyId);
  });

  it('allows call agent and manager to view vacancies across all areas', async () => {
    const res = await request(app.getHttpServer())
      .get('/field-agent/priority-dashboard')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const vacancyIds = res.body.map((opp: { vacancyId: string }) => opp.vacancyId);
    expect(vacancyIds).toContain(koraVacancyId);
    expect(vacancyIds).toContain(indiVacancyId);

    // Verify Manager also has access across all areas
    const mgrRes = await request(app.getHttpServer())
      .get('/field-agent/priority-dashboard')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    const mgrVacancyIds = mgrRes.body.map((opp: { vacancyId: string }) => opp.vacancyId);
    expect(mgrVacancyIds).toContain(koraVacancyId);
    expect(mgrVacancyIds).toContain(indiVacancyId);
  });

  it('sorts opportunities by refund deadline first (closest to 30-day guarantee expiration first)', async () => {
    const res = await request(app.getHttpServer())
      .get('/field-agent/priority-dashboard')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .expect(200);

    const urgentIdx = res.body.findIndex(
      (opp: { candidateId: string }) => opp.candidateId === oppUrgentRefundCandidateId,
    );
    const laterIdx = res.body.findIndex(
      (opp: { candidateId: string }) => opp.candidateId === oppLaterRefundCandidateId,
    );

    expect(urgentIdx).toBeGreaterThanOrEqual(0);
    expect(laterIdx).toBeGreaterThanOrEqual(0);
    // Urgent candidate (deadline in 2 days) comes before later candidate (deadline in 25 days)
    expect(urgentIdx).toBeLessThan(laterIdx);
  });

  it('uses potential fee value as tiebreak when refund deadlines are identical (higher fee first)', async () => {
    const res = await request(app.getHttpServer())
      .get('/field-agent/priority-dashboard')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .expect(200);

    const highFeeOpp = res.body.find(
      (opp: { candidateId: string }) => opp.candidateId === oppHighFeeCandidateId,
    );
    const lowFeeOpp = res.body.find(
      (opp: { candidateId: string }) => opp.candidateId === oppLowFeeCandidateId,
    );

    expect(highFeeOpp).toBeDefined();
    expect(lowFeeOpp).toBeDefined();
    expect(highFeeOpp.potentialFee).toBe(2000000); // ₹20,000
    expect(lowFeeOpp.potentialFee).toBe(1000000); // ₹10,000

    const highFeeIdx = res.body.indexOf(highFeeOpp);
    const lowFeeIdx = res.body.indexOf(lowFeeOpp);

    // Identical refund deadlines: high fee comes first
    expect(highFeeIdx).toBeLessThan(lowFeeIdx);
  });
});
