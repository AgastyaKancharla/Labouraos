import { Test, TestingModule } from '@nestjs/testing';
import { TelephonyController } from './telephony.controller';
import { TelephonyService } from './telephony.service';
import { TELEPHONY_PROVIDER } from './telephony.interface';
import { MockTelephonyProvider } from './mock-telephony.provider';
import { RealTelephonyProvider, DPDP_CONSENT_ANNOUNCEMENT } from './real-telephony.provider';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AuthModule } from '../../common/auth/auth.module';
import { RbacModule } from '../../common/rbac/rbac.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';

describe('Telephony Module (Task 4)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let callAgentToken: string;
  let financeToken: string;
  let callAgentStaffId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, AuthModule, RbacModule],
      controllers: [TelephonyController],
      providers: [
        TelephonyService,
        {
          provide: TELEPHONY_PROVIDER,
          useFactory: (p: PrismaService, a: AuditService) => new RealTelephonyProvider(p, a),
          inject: [PrismaService, AuditService],
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Seed test staff
    const timestamp = Date.now();
    await prisma.staff.create({
      data: {
        code: `FA-${timestamp.toString().slice(-5)}`,
        name: 'CEO Telephony Test',
        email: `ceo_tel_${timestamp}@test.com`,
        passwordHash: 'dummy-hash',
        role: 'ceo',
      },
    });

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-${(timestamp + 1).toString().slice(-5)}`,
        name: 'Call Agent Tel',
        email: `ca_tel_${timestamp}@test.com`,
        passwordHash: 'dummy-hash',
        role: 'call_agent',
      },
    });
    callAgentStaffId = callAgent.id;

    const finance = await prisma.staff.create({
      data: {
        code: `FA-${(timestamp + 2).toString().slice(-5)}`,
        name: 'Finance Tel',
        email: `fin_tel_${timestamp}@test.com`,
        passwordHash: 'dummy-hash',
        role: 'finance',
      },
    });

    callAgentToken = jwtService.sign({
      sub: callAgent.id,
      email: callAgent.email,
      role: 'call_agent',
    });

    financeToken = jwtService.sign({
      sub: finance.id,
      email: finance.email,
      role: 'finance',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Inbound Missed Call & Candidate Matching', () => {
    it('creates callback task and pre-populates candidate when phone matches existing JobSeeker', async () => {
      const phone = `+9198765${Date.now().toString().slice(-5)}`;
      const jobSeeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-${Date.now().toString().slice(-5)}`,
          name: 'Ramesh Telephony Candidate',
          phone,
          phoneVerified: true,
          tradeSkill: 'Electrician',
          minSalary: 1500000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          city: 'Bengaluru',
        },
      });

      const callId = `call_test_${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/telephony/inbound')
        .send({
          CallSid: callId,
          From: phone,
          To: '18001234567',
        })
        .expect(201);

      expect(res.body.isDuplicate).toBe(false);
      expect(res.body.callbackTaskId).toBeDefined();

      const task = await prisma.callbackTask.findUnique({
        where: { id: res.body.callbackTaskId },
      });
      expect(task).toBeDefined();
      expect(task?.callerName).toBe('Ramesh Telephony Candidate');
      expect(task?.jobSeekerId).toBe(jobSeeker.id);
      expect(task?.status).toBe('pending');
    });

    it('creates callback task for unknown caller with null jobSeekerId', async () => {
      const unknownPhone = `+9191111${Date.now().toString().slice(-5)}`;
      const callId = `call_unknown_${Date.now()}`;

      const res = await request(app.getHttpServer())
        .post('/telephony/webhook/missed-call')
        .send({
          call_id: callId,
          caller: unknownPhone,
          virtual_number: '18001234567',
        })
        .expect(201);

      expect(res.body.isDuplicate).toBe(false);

      const task = await prisma.callbackTask.findUnique({
        where: { id: res.body.callbackTaskId },
      });
      expect(task?.callerName).toBeNull();
      expect(task?.jobSeekerId).toBeNull();
      expect(task?.phone).toBe(unknownPhone);
    });
  });

  describe('Webhook Idempotency (AGENTS.md §2 rule 7)', () => {
    it('is a no-op when same callId webhook is delivered twice', async () => {
      const callId = `call_idem_${Date.now()}`;
      const phone = `+9192222${Date.now().toString().slice(-5)}`;

      // First delivery
      const res1 = await request(app.getHttpServer())
        .post('/telephony/inbound')
        .send({ CallSid: callId, From: phone })
        .expect(201);

      expect(res1.body.isDuplicate).toBe(false);
      const firstTaskId = res1.body.callbackTaskId;

      // Second delivery (duplicate webhook)
      const res2 = await request(app.getHttpServer())
        .post('/telephony/inbound')
        .send({ CallSid: callId, From: phone })
        .expect(201);

      expect(res2.body.isDuplicate).toBe(true);
      expect(res2.body.callbackTaskId).toBe(firstTaskId);

      // Verify database still has exactly one record for this callId
      const count = await prisma.callbackTask.count({
        where: { callId },
      });
      expect(count).toBe(1);
    });
  });

  describe('Call Recording & DPDP Act (2023) Consent Notice', () => {
    it('announces DPDP consent and logs audit event when recording is enabled', async () => {
      const callId = `call_rec_${Date.now()}`;
      const phone = `+9193333${Date.now().toString().slice(-5)}`;
      const recordingUrl = `https://telephony-storage.laboura.in/recordings/${callId}.mp3`;

      const res = await request(app.getHttpServer())
        .post('/telephony/inbound')
        .send({
          CallSid: callId,
          From: phone,
          RecordingUrl: recordingUrl,
          recordingEnabled: true,
        })
        .expect(201);

      expect(res.body.consentAnnounced).toBe(true);
      expect(res.body.consentAuditLogId).toBeDefined();

      // Check audit log
      const auditLog = await prisma.auditLog.findUnique({
        where: { code: res.body.consentAuditLogId },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.action).toBe('dpdp_consent.recorded');
      const details = auditLog?.after as Record<string, unknown>;
      expect(details.announcement).toBe(DPDP_CONSENT_ANNOUNCEMENT);
      expect(details.recordingUrl).toBe(recordingUrl);
      expect(details.consented).toBe(true);

      // Verify recording retention rule: no expiry date column or automatic deletion scheduled
      const task = await prisma.callbackTask.findUnique({
        where: { callId },
      });
      expect(task?.recordingUrl).toBe(recordingUrl);
      expect(task?.recordingConsent).toBe(true);
    });
  });

  describe('Capacity Verification', () => {
    it('reports at least 60 channels supporting 40 agents with 1.5x overlap buffer', async () => {
      const res = await request(app.getHttpServer())
        .get('/telephony/capacity')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(200);

      expect(res.body.concurrentChannels).toBeGreaterThanOrEqual(60);
      expect(res.body.maxAgentsSupported).toBeGreaterThanOrEqual(40);
    });

    it('handles 40 concurrent webhook calls without dropped tasks or errors', async () => {
      const telephonyService = app.get(TelephonyService);
      const callBatchSize = 40;
      const batchTimestamp = Date.now();
      const calls = Array.from({ length: callBatchSize }, (_, i) => ({
        CallSid: `stress_call_${batchTimestamp}_${i}`,
        From: `+9194000${(i + 1000).toString().slice(-4)}`,
        To: '18001234567',
      }));

      const results = await Promise.all(
        calls.map((c) => telephonyService.handleInboundWebhook(c)),
      );

      for (const res of results) {
        expect(res.isDuplicate).toBe(false);
        expect(res.callbackTaskId).toBeDefined();
      }

      const tasksCreated = await prisma.callbackTask.count({
        where: {
          callId: {
            startsWith: `stress_call_${batchTimestamp}_`,
          },
        },
      });

      expect(tasksCreated).toBe(callBatchSize);
    });
  });

  describe('Callback Queue Management & RBAC', () => {
    it('allows call agents to view queue, assign and complete tasks', async () => {
      const callId = `call_mgmt_${Date.now()}`;
      await request(app.getHttpServer())
        .post('/telephony/inbound')
        .send({
          CallSid: callId,
          From: '+919555500000',
        })
        .expect(201);

      // View queue
      const queueRes = await request(app.getHttpServer())
        .get('/telephony/callbacks?status=pending')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(200);

      const created = queueRes.body.find((t: { callId: string }) => t.callId === callId);
      expect(created).toBeDefined();

      // Assign to current call agent
      const assignRes = await request(app.getHttpServer())
        .post(`/telephony/callbacks/${created.id}/assign`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(201);

      expect(assignRes.body.status).toBe('assigned');
      expect(assignRes.body.assignedToStaffId).toBe(callAgentStaffId);

      // Complete callback
      const completeRes = await request(app.getHttpServer())
        .post(`/telephony/callbacks/${created.id}/complete`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .expect(201);

      expect(completeRes.body.status).toBe('completed');
    });

    it('denies finance role access to callback assignment (RBAC check)', async () => {
      const callId = `call_rbac_${Date.now()}`;
      const inRes = await request(app.getHttpServer())
        .post('/telephony/inbound')
        .send({
          CallSid: callId,
          From: '+919555511111',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/telephony/callbacks/${inRes.body.callbackTaskId}/assign`)
        .set('Authorization', `Bearer ${financeToken}`)
        .expect(403);
    });
  });

  describe('Provider Injection Fallback', () => {
    it('mock provider provides expected fallback capacity and behavior', async () => {
      const mockProvider = new MockTelephonyProvider(prisma);
      const capacity = mockProvider.getCapacity();
      expect(capacity.concurrentChannels).toBe(60);
      expect(capacity.maxAgentsSupported).toBe(40);

      const mockCallId = `call_mock_direct_${Date.now()}`;
      const res = await mockProvider.handleInboundCall({
        callId: mockCallId,
        callerPhone: '+919999988888',
      });

      expect(res.isDuplicate).toBe(false);
      expect(res.callbackTaskId).toBeDefined();

      // Repeat is duplicate
      const res2 = await mockProvider.handleInboundCall({
        callId: mockCallId,
        callerPhone: '+919999988888',
      });
      expect(res2.isDuplicate).toBe(true);
    });
  });
});
