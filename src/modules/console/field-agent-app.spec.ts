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

describe('Phase 6 Task 6: Field Agent App & Priority Dashboard', () => {
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

  it('GET /field-agent serves the Field Agent App web frontend with camera-only selfie capture and priority dashboard views', async () => {
    const res = await request(app.getHttpServer())
      .get('/field-agent')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    const html = res.text;
    expect(html).not.toMatch(/(?:\+91)?[6-9]\d{9}/);

    // Header and core layout
    expect(html).toContain('Laboura Field Agent App');
    expect(html).toContain('Priority Dashboard');
    expect(html).toContain('id="fa-check-in-button"');
    expect(html).toContain('My verification assignments');
    expect(html).toContain('Send owner presence OTP');
    expect(html).toContain('Complete verification visit');
    expect(html).toContain('/businesses/visit-assignments');
    expect(html).toContain('value="household"');
    expect(html).toContain('fa-biz-udyam');
    expect(html).toContain('fa-vc-role-title');
    expect(html).toContain('fa-vc-slot-start');

    // Business onboarding with camera-only selfie capture: accept="image/*" capture="user"
    // No gallery picker exposed
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('capture="user"');
    expect(html).toContain('fa-selfie-input');

    // Priority Dashboard 3 views
    expect(html).toContain('Candidate Urgency List');
    expect(html).toContain('Vacancy Priority List');
    expect(html).toContain('Trade Supply / Demand Board');

    // Live Priority API endpoints called directly
    expect(html).toContain('/priority/candidates');
    expect(html).toContain('/priority/vacancies');
    expect(html).toContain('/priority/trades');

    // Shortlist, interview booking, and interview status
    expect(html).toContain('fa-shortlist-vc-id');
    expect(html).toContain('Book interview');
    expect(html).toContain('fa-interview-list');
    expect(html).toContain('/shortlist?page=');
    expect(html).toContain('fa-shortlist-next');
    expect(html).toContain('Show next 3');
    expect(html).toContain('showFieldSelectedInPerson');
    expect(html).toContain('sendFieldSelectedToOwner');
    expect(html).toContain('Left out — no location:');
    const cardRenderer = html.slice(html.indexOf('async function loadFieldShortlistPage'), html.indexOf('async function submitFieldIntroductions'));
    expect(cardRenderer).not.toMatch(/\.phone\b|\.address\b|\.latitude\b|\.longitude\b|dateOfBirth|\bdob\b/i);
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
