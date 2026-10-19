import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 5 Task 1: Placement Creation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let faKoraToken: string;
  let faIndiToken: string;
  let caToken: string;

  let koraVacancyId: string;
  let indiVacancyId: string;
  let activeJobSeekerId: string;
  let placedJobSeekerId: string;

  let staffIds: string[] = [];

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const koraArea = `Area-P5K-${timestamp}`;
  const indiArea = `Area-P5I-${timestamp}`;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const faKora = await prisma.staff.create({
      data: {
        code: `FA-P5K-${timestamp}`,
        name: 'Field Agent Kora P5',
        email: `fa_p5k_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: koraArea,
        city: 'Bengaluru',
      },
    });

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-P5I-${timestamp}`,
        name: 'Field Agent Indi P5',
        email: `fa_p5i_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: indiArea,
        city: 'Bengaluru',
      },
    });

    const ca = await prisma.staff.create({
      data: {
        code: `CA-P5-${timestamp}`,
        name: 'Call Agent P5',
        email: `ca_p5_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });

    staffIds = [faKora.id, faIndi.id, ca.id];

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await request(server).post('/auth/login').send({ email, password });
      return res.body.accessToken;
    };

    faKoraToken = await login(faKora.email);
    faIndiToken = await login(faIndi.email);
    caToken = await login(ca.email);

    // Businesses in respective areas
    const koraBiz = await prisma.business.create({
      data: {
        code: `BZ-P5K-${timestamp}`,
        name: 'Kora Tech Solutions',
        area: koraArea,
        city: 'Bengaluru',
        phone: `91${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
      },
    });

    const indiBiz = await prisma.business.create({
      data: {
        code: `BZ-P5I-${timestamp}`,
        name: 'Indi Retail Hub',
        area: indiArea,
        city: 'Bengaluru',
        phone: `91${timestamp.toString().slice(-8)}2`,
        phoneVerified: true,
      },
    });

    // Vacancies
    const koraVac = await prisma.vacancy.create({
      data: {
        code: `VC-P5K-${timestamp}`,
        businessId: koraBiz.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2000000,
        status: 'open',
      },
    });
    koraVacancyId = koraVac.id;

    const indiVac = await prisma.vacancy.create({
      data: {
        code: `VC-P5I-${timestamp}`,
        businessId: indiBiz.id,
        tradeSkill: 'Plumber',
        offeredSalary: 2500000,
        status: 'open',
      },
    });
    indiVacancyId = indiVac.id;

    // Job Seekers
    const activeJs = await prisma.jobSeeker.create({
      data: {
        code: `JS-P5ACT-${timestamp}`,
        name: 'Active Candidate',
        phone: `92${timestamp.toString().slice(-8)}1`,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2400000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    activeJobSeekerId = activeJs.id;

    const placedJs = await prisma.jobSeeker.create({
      data: {
        code: `JS-P5PLC-${timestamp}`,
        name: 'Already Placed Candidate',
        phone: `92${timestamp.toString().slice(-8)}2`,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2400000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '18:00',
        status: 'placed',
      },
    });
    placedJobSeekerId = placedJs.id;
  });

  afterAll(async () => {
    // Teardown in correct FK dependency order
    await prisma.payment.deleteMany({
      where: {
        placement: {
          vacancy: {
            code: { in: [`VC-P5K-${timestamp}`, `VC-P5I-${timestamp}`] },
          },
        },
      },
    });
    await prisma.placement.deleteMany({
      where: {
        vacancy: {
          code: { in: [`VC-P5K-${timestamp}`, `VC-P5I-${timestamp}`] },
        },
      },
    });
    await prisma.vacancy.deleteMany({
      where: {
        code: { in: [`VC-P5K-${timestamp}`, `VC-P5I-${timestamp}`] },
      },
    });
    await prisma.jobSeeker.deleteMany({
      where: {
        code: {
          in: [
            `JS-P5ACT-${timestamp}`,
            `JS-P5PLC-${timestamp}`,
            `JS-P5ACC-${timestamp}`,
            `JS-P5REJ-${timestamp}`,
            `JS-P5FEE-${timestamp}`,
            `JS-P5ODD-${timestamp}`,
            `JS-P5WH-${timestamp}`,
            `JS-P5JOIN-${timestamp}`,
            `JS-P5DROP1-${timestamp}`,
            `JS-P5DROP2-${timestamp}`,
          ],
        },
      },
    });
    await prisma.business.deleteMany({
      where: {
        code: { in: [`BZ-P5K-${timestamp}`, `BZ-P5I-${timestamp}`] },
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        actorId: { in: staffIds },
      },
    });
    await prisma.staff.deleteMany({
      where: {
        id: { in: staffIds },
      },
    });
    await app.close();
  });

  it('creates a placement in offered status with agreed monthly salary and PL- code', async () => {
    const agreedSalary = 2200000; // ₹22,000 in paise
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${koraVacancyId}/placements`)
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^PL-\d{5}$/);
    expect(res.body.status).toBe('offered');
    expect(res.body.agreedSalary).toBe(2200000);
    // 50% placement fee = 1100000 paise
    expect(res.body.placementFee).toBe(1100000);
    // 18% GST on 1100000 = 198000 paise
    expect(res.body.gstAmount).toBe(198000);

    // Job seeker status must remain 'active', NOT 'placed'
    const js = await prisma.jobSeeker.findUnique({ where: { id: activeJobSeekerId } });
    expect(js?.status).toBe('active');

    // Audit log entry created
    const audit = await prisma.auditLog.findFirst({
      where: { entityCode: res.body.code },
    });
    expect(audit).toBeDefined();
    expect(audit?.action).toBe('placement_created');
  });

  it('enforces field agent area scoping: denied for vacancy outside assigned area (403)', async () => {
    // faKora tries to place into indiVacancy
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${indiVacancyId}/placements`)
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary: 2000000,
      });

    expect(res.status).toBe(403);
  });

  it('allows field agent to create placement within their own assigned area', async () => {
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${indiVacancyId}/placements`)
      .set('Authorization', `Bearer ${faIndiToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary: 2400000,
      })
      .expect(201);

    expect(res.body.code).toMatch(/^PL-\d{5}$/);
    expect(res.body.status).toBe('offered');
  });

  it('allows call agent to create placement across any area', async () => {
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${indiVacancyId}/placements`)
      .set('Authorization', `Bearer ${caToken}`)
      .send({
        jobSeekerId: activeJobSeekerId,
        agreedSalary: 2500000,
      })
      .expect(201);

    expect(res.body.code).toMatch(/^PL-\d{5}$/);
    expect(res.body.status).toBe('offered');
  });

  it('rejects placement if candidate is already placed (400)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/vacancies/${koraVacancyId}/placements`)
      .set('Authorization', `Bearer ${faKoraToken}`)
      .send({
        jobSeekerId: placedJobSeekerId,
        agreedSalary: 2000000,
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already placed');
  });

  describe('Phase 5 Task 2: Offer Response and Confirmation', () => {
    let testPlacementId: string;
    let candidateToAcceptId: string;
    let candidateToRejectId: string;

    beforeAll(async () => {
      // Create fresh candidates for accept & reject tests
      const jsAccept = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5ACC-${timestamp}`,
          name: 'Accept Candidate',
          phone: `93${timestamp.toString().slice(-8)}1`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          hitCount: 0,
        },
      });
      candidateToAcceptId = jsAccept.id;

      const jsReject = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5REJ-${timestamp}`,
          name: 'Reject Candidate',
          phone: `93${timestamp.toString().slice(-8)}2`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          hitCount: 0,
        },
      });
      candidateToRejectId = jsReject.id;
    });

    it('accepting an offer moves placement to confirmed and job seeker to placed', async () => {
      // 1. Create offered placement
      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({
          jobSeekerId: candidateToAcceptId,
          agreedSalary: 2000000,
        })
        .expect(201);

      testPlacementId = placeRes.body.id;
      expect(placeRes.body.status).toBe('offered');

      // 2. Respond accepted
      const respondRes = await request(app.getHttpServer())
        .post(`/placements/${testPlacementId}/respond`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ response: 'accepted' })
        .expect(201);

      expect(respondRes.body.status).toBe('confirmed');

      // Job seeker status must now be 'placed'
      const js = await prisma.jobSeeker.findUnique({ where: { id: candidateToAcceptId } });
      expect(js?.status).toBe('placed');

      // Audit logged
      const audit = await prisma.auditLog.findFirst({
        where: { entityCode: placeRes.body.code, action: 'placement_confirmed' },
      });
      expect(audit).toBeDefined();
    });

    it('rejecting an offer records a hit through the hit cycle and sets placement status to rejected', async () => {
      // 1. Create offered placement
      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          jobSeekerId: candidateToRejectId,
          agreedSalary: 2000000,
        })
        .expect(201);

      const placementId = placeRes.body.id;

      // 2. Respond rejected
      const respondRes = await request(app.getHttpServer())
        .post(`/placements/${placementId}/respond`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          response: 'rejected',
          rejectionReason: 'Candidate declined: commute too far',
        })
        .expect(201);

      expect(respondRes.body.status).toBe('rejected');

      // Job seeker hitCount must have incremented to 1
      const js = await prisma.jobSeeker.findUnique({ where: { id: candidateToRejectId } });
      expect(js?.hitCount).toBe(1);
      expect(js?.status).toBe('active'); // Still active at 1 hit

      // Hit record must exist with reason 'offer_rejected'
      const hit = await prisma.jobSeekerHit.findFirst({
        where: { jobSeekerId: candidateToRejectId },
      });
      expect(hit).toBeDefined();
      expect(hit?.reason).toBe('offer_rejected');
      expect(hit?.note).toContain('commute too far');
    });

    it('rejects response if placement is not in offered status (400)', async () => {
      // testPlacementId was already confirmed above
      const res = await request(app.getHttpServer())
        .post(`/placements/${testPlacementId}/respond`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ response: 'rejected' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('offered');
    });

    it('enforces area scoping when responding to a placement (403 for other area)', async () => {
      // Create placement in Koramangala
      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          jobSeekerId: candidateToRejectId,
          agreedSalary: 2000000,
        })
        .expect(201);

      // faIndi tries to respond to a Koramangala placement
      const res = await request(app.getHttpServer())
        .post(`/placements/${placeRes.body.id}/respond`)
        .set('Authorization', `Bearer ${faIndiToken}`)
        .send({ response: 'accepted' });

      expect(res.status).toBe(403);
    });
  });

  describe('Phase 5 Task 3: Placement Fee and GST', () => {
    let feeCandidateId: string;
    let oddSalaryCandidateId: string;

    beforeAll(async () => {
      const jsFee = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5FEE-${timestamp}`,
          name: 'Fee Candidate',
          phone: `94${timestamp.toString().slice(-8)}1`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });
      feeCandidateId = jsFee.id;

      const jsOdd = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5ODD-${timestamp}`,
          name: 'Odd Salary Candidate',
          phone: `94${timestamp.toString().slice(-8)}2`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });
      oddSalaryCandidateId = jsOdd.id;
    });

    it('creates Payment row for 50% placement fee + 18% GST billed to business, not job seeker', async () => {
      // 1. Create placement with agreed salary ₹20,000 = 2000000 paise
      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({
          jobSeekerId: feeCandidateId,
          agreedSalary: 2000000,
        })
        .expect(201);

      const placementId = placeRes.body.id;

      // 2. Accept placement
      const acceptRes = await request(app.getHttpServer())
        .post(`/placements/${placementId}/respond`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ response: 'accepted' })
        .expect(201);

      expect(acceptRes.body.status).toBe('confirmed');
      expect(acceptRes.body.payment).toBeDefined();

      // Check returned payment info
      const { payment } = acceptRes.body;
      expect(payment.placementFee).toBe(1000000); // 50% of 2000000
      expect(payment.gstAmount).toBe(180000); // 18% of 1000000
      expect(payment.amount).toBe(1180000); // 1000000 + 180000
      expect(payment.status).toBe('pending');
      expect(payment.code).toMatch(/^PAY-\d{5}$/);

      // Verify Payment record in DB
      const dbPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      });
      expect(dbPayment).toBeDefined();
      expect(dbPayment?.type).toBe('placement_fee');
      expect(dbPayment?.amount).toBe(1180000);
      expect(dbPayment?.placementId).toBe(placementId);
      expect(dbPayment?.businessId).toBeDefined();
      // Billed to the business, never deducted from or assigned to the job seeker
      expect(dbPayment?.jobSeekerId).toBeNull();
    });

    it('calculates fee and GST correctly for salary that does not divide evenly (rounding check)', async () => {
      // Agreed salary: 2,345,677 paise (~₹23,456.77)
      // 50% fee = Math.round(2345677 * 0.5) = Math.round(1172838.5) = 1172839 paise
      // 18% GST = Math.round(1172839 * 0.18) = Math.round(211111.02) = 211111 paise
      // Total = 1172839 + 211111 = 1383950 paise
      const agreedSalary = 2345677;

      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({
          jobSeekerId: oddSalaryCandidateId,
          agreedSalary,
        })
        .expect(201);

      const acceptRes = await request(app.getHttpServer())
        .post(`/placements/${placeRes.body.id}/respond`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ response: 'accepted' })
        .expect(201);

      const { payment } = acceptRes.body;
      expect(payment.placementFee).toBe(1172839);
      expect(payment.gstAmount).toBe(211111);
      expect(payment.amount).toBe(1383950);
      expect(Number.isInteger(payment.amount)).toBe(true);
      expect(Number.isInteger(payment.placementFee)).toBe(true);
      expect(Number.isInteger(payment.gstAmount)).toBe(true);
    });

    it('processes payment webhook for placement fee and ensures idempotent duplicate handling', async () => {
      // Create and confirm a placement
      const freshJs = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5WH-${timestamp}`,
          name: 'Webhook Candidate',
          phone: `94${timestamp.toString().slice(-8)}3`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          jobSeekerId: freshJs.id,
          agreedSalary: 2000000,
        })
        .expect(201);

      const acceptRes = await request(app.getHttpServer())
        .post(`/placements/${placeRes.body.id}/respond`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ response: 'accepted' })
        .expect(201);

      const { gatewayReference, id: paymentId } = acceptRes.body.payment;

      // 1. Deliver webhook first time
      const webhookRes1 = await request(app.getHttpServer())
        .post('/payments/webhook')
        .send({
          gatewayReference,
          status: 'succeeded',
        })
        .expect(201);

      expect(webhookRes1.body.received).toBe(true);
      expect(webhookRes1.body.status).toBe('succeeded');

      const paymentAfter1 = await prisma.payment.findUnique({
        where: { id: paymentId },
      });
      expect(paymentAfter1?.status).toBe('succeeded');

      // 2. Deliver duplicate webhook (same payload) -> must be idempotent no-op
      const webhookRes2 = await request(app.getHttpServer())
        .post('/payments/webhook')
        .send({
          gatewayReference,
          status: 'succeeded',
        })
        .expect(201);

      expect(webhookRes2.body.received).toBe(true);
      expect(webhookRes2.body.alreadyProcessed).toBe(true);
    });
  });

  describe('Task 4: Candidate joining', () => {
    it('sets joinedDate and moves placement to active status, audit logging the event', async () => {
      // 1. Create a job seeker, placement, and confirm it
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5JOIN-${timestamp}`,
          name: 'Joining Candidate',
          phone: `95${timestamp.toString().slice(-8)}4`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          jobSeekerId: candidate.id,
          agreedSalary: 2100000,
        })
        .expect(201);

      const placementId = placeRes.body.id;

      // Cannot mark joined if placement is still in 'offered' status
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(400);

      // Confirm placement
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/respond`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ response: 'accepted' })
        .expect(201);

      // Area-scoping: FA from Indiranagar cannot record joined for Koramangala business
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${faIndiToken}`)
        .send({})
        .expect(403);

      // Successfully record joined with explicit joinedDate
      const explicitDate = '2026-10-20T08:00:00.000Z';
      const joinRes = await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ joinedDate: explicitDate })
        .expect(201);

      expect(joinRes.body.id).toBe(placementId);
      expect(joinRes.body.status).toBe('active');
      expect(new Date(joinRes.body.joinedDate).toISOString()).toBe(explicitDate);

      // Placement in DB has status active and joinedDate
      const dbPlacement = await prisma.placement.findUnique({
        where: { id: placementId },
      });
      expect(dbPlacement?.status).toBe('active');
      expect(dbPlacement?.joinedDate?.toISOString()).toBe(explicitDate);

      // Audit log entry created
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityCode: placeRes.body.code,
          action: 'placement_joined',
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('placement_joined');

      // Calling /joined again on already active placement returns 400
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('Task 5: Dropout reporting and the 60-day replacement clock', () => {
    it('records employee_left dropout on active placement with dropoutReportedAt and audit log', async () => {
      // Create candidate, placement, accept, and join
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5DROP1-${timestamp}`,
          name: 'Dropout Candidate 1',
          phone: `96${timestamp.toString().slice(-8)}5`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ jobSeekerId: candidate.id, agreedSalary: 2000000 })
        .expect(201);

      const placementId = placeRes.body.id;

      // Cannot report dropout on 'offered' placement
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ eligibility: 'employee_left' })
        .expect(400);

      // Confirm and join
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/respond`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ response: 'accepted' })
        .expect(201);

      // Cannot report dropout on 'confirmed' placement
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ eligibility: 'employee_left' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(201);

      // Reject invalid eligibility
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ eligibility: 'invalid_reason' })
        .expect(400);

      // Area-scoping: FA from Indiranagar cannot report dropout on Koramangala business placement
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${faIndiToken}`)
        .send({ eligibility: 'employee_left' })
        .expect(403);

      // Successfully report dropout
      const reportDate = '2026-11-01T10:00:00.000Z';
      const dropRes = await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({
          eligibility: 'employee_left',
          dropoutReportedAt: reportDate,
          reason: 'Worker left for family emergency',
        })
        .expect(201);

      expect(dropRes.body.id).toBe(placementId);
      expect(dropRes.body.status).toBe('dropped_out');
      expect(dropRes.body.eligibility).toBe('employee_left');
      expect(new Date(dropRes.body.dropoutReportedAt).toISOString()).toBe(reportDate);

      // Check DB state
      const dbPlacement = await prisma.placement.findUnique({
        where: { id: placementId },
      });
      expect(dbPlacement?.status).toBe('dropped_out');
      expect(dbPlacement?.eligibility).toBe('employee_left');
      expect(dbPlacement?.dropoutReportedAt?.toISOString()).toBe(reportDate);

      // Audit log entry
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityCode: placeRes.body.code,
          action: 'placement_dropout',
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('placement_dropout');
    });

    it('records business_breach dropout marking placement ineligible for remedy', async () => {
      const candidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5DROP2-${timestamp}`,
          name: 'Dropout Candidate 2',
          phone: `97${timestamp.toString().slice(-8)}6`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const placeRes = await request(app.getHttpServer())
        .post(`/vacancies/${koraVacancyId}/placements`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ jobSeekerId: candidate.id, agreedSalary: 2000000 })
        .expect(201);

      const placementId = placeRes.body.id;

      await request(app.getHttpServer())
        .post(`/placements/${placementId}/respond`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ response: 'accepted' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(201);

      const dropRes = await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          eligibility: 'business_breach',
          reason: 'Business changed work role and underpaid worker',
        })
        .expect(201);

      expect(dropRes.body.status).toBe('dropped_out');
      expect(dropRes.body.eligibility).toBe('business_breach');
      expect(dropRes.body.dropoutReportedAt).toBeDefined();

      const dbPlacement = await prisma.placement.findUnique({
        where: { id: placementId },
      });
      expect(dbPlacement?.status).toBe('dropped_out');
      expect(dbPlacement?.eligibility).toBe('business_breach');
    });
  });
});


