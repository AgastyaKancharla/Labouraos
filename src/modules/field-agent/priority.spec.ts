import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 4 Task 5: Priority Endpoints (/priority/*)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let faKoraToken: string;
  let faIndiToken: string;
  let callAgentToken: string;
  let financeToken: string;

  let faKoraId: string;
  let faIndiId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const baseTime = new Date('2026-07-01T10:00:00.000Z');
  const koraArea = `Area-PKora-${timestamp}`;
  const indiArea = `Area-PIndi-${timestamp}`;

  let critical2HitCandidateId: string;
  let highBandHighSalaryCandidateId: string;
  let highBandLowSalaryCandidateId: string;
  let normalBandCandidateId: string;

  let koraInWindowReplacementVacId: string;
  let koraOldVacId: string;
  let koraNewHighFeeVacId: string;
  let indiVacId: string;

  let trade1: string;
  let trade2: string;
  let trade3: string;

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
        code: `FA-PKORA-${timestamp}`,
        name: 'Field Agent Kora Priority',
        email: `fa_pkora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: koraArea,
        city: 'Bengaluru',
      },
    });
    faKoraId = koraAgent.id;

    const indiAgent = await prisma.staff.create({
      data: {
        code: `FA-PINDI-${timestamp}`,
        name: 'Field Agent Indi Priority',
        email: `fa_pindi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: indiArea,
        city: 'Bengaluru',
      },
    });
    faIndiId = indiAgent.id;

    const ca = await prisma.staff.create({
      data: {
        code: `CA-PRIO-${timestamp}`,
        name: 'Call Agent Priority',
        email: `ca_prio_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    const fin = await prisma.staff.create({
      data: {
        code: `FN-PRIO-${timestamp}`,
        name: 'Finance Priority',
        email: `fn_prio_${timestamp}@laboura.local`,
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

    faKoraToken = await login(koraAgent.email);
    faIndiToken = await login(indiAgent.email);
    callAgentToken = await login(ca.email);
    financeToken = await login(fin.email);

    // Businesses
    const koraBiz = await prisma.business.create({
      data: {
        code: `BZ-PRIOK-${timestamp}`,
        name: 'Kora Enterprise Hub',
        area: koraArea,
        city: 'Bengaluru',
        phone: `97${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
      },
    });

    const indiBiz = await prisma.business.create({
      data: {
        code: `BZ-PRIOI-${timestamp}`,
        name: 'Indi Commercial Complex',
        area: indiArea,
        city: 'Bengaluru',
        phone: `97${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
      },
    });

    // Base vacancy & job seeker for a dropped out placement
    const baseVac = await prisma.vacancy.create({
      data: {
        code: `VC-BASE-${timestamp}`,
        businessId: koraBiz.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2000000,
        status: 'filled',
      },
    });

    const dummyJs = await prisma.jobSeeker.create({
      data: {
        code: `JS-DUMMY-${timestamp}`,
        name: 'Dummy Placed Candidate',
        phone: `98${timestamp.toString().slice(-8)}9`,
        tradeSkill: 'Electrician',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'placed',
      },
    });

    const droppedOutPlacement = await prisma.placement.create({
      data: {
        code: `PL-DUMMY-${timestamp}`,
        vacancyId: baseVac.id,
        jobSeekerId: dummyJs.id,
        businessId: koraBiz.id,
        placementFee: 1000000,
        gstAmount: 180000,
        status: 'dropped_out',
      },
    });

    trade1 = `TradeVacSurplus_${timestamp}`;
    trade2 = `TradeCandSurplus_${timestamp}`;
    trade3 = `TradeIndiOnly_${timestamp}`;

    // Vacancies:
    // 1. Replacement vacancy in Koramangala inside 15-day window (created 2 days ago, replacementForPlacementId set)
    const vacRepl = await prisma.vacancy.create({
      data: {
        code: `VC-PREPL-${timestamp}`,
        businessId: koraBiz.id,
        capturedByStaffId: faKoraId,
        tradeSkill: trade1,
        offeredSalary: 2000000,
        headcount: 1,
        status: 'open',
        replacementForPlacementId: droppedOutPlacement.id,
        createdAt: new Date(baseTime.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    koraInWindowReplacementVacId = vacRepl.id;

    // 2. Old regular vacancy in Koramangala (created 10 days ago, fee = 1 * 2000000 = 2000000)
    const vacOld = await prisma.vacancy.create({
      data: {
        code: `VC-POLD-${timestamp}`,
        businessId: koraBiz.id,
        capturedByStaffId: faKoraId,
        tradeSkill: trade2,
        offeredSalary: 2000000,
        headcount: 1,
        status: 'open',
        createdAt: new Date(baseTime.getTime() - 10 * 24 * 60 * 60 * 1000),
      },
    });
    koraOldVacId = vacOld.id;

    // 3. New high-fee vacancy in Koramangala (created 1 day ago, fee = 2 * 3000000 = 6000000)
    const vacHighFee = await prisma.vacancy.create({
      data: {
        code: `VC-PHIGH-${timestamp}`,
        businessId: koraBiz.id,
        capturedByStaffId: faKoraId,
        tradeSkill: trade1,
        offeredSalary: 3000000,
        headcount: 2,
        status: 'open',
        createdAt: new Date(baseTime.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
    });
    koraNewHighFeeVacId = vacHighFee.id;

    // 4. Vacancy in Indiranagar
    const vacIndi = await prisma.vacancy.create({
      data: {
        code: `VC-PINDI-${timestamp}`,
        businessId: indiBiz.id,
        capturedByStaffId: faIndiId,
        tradeSkill: trade3,
        offeredSalary: 2500000,
        headcount: 3,
        status: 'open',
        createdAt: new Date(baseTime.getTime() - 5 * 24 * 60 * 60 * 1000),
      },
    });
    indiVacId = vacIndi.id;

    // Candidates:
    // Candidate 1: Paid 26 days ago (4 days left <= 7 -> band 'critical'), hitCount = 2 -> twoHitFlag = true
    const cCritical = await prisma.jobSeeker.create({
      data: {
        code: `JS-PCRIT-${timestamp}`,
        name: 'Critical 2-Hit Candidate',
        phone: `98${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
        tradeSkill: trade1,
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 2,
        paymentReceivedAt: new Date(baseTime.getTime() - 26 * 24 * 60 * 60 * 1000),
      },
    });
    critical2HitCandidateId = cCritical.id;

    // Candidate 2: Paid 18 days ago (12 days left -> band 'high'), maxSalary: 4000000
    const cHighSalary = await prisma.jobSeeker.create({
      data: {
        code: `JS-PHIGHS-${timestamp}`,
        name: 'High Band High Salary',
        phone: `98${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
        tradeSkill: trade2,
        minSalary: 3000000,
        maxSalary: 4000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        paymentReceivedAt: new Date(baseTime.getTime() - 18 * 24 * 60 * 60 * 1000),
      },
    });
    highBandHighSalaryCandidateId = cHighSalary.id;

    // Candidate 3: Paid 18 days ago (12 days left -> band 'high'), maxSalary: 2000000
    const cLowSalary = await prisma.jobSeeker.create({
      data: {
        code: `JS-PLOWS-${timestamp}`,
        name: 'High Band Low Salary',
        phone: `98${timestamp.toString().slice(-8)}3`,
        phoneVerified: true,
        tradeSkill: trade2,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 1,
        paymentReceivedAt: new Date(baseTime.getTime() - 18 * 24 * 60 * 60 * 1000),
      },
    });
    highBandLowSalaryCandidateId = cLowSalary.id;

    // Candidate 4: Paid 2 days ago (28 days left -> band 'normal')
    const cNormal = await prisma.jobSeeker.create({
      data: {
        code: `JS-PNORM-${timestamp}`,
        name: 'Normal Band Candidate',
        phone: `98${timestamp.toString().slice(-8)}4`,
        phoneVerified: true,
        tradeSkill: trade3,
        minSalary: 2000000,
        maxSalary: 3000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        paymentReceivedAt: new Date(baseTime.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
    });
    normalBandCandidateId = cNormal.id;
  });

  afterAll(async () => {
    // 1. Unlink replacement vacancy from placement
    await prisma.vacancy.updateMany({
      where: { code: `VC-PREPL-${timestamp}` },
      data: { replacementForPlacementId: null },
    });
    // 2. Delete placement so vacancyId foreign key is released
    await prisma.placement.deleteMany({
      where: { code: `PL-DUMMY-${timestamp}` },
    });
    // 3. Now delete all test vacancies
    await prisma.vacancy.deleteMany({
      where: {
        code: {
          in: [
            `VC-PREPL-${timestamp}`,
            `VC-POLD-${timestamp}`,
            `VC-PHIGH-${timestamp}`,
            `VC-PINDI-${timestamp}`,
            `VC-BASE-${timestamp}`,
          ],
        },
      },
    });
    await prisma.jobSeeker.deleteMany({
      where: {
        code: {
          in: [
            `JS-DUMMY-${timestamp}`,
            `JS-PCRIT-${timestamp}`,
            `JS-PHIGH-${timestamp}`,
            `JS-PLOW-${timestamp}`,
            `JS-PNORM-${timestamp}`,
            `JS-PINDI-${timestamp}`,
          ],
        },
      },
    });
    await prisma.business.deleteMany({
      where: {
        code: { in: [`BZ-PRIOK-${timestamp}`, `BZ-PRIOI-${timestamp}`] },
      },
    });
    await prisma.staff.deleteMany({
      where: {
        code: {
          in: [
            `FA-PKORA-${timestamp}`,
            `FA-PINDI-${timestamp}`,
            `CA-PRIO-${timestamp}`,
            `FN-PRIO-${timestamp}`,
          ],
        },
      },
    });
    await app.close();
  });

  describe('GET /priority/candidates', () => {
    it('is visible city-wide for field agent and correctly computes urgency band and flags 2 hits', async () => {
      const res = await request(app.getHttpServer())
        .get(`/priority/candidates?now=${baseTime.toISOString()}`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);

      const critRow = res.body.find((r: { id: string }) => r.id === critical2HitCandidateId);
      expect(critRow).toBeDefined();
      expect(critRow.band).toBe('critical');
      expect(critRow.twoHitFlag).toBe(true);
      expect(critRow.daysRemaining).toBeLessThanOrEqual(7);

      const highRow = res.body.find((r: { id: string }) => r.id === highBandHighSalaryCandidateId);
      expect(highRow).toBeDefined();
      expect(highRow.band).toBe('high');
      expect(highRow.twoHitFlag).toBe(false);

      const normRow = res.body.find((r: { id: string }) => r.id === normalBandCandidateId);
      expect(normRow).toBeDefined();
      expect(normRow.band).toBe('normal');
      expect(normRow.daysRemaining).toBeGreaterThanOrEqual(24);
    });

    it('sorts soonest-refund-deadline first and tiebreaks by stated salary range descending', async () => {
      const res = await request(app.getHttpServer())
        .get(`/priority/candidates?now=${baseTime.toISOString()}`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .expect(200);

      const ids = res.body.map((r: { id: string }) => r.id);

      const critIdx = ids.indexOf(critical2HitCandidateId);
      const highSalaryIdx = ids.indexOf(highBandHighSalaryCandidateId);
      const lowSalaryIdx = ids.indexOf(highBandLowSalaryCandidateId);
      const normIdx = ids.indexOf(normalBandCandidateId);

      // Critical (4 days) comes before High (12 days)
      expect(critIdx).toBeLessThan(highSalaryIdx);

      // High band tiebreak: high expected salary comes before lower expected salary
      expect(highSalaryIdx).toBeLessThan(lowSalaryIdx);

      // High band comes before Normal band
      expect(lowSalaryIdx).toBeLessThan(normIdx);
    });

    it('advances urgency band and position when injectable clock moves past a day boundary', async () => {
      // Advance clock by 10 days
      const advancedTime = new Date(baseTime.getTime() + 10 * 24 * 60 * 60 * 1000);

      const res = await request(app.getHttpServer())
        .get(`/priority/candidates?now=${advancedTime.toISOString()}`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .expect(200);

      // Candidate 2 had 12 days remaining; 10 days later has 2 days remaining -> moves to 'critical'!
      const row = res.body.find((r: { id: string }) => r.id === highBandHighSalaryCandidateId);
      expect(row).toBeDefined();
      expect(row.band).toBe('critical');
      expect(row.daysRemaining).toBe(2);
    });
  });

  describe('GET /priority/vacancies', () => {
    it('scopes vacancies to field agent area and puts in-window replacement vacancy at the top', async () => {
      const res = await request(app.getHttpServer())
        .get(`/priority/vacancies?now=${baseTime.toISOString()}`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);

      // All vacancies belong to koraArea
      for (const row of res.body) {
        expect(row.businessArea).toBe(koraArea);
        expect(row.id).not.toBe(indiVacId);
      }

      const ids = res.body.map((r: { id: string }) => r.id);

      // Replacement vacancy inside 15-day window must be at the very top
      expect(ids[0]).toBe(koraInWindowReplacementVacId);

      // Old vacancy (10 days open) comes before newer vacancy (1 day open)
      const oldIdx = ids.indexOf(koraOldVacId);
      const newHighFeeIdx = ids.indexOf(koraNewHighFeeVacId);
      expect(oldIdx).toBeLessThan(newHighFeeIdx);

      // Indiranagar field agent only sees indiArea vacancies
      const indiRes = await request(app.getHttpServer())
        .get(`/priority/vacancies?now=${baseTime.toISOString()}`)
        .set('Authorization', `Bearer ${faIndiToken}`)
        .expect(200);
      for (const row of indiRes.body) {
        expect(row.businessArea).toBe(indiArea);
        expect(row.id).not.toBe(koraInWindowReplacementVacId);
      }
      const indiIds = indiRes.body.map((r: { id: string }) => r.id);
      expect(indiIds).toContain(indiVacId);
    });

    it('allows call agent to view vacancies across all areas', async () => {
      const res = await request(app.getHttpServer())
        .get(`/priority/vacancies?now=${baseTime.toISOString()}`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(200);

      const ids = res.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(koraInWindowReplacementVacId);
      expect(ids).toContain(indiVacId);
    });
  });

  describe('GET /priority/trades', () => {
    it('reports candidate counts vs vacancy headcount per trade scoped to field agent area', async () => {
      const res = await request(app.getHttpServer())
        .get('/priority/trades')
        .set('Authorization', `Bearer ${faKoraToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);

      // trade1 in Koramangala: 1 active candidate (Candidate 1), 3 vacancy headcounts (vacRepl=1 + vacHighFee=2)
      const t1 = res.body.find((t: { trade: string }) => t.trade === trade1);
      expect(t1).toBeDefined();
      expect(t1.activeCandidatesCount).toBe(1);
      expect(t1.openVacancyHeadcount).toBe(3);
      expect(t1.status).toBe('vacancy_surplus');

      // trade2 in Koramangala: 2 active candidates (Candidate 2, Candidate 3), 1 vacancy headcount (vacOld=1)
      const t2 = res.body.find((t: { trade: string }) => t.trade === trade2);
      expect(t2).toBeDefined();
      expect(t2.activeCandidatesCount).toBe(2);
      expect(t2.openVacancyHeadcount).toBe(1);
      expect(t2.status).toBe('candidate_surplus');

      // trade3 (Indiranagar only): candidate is city-wide (1), but vacancy headcount in Koramangala is 0
      const t3 = res.body.find((t: { trade: string }) => t.trade === trade3);
      expect(t3).toBeDefined();
      expect(t3.activeCandidatesCount).toBe(1);
      expect(t3.openVacancyHeadcount).toBe(0);
      expect(t3.status).toBe('candidate_surplus');
    });
  });

  describe('Finance RBAC access to /priority/*', () => {
    it('denies finance role access to all /priority/* endpoints (403)', async () => {
      await request(app.getHttpServer())
        .get('/priority/candidates')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/priority/vacancies')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/priority/trades')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(403);
    });
  });
});
