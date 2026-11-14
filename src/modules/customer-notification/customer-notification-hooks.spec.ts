import { CustomerNotificationHooks } from './customer-notification-hooks.service';
import { CustomerPushJob, CUSTOMER_PUSH_ROUND } from '../../jobs/customer-push.job';
import { CUSTOMER_PUSH_CHECK_RECEIPTS, CUSTOMER_PUSH_SEND_NOW, RECEIPT_CHECK_DELAY_MS } from './customer-notification.constants';

/**
 * The existing events, turned into app notifications: each hook looks up its
 * record, picks the right event and recipient, and never throws into the
 * service that called it.
 */
function build(rows: Record<string, unknown>) {
  const notify = jest.fn().mockResolvedValue({ inbox: 1, queued: 1, held: 0, skipped: [] });
  const prisma = {
    pricingPolicy: { findFirst: jest.fn().mockResolvedValue({ jobSeekerGuaranteeDays: 30 }) },
    payment: { findUnique: jest.fn().mockResolvedValue(rows.payment ?? null) },
    interview: { findUnique: jest.fn().mockResolvedValue(rows.interview ?? null) },
    visitAssignment: { findUnique: jest.fn().mockResolvedValue(rows.visitAssignment ?? null) },
    business: { findUnique: jest.fn().mockResolvedValue(rows.business ?? null) },
    vacancy: { findUnique: jest.fn().mockResolvedValue(rows.vacancy ?? null) },
  };
  const hooks = new CustomerNotificationHooks(prisma as never, { notify } as never);
  return { hooks, notify, prisma };
}

describe('Customer app notification hooks on existing events', () => {
  it('₹499 confirmed: the job seeker hears the guarantee started, and the partner who referred them hears "paid"', async () => {
    const { hooks, notify } = build({
      payment: { type: 'activation', status: 'succeeded', jobSeekerId: 'js-1', jobSeeker: { name: 'Ravi Kumar', referredById: 'rf-1' } },
    });
    await hooks.jobSeekerPaymentConfirmed('pay-1');
    expect(notify).toHaveBeenCalledWith({ jobSeekerId: 'js-1' }, 'payment_confirmed', { days: 30 }, { dedupeKey: 'payment_confirmed:pay-1' });
    expect(notify).toHaveBeenCalledWith({ referralId: 'rf-1' }, 'referral_paid', { firstName: 'Ravi' }, { dedupeKey: 'referral_paid:pay-1' });
  });

  it('fee paid: the business (owner and that branch) gets the receipt; both sides hear the joining is confirmed', async () => {
    const { hooks, notify } = build({
      payment: {
        type: 'placement_fee',
        status: 'succeeded',
        placement: { id: 'pl-1', businessId: 'bz-1', jobSeekerId: 'js-1', joiningDate: new Date(), vacancy: { branchId: 'br-1' } },
      },
    });
    await hooks.placementFeePaid('pay-2');
    expect(notify.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [{ businessId: 'bz-1', branchId: 'br-1' }, 'fee_paid'],
      [{ jobSeekerId: 'js-1' }, 'joining_confirmed'],
      [{ businessId: 'bz-1', branchId: 'br-1' }, 'joining_confirmed'],
    ]);
  });

  it.each([
    ['refund', { jobSeekerId: 'js-1' }, { jobSeekerId: 'js-1' }, 'refund_approved', 'refund_paid'],
    ['refund', { businessId: 'bz-1', subjectType: 'placement' }, { businessId: 'bz-1' }, 'refund_approved', 'refund_paid'],
    ['referral_payout', { referralId: 'rf-1' }, { referralId: 'rf-1' }, 'payout_approved', 'payout_paid'],
    ['joining_reward', { jobSeekerId: 'js-1' }, { jobSeekerId: 'js-1' }, 'reward_approved', 'reward_paid'],
  ])('%s: approved and paid go to the right person', async (type, ids, target, approved, paid) => {
    const base = { id: 'pay-3', type, subjectType: 'job_seeker', subjectId: 'x', jobSeekerId: null, businessId: null, referralId: null, placement: null, ...ids };
    const a = build({ payment: { ...base, status: 'approved' } });
    await a.hooks.paymentApproved('pay-3');
    expect(a.notify).toHaveBeenCalledWith(target, approved, {}, { dedupeKey: `${approved}:pay-3` });
    const p = build({ payment: { ...base, status: 'succeeded' } });
    await p.hooks.paymentPaid('pay-3');
    expect(p.notify).toHaveBeenCalledWith(target, paid, {}, { dedupeKey: `${paid}:pay-3` });
  });

  it('an offer is an urgent push with the reply hours; a non-offered interview sends nothing', async () => {
    const sentAt = new Date('2026-11-20T05:00:00Z');
    const { hooks, notify } = build({
      interview: { jobSeekerId: 'js-1', status: 'offered', offerSentAt: sentAt, replyDueAt: new Date(sentAt.getTime() + 48 * 3_600_000) },
    });
    await hooks.interviewOffered('iv-1');
    expect(notify).toHaveBeenCalledWith({ jobSeekerId: 'js-1' }, 'interview_booked', { hours: 48 }, { urgent: true, dedupeKey: 'interview_booked:iv-1' });
    const none = build({ interview: { jobSeekerId: 'js-1', status: 'cancelled', offerSentAt: sentAt, replyDueAt: sentAt } });
    await none.hooks.interviewOffered('iv-2');
    expect(none.notify).not.toHaveBeenCalled();
  });

  it('visit booked only when the owner picked a time; business approved; vacancy confirmed', async () => {
    const when = new Date('2026-11-29T05:30:00Z');
    const v = build({ visitAssignment: { businessId: 'bz-1', status: 'assigned', requestedFor: when, assignedStaff: { name: 'Suresh Gowda' } } });
    await v.hooks.visitAssigned('va-1');
    expect(v.notify).toHaveBeenCalledWith({ businessId: 'bz-1' }, 'visit_booked', { agentFirstName: 'Suresh', when }, expect.any(Object));
    const noTime = build({ visitAssignment: { businessId: 'bz-1', status: 'assigned', requestedFor: null, assignedStaff: { name: 'Suresh' } } });
    await noTime.hooks.visitAssigned('va-2');
    expect(noTime.notify).not.toHaveBeenCalled();

    const b = build({ business: { verificationStatus: 'verified', verifiedAt: when } });
    await b.hooks.businessApproved('bz-1');
    expect(b.notify).toHaveBeenCalledWith({ businessId: 'bz-1' }, 'business_approved', {}, expect.any(Object));

    const vc = build({ vacancy: { code: 'VC-00012', businessId: 'bz-1', branchId: 'br-1' } });
    await vc.hooks.vacancyConfirmed('vc-1');
    expect(vc.notify).toHaveBeenCalledWith({ businessId: 'bz-1', branchId: 'br-1' }, 'vacancy_confirmed', { vacancyCode: 'VC-00012' }, expect.any(Object));
  });

  it('never throws into the calling service', async () => {
    const { hooks, prisma } = build({});
    prisma.payment.findUnique.mockRejectedValue(new Error('database down'));
    await expect(hooks.jobSeekerPaymentConfirmed('pay-x')).resolves.toBeUndefined();
    await expect(hooks.paymentApproved('pay-x')).resolves.toBeUndefined();
  });
});

