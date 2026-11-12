import { BadRequestException, ConflictException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PlacementService } from '../placement/placement.service';
import { PaymentService } from './payment.service';
import { recordRefundCheck } from '../../test-support/refund-check';

/**
 * H2 (security check, 12 Nov): refunds, referral payouts and joining rewards were
 * "look, then create" with no lock, so a double tap or a retry created two. Each test
 * fires the same request several times at once against the real database and checks
 * that exactly one row exists afterwards; the others are refused (409, or 400 "already
 * issued" when they arrive after the first has finished) or return the existing row.
 */
describe('H2: one refund, referral payout and joining reward per subject, even under concurrent requests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let jobSeekers: JobSeekerService;
  let placements: PlacementService;
  let payments: PaymentService;

  const stamp = String(Date.now());
  const DAY = 24 * 60 * 60 * 1000;
  let seq = 0;
  const staffIds: Record<string, string> = {};
  const businessIds: string[] = [];
  const jobSeekerIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const referralIds: string[] = [];

  const tail = () => {
    seq += 1;
    return `${stamp.slice(-6)}${String(seq).padStart(2, '0')}`;
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    jobSeekers = app.get(JobSeekerService);
    placements = app.get(PlacementService);
    payments = app.get(PaymentService);

    for (const role of ['ceo', 'finance']) {
      const staff = await prisma.staff.create({
        data: {
          code: `H2-${role.toUpperCase()}-${stamp}`,
          name: `H2 ${role}`,
          email: `h2_${role}_${stamp}@laboura.local`,
          passwordHash: 'not-used',
          role,
          city: 'Bengaluru',
        },
      });
      staffIds[role] = staff.id;
    }
  }, 60000);

  afterAll(async () => {
    const ids = Object.values(staffIds);
    await prisma.payment.deleteMany({
      where: {
        OR: [
          { jobSeekerId: { in: jobSeekerIds } },
          { placementId: { in: placementIds } },
          { businessId: { in: businessIds } },
          { referralId: { in: referralIds } },
        ],
      },
    });
    await prisma.followUpTask.deleteMany({ where: { subjectId: { in: jobSeekerIds } } });
    await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.payoutAccount.deleteMany({ where: { ownerId: { in: [...businessIds, ...jobSeekerIds, ...referralIds] } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: jobSeekerIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  /** A paid job seeker whose 30 days ran out with no offer: a ₹499 refund is owed. */
  const refundOwedSeeker = async () => {
    const t = tail();
    const paidAt = new Date(Date.now() - 40 * DAY);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-H2-${stamp}-${seq}`,
        name: `H2 Seeker ${seq}`,
        phone: `+9196${t}`,
        phoneVerified: true,
        status: 'active',
        city: 'Bengaluru',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        paymentReceivedAt: paidAt,
      },
    });
    jobSeekerIds.push(seeker.id);
    await prisma.payment.create({
      data: {
        code: await idService.generateCode('payment'),
        type: 'activation',
        amount: 49900,
        status: 'succeeded',
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        jobSeekerId: seeker.id,
        confirmedAt: paidAt,
        createdAt: paidAt,
      },
    });
    await recordRefundCheck(prisma, seeker.id, 'not_working');
    return seeker;
  };

  /** A business, vacancy, candidate and placement. */
  const placementWith = async (opts: {
    status: string;
    placementFee?: number;
    dropoutReportedAt?: Date | null;
    joinedDate?: Date | null;
    referredById?: string | null;
  }) => {
    const t = tail();
    const business = await prisma.business.create({
      data: { code: `BZ-H2-${stamp}-${seq}`, name: `H2 Hotel ${seq}`, phone: `+9193${t}`, city: 'Bengaluru', verificationStatus: 'verified' },
    });
    businessIds.push(business.id);
    const candidate = await prisma.jobSeeker.create({
      data: {
        code: `JS-H2P-${stamp}-${seq}`,
        name: `H2 Candidate ${seq}`,
        phone: `+9194${t}`,
        phoneVerified: true,
        status: 'placed',
        city: 'Bengaluru',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        referredById: opts.referredById ?? null,
      },
    });
    jobSeekerIds.push(candidate.id);
    const vacancy = await prisma.vacancy.create({
      data: { code: await idService.generateCode('vacancy'), businessId: business.id, tradeSkill: 'cook', city: 'Bengaluru' },
    });
    vacancyIds.push(vacancy.id);
    const fee = opts.placementFee ?? 944000;
    const placement = await prisma.placement.create({
      data: {
        code: await idService.generateCode('placement'),
        vacancyId: vacancy.id,
        businessId: business.id,
        jobSeekerId: candidate.id,
        status: opts.status,
        agreedSalary: fee * 2,
        placementFee: fee,
        gstAmount: Math.round((fee * 18) / 100),
        city: 'Bengaluru',
        dropoutReportedAt: opts.dropoutReportedAt ?? null,
        paidAt: new Date(Date.now() - 60 * DAY),
        joinedDate: opts.joinedDate ?? null,
        feePercentAtCreation: 50,
        gstPercentAtCreation: 18,
      },
    });
    placementIds.push(placement.id);
    return { business, candidate, placement };
  };

  /**
   * Every request either succeeded or was refused as a duplicate, never anything else.
   * A request that starts after the first has finished is refused by the ordinary
   * checks (400): "already issued", or for a business refund the placement is no longer
   * dropped out because the refund ended its guarantee.
   */
  const expectRefusedAsDuplicates = (results: PromiseSettledResult<unknown>[], late: RegExp = /already/i) => {
    for (const r of results) {
      if (r.status === 'rejected') {
        const isDuplicate =
          r.reason instanceof ConflictException ||
          (r.reason instanceof BadRequestException && late.test(String(r.reason.message)));
        expect({ isDuplicate, reason: String(r.reason) }).toEqual({ isDuplicate: true, reason: expect.any(String) });
      }
    }
  };

  it('creates one ₹499 refund when Finance and the CEO approve it at the same moment', async () => {
    const seeker = await refundOwedSeeker();
    const results = await Promise.allSettled([
      jobSeekers.approveRefund(seeker.id, {}, staffIds.finance),
      jobSeekers.approveRefund(seeker.id, {}, staffIds.finance),
      jobSeekers.approveRefund(seeker.id, {}, staffIds.ceo),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expectRefusedAsDuplicates(results);
    const refunds = await prisma.payment.findMany({ where: { jobSeekerId: seeker.id, type: 'refund' } });
    expect(refunds).toHaveLength(1);
    const activation = await prisma.payment.findFirstOrThrow({ where: { jobSeekerId: seeker.id, type: 'activation' } });
    expect(refunds[0].refundsPaymentId).toBe(activation.id);
    expect(refunds[0].amount).toBe(49900);
  });

  it('answers a later repeat with 409 or "already issued" and still keeps one refund', async () => {
    const seeker = await refundOwedSeeker();
    await jobSeekers.approveRefund(seeker.id, {}, staffIds.finance);
    await expect(jobSeekers.approveRefund(seeker.id, {}, staffIds.finance)).rejects.toThrow(/already/i);
    expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id, type: 'refund' } })).toBe(1);
  });

  it('creates one business refund when Approve is tapped three times at once', async () => {
    const { placement } = await placementWith({ status: 'dropped_out', dropoutReportedAt: new Date(Date.now() - 20 * DAY) });
    const results = await Promise.allSettled([
      placements.approveRefund(placement.id, {}, staffIds.finance),
      placements.approveRefund(placement.id, {}, staffIds.finance),
      placements.approveRefund(placement.id, {}, staffIds.ceo),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expectRefusedAsDuplicates(results, /already|dropped_out/i);
    expect(await prisma.payment.count({ where: { placementId: placement.id, type: 'refund' } })).toBe(1);
  });

  it('creates one referral payout when the joined event fires twice at once, and both calls get the same payout', async () => {
    const t = tail();
    const referral = await prisma.referral.create({
      data: { code: `RF-H2-${stamp}-${seq}`, name: `H2 Partner ${seq}`, phone: `+9192${t}`, phoneVerified: true, city: 'Bengaluru' },
    });
    referralIds.push(referral.id);
    const { placement } = await placementWith({ status: 'confirmed', referredById: referral.id });
    const results = await Promise.all([
      payments.createReferralPayout(placement.id, staffIds.ceo),
      payments.createReferralPayout(placement.id, staffIds.ceo),
      payments.createReferralPayout(placement.id),
    ]);
    const rows = await prisma.payment.findMany({ where: { placementId: placement.id, type: 'referral_payout' } });
    expect(rows).toHaveLength(1);
    for (const r of results) expect(r?.id).toBe(rows[0].id);
  });

  it('queues one joining reward when the job runs twice at once', async () => {
    const { placement } = await placementWith({ status: 'active', joinedDate: new Date(Date.now() - 31 * DAY) });
    const results = await Promise.all([
      placements.createJoiningReward(placement, 20000),
      placements.createJoiningReward(placement, 20000),
      placements.createJoiningReward(placement, 20000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.payment.count({ where: { placementId: placement.id, type: 'joining_reward' } })).toBe(1);
  });

  it('has the database refuse a second live joining reward, referral payout or business refund for one placement', async () => {
    const { placement, candidate } = await placementWith({ status: 'active' });
    const row = async (type: string, status: string) =>
      prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type,
          amount: 20000,
          status,
          subjectType: 'placement',
          subjectId: placement.id,
          placementId: placement.id,
          jobSeekerId: type === 'refund' ? null : candidate.id,
        },
      });
    for (const type of ['joining_reward', 'referral_payout', 'refund']) {
      await row(type, 'approved');
      const second = row(type, 'pending');
      await expect(second).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      await expect(second).rejects.toMatchObject({ code: 'P2002' });
      // One the CEO turned down never blocks a new one.
      await prisma.payment.updateMany({ where: { placementId: placement.id, type }, data: { status: 'rejected' } });
      await expect(row(type, 'pending')).resolves.toBeDefined();
    }
  });

  it('has the database refuse a second live refund of the same ₹499', async () => {
    const seeker = await refundOwedSeeker();
    const activation = await prisma.payment.findFirstOrThrow({ where: { jobSeekerId: seeker.id, type: 'activation' } });
    const refund = async (status: string) =>
      prisma.payment.create({
        data: {
          code: await idService.generateCode('payment'),
          type: 'refund',
          amount: 49900,
          status,
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          jobSeekerId: seeker.id,
          refundsPaymentId: activation.id,
        },
      });
    await refund('failed');
    await expect(refund('approved')).rejects.toMatchObject({ code: 'P2002' });
  });
});
