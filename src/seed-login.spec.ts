import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';
import { seed } from '../prisma/seed';

describe('Phase 10 Task 7: seeded staff log in by staff code', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('prints an approved device and logs the seeded call agent in through the revealed code', async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((part) => String(part)).join(' '));
      original.apply(console, args as []);
    };
    try {
      await seed(prisma);
    } finally {
      console.log = original;
    }

    const agent = await prisma.staff.findUniqueOrThrow({
      where: { email: 'call.agent@laboura.local' },
    });
    const lead = await prisma.staff.findUniqueOrThrow({
      where: { email: 'lead.koramangala@laboura.local' },
    });
    const field = await prisma.staff.findUniqueOrThrow({
      where: { email: 'field.agent@laboura.local' },
    });
    const output = lines.join('\n');
    expect(output).toContain('Seeded staff log in with their staff code.');
    expect(output).toContain(`Approved device for ${agent.code} (call_agent): seed-device-CA-00001`);
    expect(output).toContain(`Approved device for ${lead.code} (team_lead): seed-device-TL-00001`);
    expect(output).toContain(`Approved device for ${field.code} (field_agent): seed-device-FA-00001`);

    await prisma.staff.update({
      where: { id: agent.id },
      data: { failedLoginCount: 0, lockedUntil: null, lockedByStaffId: null, lockedReason: null },
    });

    const waiting = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: agent.code.toLowerCase(),
        password: 'Password123!Secure',
        deviceId: 'seed-device-CA-00001',
      });
    expect(waiting.status).toBe(200);
    expect(waiting.body.status).toBe('awaiting_code');
    expect(waiting.body.accessToken).toBeUndefined();

    const shown = await request(app.getHttpServer())
      .post(`/login-codes/${waiting.body.loginRequestId}/reveal`)
      .set(
        'Authorization',
        `Bearer ${jwt.sign({
          sub: lead.id,
          email: lead.email,
          role: lead.role,
          code: lead.code,
        })}`,
      );
    expect(shown.status).toBe(200);
    expect(shown.body.code).toEqual(expect.any(String));

    const verified = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .send({ loginRequestId: waiting.body.loginRequestId, code: shown.body.code, deviceId: 'seed-device-CA-00001', loginRequestProof: waiting.body.loginRequestProof });
    expect(verified.status).toBe(200);
    expect(verified.body.accessToken).toEqual(expect.any(String));
  }, 120000);
});
