import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlacementService } from './placement.service';
import { PricingService } from '../pricing/pricing.service';
import { calculatePlacementFee, calculateGst } from '../../common/money/money';
import { IdService } from '../../common/id/id.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { createJoiningCallsFixture } from '../../test-support/joining-call-fixture';

describe('Phase 5 Task 1: Placement Creation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let faKoraToken: string;
  let faIndiToken: string;
  let caToken: string;
  let ceoToken: string;
  let mgrToken: string;
  let financeToken: string;
  let teamLeadToken: string;

  let koraVacancyId: string;
  let activeJobSeekerId: string;

  let staffIds: string[] = [];
  let faKoraId: string;
  let fixtureIndex = 0;
  const testPolicyIds: string[] = [];
  const overdueFlagPlacementIds: string[] = [];

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
    const teamLead = await prisma.staff.create({
      data: {
        code: `TL-P5-${timestamp}`,
        name: 'Team Lead P5',
        email: `tl_p5_${timestamp}@laboura.local`,
        passwordHash,
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-P5-${timestamp}`,
        name: 'CEO P5',
        email: `ceo_p5_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-P5-${timestamp}`,
        name: 'Manager P5',
        email: `mgr_p5_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    const finance = await prisma.staff.create({
      data: {
        code: `FI-P5-${timestamp}`,
        name: 'Finance P5',
        email: `fi_p5_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    staffIds = [faKora.id, faIndi.id, ca.id, teamLead.id, ceo.id, mgr.id, finance.id];
    faKoraId = faKora.id;

    const server = app.getHttpServer();
    const login = async (email: string | null) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    faKoraToken = await login(faKora.email);
    faIndiToken = await login(faIndi.email);
    caToken = await login(ca.email);
    teamLeadToken = await login(teamLead.email);
    ceoToken = await login(ceo.email);
    mgrToken = await login(mgr.email);
    financeToken = await login(finance.email);

    // Businesses in respective areas
    const koraBiz = await prisma.business.create({
      data: {
        code: `BZ-P5K-${timestamp}`,
        name: 'Kora Tech Solutions',
        area: koraArea,
        accountAgentId: faKora.id,
        city: 'Bengaluru',
        phone: `91${timestamp.toString().slice(-8)}1`,
        phoneVerified: true,
      },
    });

    // Vacancies
    const koraVac = await prisma.vacancy.create({
      data: {
        code: `VC-P5K-${timestamp}`,
        businessId: koraBiz.id,
        tradeSkill: 'Electrician',
        salaryMinPaise: 2000000,
        status: 'open',
      },
    });
    koraVacancyId = koraVac.id;

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

  });

  async function createAwaitingPaymentFixture(vacancyId: string, jobSeekerId: string, agreedSalary: number) {
    fixtureIndex += 1;
    const vacancy = await prisma.vacancy.findUniqueOrThrow({ where: { id: vacancyId }, include: { business: true } });
    const policy = await app.get(PricingService).current();
    const placementId = `p5-fixture-${timestamp}-${fixtureIndex}`;
    const placementFee = calculatePlacementFee(agreedSalary, policy.placementFeePercent);
    const gstAmount = calculateGst(placementFee, policy.gstPercent);
    const now = new Date();
    const placement = await prisma.placement.create({
      data: {
        id: placementId,
        code: await app.get(IdService).generateCode('placement'),
        city: vacancy.city,
        vacancyId: vacancy.id,
        jobSeekerId,
        businessId: vacancy.businessId,
        createdByStaffId: faKoraId,
        selectedAt: now,
        paymentDueAt: new Date(now.getTime() + policy.placementPaymentDueHours * 60 * 60 * 1000),
        joiningDate: now,
        rootPlacementId: placementId,
        replacementNumber: 0,
        feePercentAtCreation: policy.placementFeePercent,
        gstPercentAtCreation: policy.gstPercent,
        agreedSalary,
        placementFee,
        gstAmount,
        status: 'awaiting_payment',
      },
    });
    const payment = await prisma.payment.create({
      data: {
        code: await app.get(IdService).generateCode('payment'),
        city: vacancy.city,
        type: 'placement_fee',
        amount: placementFee + gstAmount,
        status: 'pending',
        gatewayReference: `p5_fixture_${timestamp}_${fixtureIndex}`,
        subjectType: 'placement',
        subjectId: placement.id,
        businessId: vacancy.businessId,
        placementId: placement.id,
        jobSeekerId: null,
      },
    });
    return { body: placement, payment };
  }

  async function markFixturePaymentSucceeded(placementId: string) {
    const placement = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { placementId, type: 'placement_fee' }, data: { status: 'succeeded' } });
      await tx.placement.update({ where: { id: placementId }, data: { status: 'confirmed', paidAt: now } });
      await tx.jobSeeker.update({ where: { id: placement.jobSeekerId }, data: { status: 'placed' } });
    });
    return prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
  }

  afterAll(async () => {
    // Teardown in correct FK dependency order
    await prisma.reviewFlag.deleteMany({
      where: { kind: 'payment_overdue', subjectType: 'placement', subjectId: { in: overdueFlagPlacementIds } },
    });
    await prisma.payment.deleteMany({
      where: {
        placement: {
          vacancy: {
            code: { in: [`VC-P5K-${timestamp}`, `VC-P5I-${timestamp}`] },
          },
        },
      },
    });
    await prisma.replacementCandidate.deleteMany({
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
    await prisma.interview.deleteMany({
      where: { business: { code: { in: [`BZ-P5K-${timestamp}`, `BZ-P5I-${timestamp}`] } } },
    });
    await prisma.vacancyInterviewSlot.deleteMany({
      where: { vacancy: { code: { in: [`VC-P5K-${timestamp}`, `VC-P5I-${timestamp}`] } } },
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
            `JS-P15PAY-${timestamp}`,
            `JS-P5ACC-${timestamp}`,
            `JS-P5REJ-${timestamp}`,
            `JS-P5FEE-${timestamp}`,
            `JS-P5ODD-${timestamp}`,
            `JS-P5WH-${timestamp}`,
            `JS-P5JOIN-${timestamp}`,
            `JS-P5DROP1-${timestamp}`,
            `JS-P5DROP2-${timestamp}`,
            `JS-P5RCDROP-${timestamp}`,
            `JS-P5RC1-${timestamp}`,
            `JS-P5RC2-${timestamp}`,
            `JS-P5RC3-${timestamp}`,
            `JS-P5REF1-${timestamp}`,
            `JS-P5REF2-${timestamp}`,
            `JS-P5REF3-${timestamp}`,
            `JS-P5REF4-${timestamp}`,
            `JS-P5REF5-${timestamp}`,
            `JS-P5REF6-${timestamp}`,
            `JS-P5REF7-${timestamp}`,
            `JS-P5REF8-${timestamp}`,
            `JS-P5REF9-${timestamp}`,
            `JS-P5REFPAUSE-${timestamp}`,
          ],
        },
      },
    });
    await prisma.business.deleteMany({
      where: { code: `BZ-P5K-${timestamp}` },
    });
    await prisma.auditLog.deleteMany({
      where: {
        actorId: { in: staffIds },
      },
    });
    await prisma.pricingPolicy.deleteMany({ where: { id: { in: testPolicyIds } } });
    await prisma.staff.deleteMany({
      where: {
        id: { in: staffIds },
      },
    });
    await app.close();
  });

  it.each([
    ['field_agent', () => faKoraToken], ['call_agent', () => caToken],
    ['team_lead', () => teamLeadToken], ['manager', () => mgrToken],
    ['ceo', () => ceoToken], ['finance', () => financeToken],
  ])('removes legacy placement creation and response routes for %s', async (_role, token) => {
    const auth = `Bearer ${(token as () => string)()}`;
    await request(app.getHttpServer())
      .post(`/vacancies/${koraVacancyId}/placements`)
      .set('Authorization', auth)
      .send({ jobSeekerId: activeJobSeekerId, agreedSalary: 2200000 })
      .expect(404);
    await request(app.getHttpServer())
      .post('/placements/legacy-placement/respond')
      .set('Authorization', auth)
      .send({ response: 'accepted' })
      .expect(404);
  });

  it('creates a selected interview placement with signed-agreement fees and confirms the candidate only after payment', async () => {
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P15PAY-${timestamp}`, name: 'Interview Selected Candidate',
        phone: `95${timestamp.toString().slice(-8)}9`, tradeSkill: 'Electrician',
        minSalary: 1800000, maxSalary: 2400000,
        preferredCallWindowStart: '09:00', preferredCallWindowEnd: '18:00', status: 'active',
      },
    });
    const vacancy = await prisma.vacancy.findUniqueOrThrow({
      where: { id: koraVacancyId }, include: { business: true },
    });
    const now = new Date();
    const policy = await app.get(PricingService).current();
    const agreement = await prisma.businessAgreement.create({
      data: {
        businessId: vacancy.businessId,
        version: `phase15-${timestamp}`,
        termsHash: `terms-${timestamp}`,
        noBypassMonths: policy.noBypassMonths,
        noBypassPenaltyPercent: policy.noBypassPenaltyPercent,
        feePercent: 37,
        gstPercent: 12,
        signedName: 'Owner P15',
        signedPhone: vacancy.business.phone,
        otpRequestId: `otp-${timestamp}`,
        signedAt: now,
        documentStoragePath: `agreements/${timestamp}.pdf`,
      },
    });
    const slot = await prisma.vacancyInterviewSlot.create({
      data: {
        vacancyId: vacancy.id,
        startsAt: new Date(now.getTime() + 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 90 * 60 * 1000),
        capacity: 1,
      },
    });
    const interview = await prisma.interview.create({
      data: {
        code: await app.get(IdService).generateCode('interview'),
        vacancyId: vacancy.id,
        businessId: vacancy.businessId,
        jobSeekerId: candidate.id,
        vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt,
        slotEndsAt: slot.endsAt,
        proposedByStaffId: faKoraId,
        suitabilitySnapshot: { trade: { passed: true } },
        status: 'completed',
        offerSentAt: now,
        replyDueAt: now,
        resultDueAt: now,
        result: 'selected',
        resultOtpRequestId: `otp-result-${timestamp}`,
        resultRecordedAt: now,
        selectedSalaryPaise: 2000000,
        selectedJoiningDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    const placements = app.get(PlacementService);
    const selected = await placements.createAwaitingPaymentFromInterview(interview.id, now);
    if (!selected.payment) throw new Error('Selected interview did not create its placement fee payment');
    const expectedFee = calculatePlacementFee(2000000, agreement.feePercent);
    const expectedGst = calculateGst(expectedFee, agreement.gstPercent);
    expect(selected).toMatchObject({
      status: 'awaiting_payment',
      interviewId: interview.id,
      createdByStaffId: faKoraId,
      selectedAt: now,
      paymentDueAt: new Date(now.getTime() + policy.placementPaymentDueHours * 60 * 60 * 1000),
      agreedSalary: 2000000,
      feePercentAtCreation: agreement.feePercent,
      gstPercentAtCreation: agreement.gstPercent,
      placementFee: expectedFee,
      gstAmount: expectedGst,
      rootPlacementId: selected.id,
      replacementNumber: 0,
    });
    expect(selected.payment).toMatchObject({ status: 'pending', amount: expectedFee + expectedGst });
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe('active');

    const changedPolicy = await app.get(PricingService).createVersion({
      placementFeePercent: agreement.feePercent + 1,
      gstPercent: agreement.gstPercent + 1,
    }, (await prisma.staff.findUniqueOrThrow({ where: { id: faKoraId } })).id);
    testPolicyIds.push(changedPolicy.id);
    const retry = await placements.createAwaitingPaymentFromInterview(interview.id, now);
    if (!retry.payment) throw new Error('Placement retry did not return its existing fee payment');
    expect(retry.feePercentAtCreation).toBe(agreement.feePercent);
    expect(retry.gstPercentAtCreation).toBe(agreement.gstPercent);
    expect(retry.placementFee).toBe(expectedFee);
    expect(retry.payment.id).toBe(selected.payment.id);

    let payment = await prisma.payment.findUniqueOrThrow({ where: { id: selected.payment.id } });
    if (!payment.gatewayReference && payment.upiReference) {
      await request(app.getHttpServer()).post(`/payments/request/${encodeURIComponent(payment.upiReference)}/card`).expect(200);
      payment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }
    const firstWebhook = await request(app.getHttpServer()).post('/payments/mock/simulate-webhook').send({
      gatewayReference: payment.gatewayReference, status: 'succeeded',
    }).expect(201);
    expect(firstWebhook.body.status).toBe('succeeded');
    const paidPlacement = await prisma.placement.findUniqueOrThrow({ where: { id: selected.id } });
    expect(paidPlacement.status).toBe('confirmed');
    expect(paidPlacement.paidAt).toBeInstanceOf(Date);
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe('placed');
    expect(await prisma.messageLog.count({ where: { relatedId: selected.id, template: 'joining_confirmed' } })).toBe(2);

    const replay = await request(app.getHttpServer()).post('/payments/mock/simulate-webhook').send({
      gatewayReference: payment.gatewayReference, status: 'succeeded',
    }).expect(201);
    expect(replay.body.alreadyProcessed).toBe(true);
    expect(await prisma.messageLog.count({ where: { relatedId: selected.id, template: 'joining_confirmed' } })).toBe(2);
    await prisma.businessAgreement.delete({ where: { id: agreement.id } });
    await prisma.pricingPolicy.delete({ where: { id: changedPolicy.id } });
  });

  it('flags an unpaid placement at its policy deadline and does not send the joining date', async () => {
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-P15DUE-${timestamp}`, name: 'Unpaid Interview Candidate',
        phone: `96${timestamp.toString().slice(-8)}9`, tradeSkill: 'Electrician',
        minSalary: 1800000, maxSalary: 2400000,
        preferredCallWindowStart: '09:00', preferredCallWindowEnd: '18:00', status: 'active',
      },
    });
    const fixture = await createAwaitingPaymentFixture(koraVacancyId, candidate.id, 2000000);
    overdueFlagPlacementIds.push(fixture.body.id);

    const dueAt = fixture.body.paymentDueAt;
    if (!dueAt) throw new Error('Placement payment deadline was not set');
    const placementService = app.get(PlacementService);
    expect(await placementService.processPaymentDeadlines(new Date(dueAt.getTime() - 1))).toEqual({ raised: 0 });
    expect(await placementService.processPaymentDeadlines(new Date(dueAt.getTime() + 1))).toEqual({ raised: 1 });
    expect(await placementService.processPaymentDeadlines(new Date(dueAt.getTime() + 2))).toEqual({ raised: 0 });
    expect(await prisma.reviewFlag.count({
      where: { kind: 'payment_overdue', subjectType: 'placement', subjectId: fixture.body.id },
    })).toBe(1);
    expect(await prisma.messageLog.count({
      where: { relatedId: fixture.body.id, template: 'joining_confirmed' },
    })).toBe(0);
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe('active');
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

      const placeRes = await createAwaitingPaymentFixture(koraVacancyId, candidate.id, 2100000);

      const placementId = placeRes.body.id;

      // Cannot mark joined if placement is still in 'offered' status
      const plRow = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
      await createJoiningCallsFixture({
        prisma,
        idService: app.get(IdService),
        placementId,
        jobSeekerId: candidate.id,
        businessId: koraBusinessId,
        callTime: plRow.joiningDate ?? new Date(),
      });
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(400);

      // Confirm placement
      await markFixturePaymentSucceeded(placementId);

      // Area-scoping: FA from Indiranagar cannot record joined for Koramangala business
      const plRow = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
      await createJoiningCallsFixture({
        prisma,
        idService: app.get(IdService),
        placementId,
        jobSeekerId: candidate.id,
        businessId: koraBusinessId,
        callTime: plRow.joiningDate ?? new Date(),
      });
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${faIndiToken}`)
        .send({})
        .expect(403);

      // Successfully record joined with answered confirmation calls
      const explicitDate = '2026-10-20T08:00:00.000Z';
      await prisma.placement.update({
        where: { id: placementId },
        data: { joiningDate: new Date(explicitDate) },
      });
      await createJoiningCallsFixture({
        prisma,
        idService: app.get(IdService),
        placementId,
        jobSeekerId: candidate.id,
        businessId: koraBusinessId,
        callTime: new Date(explicitDate),
      });
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
      const plRow = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
      await createJoiningCallsFixture({
        prisma,
        idService: app.get(IdService),
        placementId,
        jobSeekerId: candidate.id,
        businessId: koraBusinessId,
        callTime: plRow.joiningDate ?? new Date(),
      });
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

      const placeRes = await createAwaitingPaymentFixture(koraVacancyId, candidate.id, 2000000);

      const placementId = placeRes.body.id;

      // Cannot report dropout on 'offered' placement
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ eligibility: 'employee_left' })
        .expect(400);

      // Confirm and join
      await markFixturePaymentSucceeded(placementId);

      // Cannot report dropout on 'confirmed' placement
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ eligibility: 'employee_left' })
        .expect(400);

      const plRow = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
      await createJoiningCallsFixture({
        prisma,
        idService: app.get(IdService),
        placementId,
        jobSeekerId: candidate.id,
        businessId: koraBusinessId,
        callTime: plRow.joiningDate ?? new Date(),
      });
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
      const reportDate = new Date().toISOString();
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
      expect(dropRes.body.dropoutDateCallerSupplied).toBe(true);

      // Check DB state
      const dbPlacement = await prisma.placement.findUnique({
        where: { id: placementId },
      });
      expect(dbPlacement?.status).toBe('dropped_out');
      expect(dbPlacement?.eligibility).toBe('employee_left');
      expect(dbPlacement?.dropoutReportedAt?.toISOString()).toBe(reportDate);
      expect(dbPlacement?.dropoutDateCallerSupplied).toBe(true);

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

      const placeRes = await createAwaitingPaymentFixture(koraVacancyId, candidate.id, 2000000);

      const placementId = placeRes.body.id;

      await markFixturePaymentSucceeded(placementId);

      const plRow = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
      await createJoiningCallsFixture({
        prisma,
        idService: app.get(IdService),
        placementId,
        jobSeekerId: candidate.id,
        businessId: koraBusinessId,
        callTime: plRow.joiningDate ?? new Date(),
      });
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
      expect(dropRes.body.dropoutDateCallerSupplied).toBe(false);

      const dbPlacement = await prisma.placement.findUnique({
        where: { id: placementId },
      });
      expect(dbPlacement?.status).toBe('dropped_out');
      expect(dbPlacement?.eligibility).toBe('business_breach');
      expect(dbPlacement?.dropoutDateCallerSupplied).toBe(false);
    });
  });

  describe('Task 6: Replacement flow and the 2-rejection pause', () => {
    it('allows offering replacement candidates and pauses clock on 3rd rejection, freezing elapsed days', async () => {
      // 1. Create original candidate, placement, confirm, join, and dropout (employee_left)
      const originalCandidate = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5RCDROP-${timestamp}`,
          name: 'Original Dropped Candidate',
          phone: `98${timestamp.toString().slice(-8)}7`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const placeRes = await createAwaitingPaymentFixture(koraVacancyId, originalCandidate.id, 2000000);

      const placementId = placeRes.body.id;

      await markFixturePaymentSucceeded(placementId);

      const plRow = await prisma.placement.findUniqueOrThrow({ where: { id: placementId } });
      await createJoiningCallsFixture({
        prisma,
        idService: app.get(IdService),
        placementId,
        jobSeekerId: candidate.id,
        businessId: koraBusinessId,
        callTime: plRow.joiningDate ?? new Date(),
      });
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/joined`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(201);

      const dropoutDate = new Date();
      const dropoutReportedAt = dropoutDate.toISOString();
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/dropout`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          eligibility: 'employee_left',
          dropoutReportedAt,
        })
        .expect(201);

      // Create 3 replacement candidates
      const rc1 = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5RC1-${timestamp}`,
          name: 'Replacement Candidate 1',
          phone: `98${timestamp.toString().slice(-8)}8`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const rc2 = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5RC2-${timestamp}`,
          name: 'Replacement Candidate 2',
          phone: `98${timestamp.toString().slice(-8)}9`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const rc3 = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5RC3-${timestamp}`,
          name: 'Replacement Candidate 3',
          phone: `99${timestamp.toString().slice(-8)}0`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      // Area-scoping: Indiranagar FA cannot offer replacement on Koramangala placement
      await request(app.getHttpServer())
        .post(`/placements/${placementId}/replacement-candidates`)
        .set('Authorization', `Bearer ${faIndiToken}`)
        .send({ jobSeekerId: rc1.id })
        .expect(403);

      // Offer Candidate 1
      const offerRes1 = await request(app.getHttpServer())
        .post(`/placements/${placementId}/replacement-candidates`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ jobSeekerId: rc1.id })
        .expect(201);

      expect(offerRes1.body.status).toBe('offered');
      const rc1Id = offerRes1.body.id;

      // 1st Rejection
      const rejRes1 = await request(app.getHttpServer())
        .post(`/placements/${placementId}/replacement-candidates/${rc1Id}/reject`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({
          reason: 'Lacks required tools',
          rejectedAt: new Date(dropoutDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .expect(201);

      expect(rejRes1.body.placement.replacementRejectionCount).toBe(1);
      expect(rejRes1.body.placement.clockPaused).toBe(false);

      // Offer Candidate 2
      const offerRes2 = await request(app.getHttpServer())
        .post(`/placements/${placementId}/replacement-candidates`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ jobSeekerId: rc2.id })
        .expect(201);

      const rc2Id = offerRes2.body.id;

      // 2nd Rejection: Still does not pause clock
      const rejRes2 = await request(app.getHttpServer())
        .post(`/placements/${placementId}/replacement-candidates/${rc2Id}/reject`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          reason: 'Salary expectation gap',
          rejectedAt: new Date(dropoutDate.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .expect(201);

      expect(rejRes2.body.placement.replacementRejectionCount).toBe(2);
      expect(rejRes2.body.placement.clockPaused).toBe(false);

      // Offer Candidate 3
      const offerRes3 = await request(app.getHttpServer())
        .post(`/placements/${placementId}/replacement-candidates`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({ jobSeekerId: rc3.id })
        .expect(201);

      const rc3Id = offerRes3.body.id;

      // 3rd Rejection: Pauses the guarantee clock!
      const pauseDate = new Date(dropoutDate.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(); // exactly 10 days after dropout report
      const rejRes3 = await request(app.getHttpServer())
        .post(`/placements/${placementId}/replacement-candidates/${rc3Id}/reject`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({
          reason: 'Did not match culture fit',
          rejectedAt: pauseDate,
        })
        .expect(201);

      expect(rejRes3.body.placement.replacementRejectionCount).toBe(3);
      expect(rejRes3.body.placement.clockPaused).toBe(true);
      expect(new Date(rejRes3.body.placement.clockPausedAt).toISOString()).toBe(pauseDate);

      // Verify elapsed-day calculation freeze:
      // Even 40 days later, elapsed days remain frozen at 10 days
      const placementService = app.get(PlacementService);
      const elapsedDaysFuture = await placementService.getPlacementDaysElapsed(
        placementId,
        new Date(dropoutDate.getTime() + 40 * 24 * 60 * 60 * 1000),
      );
      expect(elapsedDaysFuture).toBe(10);
    });

    it('records acceptedAt when replacement candidate is accepted', async () => {
      const timestamp = Date.now();
      const jsDropped = await prisma.jobSeeker.create({
        data: {
          code: `JS-REPAC1-${timestamp}`,
          name: 'Dropped Seeker',
          phone: `91${timestamp.toString().slice(-8)}1`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
        },
      });

      const jsReplacement = await prisma.jobSeeker.create({
        data: {
          code: `JS-REPAC2-${timestamp}`,
          name: 'Replacement Seeker',
          phone: `91${timestamp.toString().slice(-8)}2`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
        },
      });

      const placement = await prisma.placement.create({
        data: {
          code: `PL-REPAC-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: jsDropped.id,
          businessId: (await prisma.vacancy.findUnique({ where: { id: koraVacancyId } }))!.businessId,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt: new Date(),
        },
      });

      const offerRes = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/replacement-candidates`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ jobSeekerId: jsReplacement.id })
        .expect(201);

      const candidateId = offerRes.body.id;
      const acceptTime = new Date('2026-11-10T12:00:00.000Z');

      const acceptRes = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/replacement-candidates/${candidateId}/accept`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({ acceptedAt: acceptTime.toISOString() })
        .expect(201);

      expect(acceptRes.body.candidate.status).toBe('accepted');
      expect(new Date(acceptRes.body.candidate.acceptedAt).toISOString()).toBe(acceptTime.toISOString());

      const dbCandidate = await prisma.replacementCandidate.findUnique({
        where: { id: candidateId },
      });
      expect(dbCandidate?.status).toBe('accepted');
      expect(dbCandidate?.acceptedAt?.toISOString()).toBe(acceptTime.toISOString());
    });
  });

  describe('Phase 5 Task 7: Refund approval (business side)', () => {
    it('denies non-release roles and Managers (403), while Finance can release (201)', async () => {
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5REF1-${timestamp}`,
          name: 'Refund Candidate 1',
          phone: `92${timestamp.toString().slice(-8)}8`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
        },
      });

      const placement = await prisma.placement.create({
        data: {
          code: `PL-P5REF1-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: js.id,
          businessId: (await prisma.vacancy.findUnique({ where: { id: koraVacancyId } }))!.businessId,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      });

      // Call agent gets 403
      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${caToken}`)
        .send({})
        .expect(403);

      // Field agent gets 403
      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${faKoraToken}`)
        .send({})
        .expect(403);

      // Manager cannot release money
      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .send({ asOf: '2026-10-17T00:00:00.000Z', reason: 'No replacement within the search period' })
        .expect(403);

      // Finance can release eligible refunds
      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ asOf: '2026-10-17T00:00:00.000Z', reason: 'No replacement within the search period' })
        .expect(201);
    });

    it('denies refund when eligibility is business_breach (no remedy)', async () => {
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5REF2-${timestamp}`,
          name: 'Refund Candidate 2',
          phone: `92${timestamp.toString().slice(-8)}9`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
        },
      });

      const placement = await prisma.placement.create({
        data: {
          code: `PL-P5REF2-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: js.id,
          businessId: (await prisma.vacancy.findUnique({ where: { id: koraVacancyId } }))!.businessId,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          status: 'dropped_out',
          eligibility: 'business_breach',
          dropoutReportedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: '2026-11-01T00:00:00.000Z' }) // day 31
        .expect(400);

      expect(res.body.message).toContain('business_breach');
    });

    it('denies refund when a replacement candidate has been accepted', async () => {
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5REF3-${timestamp}`,
          name: 'Refund Candidate 3',
          phone: `92${timestamp.toString().slice(-8)}0`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
        },
      });

      const replJs = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5REF4-${timestamp}`,
          name: 'Replacement Candidate 4',
          phone: `92${timestamp.toString().slice(-8)}3`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
        },
      });

      const placement = await prisma.placement.create({
        data: {
          code: `PL-P5REF3-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: js.id,
          businessId: (await prisma.vacancy.findUnique({ where: { id: koraVacancyId } }))!.businessId,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt: new Date('2026-10-01T00:00:00.000Z'),
          replacementCandidates: {
            create: {
              jobSeekerId: replJs.id,
              status: 'accepted',
            },
          },
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ asOf: '2026-11-01T00:00:00.000Z' }) // day 31
        .expect(400);

      expect(res.body.message).toContain('replacement candidate has been accepted');
    });

    it('asserts flat refund rule boundaries: no refund at days 0, 10, 14; full refund at day 15', async () => {
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5REF5-${timestamp}`,
          name: 'Refund Candidate 5',
          phone: `92${timestamp.toString().slice(-8)}4`,
          tradeSkill: 'Electrician',
          minSalary: 2400000,
          maxSalary: 3000000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
        },
      });

      const startDate = new Date('2026-10-01T00:00:00.000Z');
      const placementFee = 1200000; // 50% of ₹24,000 in paise

      const placement = await prisma.placement.create({
        data: {
          code: `PL-P5REF5-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: js.id,
          businessId: (await prisma.vacancy.findUnique({ where: { id: koraVacancyId } }))!.businessId,
          agreedSalary: 2400000,
          placementFee,
          gstAmount: 216000,
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt: startDate,
        },
      });

      // Day 0: 2026-10-01T00:00:00.000Z -> 400
      const resDay0 = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: '2026-10-01T00:00:00.000Z' })
        .expect(400);
      expect(resDay0.body.message).toContain('not payable before 15 days');

      // Day 10: 2026-10-11T00:00:00.000Z -> 400
      const resDay10 = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: '2026-10-11T00:00:00.000Z' })
        .expect(400);
      expect(resDay10.body.message).toContain('not payable before 15 days');

      // Day 14: 2026-10-15T12:00:00.000Z -> 400
      const resDay14 = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: '2026-10-15T12:00:00.000Z' })
        .expect(400);
      expect(resDay14.body.message).toContain('not payable before 15 days');

      // Day 15: 2026-10-16T00:00:00.000Z -> 201 Created, full refund (100% placement fee)
      const resDay15 = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: '2026-10-16T00:00:00.000Z' })
        .expect(201);

      expect(resDay15.body.type).toBe('refund');
      expect(resDay15.body.amount).toBe(placementFee); // full 100% placement fee
      expect(resDay15.body.code).toMatch(/^PAY-\d{5}$/);
      expect(resDay15.body.status).toBe('completed');
      expect(resDay15.body.placementId).toBe(placement.id);

      // DB check
      const dbPayment = await prisma.payment.findUnique({
        where: { id: resDay15.body.id },
      });
      expect(dbPayment?.amount).toBe(placementFee);
      expect(dbPayment?.type).toBe('refund');

      // Audit log check
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityCode: placement.code,
          action: 'refund_approved',
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.action).toBe('refund_approved');

      // Duplicate refund check: repeat call fails with 400
      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: '2026-10-16T00:00:00.000Z' })
        .expect(400);
    });

    it('asserts flat 100% refund at days 16, 30, 45, 61 (does not taper with more elapsed time)', async () => {
      // Test the boundaries across different placements to verify flat 100% refund rule
      const testCases = [
        { days: 16, asOf: '2026-10-17T00:00:00.000Z', suffix: '6' },
        { days: 30, asOf: '2026-10-31T00:00:00.000Z', suffix: '7' },
        { days: 45, asOf: '2026-11-15T00:00:00.000Z', suffix: '8' },
        { days: 61, asOf: '2026-12-01T00:00:00.000Z', suffix: '9' },
      ];

      for (const tc of testCases) {
        const js = await prisma.jobSeeker.create({
          data: {
            code: `JS-P5REF${tc.suffix}-${timestamp}`,
            name: `Refund Candidate ${tc.suffix}`,
            phone: `81${timestamp.toString().slice(-8)}${tc.suffix}`,
            tradeSkill: 'Electrician',
            minSalary: 2000000,
            maxSalary: 2600000,
            preferredCallWindowStart: '10:00',
            preferredCallWindowEnd: '18:00',
            status: 'placed',
          },
        });

        const placementFee = 1000000;
        const placement = await prisma.placement.create({
          data: {
            code: `PL-P5REF${tc.suffix}-${timestamp}`,
            vacancyId: koraVacancyId,
            jobSeekerId: js.id,
            businessId: (await prisma.vacancy.findUnique({ where: { id: koraVacancyId } }))!.businessId,
            agreedSalary: 2000000,
            placementFee,
            gstAmount: 180000,
            status: 'dropped_out',
            eligibility: 'employee_left',
            dropoutReportedAt: new Date('2026-10-01T00:00:00.000Z'),
          },
        });

        const res = await request(app.getHttpServer())
          .post(`/placements/${placement.id}/refund`)
          .set('Authorization', `Bearer ${financeToken}`)
          .send({ asOf: tc.asOf })
          .expect(201);

        expect(res.body.amount).toBe(placementFee);
        expect(res.body.type).toBe('refund');
      }
    });

    it('treats a business refund payout still in flight (processing) as already issued', async () => {
      const placement = await prisma.placement.findUniqueOrThrow({
        where: { code: `PL-P5REF9-${timestamp}` },
      });
      const refund = await prisma.payment.findFirstOrThrow({
        where: { placementId: placement.id, type: 'refund' },
      });
      await prisma.payment.update({ where: { id: refund.id }, data: { status: 'processing' } });

      await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({ asOf: '2026-12-01T00:00:00.000Z' })
        .expect(400);

      expect(await prisma.payment.count({ where: { placementId: placement.id, type: 'refund' } })).toBe(1);
    });

    it('freezes refund eligibility when clock is paused at day 10', async () => {
      const js = await prisma.jobSeeker.create({
        data: {
          code: `JS-P5REFPAUSE-${timestamp}`,
          name: 'Paused Candidate',
          phone: `92${timestamp.toString().slice(-8)}5`,
          tradeSkill: 'Electrician',
          minSalary: 1800000,
          maxSalary: 2400000,
          preferredCallWindowStart: '10:00',
          preferredCallWindowEnd: '18:00',
          status: 'placed',
        },
      });

      const dropoutReportedAt = new Date('2026-10-01T00:00:00.000Z');
      const clockPausedAt = new Date('2026-10-11T00:00:00.000Z'); // 10 days after report

      const placement = await prisma.placement.create({
        data: {
          code: `PL-P5REFPAUSE-${timestamp}`,
          vacancyId: koraVacancyId,
          jobSeekerId: js.id,
          businessId: (await prisma.vacancy.findUnique({ where: { id: koraVacancyId } }))!.businessId,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          status: 'dropped_out',
          eligibility: 'employee_left',
          dropoutReportedAt,
          clockPaused: true,
          clockPausedAt,
          replacementRejectionCount: 3,
        },
      });

      // Even at day 35 (2026-11-05), elapsed days are frozen at 10 (< 15)
      const res = await request(app.getHttpServer())
        .post(`/placements/${placement.id}/refund`)
        .set('Authorization', `Bearer ${ceoToken}`)
        .send({ asOf: '2026-11-05T00:00:00.000Z' })
        .expect(400);

      expect(res.body.message).toContain('not payable before 15 days');
      expect(res.body.message).toContain('days elapsed: 10');
    });
  });
});



