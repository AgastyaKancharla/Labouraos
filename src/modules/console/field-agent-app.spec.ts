import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 6 Task 6: Field Agent API (the old page and its priority endpoints are retired; Laboura Field replaced them)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let faKoraToken: string;
  let faKoraId: string;
  const koraArea = 'Koramangala';

  let faIndiToken: string;

  const timestamp = Date.now();
  const password = 'Password123!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);

    const passwordHash = await bcrypt.hash(password, 10);

    const faKora = await prisma.staff.create({
      data: {
        code: `FA-KORA-${timestamp}`,
        name: 'Field Agent Koramangala',
        email: `fa_kora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    faKoraId = faKora.id;

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-INDI-${timestamp}`,
        name: 'Field Agent Indiranagar',
        email: `fa_indi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });

    const koraLogin = await enrolledLogin(app.getHttpServer(), { email: faKora.email, password })
      .expect(200);
    faKoraToken = koraLogin.body.accessToken;

    const indiLogin = await enrolledLogin(app.getHttpServer(), { email: faIndi.email, password })
      .expect(200);
    faIndiToken = indiLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('does not persist deprecated area and grants vacancy writes only to the account agent', async () => {
    // 1. FA Koramangala onboards business in Koramangala
    const phoneKora = `95002${String(timestamp).slice(-5)}`;
    const otpKora = await request(app.getHttpServer())
      .post('/otp/send')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({ phone: phoneKora, purpose: 'business_contact' })
      .expect(201);
    const codeKora = (otpService.getProvider() as MockOtpProvider).getCode(otpKora.body.requestId)!;
    await request(app.getHttpServer())
      .post('/otp/verify')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({ requestId: otpKora.body.requestId, code: codeKora })
      .expect(201);

    const bizKora = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        name: 'Kora Tech Hub',
        phone: phoneKora,
        locality: koraArea,
        contactPersonName: 'Kora Contact',
        contactPersonRole: 'owner', heardFrom: 'field_visit',
        otpRequestId: otpKora.body.requestId,
        selfieUrl: 'https://cdn.laboura.local/selfies/kora.jpg',
        selfieHash: `hash_kora_${timestamp}`,
      })
      .expect(201);

    // The business becomes writable by the field agent as an account business.
    await prisma.business.update({
      where: { id: bizKora.body.id },
      data: { accountAgentId: faKoraId },
    });

    // 2. FA Koramangala captures vacancy for their Koramangala business
    const vacKora = await request(app.getHttpServer())
      .post(`/businesses/${bizKora.body.id}/vacancies`)
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        tradeSkill: 'Carpenter',
        salaryMinPaise: 2000000,
        headcount: 1,
        ownerToldMinimumWage: true,
      })
      .expect(201);
    expect(vacKora.body.tradeSkill).toBe('Carpenter');

    // 3. FA Indiranagar is denied capturing vacancy for Koramangala business (403 Forbidden)
    await request(app.getHttpServer())
      .post(`/businesses/${bizKora.body.id}/vacancies`)
      .set('Authorization', `Bearer ${faIndiToken}`)
      .send({
        tradeSkill: 'Carpenter',
        salaryMinPaise: 2000000,
        headcount: 1,
      })
      .expect(403);
  });
});
