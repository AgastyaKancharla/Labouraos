import { CustomerNotificationHooks } from './customer-notification-hooks.service';
import { CustomerPushJob, CUSTOMER_PUSH_QUEUE, CUSTOMER_PUSH_ROUND, CUSTOMER_PUSH_RUN_NOW_ID } from '../../jobs/customer-push.job';
import { jobQueue, LABOURA_JOBS_QUEUE } from '../../jobs/job-queue';
import { CustomerPushKick } from './customer-push-kick';
import { CUSTOMER_PUSH_CHECK_RECEIPTS, CUSTOMER_PUSH_SEND_NOW, RECEIPT_CHECK_DELAY_MS, RECEIPT_CHECK_MAX_RETRIES } from './customer-notification.constants';

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
    // Matched from the bank feed or by Finance: not the person's own action of the moment (waits for 9 AM at night).
    expect(notify).toHaveBeenCalledWith({ jobSeekerId: 'js-1' }, 'payment_confirmed', { days: 30 }, { dedupeKey: 'payment_confirmed:pay-1', selfAction: false });
    expect(notify).toHaveBeenCalledWith({ referralId: 'rf-1' }, 'referral_paid', { firstName: 'Ravi' }, { dedupeKey: 'referral_paid:pay-1' });
  });

  it('a receipt counts as the person\'s own action only when they just paid by card (gateway), never for bank feed or Finance', async () => {
    for (const [confirmedBy, selfAction] of [['gateway', true], ['bank_feed', false], ['finance_manual', false]] as const) {
      const { hooks, notify } = build({ payment: { type: 'activation', status: 'succeeded', confirmedBy, jobSeekerId: 'js-1', jobSeeker: { name: 'Ravi', referredById: null } } });
      await hooks.jobSeekerPaymentConfirmed('pay-1');
      expect(notify).toHaveBeenCalledWith({ jobSeekerId: 'js-1' }, 'payment_confirmed', { days: 30 }, expect.objectContaining({ selfAction }));
    }
  });

  it('fee paid: the business owners get the receipt (never a branch manager); both sides hear the joining is confirmed', async () => {
    const { hooks, notify } = build({
      payment: {
        type: 'placement_fee',
        status: 'succeeded',
        confirmedBy: 'gateway',
        placement: { id: 'pl-1', businessId: 'bz-1', jobSeekerId: 'js-1', joiningDate: new Date(), vacancy: { branchId: 'br-1' } },
      },
    });
    await hooks.placementFeePaid('pay-2');
    expect(notify.mock.calls[0][3]).toEqual({ dedupeKey: 'fee_paid:pay-2', selfAction: true });
    expect(notify.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [{ businessId: 'bz-1' }, 'fee_paid'],
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
    const tickets = [{ ticketId: 't1', deviceId: 'dev-1', inboxId: 'm1', messageLogId: 'l1', sentAt: new Date().toISOString() }];
    const sender = { now: () => new Date(), sendDue: jest.fn().mockResolvedValue({ ...result, tickets }), checkReceipts: jest.fn() };
    const job = new CustomerPushJob(sender as never);
    const queue = { add: jest.fn().mockResolvedValue({}) };
    jest.spyOn(job, 'getQueue').mockReturnValue(queue as never);
    await expect(job.process()).resolves.toEqual({ ...result, tickets: 1 });
    expect(queue.add).toHaveBeenCalledWith(CUSTOMER_PUSH_CHECK_RECEIPTS, { tickets, retry: 0 }, expect.objectContaining({ delay: RECEIPT_CHECK_DELAY_MS }));
    // The queue holds phone row ids, never a raw push token (privacy review L3).
    expect(JSON.stringify(queue.add.mock.calls[0][1])).not.toContain('ExponentPushToken');
  });

  it('asks again for receipts Expo has not produced yet, a bounded number of times', async () => {
    const pending = [{ ticketId: 't2', deviceId: 'dev-1', inboxId: 'm1', messageLogId: null, sentAt: new Date().toISOString() }];
    const sender = { now: () => new Date(), sendDue: jest.fn(), checkReceipts: jest.fn().mockResolvedValue({ ok: 0, errors: 0, deadTokensRemoved: 0, pending }) };
    const job = new CustomerPushJob(sender as never);
    const queue = { add: jest.fn().mockResolvedValue({}) };
    jest.spyOn(job, 'getQueue').mockReturnValue(queue as never);
    await expect(job.handleJob({ name: CUSTOMER_PUSH_CHECK_RECEIPTS, data: { tickets: pending, retry: 0 } })).resolves.toMatchObject({ pending: 1 });
    expect(queue.add).toHaveBeenCalledWith(CUSTOMER_PUSH_CHECK_RECEIPTS, { tickets: pending, retry: 1 }, expect.objectContaining({ delay: RECEIPT_CHECK_DELAY_MS }));
    queue.add.mockClear();
    await job.handleJob({ name: CUSTOMER_PUSH_CHECK_RECEIPTS, data: { tickets: pending, retry: RECEIPT_CHECK_MAX_RETRIES } });
    expect(queue.add).not.toHaveBeenCalled();
    // An old-style ref carrying a token and no phone id is ignored.
    sender.checkReceipts.mockClear();
    await job.handleJob({ name: CUSTOMER_PUSH_CHECK_RECEIPTS, data: { tickets: [{ ticketId: 't3', token: 'ExponentPushToken[x-123456789]' }] } });
    expect(sender.checkReceipts).toHaveBeenCalledWith([]);
  });

  it('the CEO\'s "run now" queues a round for the worker instead of sending from the web process', async () => {
    const sender = { now: () => new Date(), sendDue: jest.fn(), checkReceipts: jest.fn() };
    const job = new CustomerPushJob(sender as never);
    const add = jest.spyOn(jobQueue, 'add').mockResolvedValueOnce({} as never);
    await expect(job.queueRunNow()).resolves.toEqual({ queued: true });
    expect(add).toHaveBeenCalledWith(CUSTOMER_PUSH_ROUND, {}, expect.objectContaining({ jobId: CUSTOMER_PUSH_RUN_NOW_ID }));
    expect(sender.sendDue).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('routes a kick to a send round and a receipt job to the receipt check', async () => {
    const sender = {
      now: () => new Date(),
      sendDue: jest.fn().mockResolvedValue({ ...result, tickets: [] }),
      checkReceipts: jest.fn().mockResolvedValue({ ok: 1, errors: 0, deadTokensRemoved: 0, pending: [] }),
    };
    const job = new CustomerPushJob(sender as never);
    await job.handleJob({ name: CUSTOMER_PUSH_SEND_NOW, data: {} });
    expect(sender.sendDue).toHaveBeenCalledTimes(1);
    await job.handleJob({ name: CUSTOMER_PUSH_CHECK_RECEIPTS, data: { tickets: [{ ticketId: 't', deviceId: 'd' }] } });
    expect(sender.checkReceipts).toHaveBeenCalledWith([{ ticketId: 't', deviceId: 'd' }]);
    expect(CUSTOMER_PUSH_ROUND).toBe('send-due-customer-pushes');
  });

  it('never runs a kick and the scheduled round at the same time in one process (the daily cap is counted once)', async () => {
    let active = 0;
    let most = 0;
    const sendDue = jest.fn().mockImplementation(async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ...result, tickets: [] };
    });
    const job = new CustomerPushJob({ now: () => new Date(), sendDue, checkReceipts: jest.fn() } as never);
    await Promise.all([job.handle({} as never), job.handleOneOff({ name: CUSTOMER_PUSH_SEND_NOW, data: {} } as never), job.process()]);
    expect(sendDue).toHaveBeenCalledTimes(3);
    expect(most).toBe(1);
  });

  it('a failed send does not stop the next one', async () => {
    const sendDue = jest.fn().mockRejectedValueOnce(new Error('database down')).mockResolvedValue({ ...result, tickets: [] });
    const job = new CustomerPushJob({ now: () => new Date(), sendDue, checkReceipts: jest.fn() } as never);
    await expect(job.process()).rejects.toThrow('database down');
    await expect(job.process()).resolves.toEqual({ ...result, tickets: 0 });
  });

  it('uses the one shared queue: registers its three job names with the shared worker and opens no queue of its own', async () => {
    const original = process.env.PROCESS_ROLE;
    process.env.PROCESS_ROLE = 'worker';
    const job = new CustomerPushJob({} as never);
    jest.spyOn(job, 'schedule').mockResolvedValue(undefined);
    jest.spyOn(job, 'getWorker').mockReturnValue({} as never);
    try {
      await job.onModuleInit();
      expect(CUSTOMER_PUSH_QUEUE).toBe(LABOURA_JOBS_QUEUE);
      for (const name of [CUSTOMER_PUSH_ROUND, CUSTOMER_PUSH_SEND_NOW, CUSTOMER_PUSH_CHECK_RECEIPTS]) expect(jobQueue.hasHandler(name)).toBe(true);
      await job.close();
      for (const name of [CUSTOMER_PUSH_ROUND, CUSTOMER_PUSH_SEND_NOW, CUSTOMER_PUSH_CHECK_RECEIPTS]) expect(jobQueue.hasHandler(name)).toBe(false);
    } finally {
      if (original === undefined) delete process.env.PROCESS_ROLE;
      else process.env.PROCESS_ROLE = original;
    }
  });

  it('a "send now" kick goes into the shared queue and gives up quietly when Redis does not answer', async () => {
    const add = jest.spyOn(jobQueue, 'add').mockResolvedValueOnce({} as never);
    await new CustomerPushKick().kick();
    expect(add).toHaveBeenCalledWith(CUSTOMER_PUSH_SEND_NOW, {}, expect.objectContaining({ jobId: CUSTOMER_PUSH_SEND_NOW }));
    add.mockRejectedValueOnce(new Error('Redis down'));
    await expect(new CustomerPushKick().kick()).resolves.toBeUndefined();
    add.mockRestore();
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
