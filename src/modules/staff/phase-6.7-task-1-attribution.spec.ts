import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { RBAC_MATRIX } from '../../common/rbac/rbac.types';

describe('Phase 6.7 Task 1: Agent Attribution and own_captured scope resolution', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let callAgentToken: string;
  let callAgentId: string;
  let fieldAgentToken: string;
  let fieldAgentId: string;
  let fieldAgent2Token: string;
  let managerToken: string;

  let koraBizId: string;
  let indiBizId: string;
  let koraVacancyId: string;
  let indiVacancyId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const koraArea = `Area-T1K-${timestamp}`;
  const indiArea = `Area-T1I-${timestamp}`;

  const cleanStaffIds: string[] = [];
  const cleanJobSeekerIds: string[] = [];
  const cleanPlacementIds: string[] = [];
  const cleanVacancyIds: string[] = [];
  const cleanBusinessIds: string[] = [];

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

    const passwordHash = await bcrypt.hash(password, 10);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-T1-${timestamp}`,
        name: 'Call Agent T1',
        email: `ca_t1_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = ca.id;
    cleanStaffIds.push(ca.id);

    const fa = await prisma.staff.create({
      data: {
        code: `FA-T1K-${timestamp}`,
        name: 'Field Agent Kora T1',
        email: `fa_t1k_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: koraArea,
        city: 'Bengaluru',
      },
    });
    fieldAgentId = fa.id;
    cleanStaffIds.push(fa.id);

    const fa2 = await prisma.staff.create({
      data: {
        code: `FA-T1I-${timestamp}`,
        name: 'Field Agent Indi T1',
        email: `fa_t1i_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: indiArea,
        city: 'Bengaluru',
      },
    });
    cleanStaffIds.push(fa2.id);

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-T1-${timestamp}`,
        name: 'Manager T1',
        email: `mgr_t1_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    cleanStaffIds.push(mgr.id);

    const server = app.getHttpServer();
    const login = async (email: string | null) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    callAgentToken = await login(ca.email);
    fieldAgentToken = await login(fa.email);
    fieldAgent2Token = await login(fa2.email);
    managerToken = await login(mgr.email);

    // Create businesses in two areas
    const bKora = await prisma.business.create({
      data: {
        code: `BZ-T1K-${timestamp}`,
        name: 'Kora Biz T1',
        phone: `+9181${String(timestamp).slice(-8)}1`,
        phoneVerified: true,
        area: koraArea,
        city: 'Bengaluru',
      },
    });
    koraBizId = bKora.id;
    cleanBusinessIds.push(bKora.id);

    const bIndi = await prisma.business.create({
      data: {
        code: `BZ-T1I-${timestamp}`,
        name: 'Indi Biz T1',
        phone: `+9181${String(timestamp).slice(-8)}2`,
        phoneVerified: true,
        area: indiArea,
        city: 'Bengaluru',
      },
    });
    indiBizId = bIndi.id;
    cleanBusinessIds.push(bIndi.id);

    // Create vacancies in two areas
    const vKora = await prisma.vacancy.create({
      data: {
        code: `VC-T1K-${timestamp}`,
        businessId: bKora.id,
        tradeSkill: 'Electrician',
        salaryMinPaise: 2000000,
        capturedByStaffId: fa.id,
        city: 'Bengaluru',
      },
    });
    koraVacancyId = vKora.id;
    cleanVacancyIds.push(vKora.id);

    const vIndi = await prisma.vacancy.create({
      data: {
        code: `VC-T1I-${timestamp}`,
        businessId: bIndi.id,
        tradeSkill: 'Plumber',
        salaryMinPaise: 2200000,
        capturedByStaffId: fa2.id,
        city: 'Bengaluru',
      },
    });
    indiVacancyId = vIndi.id;
    cleanVacancyIds.push(vIndi.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { entityCode: { startsWith: 'JS-T1' } },
            { entityCode: { startsWith: 'PL-T1' } },
          ],
        },
      });
      await prisma.placement.deleteMany({
        where: { id: { in: cleanPlacementIds } },
      });
      await prisma.vacancy.deleteMany({
        where: { id: { in: cleanVacancyIds } },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: cleanJobSeekerIds } },
      });
      await prisma.business.deleteMany({
        where: { id: { in: cleanBusinessIds } },
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

  describe('Job Seeker Attribution', () => {
    it('creating a job seeker as Call Agent records acting staff in registeredByStaffId', async () => {
      const phone = `+9191${String(timestamp).slice(-8)}1`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/job-seekers')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          name: 'CA Onboarded Candidate',
          phone,
          otpRequestId,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          city: 'Bengaluru',
        });

      expect(res.status).toBe(201);
      cleanJobSeekerIds.push(res.body.id);

      const inDb = await prisma.jobSeeker.findUnique({
        where: { id: res.body.id },
        include: { registeredBy: true },
      });
      expect(inDb?.registeredByStaffId).toBe(callAgentId);
      expect(inDb?.registeredBy?.id).toBe(callAgentId);
      expect(inDb?.registeredBy?.role).toBe('call_agent');
    });

    it('creating a job seeker as Field Agent records acting staff in registeredByStaffId', async () => {
      const phone = `+9191${String(timestamp).slice(-8)}2`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/job-seekers')
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          name: 'FA Onboarded Candidate',
          phone,
          otpRequestId,
          tradeSkill: 'Plumber',
          minSalary: 1900000,
          maxSalary: 2600000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '17:00',
          city: 'Bengaluru',
        });

      expect(res.status).toBe(201);
      cleanJobSeekerIds.push(res.body.id);

      const inDb = await prisma.jobSeeker.findUnique({
        where: { id: res.body.id },
        include: { registeredBy: true },
      });
      expect(inDb?.registeredByStaffId).toBe(fieldAgentId);
      expect(inDb?.registeredBy?.id).toBe(fieldAgentId);
      expect(inDb?.registeredBy?.role).toBe('field_agent');
    });
  });

  describe('Placement Attribution', () => {
    let candidateForCaPl: string;
    let candidateForFaPl: string;

    beforeAll(async () => {
      const js1 = await prisma.jobSeeker.create({
        data: {
          code: `JS-T1PLC-1-${timestamp}`,
          name: 'Ready Candidate 1',
          phone: `+9191${String(timestamp).slice(-8)}3`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          city: 'Bengaluru',
        },
      });
      candidateForCaPl = js1.id;
      cleanJobSeekerIds.push(js1.id);

      const js2 = await prisma.jobSeeker.create({
        data: {
          code: `JS-T1PLC-2-${timestamp}`,
          name: 'Ready Candidate 2',
          phone: `+9191${String(timestamp).slice(-8)}4`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          city: 'Bengaluru',
        },
      });
      candidateForFaPl = js2.id;
      cleanJobSeekerIds.push(js2.id);
    });

    it('creating a placement as Call Agent records acting staff in createdByStaffId', async () => {
      const res = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          jobSeekerId: candidateForCaPl,
          agreedSalary: 2000000,
        });

      expect(res.status).toBe(201);
      cleanPlacementIds.push(res.body.id);

      const inDb = await prisma.placement.findUnique({
        where: { id: res.body.id },
        include: { createdBy: true },
      });
      expect(inDb?.createdByStaffId).toBe(callAgentId);
      expect(inDb?.createdBy?.id).toBe(callAgentId);
      expect(inDb?.createdBy?.role).toBe('call_agent');
    });

    it('creating a placement as Field Agent records acting staff in createdByStaffId', async () => {
      const res = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          jobSeekerId: candidateForFaPl,
          agreedSalary: 2000000,
        });

      expect(res.status).toBe(201);
      cleanPlacementIds.push(res.body.id);

      const inDb = await prisma.placement.findUnique({
        where: { id: res.body.id },
        include: { createdBy: true },
      });
      expect(inDb?.createdByStaffId).toBe(fieldAgentId);
      expect(inDb?.createdBy?.id).toBe(fieldAgentId);
      expect(inDb?.createdBy?.role).toBe('field_agent');
    });
  });

  describe('Null Attribution Handling', () => {
    it('records with null attribution exist and are excluded from per-agent metric filters', async () => {
      // Create legacy/unattributed job seeker and placement directly with null attribution
      const unattrCandidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-T1UNATTR-${timestamp}`,
          name: 'Legacy Unattributed Worker',
          phone: `+9191${String(timestamp).slice(-8)}5`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          registeredByStaffId: null, // explicitly null
          city: 'Bengaluru',
        },
      });
      cleanJobSeekerIds.push(unattrCandidate.id);

      const unattrPlacement = await prisma.placement.create({
        data: {
          code: `PL-T1UNATTR-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: unattrCandidate.id,
          businessId: koraBizId,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          createdByStaffId: null, // explicitly null
          status: 'offered',
          city: 'Bengaluru',
        },
      });
      cleanPlacementIds.push(unattrPlacement.id);

      expect(unattrCandidate.registeredByStaffId).toBeNull();
      expect(unattrPlacement.createdByStaffId).toBeNull();

      // Query attributed to callAgentId
      const caCandidates = await prisma.jobSeeker.findMany({
        where: { registeredByStaffId: callAgentId },
      });
      expect(caCandidates.some((c) => c.id === unattrCandidate.id)).toBe(false);

      const caPlacements = await prisma.placement.findMany({
        where: { createdByStaffId: callAgentId },
      });
      expect(caPlacements.some((p) => p.id === unattrPlacement.id)).toBe(false);

      // Query attributed to fieldAgentId
      const faCandidates = await prisma.jobSeeker.findMany({
        where: { registeredByStaffId: fieldAgentId },
      });
      expect(faCandidates.some((c) => c.id === unattrCandidate.id)).toBe(false);

      const faPlacements = await prisma.placement.findMany({
        where: { createdByStaffId: fieldAgentId },
      });
      expect(faPlacements.some((p) => p.id === unattrPlacement.id)).toBe(false);
    });

    it('deleting a staff member nullifies their attributed records (onDelete: SetNull)', async () => {
      const tempAgent = await prisma.staff.create({
        data: {
          code: `TMP-T1-${timestamp}`,
          name: 'Temporary Agent',
          email: `tmp_t1_${timestamp}@laboura.local`,
          passwordHash: 'hash',
          role: 'call_agent',
          city: 'Bengaluru',
        },
      });

      const tempCandidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-T1TMP-${timestamp}`,
          name: 'Temp Attributed Worker',
          phone: `+9191${String(timestamp).slice(-8)}6`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          registeredByStaffId: tempAgent.id,
          city: 'Bengaluru',
        },
      });
      cleanJobSeekerIds.push(tempCandidate.id);

      const tempPlacement = await prisma.placement.create({
        data: {
          code: `PL-T1TMP-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: tempCandidate.id,
          businessId: koraBizId,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          createdByStaffId: tempAgent.id,
          status: 'offered',
          city: 'Bengaluru',
        },
      });
      cleanPlacementIds.push(tempPlacement.id);

      // Delete staff member
      await prisma.staff.delete({ where: { id: tempAgent.id } });

      // Check attributed records: they should still exist with null foreign key
      const refreshedCandidate = await prisma.jobSeeker.findUnique({
        where: { id: tempCandidate.id },
      });
      expect(refreshedCandidate).toBeDefined();
      expect(refreshedCandidate?.registeredByStaffId).toBeNull();

      const refreshedPlacement = await prisma.placement.findUnique({
        where: { id: tempPlacement.id },
      });
      expect(refreshedPlacement).toBeDefined();
      expect(refreshedPlacement?.createdByStaffId).toBeNull();
    });
  });

  describe('RBAC Matrix: call_agent scope resolution (own_captured -> all)', () => {
    it('RBAC_MATRIX configures call_agent vacancy and placement with scope all', () => {
      expect(RBAC_MATRIX.call_agent.vacancy.read.scope).toBe('all');
      expect(RBAC_MATRIX.call_agent.vacancy.write.scope).toBe('all');
      expect(RBAC_MATRIX.call_agent.placement.read.scope).toBe('all');
      expect(RBAC_MATRIX.call_agent.placement.write.scope).toBe('all');
    });

    it('Call Agent can read vacancies city-wide, across multiple areas and captured by other agents', async () => {
      // Koramangala vacancy captured by Field Agent 1
      const resKora = await request(app.getHttpServer())
        .get(`/vacancies/${koraVacancyId}`)
        .set('Authorization', `Bearer ${callAgentToken}`);
      expect(resKora.status).toBe(200);
      expect(resKora.body.id).toBe(koraVacancyId);

      // Indiranagar vacancy captured by Field Agent 2
      const resIndi = await request(app.getHttpServer())
        .get(`/vacancies/${indiVacancyId}`)
        .set('Authorization', `Bearer ${callAgentToken}`);
      expect(resIndi.status).toBe(200);
      expect(resIndi.body.id).toBe(indiVacancyId);
    });

    it('Call Agent can list all vacancies city-wide', async () => {
      const res = await request(app.getHttpServer())
        .get('/vacancies')
        .set('Authorization', `Bearer ${callAgentToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((v: { id: string }) => v.id);
      expect(ids).toContain(koraVacancyId);
      expect(ids).toContain(indiVacancyId);
    });

    it('Field Agent remains strictly area-scoped for vacancies (no area leak)', async () => {
      // Field Agent 1 is in Koramangala; accessing Indiranagar vacancy -> 403 Forbidden
      const res403 = await request(app.getHttpServer())
        .get(`/vacancies/${indiVacancyId}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);
      expect(res403.status).toBe(403);

      // Field Agent 2 is in Indiranagar; accessing Indiranagar vacancy -> 200 OK
      const res200 = await request(app.getHttpServer())
        .get(`/vacancies/${indiVacancyId}`)
        .set('Authorization', `Bearer ${fieldAgent2Token}`);
      expect(res200.status).toBe(200);
      expect(res200.body.id).toBe(indiVacancyId);
    });

    it('Manager can list all vacancies city-wide', async () => {
      const res = await request(app.getHttpServer())
        .get('/vacancies')
        .set('Authorization', `Bearer ${managerToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.map((v: { id: string }) => v.id);
      expect(ids).toContain(koraVacancyId);
      expect(ids).toContain(indiVacancyId);
    });

    it('Field Agent remains strictly area-scoped for placements (no area leak)', async () => {
      // Field Agent 1 is in Koramangala; creating placement on Indiranagar vacancy -> 403 Forbidden
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-T1LEAK-${timestamp}`,
          name: 'Area Test Worker',
          phone: `+9191${String(timestamp).slice(-8)}7`,
          tradeSkill: 'Plumber',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          city: 'Bengaluru',
        },
      });
      cleanJobSeekerIds.push(js.id);

      const res = await request(app.getHttpServer())
        .post(`/vacancies/${indiVacancyId}/placements`)
        .set('Authorization', `Bearer ${fieldAgentToken}`)
        .send({
          jobSeekerId: js.id,
          agreedSalary: 2200000,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Field agent can only create placements for vacancies in their own area');
    });

    it('Field Agent remains strictly area-scoped for businesses (no area leak)', async () => {
      // Field Agent 1 is in Koramangala; accessing Indiranagar business -> 403 Forbidden
      const res = await request(app.getHttpServer())
        .get(`/businesses/${indiBizId}`)
        .set('Authorization', `Bearer ${fieldAgentToken}`);
      expect(res.status).toBe(403);
    });
  });
});
