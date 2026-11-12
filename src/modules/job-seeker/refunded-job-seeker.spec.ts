import { ConflictException, ForbiddenException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { JobSeekerService } from './job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { MatchingService } from '../vacancy/matching.service';
import { RefundService } from '../refund/refund.service';
import { recordRefundCheck } from '../../test-support/refund-check';

/**
 * A refunded job seeker (guide check 12 Nov, finding 5): when his ₹499 is refunded
 * he leaves the matching pool, and he can register and pay again (reactivate from
 * "refunded"), so the win-back list (N5) works. Paying ₹499 again resets the hits
 * and starts a new 30-day guarantee (Master Guide), which can end in a refund of its own.
 * The CEO (never Finance) can also give a ₹499 refund outside the rules (goodwill),
 * with a written reason, audited.
 */
describe('A refunded job seeker leaves the pool and can pay again', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let jobSeekers: JobSeekerService;
  let payments: PaymentService;
  let matching: MatchingService;

  const stamp = String(Date.now());
  const DAY = 24 * 60 * 60 * 1000;
  let seq = 0;
  const seekerIds: string[] = [];
  let ceoId = '';
  let financeId = '';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    jobSeekers = app.get(JobSeekerService);
    payments = app.get(PaymentService);
    matching = app.get(MatchingService);
    for (const role of ['ceo', 'finance']) {
      const staff = await prisma.staff.create({
        data: { code: `RFS-${role.toUpperCase()}-${stamp}`, name: `Refunded ${role}`, email: `rfs-${role}-${stamp}@laboura.local`, passwordHash: 'x', role, city: 'Bengaluru' },
      });
      if (role === 'ceo') ceoId = staff.id;
      else financeId = staff.id;
    }
  }, 60000);

  afterAll(async () => {
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.payment.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.followUpTask.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.payoutAccount.deleteMany({ where: { ownerId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [ceoId, financeId] } } });
    await prisma.staff.deleteMany({ where: { id: { in: [ceoId, financeId] } } });
    await app.close();
  });

  /** An active job seeker who paid `daysAgo` days ago, with his refund check recorded. */
  const paidSeeker = async (daysAgo: number) => {
    seq += 1;
    const paidAt = new Date(Date.now() - daysAgo * DAY);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-RFS-${stamp}-${seq}`,
        name: `Refunded Seeker ${seq}`,
        phone: `+9195${stamp.slice(-6)}${String(seq).padStart(2, '0')}`,
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
    seekerIds.push(seeker.id);
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

  it('moves him to "refunded" when the refund is approved, so matching no longer offers him', async () => {
    const seeker = await paidSeeker(35);
    expect((await matching.jobsForSeeker(seeker.id, { page: 1 })).blockedReason).not.toBe('not_active');

    await jobSeekers.approveRefund(seeker.id, {}, financeId);

    const after = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } });
    expect(after.status).toBe('refunded');
    const history = await prisma.statusHistory.findFirst({ where: { subjectType: 'job_seeker', subjectId: seeker.id, toStatus: 'refunded' } });
    expect(history).toMatchObject({ fromStatus: 'active', reason: 'refund_approved' });
    expect((await matching.jobsForSeeker(seeker.id, { page: 1 })).blockedReason).toBe('not_active');
    // Not listed as owed again, and the refund cannot be approved twice.
    const due = await app.get(RefundService).getRefundsDue(ceoId);
    expect(due.some((row) => row.type === 'job_seeker' && row.id === seeker.id)).toBe(false);
    await expect(jobSeekers.approveRefund(seeker.id, {}, ceoId)).rejects.toThrow(/already been issued/);
  });

  it('also leaves the pool when Finance approves a pending refund payment', async () => {
    const seeker = await paidSeeker(35);
    const pending = await prisma.payment.create({
      data: { code: await idService.generateCode('payment'), type: 'refund', amount: 49900, status: 'pending', subjectType: 'job_seeker', subjectId: seeker.id, jobSeekerId: seeker.id },
    });
    await payments.approvePayment(pending.id, financeId);
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('refunded');
  });

  it('lets him pay ₹499 again: hits reset, a new 30-day clock, and that guarantee can end in a refund of its own', async () => {
    const seeker = await paidSeeker(80);
    // A hit from his first guarantee.
    await prisma.jobSeekerHit.create({ data: { jobSeekerId: seeker.id, reason: 'no_pickup', recordedBy: 'system', recordedAt: new Date(Date.now() - 70 * DAY) } });
    await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { hitCount: 1 } });
    const first = await jobSeekers.approveRefund(seeker.id, {}, financeId);
    // Refunded on day 35 of the first guarantee.
    await prisma.payment.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 45 * DAY) } });

    // A plain new payment is refused: he comes back through reactivation.
    await expect(jobSeekers.createActivationPayment(seeker.id)).rejects.toThrow(/reactivate/);
    const back = await jobSeekers.reactivate(seeker.id, ceoId);
    expect(back).toMatchObject({ reactivation: true, amountPaise: 49900 });

    // The ₹499 arrives 40 days ago.
    const paidAgainAt = new Date(Date.now() - 40 * DAY);
    await payments.onPaymentSucceeded(back.paymentId, { confirmedAt: paidAgainAt, confirmedBy: 'bank_feed', bankUtr: `UTR${stamp}${seq}` });
    const active = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } });
    expect(active).toMatchObject({ status: 'active', hitCount: 0 });
    expect(active.paymentReceivedAt?.getTime()).toBe(paidAgainAt.getTime());
    const hits = await prisma.jobSeekerHit.findMany({ where: { jobSeekerId: seeker.id } });
    expect(hits.every((h) => h.supersededAt !== null)).toBe(true);
    expect((await matching.jobsForSeeker(seeker.id, { page: 1 })).blockedReason).not.toBe('not_active');

    // His new 30 days ran out with no offer: the new ₹499 is refunded.
    await recordRefundCheck(prisma, seeker.id, 'not_working');
    const second = await jobSeekers.approveRefund(seeker.id, {}, financeId);
    expect(second.refundsPaymentId).toBe(back.paymentId);
    expect(second.id).not.toBe(first.id);
    expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id, type: 'refund' } })).toBe(2);
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('refunded');
  });

  describe('goodwill ₹499 refund (outside the rules)', () => {
    it('is the CEO\'s alone: Finance is refused and nothing is created', async () => {
      const seeker = await paidSeeker(10);
      const refused = jobSeekers.approveRefund(seeker.id, { goodwill: true, reason: 'Promised on the call' }, financeId);
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toMatchObject({ response: { code: 'goodwill_needs_ceo' } });
      expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id, type: 'refund' } })).toBe(0);
      expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('active');
    });

    it('needs a written reason', async () => {
      const seeker = await paidSeeker(10);
      await expect(jobSeekers.approveRefund(seeker.id, { goodwill: true }, ceoId)).rejects.toThrow(/written reason/);
      await expect(jobSeekers.approveRefund(seeker.id, { goodwill: true, reason: '   ' }, ceoId)).rejects.toThrow(/written reason/);
    });

    it('lets the CEO refund the ₹499 the rules do not allow, audited with the reason, once', async () => {
      // Day 10 of his guarantee: under the rules no refund is due yet.
      const seeker = await paidSeeker(10);
      await expect(jobSeekers.approveRefund(seeker.id, {}, ceoId)).rejects.toThrow(/30 days/);

      const refund = await jobSeekers.approveRefund(seeker.id, { goodwill: true, reason: 'Family emergency, leaving Bengaluru' }, ceoId);
      expect(refund).toMatchObject({ type: 'refund', amount: 49900, status: 'approved', approvedByStaffId: ceoId, outsideRules: true, approvalNote: 'Family emergency, leaving Bengaluru' });
      const activation = await prisma.payment.findFirstOrThrow({ where: { jobSeekerId: seeker.id, type: 'activation' } });
      expect(refund.refundsPaymentId).toBe(activation.id);
      expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('refunded');

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'refund_approved', entityCode: seeker.code, actorId: ceoId } });
      expect(audit.reason).toBe('Family emergency, leaving Bengaluru');
      expect(audit.after).toMatchObject({ paymentId: refund.id, outsideRules: true, approvedByRole: 'ceo', amount: 49900 });
      const history = await prisma.statusHistory.findFirstOrThrow({ where: { subjectType: 'payment', subjectId: refund.id } });
      expect(history.reason).toBe('goodwill_refund_approved_by_ceo');

      // Never twice for the same ₹499.
      await expect(
        jobSeekers.approveRefund(seeker.id, { goodwill: true, reason: 'Again' }, ceoId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.payment.count({ where: { jobSeekerId: seeker.id, type: 'refund' } })).toBe(1);
    });

    it('refuses a goodwill refund to someone who never paid', async () => {
      seq += 1;
      const unpaid = await prisma.jobSeeker.create({
        data: {
          code: `JS-RFS-${stamp}-${seq}`, name: 'Unpaid', phone: `+9195${stamp.slice(-6)}${String(seq).padStart(2, '0')}`,
          status: 'lead', city: 'Bengaluru', minSalary: 1500000, maxSalary: 2500000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
        },
      });
      seekerIds.push(unpaid.id);
      await expect(jobSeekers.approveRefund(unpaid.id, { goodwill: true, reason: 'x' }, ceoId)).rejects.toThrow(/no ₹499 received/);
    });
  });

  it('tells the guarantees apart by link, not by time: a re-pay the same day as the refund', async () => {
    const seeker = await paidSeeker(35);
    const first = await jobSeekers.approveRefund(seeker.id, {}, financeId);
    const back = await jobSeekers.reactivate(seeker.id, ceoId);
    // The bank's time for the new ₹499 is an hour before the refund row was made.
    const paidAgainAt = new Date(first.createdAt.getTime() - 60 * 60 * 1000);
    await payments.onPaymentSucceeded(back.paymentId, { confirmedAt: paidAgainAt, confirmedBy: 'bank_feed', bankUtr: `UTRS${stamp}${seq}` });
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('active');
    // The old refund names the old ₹499, so it is not this guarantee's: a refund of the
    // new ₹499 is still possible (here a CEO goodwill refund, as the 30 days are not over).
    const second = await jobSeekers.approveRefund(seeker.id, { goodwill: true, reason: 'Paid twice by mistake the same day' }, ceoId);
    expect(second.refundsPaymentId).toBe(back.paymentId);
    expect(first.refundsPaymentId).not.toBe(back.paymentId);
  });

  it('cannot be got round by a plain status change', async () => {
    const seeker = await paidSeeker(35);
    await expect(jobSeekers.transitionStatus(seeker.id, 'refunded', ceoId)).rejects.toThrow(/only when his ₹499 refund is approved/);
    await expect(jobSeekers.transitionStatus(seeker.id, 'deactivated', ceoId)).rejects.toThrow(/third hit/);
    await jobSeekers.approveRefund(seeker.id, {}, financeId);
    await expect(jobSeekers.transitionStatus(seeker.id, 'active', ceoId)).rejects.toThrow(/pays ₹499 again/);
    for (const status of ['deactivated', 'closed']) {
      await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { status } });
      await expect(jobSeekers.transitionStatus(seeker.id, 'active', ceoId)).rejects.toThrow(/pays ₹499 again/);
    }
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } })).status).toBe('closed');
  });

  it('still refuses to reactivate someone who is active', async () => {
    const seeker = await paidSeeker(5);
    await expect(jobSeekers.reactivate(seeker.id, ceoId)).rejects.toThrow(/deactivated, closed or refunded/);
  });
});
