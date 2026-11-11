import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
import { FollowUpService } from '../follow-up/follow-up.service';
import { JobSeekerService } from './job-seeker.service';
import { loadJobSeekerRefundGuards } from './job-seeker-refund-guards';
import { recordRefundCheck } from '../../test-support/refund-check';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Master Guide rules for job seekers: a job found on his own, a number change, and the
 * full reset of the guarantee when he pays ₹499 again after 3 hits.
 */
describe('Job seeker rules from the Master Guide', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const callIds: string[] = [];
  let callAgentId: string;
  let ceoId: string;
  let callAgentToken: string;
  let ceoToken: string;
  let phoneSeq = 0;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const nextPhone = () => {
    phoneSeq += 1;
    return `+9194${String(Date.now()).slice(-6)}${String(phoneSeq).padStart(2, '0')}`;
  };

  async function createSeeker(data: Record<string, unknown> = {}) {
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-GR-${suffix}-${seekerIds.length}`,
        name: `Guide Rules Seeker ${seekerIds.length}`,
        phone: nextPhone(),
        phoneVerified: true,
        minSalary: 1600000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'active',
        registeredByStaffId: callAgentId,
        ...data,
      },
    });
    seekerIds.push(seeker.id);
    return seeker;
  }

  async function paidSeeker(daysAgo: number, data: Record<string, unknown> = {}) {
    const paidAt = new Date(Date.now() - daysAgo * DAY_MS);
    const seeker = await createSeeker({ paymentReceivedAt: paidAt, ...data });
    await prisma.payment.create({
      data: {
        code: `PAY-GR-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        type: 'activation',
        amount: 49900,
        status: 'succeeded',
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        jobSeekerId: seeker.id,
        createdAt: paidAt,
      },
    });
    return seeker;
  }

  async function answeredCall(jobSeekerId: string, purpose = 'follow_up', answered = true) {
    const call = await prisma.callRecord.create({
      data: {
        code: `CL-GR-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        provider: 'mock',
        providerCallId: `gr-${randomUUID()}`,
        direction: 'outbound',
        staffId: callAgentId,
        subjectType: 'job_seeker',
        subjectId: jobSeekerId,
        purpose,
        providerStatus: answered ? 'completed' : 'no_answer',
        answered,
        startedAt: new Date(),
      },
    });
    callIds.push(call.id);
    return call;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    const passwordHash = await bcrypt.hash('Guide-Rules-Password-1', 4);
    const createStaff = async (role: string, tag: string) => {
      const staff = await prisma.staff.create({
        data: {
          code: `GR-${tag}-${suffix}`,
          name: `Guide rules ${tag}`,
          email: `gr_${tag.toLowerCase()}_${suffix.toLowerCase()}@laboura.local`,
          passwordHash,
          role,
          status: 'active',
          city: 'Bengaluru',
        },
      });
      staffIds.push(staff.id);
      return { id: staff.id, token: jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email }) };
    };
    const callAgent = await createStaff('call_agent', 'CA');
    const ceo = await createStaff('ceo', 'CEO');
    callAgentId = callAgent.id;
    callAgentToken = callAgent.token;
    ceoId = ceo.id;
    ceoToken = ceo.token;
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.followUpTask.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.payment.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
    await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  describe('found a job on his own', () => {
    it('closes the profile with an audit entry, blocks the ₹499 refund, and he can come back by paying again', async () => {
      const seeker = await paidSeeker(35);
      const call = await answeredCall(seeker.id);

      await request(app.getHttpServer()).post(`/job-seekers/${seeker.id}/found-own-job`).set(auth(callAgentToken))
        .send({ reason: 'Working at a hotel he found himself' }).expect(400);
      const unanswered = await answeredCall(seeker.id, 'follow_up', false);
      await request(app.getHttpServer()).post(`/job-seekers/${seeker.id}/found-own-job`).set(auth(callAgentToken))
        .send({ reason: 'Working at a hotel', callRecordId: unanswered.id }).expect(400);

      const closed = await request(app.getHttpServer()).post(`/job-seekers/${seeker.id}/found-own-job`).set(auth(callAgentToken))
        .send({ reason: 'Working at a hotel he found himself', callRecordId: call.id }).expect(201);
      expect(closed.body.status).toBe('closed');
      expect(closed.body.foundOwnJobAt).toBeTruthy();
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'job_seeker.found_own_job', entityCode: seeker.code } });
      expect(audit.actorId).toBe(callAgentId);
      expect((audit.after as Record<string, unknown>).refund).toBe('blocked');

      await recordRefundCheck(prisma, seeker.id);
      const refused = await request(app.getHttpServer()).post(`/job-seekers/${seeker.id}/refund`).set(auth(ceoToken)).send({}).expect(400);
      expect(refused.body.message).toContain('found a job on his own');
      const due = await app.get(RefundService).getRefundsDue(ceoId);
      expect(due.some((row) => row.type === 'job_seeker' && row.id === seeker.id)).toBe(false);

      // Closing goes only through this action, never the plain status endpoint.
      const other = await createSeeker();
      await request(app.getHttpServer()).post(`/job-seekers/${other.id}/status`).set(auth(callAgentToken))
        .send({ status: 'closed' }).expect(400);

      // He can come back later by paying ₹499 again.
      const back = await request(app.getHttpServer()).post(`/job-seekers/${seeker.id}/reactivate`).set(auth(callAgentToken)).expect(201);
      expect(back.body.reactivation).toBe(true);
    });

    it("offers it on a 'working elsewhere' follow-up answer, and records it when asked", async () => {
      const followUps = app.get(FollowUpService);
      const makeTask = async (jobSeekerId: string) => prisma.followUpTask.create({
        data: {
          code: `FU-GR-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
          kind: 'not_selected_day_7',
          subjectType: 'job_seeker',
          subjectId: jobSeekerId,
          dueAt: new Date(),
          assignedStaffId: callAgentId,
          status: 'pending',
        },
      });

      const offered = await paidSeeker(10);
      const offeredTask = await makeTask(offered.id);
      const offeredCall = await answeredCall(offered.id);
      const offeredResult = await followUps.completeTask(offeredTask.id, { callRecordId: offeredCall.id, answer: 'working_elsewhere' }, callAgentId);
      expect(offeredResult).toMatchObject({ offerFoundOwnJob: true, foundOwnJobRecorded: false });
      expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: offered.id } })).status).toBe('active');

      const recorded = await paidSeeker(10);
      const recordedTask = await makeTask(recorded.id);
      const recordedCall = await answeredCall(recorded.id);
      const recordedResult = await followUps.completeTask(
        recordedTask.id,
        { callRecordId: recordedCall.id, answer: 'working_elsewhere', foundOwnJob: true, notes: 'Joined a bakery on his own' },
        callAgentId,
      );
      expect(recordedResult).toMatchObject({ foundOwnJobRecorded: true });
      const after = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: recorded.id } });
      expect(after.status).toBe('closed');
      expect(after.foundOwnJobAt).not.toBeNull();

      const notWorking = await paidSeeker(10);
      const notWorkingTask = await makeTask(notWorking.id);
      const notWorkingCall = await answeredCall(notWorking.id);
      await expect(followUps.completeTask(
        notWorkingTask.id,
        { callRecordId: notWorkingCall.id, answer: 'not_working', foundOwnJob: true },
        callAgentId,
      )).rejects.toThrow('working_elsewhere');
    });
  });

  describe('refund approval guards', () => {
    it("needs the refund-check call, and refuses when he said there he is working elsewhere", async () => {
      const seeker = await paidSeeker(35);
      const noCheck = await request(app.getHttpServer()).post(`/job-seekers/${seeker.id}/refund`).set(auth(ceoToken)).send({}).expect(400);
      expect(noCheck.body.message).toContain('refund-check call');

      await recordRefundCheck(prisma, seeker.id, 'working_elsewhere');
      const elsewhere = await request(app.getHttpServer()).post(`/job-seekers/${seeker.id}/refund`).set(auth(ceoToken)).send({}).expect(400);
      expect(elsewhere.body.message).toContain('working elsewhere');
    });

    it('applies the same guards when Finance approves a pending refund payment', async () => {
      const seeker = await paidSeeker(35);
      const refund = await prisma.payment.create({
        data: {
          code: `PAY-GR-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
          type: 'refund',
          amount: 49900,
          status: 'pending',
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          jobSeekerId: seeker.id,
        },
      });
      await expect(app.get(PaymentService).approvePayment(refund.id, ceoId)).rejects.toThrow('refund-check call');
      await recordRefundCheck(prisma, seeker.id);
      const approved = await app.get(PaymentService).approvePayment(refund.id, ceoId);
      expect(approved.status).toBe('approved');
    });
  });

  describe('changing his mobile number', () => {
    it('needs an OTP on the new number and switches off the live registration link', async () => {
      const seeker = await createSeeker({ status: 'consented' });
      const links = app.get(PublicLinkStoreService);
      await links.create({
        purpose: 'registration',
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        phone: seeker.phone,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        metadata: { resumable: true },
      });
      const newPhone = nextPhone();

      const noOtp = await request(app.getHttpServer()).patch(`/job-seekers/${seeker.id}`).set(auth(callAgentToken))
        .send({ phone: newPhone, reason: 'He has a new SIM' }).expect(400);
      expect(noOtp.body.message).toContain('OTP');

      // An OTP verified on the OLD number does not count.
      const oldOtp = await otp.sendOtp(seeker.phone);
      await otp.verifyOtp(oldOtp.requestId, (otp.getProvider() as MockOtpProvider).getCode(oldOtp.requestId)!);
      await request(app.getHttpServer()).patch(`/job-seekers/${seeker.id}`).set(auth(callAgentToken))
        .send({ phone: newPhone, reason: 'He has a new SIM', phoneOtpRequestId: oldOtp.requestId }).expect(400);

      const taken = await createSeeker();
      const takenOtp = await otp.sendOtp(taken.phone);
      await otp.verifyOtp(takenOtp.requestId, (otp.getProvider() as MockOtpProvider).getCode(takenOtp.requestId)!);
      const conflict = await request(app.getHttpServer()).patch(`/job-seekers/${seeker.id}`).set(auth(callAgentToken))
        .send({ phone: taken.phone, reason: 'Wrong number', phoneOtpRequestId: takenOtp.requestId }).expect(409);
      expect(conflict.body.existingJobSeekerCode).toBe(taken.code);

      const newOtp = await otp.sendOtp(newPhone);
      await otp.verifyOtp(newOtp.requestId, (otp.getProvider() as MockOtpProvider).getCode(newOtp.requestId)!);
      await request(app.getHttpServer()).patch(`/job-seekers/${seeker.id}`).set(auth(callAgentToken))
        .send({ phone: newPhone, reason: 'He has a new SIM', phoneOtpRequestId: newOtp.requestId }).expect(200);

      const stored = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } });
      expect(stored.phone).toBe(newPhone);
      expect(stored.phoneVerified).toBe(true);
      expect(await links.hasActive('registration', 'job_seeker', seeker.id)).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: 'job_seeker.phone_changed', entityCode: seeker.code } })).toBe(1);

      // The same verified OTP cannot be used twice.
      await request(app.getHttpServer()).patch(`/job-seekers/${seeker.id}`).set(auth(callAgentToken))
        .send({ phone: nextPhone(), reason: 'Again', phoneOtpRequestId: newOtp.requestId }).expect(400);
    });
  });

  describe('paying ₹499 again after 3 hits', () => {
    it('starts a fresh guarantee: earlier hits no longer count for hits, the refund or the refund check', async () => {
      const oldPaidAt = new Date(Date.now() - 60 * DAY_MS);
      const seeker = await createSeeker({ status: 'deactivated', hitCount: 3, paymentReceivedAt: oldPaidAt });
      for (const reason of ['offer_declined', 'interview_no_show', 'no_pickup']) {
        await prisma.jobSeekerHit.create({
          data: { jobSeekerId: seeker.id, reason, recordedBy: 'system', recordedAt: new Date(oldPaidAt.getTime() + DAY_MS) },
        });
      }
      await recordRefundCheck(prisma, seeker.id, 'not_working', new Date(oldPaidAt.getTime() + 28 * DAY_MS));

      const reactivation = await prisma.payment.create({
        data: {
          code: `PAY-GR-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
          type: 'activation',
          amount: 49900,
          status: 'pending',
          reactivation: true,
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          jobSeekerId: seeker.id,
        },
      });
      const confirmedAt = new Date();
      await app.get(PaymentService).onPaymentSucceeded(reactivation.id, { confirmedAt, confirmedBy: 'bank_feed' });

      const after = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } });
      expect(after).toMatchObject({ status: 'active', hitCount: 0 });
      expect(after.paymentReceivedAt?.getTime()).toBe(confirmedAt.getTime());
      const hits = await prisma.jobSeekerHit.findMany({ where: { jobSeekerId: seeker.id } });
      expect(hits).toHaveLength(3);
      expect(hits.every((hit) => hit.supersededAt?.getTime() === confirmedAt.getTime())).toBe(true);

      let guards = await loadJobSeekerRefundGuards(prisma, after);
      expect(guards.hasOfferRejectedHit).toBe(false);
      // The refund check from the earlier guarantee does not count for the new one.
      expect(guards.refundCheckRecorded).toBe(false);

      // Day 31 of the new guarantee: the old decline no longer blocks the refund.
      const newPaidAt = new Date(Date.now() - 31 * DAY_MS);
      await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { paymentReceivedAt: newPaidAt } });
      await prisma.payment.update({ where: { id: reactivation.id }, data: { createdAt: newPaidAt } });

      const sweepStartedAt = new Date();
      const created = await app.get(FollowUpService).createScheduledTasks(new Date());
      expect(created.created).toBeGreaterThanOrEqual(1);
      // The daily sweep also creates tasks for other suites' leftovers; remove those again.
      await prisma.followUpTask.deleteMany({
        where: { createdAt: { gte: sweepStartedAt }, subjectId: { notIn: seekerIds } },
      });
      const newCheck = await prisma.followUpTask.findFirstOrThrow({
        where: { subjectId: seeker.id, kind: 'refund_check', status: 'pending' },
      });
      await prisma.followUpTask.update({
        where: { id: newCheck.id },
        data: { status: 'done', answer: 'not_working', completedAt: new Date() },
      });

      guards = await loadJobSeekerRefundGuards(prisma, { id: seeker.id, paymentReceivedAt: newPaidAt });
      expect(guards).toMatchObject({ hasOfferRejectedHit: false, refundCheckRecorded: true });
      const refund = await app.get(JobSeekerService).approveRefund(seeker.id, {}, ceoId);
      expect(refund.amount).toBe(49900);
    });
  });
});
