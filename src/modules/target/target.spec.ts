import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { TargetService } from './target.service';

describe('Phase 6.7 Task 2: Target Model and Setting Targets', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let targetService: TargetService;

  let ceoToken: string;
  let ceoId: string;
  let managerToken: string;
  let managerId: string;
  let teamLead1Token: string;
  let teamLead1Id: string;
  let teamLead2Token: string;
  let teamLead2Id: string;
  let callAgentToken: string;
  let callAgentId: string;
  let fieldAgentToken: string;
  let fieldAgentId: string;
  let financeToken: string;
  let financeId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  const cleanStaffIds: string[] = [];
  const cleanTargetIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    targetService = app.get<TargetService>(TargetService);

    const passwordHash = await bcrypt.hash(password, 10);

    // 1. CEO & Manager
    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-T2-${timestamp}`,
        name: 'CEO T2',
        email: `ceo_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    ceoId = ceo.id;
    cleanStaffIds.push(ceo.id);

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-T2-${timestamp}`,
        name: 'Manager T2',
        email: `mgr_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    managerId = mgr.id;
    cleanStaffIds.push(mgr.id);

    // 2. Team Leads
    const tl1 = await prisma.staff.create({
      data: {
        code: `TL1-T2-${timestamp}`,
        name: 'Team Lead 1 T2',
        email: `tl1_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    teamLead1Id = tl1.id;
    cleanStaffIds.push(tl1.id);

    const tl2 = await prisma.staff.create({
      data: {
        code: `TL2-T2-${timestamp}`,
        name: 'Team Lead 2 T2',
        email: `tl2_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    teamLead2Id = tl2.id;
    cleanStaffIds.push(tl2.id);

    // 3. Call Agent (under Team Lead 1)
    const ca = await prisma.staff.create({
      data: {
        code: `CA-T2-${timestamp}`,
        name: 'Call Agent T2',
        email: `ca_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        teamLeadId: tl1.id,
        city: 'Bengaluru',
      },
    });
    callAgentId = ca.id;
    cleanStaffIds.push(ca.id);

    // 4. Field Agent (under Team Lead 2)
    const fa = await prisma.staff.create({
      data: {
        code: `FA-T2-${timestamp}`,
        name: 'Field Agent T2',
        email: `fa_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        teamLeadId: teamLead2Id,
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fa.id;
    cleanStaffIds.push(fa.id);

    // 5. Finance
    const fin = await prisma.staff.create({
      data: {
        code: `FIN-T2-${timestamp}`,
        name: 'Finance T2',
        email: `fin_t2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    financeId = fin.id;
    cleanStaffIds.push(fin.id);

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    ceoToken = await login(ceo.email);
    managerToken = await login(mgr.email);
    teamLead1Token = await login(tl1.email);
    teamLead2Token = await login(tl2.email);
    callAgentToken = await login(ca.email);
    fieldAgentToken = await login(fa.email);
    financeToken = await login(fin.email);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: { entityType: 'target' },
      });
      await prisma.target.deleteMany({
        where: { id: { in: cleanTargetIds } },
      });
      await prisma.staffSession.deleteMany({
        where: { staffId: { in: cleanStaffIds } },
      });
      await prisma.staff.deleteMany({
        where: { id: { in: cleanStaffIds } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('Decision 1: Which roles can have a target at all', () => {
    it('allows Manager to set a target for call_agent (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 1,
          candidatesActivated: 20,
          refundRate: 0.05,
          vacanciesCaptured: 10,
        });

      expect(res.status).toBe(201);
      cleanTargetIds.push(res.body.id);
      expect(res.body.staffId).toBe(callAgentId);
      expect(res.body.stored.candidatesActivated).toBe(20);
    });

    it('allows Manager to set a target for field_agent (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2027,
          month: 1,
          placementsClosed: 8,
          replacementsInside15Days: 3,
        });

      expect(res.status).toBe(201);
      cleanTargetIds.push(res.body.id);
      expect(res.body.staffId).toBe(fieldAgentId);
      expect(res.body.stored.placementsClosed).toBe(8);
    });

    it('refuses setting target for ceo (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: ceoId,
          year: 2027,
          month: 1,
          placementsClosed: 10,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Targets can only be set for call_agent and field_agent');
    });

    it('refuses setting target for manager (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({
          staffId: managerId,
          year: 2027,
          month: 1,
          placementsClosed: 10,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Targets can only be set for call_agent and field_agent');
    });

    it('refuses setting target for team_lead (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: teamLead1Id,
          year: 2027,
          month: 1,
          candidatesActivated: 15,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Targets can only be set for call_agent and field_agent');
    });

    it('refuses setting target for finance (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: financeId,
          year: 2027,
          month: 1,
          candidatesActivated: 10,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Targets can only be set for call_agent and field_agent');
    });
  });

  describe('Decision 2: Partial targets (null means not targeted, empty record refused)', () => {
    it('sets only placementsClosed, leaving other metrics null (not treated as zero)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2027,
          month: 2,
          placementsClosed: 6,
        });

      expect(res.status).toBe(201);
      cleanTargetIds.push(res.body.id);

      expect(res.body.stored.placementsClosed).toBe(6);
      expect(res.body.stored.repeatBusinesses).toBeNull();
      expect(res.body.stored.candidatesActivated).toBeNull();

      // Metric detail
      const mPlacements = res.body.metrics.placementsClosed;
      expect(mPlacements.status).toBe('active');
      expect(mPlacements.isMeasured).toBe(true);
      expect(mPlacements.effectiveTarget).toBe(6);

      const mRepeat = res.body.metrics.repeatBusinesses;
      expect(mRepeat.status).toBe('not_targeted');
      expect(mRepeat.isMeasured).toBe(false);
      expect(mRepeat.effectiveTarget).toBeNull();
    });

    it('refuses target where ALL metric fields are null/undefined (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2027,
          month: 3,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('At least one metric target must be provided');
    });

    it('refuses updating target to clear all metrics to null (400)', async () => {
      // First create a target
      const targetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2027,
          month: 4,
          placementsClosed: 5,
        });
      expect(targetRes.status).toBe(201);
      cleanTargetIds.push(targetRes.body.id);

      // Attempt patch clearing the only active metric to null
      const patchRes = await request(app.getHttpServer())
        .patch(`/targets/${targetRes.body.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          placementsClosed: null,
        });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.message).toContain('At least one metric target must remain set');
    });
  });

  describe('Decision 3: Targets for past periods', () => {
    it('refuses creating a target for a month that has already ended (400)', async () => {
      // Direct call to targetService with explicit past date (2025-05) relative to current 2026+ clock
      await expect(
        targetService.setTarget(
          {
            staffId: callAgentId,
            year: 2025,
            month: 5,
            candidatesActivated: 10,
          },
          managerId,
          new Date('2026-11-01T00:00:00Z'),
        ),
      ).rejects.toThrow('Cannot set or update target for past period');
    });

    it('refuses updating a target for a month that has already ended (400)', async () => {
      // Create target for 2026-11 at time 2026-11-01
      const target = await targetService.setTarget(
        {
          staffId: callAgentId,
          year: 2026,
          month: 11,
          candidatesActivated: 15,
        },
        managerId,
        new Date('2026-11-01T00:00:00Z'),
      );
      cleanTargetIds.push(target.id);

      // Try updating target in 2026-12 (after period has ended)
      await expect(
        targetService.updateTarget(
          target.id,
          { candidatesActivated: 20 },
          managerId,
          new Date('2026-12-01T00:00:00Z'),
        ),
      ).rejects.toThrow('Cannot set or update target for past period');
    });

    it('allows updating a target within the current active month (200)', async () => {
      const target = await targetService.setTarget(
        {
          staffId: fieldAgentId,
          year: 2027,
          month: 5,
          placementsClosed: 5,
        },
        managerId,
        new Date('2027-05-05T00:00:00Z'),
      );
      cleanTargetIds.push(target.id);

      const updated = await targetService.updateTarget(
        target.id,
        { placementsClosed: 8 },
        managerId,
        new Date('2027-05-15T00:00:00Z'),
      );

      expect(updated.stored.placementsClosed).toBe(8);
      expect(updated.effective.placementsClosed).toBe(8);
    });
  });

  describe('RBAC Endpoint Permissions', () => {
    it('CEO and Manager can set targets (201)', async () => {
      const ceoRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 6,
          candidatesActivated: 18,
        });
      expect(ceoRes.status).toBe(201);
      cleanTargetIds.push(ceoRes.body.id);

      const mgrRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2027,
          month: 6,
          placementsClosed: 7,
        });
      expect(mgrRes.status).toBe(201);
      cleanTargetIds.push(mgrRes.body.id);
    });

    it('Team Lead cannot set targets (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 7,
          candidatesActivated: 15,
        });
      expect(res.status).toBe(403);
    });

    it('Call Agent cannot set targets (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 7,
          candidatesActivated: 15,
        });
      expect(res.status).toBe(403);
    });

    it('Field Agent cannot set targets (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2027,
          month: 7,
          placementsClosed: 5,
        });
      expect(res.status).toBe(403);
    });

    it('Finance cannot set targets (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 7,
          candidatesActivated: 15,
        });
      expect(res.status).toBe(403);
    });

    it('Team Lead can read targets of own subordinate (200), but not another team (403)', async () => {
      // Target for callAgentId (under teamLead1)
      const caTargetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 8,
          candidatesActivated: 20,
        });
      cleanTargetIds.push(caTargetRes.body.id);

      // Target for fieldAgentId (under teamLead2)
      const faTargetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2027,
          month: 8,
          placementsClosed: 10,
        });
      cleanTargetIds.push(faTargetRes.body.id);

      // TeamLead1 reads own agent target -> 200
      const tl1ReadOwn = await request(app.getHttpServer())
        .get(`/targets/${caTargetRes.body.id}`)
        .set('Authorization', `Bearer ${teamLead1Token}`);
      expect(tl1ReadOwn.status).toBe(200);

      // TeamLead1 reads TeamLead2 agent target -> 403
      const tl1ReadOther = await request(app.getHttpServer())
        .get(`/targets/${faTargetRes.body.id}`)
        .set('Authorization', `Bearer ${teamLead1Token}`);
      expect(tl1ReadOther.status).toBe(403);

      // TeamLead2 reads own agent target -> 200
      const tl2ReadOwn = await request(app.getHttpServer())
        .get(`/targets/${faTargetRes.body.id}`)
        .set('Authorization', `Bearer ${teamLead2Token}`);
      expect(tl2ReadOwn.status).toBe(200);
    });

    it('Agent can read own target (200), but not another agent (403)', async () => {
      const caTargetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 9,
          candidatesActivated: 22,
        });
      cleanTargetIds.push(caTargetRes.body.id);

      // Call Agent reads own target -> 200
      const caReadSelf = await request(app.getHttpServer())
        .get(`/targets/${caTargetRes.body.id}`)
        .set('Authorization', `Bearer ${callAgentToken}`);
      expect(caReadSelf.status).toBe(200);

      // Field Agent reads Call Agent target -> 403
      const faReadOther = await request(app.getHttpServer())
        .get(`/targets/${caTargetRes.body.id}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);
      expect(faReadOther.status).toBe(403);
    });

    it('Finance is refused reading targets entirely (403)', async () => {
      const res = await request(app.getHttpServer())
        .get('/targets')
        .set('Authorization', `Bearer ${financeToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('Pro-Rating for Mid-Month Joiners', () => {
    it('agent created on the 20th of a 30-day month has an effective target of Math.floor(storedTarget * 11 / 30)', async () => {
      // Create an agent with createdAt set to the 20th of a 30-day month (e.g. November 2027)
      const midMonthAgent = await prisma.staff.create({
        data: {
          code: `CA-MID-${timestamp}`,
          name: 'Mid Month Joiner',
          email: `mid_${timestamp}@laboura.local`,
          passwordHash: 'hash',
          role: 'call_agent',
          city: 'Bengaluru',
          createdAt: new Date('2027-11-20T10:00:00Z'), // Day 20 of 30-day month
        },
      });
      cleanStaffIds.push(midMonthAgent.id);

      // Set full monthly target = 30
      const targetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: midMonthAgent.id,
          year: 2027,
          month: 11,
          candidatesActivated: 30,
        });

      expect(targetRes.status).toBe(201);
      cleanTargetIds.push(targetRes.body.id);

      // Stored target remains unscaled 30
      expect(targetRes.body.stored.candidatesActivated).toBe(30);

      // Pro-rating check:
      // November has 30 days. Joined day 20 -> worked 20th through 30th = 11 days.
      // Factor = 11 / 30 (~0.36666...)
      // Effective target = Math.floor(30 * (11 / 30)) = 11
      expect(targetRes.body.proRating.isMidMonthJoiner).toBe(true);
      expect(targetRes.body.proRating.daysPresent).toBe(11);
      expect(targetRes.body.proRating.daysInMonth).toBe(30);
      expect(targetRes.body.proRating.factor).toBeCloseTo(11 / 30, 4);

      expect(targetRes.body.effective.candidatesActivated).toBe(11);
      expect(targetRes.body.metrics.candidatesActivated.status).toBe('active');
      expect(targetRes.body.metrics.candidatesActivated.isMeasured).toBe(true);
      expect(targetRes.body.metrics.candidatesActivated.effectiveTarget).toBe(11);
    });

    it('agent whose pro-rated target computes to 0 returns the explicit "not measured this period" state', async () => {
      // Same agent joined on 20th of 30-day month (factor 11/30)
      const midMonthAgent = await prisma.staff.create({
        data: {
          code: `CA-MID2-${timestamp}`,
          name: 'Mid Month Small Target',
          email: `mid2_${timestamp}@laboura.local`,
          passwordHash: 'hash',
          role: 'call_agent',
          city: 'Bengaluru',
          createdAt: new Date('2027-11-20T10:00:00Z'),
        },
      });
      cleanStaffIds.push(midMonthAgent.id);

      // Target set to 2. Math.floor(2 * (11 / 30)) = Math.floor(0.733) = 0
      const targetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: midMonthAgent.id,
          year: 2027,
          month: 11,
          vacanciesCaptured: 2,
        });

      expect(targetRes.status).toBe(201);
      cleanTargetIds.push(targetRes.body.id);

      expect(targetRes.body.stored.vacanciesCaptured).toBe(2);

      // Must NOT return target 0; must return explicit "not measured this period"
      expect(targetRes.body.effective.vacanciesCaptured).toBeNull();
      const mVac = targetRes.body.metrics.vacanciesCaptured;
      expect(mVac.status).toBe('not_measured');
      expect(mVac.isMeasured).toBe(false);
      expect(mVac.effectiveTarget).toBeNull();
      expect(mVac.storedTarget).toBe(2);
    });

    it('agent created on the last day of the month is explicitly not measured', async () => {
      const lastDayAgent = await prisma.staff.create({
        data: {
          code: `FA-LAST-${timestamp}`,
          name: 'Last Day Joiner',
          email: `last_${timestamp}@laboura.local`,
          passwordHash: 'hash',
          role: 'field_agent',
          city: 'Bengaluru',
          createdAt: new Date('2027-11-30T10:00:00Z'), // Day 30 of 30-day month
        },
      });
      cleanStaffIds.push(lastDayAgent.id);

      // Full month target = 10. Math.floor(10 * (1 / 30)) = 0
      const targetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: lastDayAgent.id,
          year: 2027,
          month: 11,
          placementsClosed: 10,
        });

      expect(targetRes.status).toBe(201);
      cleanTargetIds.push(targetRes.body.id);

      expect(targetRes.body.proRating.daysPresent).toBe(1);
      expect(targetRes.body.proRating.daysInMonth).toBe(30);
      expect(targetRes.body.effective.placementsClosed).toBeNull();
      expect(targetRes.body.metrics.placementsClosed.status).toBe('not_measured');
      expect(targetRes.body.metrics.placementsClosed.isMeasured).toBe(false);
    });

    it('refundRate ceiling is not pro-rated down for mid-month joiners', async () => {
      const midMonthAgent = await prisma.staff.create({
        data: {
          code: `CA-RR-${timestamp}`,
          name: 'Mid Month RR Joiner',
          email: `mid_rr_${timestamp}@laboura.local`,
          passwordHash: 'hash',
          role: 'call_agent',
          city: 'Bengaluru',
          createdAt: new Date('2027-11-20T10:00:00Z'),
        },
      });
      cleanStaffIds.push(midMonthAgent.id);

      const targetRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: midMonthAgent.id,
          year: 2027,
          month: 11,
          candidatesActivated: 30,
          refundRate: 0.05,
        });

      expect(targetRes.status).toBe(201);
      cleanTargetIds.push(targetRes.body.id);

      // Volume is pro-rated (30 * 11/30 = 11)
      expect(targetRes.body.effective.candidatesActivated).toBe(11);
      // Rate ceiling is NOT pro-rated (0.05 remains 0.05)
      expect(targetRes.body.effective.refundRate).toBe(0.05);
      expect(targetRes.body.metrics.refundRate.direction).toBe('lower_is_better');
      expect(targetRes.body.metrics.refundRate.status).toBe('active');
      expect(targetRes.body.metrics.refundRate.isMeasured).toBe(true);
    });
  });

  describe('Unique Constraint and Audit Logging', () => {
    it('prevents two targets for the same agent and month (409 Conflict)', async () => {
      const firstRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 12,
          candidatesActivated: 25,
        });
      expect(firstRes.status).toBe(201);
      cleanTargetIds.push(firstRes.body.id);

      // Second target for same agent, year, month
      const dupRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: callAgentId,
          year: 2027,
          month: 12,
          candidatesActivated: 30,
        });
      expect(dupRes.status).toBe(409);
    });

    it('audits target creation and target updates in AuditLog', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/targets')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          staffId: fieldAgentId,
          year: 2028,
          month: 1,
          placementsClosed: 12,
        });
      expect(createRes.status).toBe(201);
      const targetId = createRes.body.id;
      cleanTargetIds.push(targetId);

      // Check create audit log
      const createLog = await prisma.auditLog.findFirst({
        where: {
          action: 'target.create',
          entityCode: targetId,
        },
      });
      expect(createLog).toBeDefined();
      expect(createLog?.actorId).toBe(managerId);

      // Update target
      const updateRes = await request(app.getHttpServer())
        .patch(`/targets/${targetId}`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({
          placementsClosed: 15,
        });
      expect(updateRes.status).toBe(200);

      // Check update audit log
      const updateLog = await prisma.auditLog.findFirst({
        where: {
          action: 'target.update',
          entityCode: targetId,
        },
      });
      expect(updateLog).toBeDefined();
      expect(updateLog?.actorId).toBe(ceoId);
    });
  });
});