describe('CustomerPushJob', () => {
  const result = { sent: 1, failed: 0, heldQuietHours: 0, heldDailyCap: 0, off: 0, noDevice: 0, retried: 0, deadTokensRemoved: 0 };

  it('sends what is due and books the receipt check about 15 minutes later', async () => {
    const tickets = [{ ticketId: 't1', token: 'ExponentPushToken[a-123456789]', inboxId: 'm1', messageLogId: 'l1' }];
    const sender = { now: () => new Date(), sendDue: jest.fn().mockResolvedValue({ ...result, tickets }), checkReceipts: jest.fn() };
    const job = new CustomerPushJob(sender as never);
    const queue = { add: jest.fn().mockResolvedValue({}) };
    jest.spyOn(job, 'getQueue').mockReturnValue(queue as never);
    await expect(job.process()).resolves.toEqual({ ...result, tickets: 1 });
    expect(queue.add).toHaveBeenCalledWith(CUSTOMER_PUSH_CHECK_RECEIPTS, { tickets }, expect.objectContaining({ delay: RECEIPT_CHECK_DELAY_MS }));
  });

  it('routes a kick to a send round and a receipt job to the receipt check', async () => {
    const sender = { now: () => new Date(), sendDue: jest.fn().mockResolvedValue({ ...result, tickets: [] }), checkReceipts: jest.fn().mockResolvedValue({ ok: 1 }) };
    const job = new CustomerPushJob(sender as never);
    await job.handle({ name: CUSTOMER_PUSH_SEND_NOW, data: {} });
    expect(sender.sendDue).toHaveBeenCalledTimes(1);
    await job.handle({ name: CUSTOMER_PUSH_CHECK_RECEIPTS, data: { tickets: [{ ticketId: 't' }] } });
    expect(sender.checkReceipts).toHaveBeenCalledWith([{ ticketId: 't' }]);
    expect(CUSTOMER_PUSH_ROUND).toBe('send-due-customer-pushes');
  });

  it('builds no queue or worker in a web-only process', async () => {
    const original = process.env.PROCESS_ROLE;
    process.env.PROCESS_ROLE = 'web';
    const job = new CustomerPushJob({} as never);
    const getQueue = jest.spyOn(job, 'getQueue');
    await job.onModuleInit();
    expect(getQueue).not.toHaveBeenCalled();
    if (original === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = original;
  });
});
