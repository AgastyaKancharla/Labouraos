import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { WHATSAPP_PROVIDER } from './whatsapp.interface';
import { MockWhatsAppProvider } from './mock-whatsapp.provider';
import { RealWhatsAppProvider, APPROVED_TEMPLATES } from './real-whatsapp.provider';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppModule } from '../../app.module';
import { NoPickupEvaluationJob } from '../../jobs/no-pickup-evaluation.job';
import * as bcrypt from 'bcrypt';

describe('WhatsApp Business API Provider (Phase 7 Task 3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsAppService: WhatsAppService;
  let jobService: NoPickupEvaluationJob;
  let mockProvider: MockWhatsAppProvider;
  let testStaffId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    whatsAppService = app.get(WhatsAppService);
    jobService = app.get(NoPickupEvaluationJob);
    mockProvider = app.get(WHATSAPP_PROVIDER);

    const timestamp = Date.now();
    const passwordHash = await bcrypt.hash('Secret123!', 10);
    const staff = await prisma.staff.create({
      data: {
        code: `CA-WA-${timestamp}`,
        name: 'WhatsApp Test Agent',
        email: `wa_test_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    testStaffId = staff.id;
  });

  afterAll(async () => {
    if (jobService) {
      await jobService.close();
    }
    if (prisma && testStaffId) {
      await prisma.staff.delete({ where: { id: testStaffId } }).catch(() => {});
    }
    if (app) {
      await app.close();
    }
  });

  describe('MockWhatsAppProvider', () => {
    it('records template message send attempt and returns sent status', async () => {
      const res = await mockProvider.sendTemplateMessage(
        '+919876543210',
        'call_attempt_notice',
        { candidateName: 'Suresh' },
      );

      expect(res.status).toBe('sent');
      expect(res.messageId).toMatch(/^wamid_/);
      expect(mockProvider.sentMessages.length).toBeGreaterThan(0);
    });
  });

  describe('RealWhatsAppProvider', () => {
    it('rejects unapproved templates per WhatsApp Business API policy', async () => {
      const realProvider = new RealWhatsAppProvider({
        apiUrl: 'https://graph.facebook.com/v21.0',
        accessToken: 'mock-token',
        phoneNumberId: '1234567890',
      });

      const res = await realProvider.sendTemplateMessage(
        '+919876543210',
        'arbitrary_free_form_text',
        { text: 'hello' },
      );

      expect(res.status).toBe('failed');
      expect(res.error).toContain('is not approved');
    });

    it('successfully sends approved template to stubbed Meta Graph API', async () => {
      const stubFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '919876543210', wa_id: '919876543210' }],
          messages: [{ id: 'wamid.HBgLMTIzNDU2Nzg5MA==' }],
        }),
      });

      const realProvider = new RealWhatsAppProvider({
        apiUrl: 'https://graph.facebook.com/v21.0',
        accessToken: 'test-token-123',
        phoneNumberId: '100000000000001',
        fetchFn: stubFetch as unknown as typeof fetch,
      });

      const res = await realProvider.sendTemplateMessage(
        '+919876543210',
        APPROVED_TEMPLATES[0],
        { candidateName: 'Ramesh', trade: 'Electrician' },
      );

      expect(res.status).toBe('sent');
      expect(res.messageId).toBe('wamid.HBgLMTIzNDU2Nzg5MA==');
      expect(stubFetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/100000000000001/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        }),
      );
    });

    it('surfaces Meta API errors clearly without throwing', async () => {
      const stubFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Template parameter count mismatch',
            type: 'OAuthException',
            code: 100,
          },
        }),
      });

      const realProvider = new RealWhatsAppProvider({
        apiUrl: 'https://graph.facebook.com/v21.0',
        accessToken: 'test-token',
        phoneNumberId: '100000000000001',
        fetchFn: stubFetch as unknown as typeof fetch,
      });

      const res = await realProvider.sendTemplateMessage(
        '+919876543210',
        'call_attempt_notice',
        {},
      );

      expect(res.status).toBe('failed');
      expect(res.error).toBe('Template parameter count mismatch');
    });
  });

  describe('WhatsAppService Audit Logging', () => {
    it('creates audit log on template send attempt', async () => {
      const phone = `+9199000${Date.now().toString().slice(-5)}`;
      const res = await whatsAppService.sendTemplateMessage(
        phone,
        'call_attempt_notice',
        { candidateName: 'Ganesh' },
        testStaffId,
      );

      expect(res.status).toBe('sent');

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'whatsapp.send_attempt',
          entityCode: res.messageId,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(testStaffId);
    });
  });

  describe('Automated WhatsApp Leg in 3-Hit Evaluation (NoPickupEvaluationJob)', () => {
    it('fires automated WhatsApp template and records contact attempt + hit', async () => {
      const timestamp = Date.now();
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-WA-AUTO-${timestamp}`,
          name: 'Auto WhatsApp Worker',
          phone: `9188000${timestamp.toString().slice(-5)}`,
          phoneVerified: true,
          tradeSkill: 'Plumber',
          minSalary: 1500000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          hitCount: 0,
          city: 'Bengaluru',
        },
      });

      // Seed AM and PM no-pickup calls for today, but NO WhatsApp attempt yet
      const today = new Date();
      await prisma.contactAttempt.create({
        data: {
          jobSeekerId: js.id,
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'am',
          attemptedAt: today,
          staffId: testStaffId,
        },
      });
      await prisma.contactAttempt.create({
        data: {
          jobSeekerId: js.id,
          channel: 'call',
          outcome: 'no_pickup',
          timeOfDay: 'pm',
          attemptedAt: today,
          staffId: testStaffId,
        },
      });

      const initialSentCount = mockProvider.sentMessages.length;

      // Run evaluation
      const evalResult = await jobService.evaluateNoPickups();
      expect(evalResult.hitJobSeekerIds).toContain(js.id);

      // Verify WhatsApp provider was called
      expect(mockProvider.sentMessages.length).toBeGreaterThan(initialSentCount);
      const sent = mockProvider.sentMessages.find((m) => m.phone === js.phone);
      expect(sent).toBeDefined();
      expect(sent?.templateName).toBe('call_attempt_notice');

      // Verify contact attempt was created for whatsapp
      const waAttempt = await prisma.contactAttempt.findFirst({
        where: {
          jobSeekerId: js.id,
          channel: 'whatsapp',
        },
      });
      expect(waAttempt).toBeDefined();

      // Verify hit was recorded
      const updatedJs = await prisma.jobSeeker.findUnique({
        where: { id: js.id },
      });
      expect(updatedJs?.hitCount).toBe(1);

      // Clean up
      await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: js.id } });
      await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: js.id } });
      await prisma.jobSeeker.delete({ where: { id: js.id } });
    });
  });
});
