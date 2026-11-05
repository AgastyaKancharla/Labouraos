import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { ReviewFlagService } from './review-flag.service';
import { REVIEW_FLAG_KINDS, ReviewFlagKind } from './review-flag.constants';

describe('Phase 9 Task 8: Review Flags', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let otpService: OtpService;
  let reviewFlagService: ReviewFlagService;

  let ceoToken: string;
  let managerToken: string;
  let teamLead1Token: string;
  let teamLead2Token: string;
  let callAgentToken: string;
  let fieldAgent1Token: string;
  let fieldAgent2Token: string;
  let financeToken: string;

  let teamLead1StaffId: string;
  let fieldAgent1StaffId: string;
  let fieldAgent2StaffId: string;

  const KORA_LAT = 12.9352;
  const KORA_LON = 77.6245;
  const KORA_NEAR_LAT = 12.9354;
  const KORA_NEAR_LON = 77.6246;
  const KORA_FAR_LAT = 12.9716;
  const KORA_FAR_LON = 77.5946;

  function mkToken(staff: {
    id: string;
    role: string;
    code?: string;
  }) {
    return jwtService.sign({
      sub: staff.id,
      email: `${staff.id}@laboura.local`,
      role: staff.role,
      code: staff.code ?? staff.id,
    });
  }

  async function getVerifiedOtp(phone: string): Promise<string> {
    const otpRes = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as unknown as MockOtpProvider;
    const code = mockProvider.getCode(otpRes.requestId)!;
    await otpService.verifyOtp(otpRes.requestId, code);
    return otpRes.requestId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
    otpService = app.get(OtpService);
    reviewFlagService = app.get(ReviewFlagService);

    // Clean review flags
    await prisma.reviewFlag.deleteMany();

    const timestamp = Date.now();

    // CEO
    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-RF-${timestamp}`,
        name: 'CEO ReviewFlags',
        email: `ceo.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'ceo',
        status: 'active',
      },
    });
    ceoToken = mkToken(ceo);

    // Manager
    const manager = await prisma.staff.create({
      data: {
        code: `MGR-RF-${timestamp}`,
        name: 'Manager ReviewFlags',
        email: `mgr.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'manager',
        status: 'active',
      },
    });
    managerToken = mkToken(manager);

    // Team Lead 1 & Field Agent 1
    const tl1 = await prisma.staff.create({
      data: {
        code: `TL1-RF-${timestamp}`,
        name: 'Team Lead 1',
        email: `tl1.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'team_lead',
        status: 'active',
      },
    });
    teamLead1StaffId = tl1.id;
    teamLead1Token = mkToken(tl1);

    const fa1 = await prisma.staff.create({
      data: {
        code: `FA1-RF-${timestamp}`,
        name: 'Field Agent 1 Under TL1',
        email: `fa1.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'field_agent',
        status: 'active',
        teamLeadId: tl1.id,
      },
    });
    fieldAgent1StaffId = fa1.id;
    fieldAgent1Token = mkToken(fa1);

    // Team Lead 2 & Field Agent 2
    const tl2 = await prisma.staff.create({
      data: {
        code: `TL2-RF-${timestamp}`,
        name: 'Team Lead 2',
        email: `tl2.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'team_lead',
        status: 'active',
      },
    });
    teamLead2Token = mkToken(tl2);

    const fa2 = await prisma.staff.create({
      data: {
        code: `FA2-RF-${timestamp}`,
        name: 'Field Agent 2 Under TL2',
        email: `fa2.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'field_agent',
        status: 'active',
        teamLeadId: tl2.id,
      },
    });
    fieldAgent2StaffId = fa2.id;
    fieldAgent2Token = mkToken(fa2);

    // Call Agent
    const ca = await prisma.staff.create({
      data: {
        code: `CA-RF-${timestamp}`,
        name: 'Call Agent ReviewFlags',
        email: `ca.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'call_agent',
        status: 'active',
      },
    });
    callAgentToken = mkToken(ca);

    // Finance
    const fin = await prisma.staff.create({
      data: {
        code: `FIN-RF-${timestamp}`,
        name: 'Finance ReviewFlags',
        email: `fin.rf.${timestamp}@laboura.local`,
        passwordHash: 'dummyhash',
        role: 'finance',
        status: 'active',
      },
    });
    financeToken = mkToken(fin);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Producer: Business GPS Mismatch', () => {
    it('does not raise a review flag when business is created within geofence', async () => {
      const phone = `94${Date.now().toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/businesses')
        .set('Authorization', `Bearer ${fieldAgent1Token}`)
        .send({
          name: 'Close Cafe',
          address: 'Koramangala 4th Block',
          phone,
          otpRequestId,
          latitude: KORA_LAT,
          longitude: KORA_LON,
          visitLatitude: KORA_NEAR_LAT,
          visitLongitude: KORA_NEAR_LON,
        })
        .expect(201);

      expect(res.body.geofenceFlag).toBe(false);

      const flag = await prisma.reviewFlag.findFirst({
        where: { subjectId: res.body.id },
      });
      expect(flag).toBeNull();
    });

    it('raises a gps_mismatch review flag for the agent when business is created with GPS mismatch', async () => {
      const phone = `95${Date.now().toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);

      const res = await request(app.getHttpServer())
        .post('/businesses')
        .set('Authorization', `Bearer ${fieldAgent1Token}`)
        .send({
          name: 'Far Away Cafe',
          address: 'Koramangala 4th Block',
          phone,
          otpRequestId,
          latitude: KORA_LAT,
          longitude: KORA_LON,
          visitLatitude: KORA_FAR_LAT,
          visitLongitude: KORA_FAR_LON,
        })
        .expect(201);

      expect(res.body.geofenceFlag).toBe(true);

      const flag = await prisma.reviewFlag.findFirst({
        where: { subjectId: res.body.id },
      });
      expect(flag).toBeDefined();
      expect(flag?.kind).toBe('gps_mismatch');
      expect(flag?.subjectType).toBe('business');
      expect(flag?.raisedForStaffId).toBe(fieldAgent1StaffId);
      expect(flag?.status).toBe('open');
      expect(flag?.code).toMatch(/^FL-\d{5}$/);
    });
  });

  describe('Closed list of kinds', () => {
    it('includes payment_mismatch and other closed list items', async () => {
      expect(REVIEW_FLAG_KINDS).toContain('payment_mismatch');
      expect(REVIEW_FLAG_KINDS).toContain('gps_mismatch');
      expect(REVIEW_FLAG_KINDS).toContain('duplicate_business');

      const flag = await reviewFlagService.raise({
        kind: 'payment_mismatch',
        subjectType: 'payment',
        subjectId: 'pay-uuid-test',
        raisedForStaffId: fieldAgent2StaffId,
        details: { expectedPaise: 49900, receivedPaise: 45000 },
      });

      expect(flag.kind).toBe('payment_mismatch');
      expect(flag.status).toBe('open');
      expect(flag.raisedForStaffId).toBe(fieldAgent2StaffId);
    });

    it('refuses invalid flag kinds with BadRequestException', async () => {
      await expect(
        reviewFlagService.raise({
          kind: 'unsupported_random_kind' as unknown as ReviewFlagKind,
          subjectType: 'business',
          subjectId: 'biz-test',
        }),
      ).rejects.toThrow();
    });
  });

  describe('RBAC for GET /review-flags', () => {
    it('refuses Call Agent with 403', async () => {
      await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(403);
    });

    it('allows Field Agents to see only notices assigned to themselves', async () => {
      const ownFlags = await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${fieldAgent1Token}`)
        .expect(200);
      expect(ownFlags.body.every((flag: { raisedForStaffId: string }) => flag.raisedForStaffId === fieldAgent1StaffId)).toBe(true);

      const otherFlags = await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${fieldAgent2Token}`)
        .expect(200);
      expect(otherFlags.body.every((flag: { raisedForStaffId: string }) => flag.raisedForStaffId === fieldAgent2StaffId)).toBe(true);
    });

    it('refuses Finance with 403', async () => {
      await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(403);
    });

    it('allows CEO to see all review flags', async () => {
      const res = await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${ceoToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // We created flags for fa1 (gps_mismatch) and fa2 (payment_mismatch)
      const staffIds = res.body.map((f: { raisedForStaffId: string }) => f.raisedForStaffId);
      expect(staffIds).toContain(fieldAgent1StaffId);
      expect(staffIds).toContain(fieldAgent2StaffId);
    });

    it('allows Manager to see all review flags', async () => {
      const res = await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const staffIds = res.body.map((f: { raisedForStaffId: string }) => f.raisedForStaffId);
      expect(staffIds).toContain(fieldAgent1StaffId);
      expect(staffIds).toContain(fieldAgent2StaffId);
    });

    it('scopes Team Lead 1 to only see their own team members flags', async () => {
      const res = await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      for (const flag of res.body) {
        expect(flag.raisedForStaffId).toBe(fieldAgent1StaffId);
        expect(flag.raisedForStaffId).not.toBe(fieldAgent2StaffId);
      }
    });

    it('scopes Team Lead 2 to only see their own team members flags', async () => {
      const res = await request(app.getHttpServer())
        .get('/review-flags')
        .set('Authorization', `Bearer ${teamLead2Token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      for (const flag of res.body) {
        expect(flag.raisedForStaffId).toBe(fieldAgent2StaffId);
        expect(flag.raisedForStaffId).not.toBe(fieldAgent1StaffId);
      }
    });
  });

  describe('POST /review-flags/:id/resolve', () => {
    it('refuses resolving without a written resolution text (400)', async () => {
      const flag = await prisma.reviewFlag.findFirst({
        where: { raisedForStaffId: fieldAgent1StaffId },
      });
      expect(flag).toBeDefined();

      await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .send({
          resolution: '',
        })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .send({
          resolution: '   ',
        })
        .expect(400);
    });

    it('refuses an unauthorized role (Call Agent, Field Agent, Finance) with 403', async () => {
      const flag = await prisma.reviewFlag.findFirst({
        where: { raisedForStaffId: fieldAgent1StaffId },
      });

      await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({ resolution: 'Looks okay' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${fieldAgent1Token}`)
        .send({ resolution: 'I fixed it' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ resolution: 'Finance approved' })
        .expect(403);
    });

    it('refuses Team Lead 2 from resolving a flag raised for Team Lead 1s agent (403)', async () => {
      const flag = await prisma.reviewFlag.findFirst({
        where: { raisedForStaffId: fieldAgent1StaffId },
      });
      expect(flag).toBeDefined();

      await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${teamLead2Token}`)
        .send({ resolution: 'TL2 trying to resolve TL1 flag' })
        .expect(403);
    });

    it('allows Team Lead 1 to resolve their agents flag with written resolution and audits it', async () => {
      const flag = await prisma.reviewFlag.findFirst({
        where: { raisedForStaffId: fieldAgent1StaffId, status: 'open' },
      });
      expect(flag).toBeDefined();

      const res = await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${teamLead1Token}`)
        .send({
          resolution: 'Called shop owner directly and confirmed physical visit occurred',
          status: 'resolved',
        })
        .expect(201);

      expect(res.body.status).toBe('resolved');
      expect(res.body.resolution).toBe(
        'Called shop owner directly and confirmed physical visit occurred',
      );
      expect(res.body.resolvedByStaffId).toBe(teamLead1StaffId);
      expect(res.body.resolvedAt).toBeDefined();

      // Check audit row
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityType: 'review_flag',
          entityCode: flag!.code,
          action: 'review_flag.resolved',
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(teamLead1StaffId);
    });

    it('allows CEO or Manager to dismiss any flag with written resolution and audits it', async () => {
      const flag = await prisma.reviewFlag.findFirst({
        where: { raisedForStaffId: fieldAgent2StaffId, status: 'open' },
      });
      expect(flag).toBeDefined();

      const res = await request(app.getHttpServer())
        .post(`/review-flags/${flag!.id}/resolve`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          resolution: 'Manual bank adjustment made, verified transaction hash',
          status: 'dismissed',
        })
        .expect(201);

      expect(res.body.status).toBe('dismissed');
      expect(res.body.resolution).toBe(
        'Manual bank adjustment made, verified transaction hash',
      );

      const audit = await prisma.auditLog.findFirst({
        where: {
          entityType: 'review_flag',
          entityCode: flag!.code,
          action: 'review_flag.resolved',
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.after).toMatchObject({ status: 'dismissed' });
    });
  });
});
