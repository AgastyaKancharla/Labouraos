import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('₹499 Activation Payment and Webhook (Phase 2 Task 5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let callAgentToken: string;
  let callAgentId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    const callAgent = await prisma.staff.create({
      data: {
        code: `CA-AP-${timestamp}`,
        name: 'Call Agent AP',
        email: `call_agent_ap_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });
    callAgentId = callAgent.id;

    const server = app.getHttpServer();
    const loginRes = await enrolledLogin(server, { email: callAgent.email, password });
    callAgentToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: callAgentId },
            { entityType: 'job_seeker' },
          ],
        },
      });
      await prisma.payment.deleteMany({
        where: {
          code: { contains: `${timestamp}` },
        },
      });
      await prisma.jobSeeker.deleteMany({
        where: {
          phone: { contains: `${timestamp.toString().slice(-8)}` },
        },
      });
      await prisma.staff.deleteMany({
        where: { id: callAgentId },
      });
    }
    if (app) {
      await app.close();
    }
  });

  async function createPendingJobSeeker(phoneSuffix: string) {
    const phone = `71${phoneSuffix}`;
    const { requestId } = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(requestId)!;
    await otpService.verifyOtp(requestId, code);

    const res = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: `Seeker ${phoneSuffix}`,
        phone,
        otpRequestId: requestId,
        tradeSkill: 'Electrician',
        minSalary: 2000000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      });

    return res.body;
  }

  it('POST /job-seekers/:id/activation-payment creates Payment row (49900 paise, pending) and returns link', async () => {
    const seeker = await createPendingJobSeeker(timestamp.toString().slice(-8));

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/activation-payment`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(201);
    expect(res.body.paymentId).toBeDefined();
    expect(res.body.paymentCode).toMatch(/^PAY-\d{5}$/);
    expect(res.body.paymentLink).toContain('https://pay.laboura.local/pay/');
    expect(res.body.gatewayReference).toBeDefined();
    expect(res.body.amount).toBe(49900); // 49900 paise
    expect(res.body.status).toBe('pending');

    // Verify row in database
    const payment = await prisma.payment.findUnique({
      where: { id: res.body.paymentId },
    });
    expect(payment).toBeDefined();
    expect(payment?.type).toBe('activation');
    expect(payment?.amount).toBe(49900);
    expect(payment?.status).toBe('pending');
    expect(payment?.jobSeekerId).toBe(seeker.id);
  });

  it('webhook marks payment succeeded, activates job seeker, records paymentReceivedAt, and audit logs', async () => {
    const phoneSuffix = (timestamp + 1).toString().slice(-8);
    const seeker = await createPendingJobSeeker(phoneSuffix);

    const paymentRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/activation-payment`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    const { gatewayReference, paymentId } = paymentRes.body;

    const beforeTime = new Date(Date.now() - 1000);

    // Gateway fires webhook
    const webhookRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send({
        gatewayReference,
        status: 'succeeded',
        amountPaise: 49900,
      });

    expect(webhookRes.status).toBe(201);
    expect(webhookRes.body.received).toBe(true);
    expect(webhookRes.body.status).toBe('succeeded');

    // 1. Payment row status is succeeded
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    expect(payment?.status).toBe('succeeded');

    // 2. Job seeker status is active
    const updatedSeeker = await prisma.jobSeeker.findUnique({
      where: { id: seeker.id },
    });
    expect(updatedSeeker?.status).toBe('active');

    // 3. paymentReceivedAt (UTC) is recorded
    expect(updatedSeeker?.paymentReceivedAt).toBeDefined();
    expect(new Date(updatedSeeker!.paymentReceivedAt!).getTime()).toBeGreaterThan(beforeTime.getTime());

    // 4. Audit log entry exists
    const logs = await prisma.auditLog.findMany({
      where: {
        entityCode: seeker.code,
        action: 'job_seeker.activated',
      },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].entityType).toBe('job_seeker');
  });

  it('MANDATORY IDEMPOTENCY: firing exact same webhook twice results in exactly 1 payment, 1 audit entry, and 1 activation', async () => {
    const phoneSuffix = (timestamp + 2).toString().slice(-8);
    const seeker = await createPendingJobSeeker(phoneSuffix);

    const paymentRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/activation-payment`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    const { gatewayReference, paymentId } = paymentRes.body;

    const webhookPayload = {
      gatewayReference,
      status: 'succeeded',
      amountPaise: 49900,
    };

    // First webhook call
    const firstCall = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send(webhookPayload);
    expect(firstCall.status).toBe(201);
    expect(firstCall.body.status).toBe('succeeded');

    // Second webhook call with identical payload
    const secondCall = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send(webhookPayload);
    expect(secondCall.status).toBe(201);
    expect(secondCall.body.received).toBe(true);
    expect(secondCall.body.alreadyProcessed).toBe(true);

    // Assert exactly one Payment row exists with this gatewayReference
    const payments = await prisma.payment.findMany({
      where: { gatewayReference },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].id).toBe(paymentId);
    expect(payments[0].status).toBe('succeeded');

    // Assert exactly one activation audit log entry exists
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entityCode: seeker.code,
        action: 'job_seeker.activated',
      },
    });
    expect(auditLogs).toHaveLength(1);

    // Assert job seeker is active
    const seekerInDb = await prisma.jobSeeker.findUnique({
      where: { id: seeker.id },
    });
    expect(seekerInDb?.status).toBe('active');
  });

  it('webhook for unknown reference or already failed payment is rejected cleanly (no crash, no 500)', async () => {
    // 1. Unknown gateway reference
    const unknownRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send({
        gatewayReference: 'non_existent_reference_xyz',
        status: 'succeeded',
      });

    expect(unknownRes.status).toBe(201);
    expect(unknownRes.body.received).toBe(false);
    expect(unknownRes.body.error).toContain('not found');

    // 2. Webhook for failed payment
    const phoneSuffix = (timestamp + 3).toString().slice(-8);
    const seeker = await createPendingJobSeeker(phoneSuffix);

    const paymentRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/activation-payment`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    const { gatewayReference } = paymentRes.body;

    // Fail the payment
    const failRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send({
        gatewayReference,
        status: 'failed',
      });
    expect(failRes.status).toBe(201);
    expect(failRes.body.status).toBe('failed');

    // Try to succeed an already failed payment
    const retryRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send({
        gatewayReference,
        status: 'succeeded',
      });
    expect(retryRes.status).toBe(201);
    expect(retryRes.body.alreadyFailed).toBe(true);
  });
});
