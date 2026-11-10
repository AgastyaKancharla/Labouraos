import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';
import { RBAC_MATRIX } from '../../common/rbac/rbac.types';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { Reflector } from '@nestjs/core';
import { PERMISSION_METADATA_KEY } from '../../common/rbac/permissions.decorator';

describe('Phase 6.6 Task 1: Open up the Team Lead role', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;
  let rbacGuard: RbacGuard;

  let lead1Token: string;
  let lead1Id: string;
  let lead2Token: string;
  let lead2Id: string;
  let agent1Id: string;
  let agent2Id: string;
  let agent3Id: string;

  let sampleBusinessId: string;
  let sampleVacancyId: string;
  let sampleSeekerId: string;
  let sampleReferralId: string;
  let callbackTaskId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const cleanStaffIds: string[] = [];
  const cleanJobSeekerIds: string[] = [];
  const cleanReferralIds: string[] = [];
  const cleanBusinessIds: string[] = [];
  const cleanCallbackTaskIds: string[] = [];

  const getVerifiedOtp = async (phone: string): Promise<string> => {
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);
    return requestId;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);
    rbacGuard = app.get<RbacGuard>(RbacGuard);

    const passwordHash = await bcrypt.hash(password, 10);

    // 1. Create Team Lead 1
    const lead1 = await prisma.staff.create({
      data: {
        code: `TL1-${timestamp}`,
        name: 'Team Lead 1',
        email: `tl1_${timestamp}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    lead1Id = lead1.id;
    cleanStaffIds.push(lead1.id);

    // 2. Create Team Lead 2
    const lead2 = await prisma.staff.create({
      data: {
        code: `TL2-${timestamp}`,
        name: 'Team Lead 2',
        email: `tl2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    lead2Id = lead2.id;
    cleanStaffIds.push(lead2.id);

    // 3. Create Agent 1 under Lead 1 (call agent)
    const agent1 = await prisma.staff.create({
      data: {
        code: `CA1-${timestamp}`,
        name: 'Call Agent 1 (Team 1)',
        email: `ca1_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        teamLeadId: lead1.id,
        city: 'Bengaluru',
      },
    });
    agent1Id = agent1.id;
    cleanStaffIds.push(agent1.id);

    // 4. Create Agent 2 under Lead 1 (field agent in Koramangala)
    const agent2 = await prisma.staff.create({
      data: {
        code: `FA1-${timestamp}`,
        name: 'Field Agent 2 (Team 1)',
        email: `fa2_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        teamLeadId: lead1.id,
        city: 'Bengaluru',
      },
    });
    agent2Id = agent2.id;
    cleanStaffIds.push(agent2.id);

    // 5. Create Agent 3 under Lead 2 (call agent in Team 2)
    const agent3 = await prisma.staff.create({
      data: {
        code: `CA2-${timestamp}`,
        name: 'Call Agent 3 (Team 2)',
        email: `ca3_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        teamLeadId: lead2.id,
        city: 'Bengaluru',
      },
    });
    agent3Id = agent3.id;
    cleanStaffIds.push(agent3.id);

    // Login tokens
    const server = app.getHttpServer();
    const login = async (email: string | null) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    lead1Token = await login(lead1.email);
    lead2Token = await login(lead2.email);

    // Create Business and Vacancy for operational endpoint assertions
    const bz = await prisma.business.create({
      data: {
        code: `BZ-TL-${timestamp}`,
        name: 'Lead Test Corp',
        phone: `91${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        locality: 'Koramangala',
        accountAgentId: agent2.id,
        city: 'Bengaluru',
      },
    });
    sampleBusinessId = bz.id;
    cleanBusinessIds.push(bz.id);

    const vc = await prisma.vacancy.create({
      data: {
        code: `VC-TL-${timestamp}`,
        businessId: bz.id,
        tradeSkill: 'Plumber',
        salaryMinPaise: 2200000,
        city: 'Bengaluru',
        capturedByStaffId: agent2.id,
      },
    });
    sampleVacancyId = vc.id;

    // Create Candidate captured/owned by Agent 1
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-TL-${timestamp}`,
        name: 'Candidate Team 1',
        phone: `92${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        trades: { create: { trade: 'Plumber', isPrimary: true } },
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        city: 'Bengaluru',
      },
    });
    sampleSeekerId = seeker.id;
    cleanJobSeekerIds.push(seeker.id);

    // Create Referral
    const ref = await prisma.referral.create({
      data: {
        code: `RF-TL-${timestamp}`,
        name: 'Partner Team 1',
        phone: `81${timestamp.toString().slice(-8)}`,
        phoneVerified: true,
        city: 'Bengaluru',
      },
    });
    sampleReferralId = ref.id;
    cleanReferralIds.push(ref.id);

    // Create CallbackTask for reassignment test
    const cb = await prisma.callbackTask.create({
      data: {
        callId: `CALL-TL-${timestamp}`,
        phone: `93${timestamp.toString().slice(-8)}`,
        callerName: 'Callback Caller',
        status: 'pending',
      },
    });
    callbackTaskId = cb.id;
    cleanCallbackTaskIds.push(cb.id);
  });

  afterAll(async () => {
    if (cleanCallbackTaskIds.length > 0) {
      await prisma.callbackTask.deleteMany({
        where: { id: { in: cleanCallbackTaskIds } },
      });
    }

    if (sampleVacancyId) {
      await prisma.placement.deleteMany({
        where: { vacancyId: sampleVacancyId },
      });
      await prisma.vacancy.deleteMany({
        where: { id: sampleVacancyId },
      });
    }

    if (cleanJobSeekerIds.length > 0) {
      await prisma.jobSeekerHit.deleteMany({
        where: { jobSeekerId: { in: cleanJobSeekerIds } },
      });
      await prisma.contactAttempt.deleteMany({
        where: { jobSeekerId: { in: cleanJobSeekerIds } },
      });
      await prisma.payment.deleteMany({
        where: { subjectId: { in: cleanJobSeekerIds } },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: cleanJobSeekerIds } },
      });
    }

    if (cleanReferralIds.length > 0) {
      await prisma.referral.deleteMany({
        where: { id: { in: cleanReferralIds } },
      });
    }

    if (cleanBusinessIds.length > 0) {
      await prisma.businessVisit.deleteMany({
        where: { businessId: { in: cleanBusinessIds } },
      });
      await prisma.business.deleteMany({
        where: { id: { in: cleanBusinessIds } },
      });
    }

    if (cleanStaffIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: cleanStaffIds } },
      });
      await prisma.staffSession.deleteMany({
        where: { staffId: { in: cleanStaffIds } },
      });
      await prisma.staff.deleteMany({
        where: { id: { in: cleanStaffIds } },
      });
    }

    await app.close();
  });

  describe('1. Team Lead Staff Scoping & Listing', () => {
    it("Team Lead can list their own team's agents via GET /staff", async () => {
      const res = await request(app.getHttpServer())
        .get('/staff')
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const returnedIds = res.body.map((s: { id: string }) => s.id);
      expect(returnedIds).toContain(agent1Id);
      expect(returnedIds).toContain(agent2Id);
      // Another team's agent is not returned
      expect(returnedIds).not.toContain(agent3Id);
    });

    it("Team Lead can read own team's agents by ID via GET /staff/:id", async () => {
      const res1 = await request(app.getHttpServer())
        .get(`/staff/${agent1Id}`)
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res1.status).toBe(200);
      expect(res1.body.id).toBe(agent1Id);
      expect(res1.body.teamLeadId).toBe(lead1Id);

      const res2 = await request(app.getHttpServer())
        .get(`/staff/${agent2Id}`)
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res2.status).toBe(200);
      expect(res2.body.id).toBe(agent2Id);
      expect(res2.body.teamLeadId).toBe(lead1Id);

      // Lead 2 can read their own agent (Agent 3)
      const res3 = await request(app.getHttpServer())
        .get(`/staff/${agent3Id}`)
        .set('Authorization', `Bearer ${lead2Token}`);

      expect(res3.status).toBe(200);
      expect(res3.body.id).toBe(agent3Id);
      expect(res3.body.teamLeadId).toBe(lead2Id);
    });

    it("Team Lead is strictly REFUSED (403) reading another team's agent by ID", async () => {
      const res = await request(app.getHttpServer())
        .get(`/staff/${agent3Id}`)
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Access denied');
      expect(res.body.message).toContain('is not part of your team');
    });

    it("Team Lead is strictly REFUSED (403) attempting to query another team's staff list", async () => {
      const res = await request(app.getHttpServer())
        .get(`/staff?teamLeadId=${lead2Id}`)
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Access denied');
      expect(res.body.message).toContain('another team lead');
    });
  });

  describe('2. Team Lead Staff Creation & Deactivation Refusal', () => {
    it('Team Lead is strictly REFUSED (403) creating a staff account (POST /staff)', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff')
        .set('Authorization', `Bearer ${lead1Token}`)
        .send({
          name: 'Forbidden Hire',
          email: `forbidden_${timestamp}@laboura.local`,
          role: 'call_agent',
        });

      expect(res.status).toBe(403);
    });

    it('Team Lead is strictly REFUSED (403) deactivating a staff account (POST /staff/:id/deactivate)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/staff/${agent1Id}/deactivate`)
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('3. Team Lead Candidate Access', () => {
    it('Team Lead can read a candidate their agent owns (GET /job-seekers/:id)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/job-seekers/${sampleSeekerId}`)
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(sampleSeekerId);
      expect(res.body.name).toBe('Candidate Team 1');
    });

    it('Team Lead can list job seekers (GET /job-seekers)', async () => {
      const res = await request(app.getHttpServer())
        .get('/job-seekers')
        .set('Authorization', `Bearer ${lead1Token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((s: { id: string }) => s.id === sampleSeekerId)).toBe(true);
    });

    it('Team Lead can create a job seeker with verified OTP (POST /job-seekers)', async () => {
      const phone = `94${timestamp.toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/job-seekers')
        .set('Authorization', `Bearer ${lead1Token}`)
        .send(completeJobSeekerRegistration({
          name: 'Lead Created Candidate',
          phone,
          otpRequestId,
          tradeSkill: 'Plumber',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
        }));

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      cleanJobSeekerIds.push(res.body.id);
    });
  });

  describe('4. Team Lead Access to Operations (Referrals, Businesses, Vacancies, Priority)', () => {
    it('Team Lead can read referrals (GET /referrals and GET /referrals/:id)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/referrals')
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(listRes.status).toBe(200);

      const detailRes = await request(app.getHttpServer())
        .get(`/referrals/${sampleReferralId}`)
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(sampleReferralId);
    });

    it('Team Lead can read businesses (GET /businesses and GET /businesses/:id)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/businesses')
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(listRes.status).toBe(200);

      const detailRes = await request(app.getHttpServer())
        .get(`/businesses/${sampleBusinessId}`)
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(sampleBusinessId);
    });

    it('Team Lead can read vacancies (GET /vacancies and GET /vacancies/:id)', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/vacancies')
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(listRes.status).toBe(200);

      const detailRes = await request(app.getHttpServer())
        .get(`/vacancies/${sampleVacancyId}`)
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(sampleVacancyId);
    });

    it('Team Lead can access Priority Dashboard endpoints', async () => {
      const candidatesRes = await request(app.getHttpServer())
        .get('/priority/candidates')
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(candidatesRes.status).toBe(200);

      const vacanciesRes = await request(app.getHttpServer())
        .get('/priority/vacancies')
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(vacanciesRes.status).toBe(200);

      const tradesRes = await request(app.getHttpServer())
        .get('/priority/trades')
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(tradesRes.status).toBe(200);

      const dashboardRes = await request(app.getHttpServer())
        .get('/field-agent/priority-dashboard')
        .set('Authorization', `Bearer ${lead1Token}`);
      expect(dashboardRes.status).toBe(200);
    });
  });

  describe('5. Team Lead Work Reassignment Between Own Agents', () => {
    it('Team Lead can assign work to an agent on their own team', async () => {
      const res = await request(app.getHttpServer())
        .post(`/telephony/callbacks/${callbackTaskId}/assign`)
        .set('Authorization', `Bearer ${lead1Token}`)
        .send({ staffId: agent1Id });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(callbackTaskId);
      expect(res.body.assignedToStaffId).toBe(agent1Id);
      expect(res.body.status).toBe('assigned');
    });

    it('Team Lead can reassign work to another agent on their own team', async () => {
      const res = await request(app.getHttpServer())
        .post(`/telephony/callbacks/${callbackTaskId}/assign`)
        .set('Authorization', `Bearer ${lead1Token}`)
        .send({ staffId: agent2Id });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(callbackTaskId);
      expect(res.body.assignedToStaffId).toBe(agent2Id);
      expect(res.body.status).toBe('assigned');
    });

    it("Team Lead is strictly REFUSED (403) assigning work to an agent on another team", async () => {
      const res = await request(app.getHttpServer())
        .post(`/telephony/callbacks/${callbackTaskId}/assign`)
        .set('Authorization', `Bearer ${lead1Token}`)
        .send({ staffId: agent3Id });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Access denied');
      expect(res.body.message).toContain('is not part of your team');
    });
  });

  describe('6. Target Permission Boundaries (Asserted Ahead of Phase 6.7)', () => {
    it('Asserts in RBAC matrix that Team Lead has read own_team, but write target is strictly disallowed', () => {
      expect(RBAC_MATRIX.team_lead.target.read.allowed).toBe(true);
      expect(RBAC_MATRIX.team_lead.target.read.scope).toBe('own_team');

      expect(RBAC_MATRIX.team_lead.target.write.allowed).toBe(false);
      expect(RBAC_MATRIX.team_lead.target.write.scope).toBe('none');
    });

    it('Asserts that RbacGuard rejects team_lead attempting write action on target resource', async () => {
      const mockExecutionContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            user: {
              sub: lead1Id,
              role: 'team_lead',
            },
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      const reflector = app.get<Reflector>(Reflector);
      const spy = jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((metadataKey: unknown) => {
          if (metadataKey === PERMISSION_METADATA_KEY) {
            return { resource: 'target', action: 'write' };
          }
          return undefined;
        });

      await expect(rbacGuard.canActivate(mockExecutionContext)).rejects.toThrow(
        "Role 'team_lead' is not permitted to perform 'write' on 'target'",
      );
      spy.mockRestore();
    });
  });
});
