import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { JobSeekerService } from './job-seeker.service';
import { JobSeekerFlowService, ID_CHECK_REMINDERS_MAX } from './job-seeker-flow.service';
import { PaymentService } from '../payment/payment.service';
import { MatchingService } from '../vacancy/matching.service';
import { RefundService } from '../refund/refund.service';
import { ConsentService } from '../consent/consent.service';
import { DEFAULT_NOTICE_VERSION, JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from '../consent/consent.constants';
import { contactPhoneHash } from '../message/messaging.service';
import { assistedActivations } from '../signup-tracker/signup-credit';
import { recordRefundCheck } from '../../test-support/refund-check';

jest.setTimeout(180000);

/**
 * Master Guide rev 211 ("Decided 25 Nov"): Consent → Selfie → Payment → ID check. Paid with no passed
 * ID check he is "Paid, waiting for ID" (no matching, no offers, no hits, no clock); the 30 days start
 * at the later of the payment and the ID pass; reminders; a refund before a passed ID check only on
 * request (to whoever paid, never for a forged ID); the agent's credit when the 30 days start.
 */
describe('Job seeker order Consent → Selfie → Payment → ID check (rev 211)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let jobSeekers: JobSeekerService;
  let flow: JobSeekerFlowService;
  let payments: PaymentService;
  let jwt: JwtService;
  const stamp = String(Date.now());
  const DAY = 24 * 60 * 60 * 1000;
  let seq = 0;
  const seekerIds: string[] = [];
  const staff: Record<string, { id: string; code: string; role: string }> = {};

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    jobSeekers = app.get(JobSeekerService);
    flow = app.get(JobSeekerFlowService);
    payments = app.get(PaymentService);
    jwt = app.get(JwtService);
    for (const role of ['ceo', 'finance', 'manager', 'call_agent']) {
      const row = await prisma.staff.create({
        data: { code: `F25-${role.toUpperCase()}-${stamp}`, name: `Flow ${role}`, email: `f25-${role}-${stamp}@laboura.local`, passwordHash: 'x', role, city: 'Bengaluru' },
      });
      staff[role] = { id: row.id, code: row.code, role };
    }
  }, 60000);

  afterAll(async () => {
    const ids = seekerIds;
    await prisma.notification.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.contactBlock.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.permanentBan.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { jobSeekerId: { in: ids } } });
    await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: ids } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.followUpTask.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.jobSeekerHit.deleteMany({ where: { jobSeekerId: { in: ids } } });
    await prisma.signupTracker.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: ids } } });
    const staffIds = Object.values(staff).map((s) => s.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const token = (who: keyof typeof staff) => jwt.sign({ sub: staff[who].id, email: `${staff[who].id}@laboura.local`, role: staff[who].role, code: staff[who].code });

  async function seeker(data: { status?: string; paymentReceivedAt?: Date | null; guaranteeStartsAt?: Date | null; registeredByStaffId?: string | null } = {}) {
    seq += 1;
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-F25-${stamp}-${seq}`,
        name: `Flow Seeker ${seq}`,
        phone: `+9196${stamp.slice(-6)}${String(seq).padStart(2, '0')}`,
        phoneVerified: true,
        status: data.status ?? 'consented',
        city: 'Bengaluru',
        minSalary: 1500000,
        maxSalary: 2500000,
        guaranteeFloorPaise: 1500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        paymentReceivedAt: data.paymentReceivedAt ?? null,
        guaranteeStartsAt: data.guaranteeStartsAt ?? null,
        registeredByStaffId: data.registeredByStaffId ?? null,
      },
    });
    seekerIds.push(row.id);
    return row;
  }

  async function pendingActivation(jobSeekerId: string) {
    return prisma.payment.create({
      data: { code: await idService.generateCode('payment'), type: 'activation', amount: 49900, expectedAmountPaise: 49900, status: 'pending', subjectType: 'job_seeker', subjectId: jobSeekerId, jobSeekerId },
    });
  }

  async function passedId(jobSeekerId: string, verifiedAt: Date) {
    await prisma.identityVerification.create({
      data: { jobSeekerId, method: 'pan', vendor: 'team_lead_check', status: 'verified', last4: '234F', nameMatches: true, isAdult: true, verifiedAt },
    });
  }

  /** A job seeker paid `daysAgo` days ago with no passed ID check: "paid, waiting for ID". */
  async function paidWaiting(daysAgo = 2) {
    const s = await seeker();
    const pay = await pendingActivation(s.id);
    const paidAt = new Date(Date.now() - daysAgo * DAY);
    await payments.onPaymentSucceeded(pay.id, { confirmedAt: paidAt, confirmedBy: 'bank_feed', bankUtr: `UTRF25${stamp}${seq}` });
    return { seeker: s, payment: pay, paidAt };
  }

  // ------------------------------------------------------------- the 30-day start

  it('pay first, ID later: "paid, waiting for ID" until the ID passes, then the 30 days start at the ID pass', async () => {
    const { seeker: s, payment, paidAt } = await paidWaiting(3);
    const waiting = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: s.id } });
    expect(waiting).toMatchObject({ status: 'paid_waiting_id', guaranteeStartsAt: null });
    expect(waiting.paymentReceivedAt?.getTime()).toBe(paidAt.getTime());
    expect(await prisma.statusHistory.count({ where: { subjectId: s.id, toStatus: 'paid_waiting_id', reason: 'paid_waiting_for_id' } })).toBe(1);
    // "Payment received, only your ID check is left" with his link, once for this payment.
    const received = await prisma.messageLog.findMany({ where: { subjectId: s.id, template: 'payment_received_id_left', relatedId: payment.id, status: { not: 'failed' } } });
    expect(received).toHaveLength(1);
    expect(received[0].channel).toBe('whatsapp');

    const idAt = new Date();
    await passedId(s.id, idAt);
    expect(await flow.afterIdPassed(s.id, null, idAt)).toBe(true);
    const active = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: s.id } });
    expect(active.status).toBe('active');
    expect(active.guaranteeStartsAt?.getTime()).toBe(idAt.getTime());
    expect(await prisma.messageLog.count({ where: { subjectId: s.id, template: 'guarantee_started', status: { not: 'failed' } } })).toBe(1);
    // A second pass changes nothing.
    expect(await flow.afterIdPassed(s.id, null, new Date())).toBe(false);
  });

  it('ID first (a field agent in person), payment later: active at once, the 30 days start at the payment', async () => {
    const s = await seeker();
    await passedId(s.id, new Date(Date.now() - 5 * DAY));
    const pay = await pendingActivation(s.id);
    const paidAt = new Date(Date.now() - DAY);
    await payments.onPaymentSucceeded(pay.id, { confirmedAt: paidAt, confirmedBy: 'bank_feed', bankUtr: `UTRF25B${stamp}` });
    const after = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe('active');
    expect(after.guaranteeStartsAt?.getTime()).toBe(paidAt.getTime());
    expect(await prisma.messageLog.count({ where: { subjectId: s.id, template: 'guarantee_started', relatedId: pay.id } })).toBeGreaterThan(0);
    expect(await prisma.messageLog.count({ where: { subjectId: s.id, template: 'payment_received_id_left' } })).toBe(0);
  });

  it('a payment needs no ID check any more, but an under-18 date of birth still stops it', async () => {
    const s = await seeker();
    await expect(jobSeekers.assertIdReadyForPayment({ id: s.id, dateOfBirth: null })).resolves.toBeUndefined();
    await expect(jobSeekers.assertIdReadyForPayment({ id: s.id, dateOfBirth: new Date(Date.now() - 16 * 365 * DAY) })).rejects.toThrow(/under 18/);
  });

  // ------------------------------------------------------------- not active while waiting

  it('while waiting for the ID: not matched, no hits, no day-30 refund, not on the refunds-due list', async () => {
    const { seeker: s } = await paidWaiting(40);
    expect((await app.get(MatchingService).jobsForSeeker(s.id, { page: 1 })).blockedReason).toBe('not_active');
    await expect(jobSeekers.recordHit(s.id, 'offer_declined', undefined, 'system', 'system')).rejects.toThrow(/waiting for the ID check/);
    expect(await prisma.jobSeekerHit.count({ where: { jobSeekerId: s.id } })).toBe(0);
    await recordRefundCheck(prisma, s.id, 'not_working');
    await expect(jobSeekers.approveRefund(s.id, {}, staff.finance.id)).rejects.toThrow(/30 days have not started/);
    const due = await app.get(RefundService).getRefundsDue(staff.ceo.id);
    expect(due.some((row) => row.type === 'job_seeker' && row.id === s.id)).toBe(false);
    // Nobody makes him active by hand: only the ID check does.
    await expect(jobSeekers.transitionStatus(s.id, 'active', staff.ceo.id)).rejects.toThrow(/ID check passes/);
  });

  // ------------------------------------------------------------- messages

  it('consent and selfie done: "your details are saved, next pay ₹499" with his link, once', async () => {
    const s = await seeker();
    for (const purpose of JOB_SEEKER_REQUIRED_CONSENT_PURPOSES) {
      await app.get(ConsentService).grant({ subjectType: 'job_seeker', subjectId: s.id, purpose, noticeVersion: DEFAULT_NOTICE_VERSION, language: 'en', method: 'sms_link' });
    }
    await flow.afterSelfie({ jobSeekerId: s.id, now: new Date() });
    await flow.afterSelfie({ jobSeekerId: s.id, now: new Date() });
    const rows = await prisma.messageLog.findMany({ where: { subjectId: s.id, template: 'details_saved_pay_next', status: { not: 'failed' } } });
    expect(rows).toHaveLength(1);
    expect(await prisma.publicLink.count({ where: { subjectId: s.id, purpose: 'registration' } })).toBe(1);
    // Without full consent nothing goes.
    const partial = await seeker();
    await flow.afterSelfie({ jobSeekerId: partial.id, now: new Date() });
    expect(await prisma.messageLog.count({ where: { subjectId: partial.id, template: 'details_saved_pay_next' } })).toBe(0);
  });

  it('a failed ID check of a paid job seeker tells him what went wrong and how to ask for a refund (never before payment)', async () => {
    const { seeker: s } = await paidWaiting(1);
    const failed = await prisma.identityVerification.create({
      data: { jobSeekerId: s.id, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', status: 'failed', nameMatches: false, isAdult: true, failureReason: 'Name on the Aadhaar does not match the registered name' },
    });
    await flow.afterIdFailed({ jobSeekerId: s.id, verificationId: failed.id, result: 'name_mismatch', now: new Date() });
    await flow.afterIdFailed({ jobSeekerId: s.id, verificationId: failed.id, result: 'name_mismatch', now: new Date() });
    expect(await prisma.messageLog.count({ where: { subjectId: s.id, template: 'id_check_failed_refund', status: { not: 'failed' } } })).toBe(1);
    const unpaid = await seeker();
    await flow.afterIdFailed({ jobSeekerId: unpaid.id, verificationId: failed.id, result: 'under_18', now: new Date() });
    expect(await prisma.messageLog.count({ where: { subjectId: unpaid.id, template: 'id_check_failed_refund' } })).toBe(0);
  });

  it('reminders: one a day, at most 3, 9 AM–9 PM only, not while the Team Lead checks, not to "do not call"', async () => {
    const { seeker: s, paidAt } = await paidWaiting(1);
    const atIst = (dayOffset: number, istHour: number) => {
      const d = new Date(paidAt.getTime() + dayOffset * DAY);
      d.setUTCHours(istHour - 5, 30, 0, 0); // IST = UTC + 5:30
      return d;
    };
    const count = () => prisma.messageLog.count({ where: { subjectId: s.id, template: 'id_check_reminder', status: { not: 'failed' } } });
    // 10 PM IST: quiet hours.
    expect(await flow.sendIdCheckReminders(atIst(1, 22))).toMatchObject({ sent: 0, quietHours: true });
    await flow.sendIdCheckReminders(atIst(1, 10));
    expect(await count()).toBe(1);
    // Later the same day: nothing more.
    await flow.sendIdCheckReminders(atIst(1, 15));
    expect(await count()).toBe(1);
    await flow.sendIdCheckReminders(atIst(2, 11));
    await flow.sendIdCheckReminders(atIst(3, 11));
    expect(await count()).toBe(ID_CHECK_REMINDERS_MAX);
    // Then nothing more by itself.
    await flow.sendIdCheckReminders(atIst(4, 11));
    await flow.sendIdCheckReminders(atIst(5, 11));
    expect(await count()).toBe(3);

    // Another ID waiting for the Team Lead: nothing for him to do, no reminder.
    const { seeker: tl, paidAt: tlPaid } = await paidWaiting(1);
    await prisma.identityVerification.create({ data: { jobSeekerId: tl.id, method: 'pan', vendor: 'team_lead_check', status: 'pending' } });
    await flow.sendIdCheckReminders(new Date(tlPaid.getTime() + 2 * DAY));
    expect(await prisma.messageLog.count({ where: { subjectId: tl.id, template: 'id_check_reminder' } })).toBe(0);
    // "Do not call": nothing.
    const { seeker: dnc, paidAt: dncPaid } = await paidWaiting(1);
    await prisma.contactBlock.create({
      data: { subjectType: 'job_seeker', subjectId: dnc.id, kind: 'do_not_call', phoneHash: contactPhoneHash(dnc.phone), byStaffId: staff.call_agent.id, liveKey: `job_seeker|${dnc.id}|do_not_call` },
    });
    const noon = new Date(dncPaid.getTime() + 2 * DAY);
    noon.setUTCHours(6, 30, 0, 0);
    await flow.sendIdCheckReminders(noon);
    expect(await prisma.messageLog.count({ where: { subjectId: dnc.id, template: 'id_check_reminder', status: { not: 'blocked' } } })).toBe(0);
  });

  // ------------------------------------------------------------- refund before a passed ID check

  it('"Refund requested by the job seeker (ID not verified)": Finance records it, full ₹499, he leaves the pool; never twice', async () => {
    const { seeker: s, payment } = await paidWaiting(2);
    const refund = await jobSeekers.approveRefund(s.id, { idNotVerified: true, reason: 'He asked on the phone' }, staff.finance.id);
    expect(refund).toMatchObject({ type: 'refund', status: 'approved', amount: 49900, refundKind: 'id_not_verified', refundsPaymentId: payment.id, refundPayerLinkId: null, refundTo: { kind: 'job_seeker' } });
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('refunded');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'refund_approved', entityCode: s.code } });
    expect(audit?.reason).toContain('Refund requested by the job seeker (ID not verified)');
    await expect(jobSeekers.approveRefund(s.id, { idNotVerified: true }, staff.finance.id)).rejects.toThrow();
    expect(await prisma.payment.count({ where: { jobSeekerId: s.id, type: 'refund' } })).toBe(1);
  });

  it('the refund goes back to whoever paid: a payment-only link payer who verified his number', async () => {
    const { seeker: s, payment } = await paidWaiting(2);
    const link = await prisma.publicLink.create({
      data: {
        tokenHash: `f25-${stamp}-${seq}-payer`, purpose: 'payment_only', subjectType: 'job_seeker', subjectId: s.id, phone: '+919812345678',
        expiresAt: new Date(Date.now() + DAY), metadata: { paymentId: payment.id, relation: 'brother', payerVerifiedAt: new Date().toISOString() },
      },
    });
    const refund = await jobSeekers.approveRefund(s.id, { idNotVerified: true }, staff.ceo.id);
    expect(refund).toMatchObject({ refundPayerLinkId: link.id, refundTo: { kind: 'other_payer', maskedPhone: '******5678', relation: 'brother' } });
  });

  it('no refund for a forged ID (permanent ban, forged_id), none while a Team Lead\'s "fake" flag waits, none once the ID passed', async () => {
    const { seeker: forged } = await paidWaiting(2);
    await prisma.permanentBan.create({
      data: { subjectType: 'job_seeker', subjectId: forged.id, subjectCode: forged.code, category: 'forged_id', reason: 'Altered PAN', phoneHash: contactPhoneHash(forged.phone), bannedByStaffId: staff.manager.id, bannedAt: new Date() },
    });
    await expect(jobSeekers.approveRefund(forged.id, { idNotVerified: true }, staff.ceo.id)).rejects.toThrow(/forged or altered ID/);

    const { seeker: flagged } = await paidWaiting(2);
    await prisma.reviewFlag.create({ data: { code: `FLG-F25-${stamp}`, kind: 'registration_suspect', subjectType: 'job_seeker', subjectId: flagged.id, status: 'open', details: {} } });
    await expect(jobSeekers.approveRefund(flagged.id, { idNotVerified: true }, staff.ceo.id)).rejects.toThrow(/decides first whether it was forged/);

    const { seeker: passed } = await paidWaiting(3);
    await passedId(passed.id, new Date(Date.now() - 2 * DAY));
    expect(await flow.afterIdPassed(passed.id, null, new Date(Date.now() - 2 * DAY))).toBe(true);
    await expect(jobSeekers.approveRefund(passed.id, { idNotVerified: true }, staff.ceo.id)).rejects.toThrow(/day-30 refund rules apply/);
    expect(await prisma.payment.count({ where: { jobSeekerId: { in: [forged.id, flagged.id, passed.id] }, type: 'refund' } })).toBe(0);
  });

  it('only the CEO and Finance record it (POST /job-seekers/:id/refund with idNotVerified)', async () => {
    const { seeker: s } = await paidWaiting(2);
    await request(app.getHttpServer()).post(`/job-seekers/${s.id}/refund`).set('Authorization', `Bearer ${token('manager')}`).send({ idNotVerified: true }).expect(403);
    await request(app.getHttpServer()).post(`/job-seekers/${s.id}/refund`).set('Authorization', `Bearer ${token('call_agent')}`).send({ idNotVerified: true }).expect(403);
    expect(await prisma.payment.count({ where: { jobSeekerId: s.id, type: 'refund' } })).toBe(0);
  });

  // ------------------------------------------------------------- the agent's credit

  it('an assisted app sign-up credits the agent when the 30 days start, not at payment', async () => {
    const agent = staff.call_agent.id;
    const from = new Date(Date.now() - 10 * DAY);
    const to = new Date(Date.now() + DAY);
    const s = await seeker({ status: 'paid_waiting_id', paymentReceivedAt: new Date(Date.now() - 2 * DAY) });
    await prisma.signupTracker.create({
      data: { profileKind: 'job_seeker', subjectType: 'job_seeker', subjectId: s.id, outcome: 'assisted', assignedStaffId: agent, assignedAt: new Date(Date.now() - 5 * DAY), stage: 'E', stageReachedAt: new Date(), lastActivityAt: new Date() },
    });
    expect(await assistedActivations(prisma, agent, from, to)).toBe(0);
    await prisma.jobSeeker.update({ where: { id: s.id }, data: { status: 'active', guaranteeStartsAt: new Date() } });
    expect(await assistedActivations(prisma, agent, from, to)).toBe(1);
  });
});
