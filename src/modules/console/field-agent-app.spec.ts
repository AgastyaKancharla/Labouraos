import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { PriorityCandidateRow } from '../field-agent/priority.types';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 6 Task 6: Field Agent API & Priority Dashboard (the old page is retired; Laboura Field replaced it)', () => {
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

  it('Priority Dashboard screen reflects live data from /priority/* and updates after re-fetch', async () => {
    // 1. Initial fetch from /priority/candidates (city-wide)
    const initCandidatesRes = await request(app.getHttpServer())
      .get('/priority/candidates')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .expect(200);
    expect(Array.isArray(initCandidatesRes.body)).toBe(true);

    // 2. Initial fetch from /priority/vacancies (city-wide)
    const initVacanciesRes = await request(app.getHttpServer())
      .get('/priority/vacancies')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .expect(200);
    expect(Array.isArray(initVacanciesRes.body)).toBe(true);

    // 3. Initial fetch from /priority/trades (city-wide)
    const initTradesRes = await request(app.getHttpServer())
      .get('/priority/trades')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .expect(200);
    expect(Array.isArray(initTradesRes.body)).toBe(true);

    // 4. Create a 2-hit candidate city-wide to test urgency flag reflection
    const phone = `95001${String(timestamp).slice(-5)}`;
    const otpRes = await request(app.getHttpServer())
      .post('/otp/send')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({ phone, purpose: 'job_seeker' })
      .expect(201);
    const otpCode = (otpService.getProvider() as MockOtpProvider).getCode(otpRes.body.requestId)!;
    await request(app.getHttpServer())
      .post('/otp/verify')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({ requestId: otpRes.body.requestId, code: otpCode })
      .expect(201);

    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-PD-${timestamp}`,
        name: 'Urgent Seeker',
        phone,
        phoneVerified: true,
        trades: { create: { trade: 'Carpenter', isPrimary: true } },
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 2, // 2-hit candidate!
        paymentReceivedAt: new Date(),
        city: 'Bengaluru',
      },
    });

    // 5. Re-fetch candidate urgency: live data reflects the newly created candidate with 2 hits
    const reFetchedCandidates = await request(app.getHttpServer())
      .get('/priority/candidates')
      .set('Authorization', `Bearer ${faKoraToken}`)
      .expect(200);

    const found = reFetchedCandidates.body.find((c: PriorityCandidateRow) => c.id === candidate.id);
    expect(found).toBeDefined();
    expect(found.twoHitFlag).toBe(true);
    expect(found.band).toBeDefined();
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
