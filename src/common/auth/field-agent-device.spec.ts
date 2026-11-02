import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';

describe('Phase 9 Task 4: Field Agent Device ID Enforcement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let totpService: TotpService;

  const testPassword = 'Password123!';
  const timestamp = Date.now();

  let fieldAgentStaff: { id: string; email: string; totpSecret: string; code: string };
  let callAgentStaff: { id: string; email: string; totpSecret: string; code: string };
  let ceoStaff: { id: string; email: string; totpSecret: string; code: string };

  const TOTP_STEP_MS = 30_000;
  const TOTP_SAFE_MARGIN_MS = 5_000;
  const stableTotp = async (secret: string): Promise<string> => {
    const remaining = TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS);
    if (remaining < TOTP_SAFE_MARGIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, remaining + 50));
    }
    return totpService.generateToken(secret);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    totpService = app.get<TotpService>(TotpService);

    const passwordHash = await bcrypt.hash(testPassword, 10);

    // 1. Field Agent
    const faSecret = totpService.generateSecret();
    const fa = await prisma.staff.create({
      data: {
        code: `STF-DEV-FA-${timestamp.toString().slice(-4)}`,
        name: 'Device Test Field Agent',
        email: `fa_dev_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
        totpSecret: faSecret,
        totpEnabled: true,
      },
    });
    fieldAgentStaff = { id: fa.id, email: fa.email, totpSecret: faSecret, code: fa.code };

    // 2. Call Agent
    const caSecret = totpService.generateSecret();
    const ca = await prisma.staff.create({
      data: {
        code: `STF-DEV-CA-${timestamp.toString().slice(-4)}`,
        name: 'Device Test Call Agent',
        email: `ca_dev_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
        totpSecret: caSecret,
        totpEnabled: true,
      },
    });
    callAgentStaff = { id: ca.id, email: ca.email, totpSecret: caSecret, code: ca.code };

    // 3. CEO
    const ceoSecret = totpService.generateSecret();
    const ceo = await prisma.staff.create({
      data: {
        code: `STF-DEV-CEO-${timestamp.toString().slice(-4)}`,
        name: 'Device Test CEO',
        email: `ceo_dev_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
        totpSecret: ceoSecret,
        totpEnabled: true,
      },
    });
    ceoStaff = { id: ceo.id, email: ceo.email, totpSecret: ceoSecret, code: ceo.code };
  });

  afterAll(async () => {
    const staffIds = [fieldAgentStaff?.id, callAgentStaff?.id, ceoStaff?.id].filter(Boolean);

    await prisma.staffSession.deleteMany({
      where: { staffId: { in: staffIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: staffIds } },
    });
    await prisma.staff.deleteMany({
      where: { id: { in: staffIds } },
    });
    await app.close();
  });

  it('1. Field agent login with no deviceId is refused with 401 and clear message', async () => {
    const validCode = await stableTotp(fieldAgentStaff.totpSecret);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: fieldAgentStaff.email,
        password: testPassword,
        totpCode: validCode,
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('deviceId is required for field agent login');
  });

  it('2. Field agent login with empty/whitespace deviceId is refused with 401', async () => {
    const validCode = await stableTotp(fieldAgentStaff.totpSecret);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: fieldAgentStaff.email,
        password: testPassword,
        totpCode: validCode,
        deviceId: '   ',
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('deviceId is required for field agent login');
  });

  it('3. Field agent login with deviceId succeeds and registers the device', async () => {
    const validCode = await stableTotp(fieldAgentStaff.totpSecret);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: fieldAgentStaff.email,
        password: testPassword,
        totpCode: validCode,
        deviceId: 'fa-registered-device-001',
      });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();

    const updated = await prisma.staff.findUnique({
      where: { id: fieldAgentStaff.id },
    });
    expect(updated?.registeredDeviceId).toBe('fa-registered-device-001');
  });

  it('4. Field agent login with registered deviceId continues to succeed', async () => {
    const validCode = await stableTotp(fieldAgentStaff.totpSecret);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: fieldAgentStaff.email,
        password: testPassword,
        totpCode: validCode,
        deviceId: 'fa-registered-device-001',
      });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('5. Field agent with registered device trying to omit deviceId is still refused', async () => {
    const validCode = await stableTotp(fieldAgentStaff.totpSecret);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: fieldAgentStaff.email,
        password: testPassword,
        totpCode: validCode,
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('deviceId is required for field agent login');
  });

  it('6. Other roles (Call Agent, CEO) can log in without deviceId', async () => {
    for (const account of [callAgentStaff, ceoStaff]) {
      const validCode = await stableTotp(account.totpSecret);
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: account.email,
          password: testPassword,
          totpCode: validCode,
        });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    }
  });
});
