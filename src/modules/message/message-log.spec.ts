import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_PROVIDER } from '../../common/whatsapp/whatsapp.interface';
import { signCallStatusBody } from '../call/call-signature';
import { MessagingService } from './messaging.service';

const SECRET = 'message_webhook_secret_for_tests_32chars';
const PHONE = '+919811122233';
const TRADE = 'MessageTradeToken';

describe('Phase 11 Task 2: message log', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let messaging: MessagingService;
  let failSend = false;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const messageIds: string[] = [];

  function tokenFor(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({ sub: staff.id, email: staff.email, role: staff.role, code: staff.code });
  }

  beforeAll(async () => {
    process.env.MESSAGE_WEBHOOK_SECRET = SECRET;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WHATSAPP_PROVIDER)
      .useValue({
        sendTemplateMessage: async () => {
          if (failSend) {
            return {
              messageId: '',
              status: 'failed',
              phone: PHONE,
              templateName: 'call_attempt_notice',
              error: 'down',
              timestamp: new Date(),
            };
          }
          return {
            messageId: `wamid-${Date.now()}`,
            status: 'sent',
            phone: PHONE,
            templateName: 'call_attempt_notice',
            timestamp: new Date(),
          };
        },
      })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    messaging = app.get(MessagingService);
  }, 120000);

  afterAll(async () => {
    await prisma.messageLog.deleteMany({ where: { id: { in: messageIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  async function makeStaff(role: string, teamLeadId?: string) {
    const stamp = `${Date.now()}-${staffIds.length}`;
    const staff = await prisma.staff.create({
      data: {
        code: `ML-${role.slice(0, 3).toUpperCase()}-${stamp}`,
        name: `Message ${role}`,
        email: `ml-${role}-${stamp}@laboura.local`,
        passwordHash: await bcrypt.hash('Message-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  it('writes one row, moves it to sent, hides the body and the phone, and ignores a repeated delivery webhook', async () => {
    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('call_agent', lead.id);
    const manager = await makeStaff('manager');
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-ML-${Date.now()}`,
        name: 'Message Candidate',
        phone: PHONE,
        trades: { create: { trade: TRADE, isPrimary: true } },
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        registeredByStaffId: agent.id,
      },
    });
    seekerIds.push(seeker.id);

    const sent = await messaging.send({
      channel: 'whatsapp',
      template: 'call_attempt_notice',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      variables: { trade: TRADE, body: 'the words of the message' },
    });
    messageIds.push(sent.id);
    expect(sent.status).toBe('sent');
    const stored = await prisma.messageLog.findUniqueOrThrow({ where: { id: sent.id } });
    const storedJson = JSON.stringify(stored);
    expect(storedJson).not.toContain(PHONE);
    expect(storedJson).not.toContain(TRADE);
    expect(storedJson).not.toContain('the words of the message');
    expect(stored.template).toBe('call_attempt_notice');
    expect(stored.providerMessageId).toEqual(expect.any(String));

    const raw = JSON.stringify({ providerMessageId: stored.providerMessageId, status: 'delivered' });
    const signature = signCallStatusBody(raw, SECRET);
    const first = await request(app.getHttpServer())
      .post('/messages/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-message-signature', signature)
      .send(raw);
    expect(first.status).toBe(201);
    expect(first.body.unchanged).toBe(false);
    const delivered = await prisma.messageLog.findUniqueOrThrow({ where: { id: stored.id } });
    expect(delivered.status).toBe('delivered');

    const second = await request(app.getHttpServer())
      .post('/messages/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-message-signature', signature)
      .send(raw);
    expect(second.body.unchanged).toBe(true);
    const after = await prisma.messageLog.findUniqueOrThrow({ where: { id: stored.id } });
    expect(after.updatedAt.toISOString()).toBe(delivered.updatedAt.toISOString());

    const listed = await request(app.getHttpServer())
      .get('/messages')
      .query({ subjectType: 'job_seeker', subjectId: seeker.id })
      .set('Authorization', `Bearer ${tokenFor(manager)}`);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(PHONE);
    expect(JSON.stringify(listed.body)).not.toContain(TRADE);

    const ownLead = await request(app.getHttpServer())
      .get('/messages')
      .query({ subjectType: 'job_seeker', subjectId: seeker.id })
      .set('Authorization', `Bearer ${tokenFor(lead)}`);
    expect(ownLead.status).toBe(200);

    const refused = await request(app.getHttpServer())
      .get('/messages')
      .query({ subjectType: 'job_seeker', subjectId: seeker.id })
      .set('Authorization', `Bearer ${tokenFor(agent)}`);
    expect(refused.status).toBe(403);
  }, 120000);

  it('marks the row failed when the provider refuses the send', async () => {
    failSend = true;
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-ML-F-${Date.now()}`,
        name: 'Failed Candidate',
        phone: '+919822233344',
        trades: { create: { trade: 'Helper', isPrimary: true } },
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(seeker.id);
    const failed = await messaging.send({
      channel: 'whatsapp',
      template: 'call_attempt_notice',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
    });
    messageIds.push(failed.id);
    expect(failed.status).toBe('failed');
    const stored = await prisma.messageLog.findUniqueOrThrow({ where: { id: failed.id } });
    expect(stored.failedAt).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain('+919822233344');
    failSend = false;
  }, 60000);
});
