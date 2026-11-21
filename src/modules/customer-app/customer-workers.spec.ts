import { Prisma } from '@prisma/client';
import { CustomerWorkersService } from './customer-workers.service';
import { SEEDED_PRICING_POLICY } from '../../test-support/seeded-pricing';

/**
 * "A worker left" from the app: only the caller's own business (a branch: its
 * branch), dates inside the guarantee as the staff claim checks them, the
 * claim reasons, one open report per worker, and a call from the team.
 */
describe('CustomerWorkersService (a worker left, in the app)', () => {
  const NOW = new Date('2026-11-21T06:00:00.000Z'); // 21 Nov, 11:30 IST
  const owner: { id: string; accountId: string; kind: string; role: string; jobSeekerId: null; businessId: string; branchId: string | null; referralId: null } = { id: 'prof-1', accountId: 'acc-1', kind: 'business', role: 'owner', jobSeekerId: null, businessId: 'biz-1', branchId: null, referralId: null };
  const branchManager = { ...owner, id: 'prof-2', role: 'manager', branchId: 'branch-9' };
  const saved = process.env.CUSTOMER_WORKER_LEFT_REPORTS;
  beforeEach(() => {
    process.env.CUSTOMER_WORKER_LEFT_REPORTS = 'on';
  });
  afterAll(() => {
    process.env.CUSTOMER_WORKER_LEFT_REPORTS = saved;
  });
  function claim(extra: Record<string, unknown> = {}) {
    return {
      code: 'CL-00001', workerLeftOn: new Date('2026-11-05T00:00:00.000Z'), reportedAt: new Date('2026-11-06T06:00:00.000Z'),
      decision: null, decisionReason: null, rejectionCode: null, decidedByStaffId: null, overruledByStaffId: null, ...extra,
    };
  }

  function placement(extra: Record<string, unknown> = {}) {
    return {
      id: 'pl-1',
      code: 'PL-00012',
      status: 'active',
      joinedDate: new Date('2026-11-01T00:00:00.000Z'),
      joiningDate: new Date('2026-11-01T00:00:00.000Z'),
      rootPlacementId: null,
      vacancy: { tradeSkill: 'Cook', branchId: null },
      jobSeeker: { name: 'Ravi Kumar' },
      replacementClaims: [],
      ...extra,
    };
  }

  function setup(opts: { profile?: typeof owner; rows?: ReturnType<typeof placement>[]; openReport?: unknown; openCallback?: unknown } = {}) {
    const tx = {
      customerCallbackRequest: {
        findFirst: jest.fn().mockResolvedValue(opts.openCallback ?? null),
        create: jest.fn().mockResolvedValue({ id: 'cb-1' }),
      },
      customerWorkerLeftReport: {
        create: jest.fn().mockResolvedValue({ id: 'rep-1', status: 'open', createdAt: NOW }),
      },
    };
    const prisma = {
      placement: {
        findMany: jest.fn().mockResolvedValue(opts.rows ?? [placement()]),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      customerWorkerLeftReport: {
        findFirst: jest.fn().mockResolvedValue(opts.openReport ?? null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      replacementClaim: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
    };
    const scope = { profile: jest.fn().mockResolvedValue(opts.profile ?? owner) };
    const service = new CustomerWorkersService(
      prisma as never,
      { now: () => NOW } as never,
      scope as never,
      { current: jest.fn().mockResolvedValue(SEEDED_PRICING_POLICY) } as never,
    );
    return { service, prisma, tx, scope };
  }

  it('lists only this business’s paid workers, by first name, with the dates they may have left on', async () => {
    const { service, prisma, scope } = setup();
    const answer = await service.workers('acc-1', 'prof-1');
    expect(scope.profile).toHaveBeenCalledWith('acc-1', 'prof-1', 'business');
    expect(prisma.placement.findMany.mock.calls[0][0].where).toEqual({ businessId: 'biz-1', status: { in: ['active', 'confirmed'] } });
    expect(answer.open).toBe(true);
    expect(answer.workers).toEqual([
      expect.objectContaining({
        placementCode: 'PL-00012',
        workerFirstName: 'Ravi',
        trade: 'Cook',
        leftOnEarliest: '2026-11-01',
        leftOnLatest: '2026-11-21',
        guaranteeLastDay: '2026-12-31',
        state: 'can_report',
      }),
    ]);
    expect(JSON.stringify(answer)).not.toMatch(/phone|Kumar|paise/i);
    expect(answer.reasons.covered).toContain('resigned');
    expect(answer.reasons.covered).not.toContain('never_joined');
    expect(answer.reasons.notCovered).toContain('salary_unpaid');
  });

  it('a branch profile sees only its own branch’s workers and reports', async () => {
    const { service, prisma } = setup({ profile: branchManager });
    await service.workers('acc-1', 'prof-2');
    expect(prisma.placement.findMany.mock.calls[0][0].where).toEqual({ businessId: 'biz-1', status: { in: ['active', 'confirmed'] }, vacancy: { branchId: 'branch-9' } });
    expect(prisma.customerWorkerLeftReport.findMany.mock.calls[1][0].where).toEqual({ businessId: 'biz-1', branchId: 'branch-9' });
  });

  it('saves the report and asks the call team to call; the claim is not filed here', async () => {
    const { service, tx, prisma } = setup();
    const result = await service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned', note: 'Went back home' });
    expect(result).toEqual({ created: true, body: { reportId: 'rep-1', status: 'open', reportedAt: NOW } });
    expect(prisma.placement.findMany.mock.calls[0][0].where).toEqual({ businessId: 'biz-1', status: { in: ['active', 'confirmed'] }, id: 'pl-1' });
    // Only its own open "worker left" call for this profile is reused, never another (assigned, or another profile's).
    expect(tx.customerCallbackRequest.findFirst.mock.calls[0][0].where).toEqual({ accountId: 'acc-1', profileId: 'prof-1', topic: 'worker_left', status: 'open' });
    expect(tx.customerCallbackRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: 'acc-1', profileId: 'prof-1', topic: 'worker_left', note: 'PL-00012: worker left on 2026-11-19' }) }),
    );
    expect(tx.customerWorkerLeftReport.create.mock.calls[0][0].data).toEqual({
      accountId: 'acc-1',
      profileId: 'prof-1',
      businessId: 'biz-1',
      branchId: null,
      placementId: 'pl-1',
      workerLeftOn: new Date('2026-11-19T00:00:00.000Z'),
      reason: 'resigned',
      note: 'Went back home',
      callbackRequestId: 'cb-1',
    });
  });

  it('is refused while switched off (the office does not use the reports yet)', async () => {
    delete process.env.CUSTOMER_WORKER_LEFT_REPORTS;
    const { service, tx } = setup();
    await expect(service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' })).rejects.toMatchObject({ status: 501 });
    expect(tx.customerWorkerLeftReport.create).not.toHaveBeenCalled();
    expect((await service.workers('acc-1', 'prof-1')).open).toBe(false);
  });

  it('uses its own "worker left" call already open instead of making a second one', async () => {
    const { service, tx } = setup({ openCallback: { id: 'cb-open' } });
    await service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' });
    expect(tx.customerCallbackRequest.create).not.toHaveBeenCalled();
    expect(tx.customerWorkerLeftReport.create.mock.calls[0][0].data.callbackRequestId).toBe('cb-open');
  });

  it('another business’s worker (or one not paid for) is not found — the same answer as no worker', async () => {
    const { service } = setup({ rows: [] });
    await expect(service.reportLeft('acc-1', 'prof-1', 'pl-other', { workerLeftOn: '2026-11-19', reason: 'resigned' })).rejects.toMatchObject({ status: 404 });
  });

  it('a second report while one is open gives back the open one', async () => {
    const { service, tx } = setup({ openReport: { id: 'rep-old', status: 'open', createdAt: NOW } });
    const result = await service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' });
    expect(result).toEqual({ created: false, body: { reportId: 'rep-old', status: 'open', reportedAt: NOW } });
    expect(tx.customerWorkerLeftReport.create).not.toHaveBeenCalled();
  });

  it('two taps at once: the database keeps one, and the second gets it back', async () => {
    const { service, tx, prisma } = setup();
    tx.customerWorkerLeftReport.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    prisma.customerWorkerLeftReport.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'rep-first', status: 'open', createdAt: NOW });
    const result = await service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' });
    expect(result).toEqual({ created: false, body: { reportId: 'rep-first', status: 'open', reportedAt: NOW } });
  });

  it.each([
    [{ workerLeftOn: '2026-10-31', reason: 'resigned' }, 'workerLeftOn'], // before he joined
    [{ workerLeftOn: '2026-11-22', reason: 'resigned' }, 'workerLeftOn'], // in the future
    [{ workerLeftOn: '19-11-2026', reason: 'resigned' }, 'workerLeftOn'],
    [{ workerLeftOn: '2026-11-19', reason: 'never_joined' }, 'reason'], // he joined
    [{ workerLeftOn: '2026-11-19', reason: 'made_up' }, 'reason'],
    [{ workerLeftOn: '2026-11-19', reason: 'resigned', note: 'Aadhaar 1234 5678 9012' }, 'note'],
    [{ workerLeftOn: '2026-11-19', reason: 'resigned', note: 'x'.repeat(201) }, 'note'],
  ])('refuses %j (%s)', async (body, field) => {
    const { service, tx } = setup();
    await expect(service.reportLeft('acc-1', 'prof-1', 'pl-1', body)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED', field }) });
    expect(tx.customerWorkerLeftReport.create).not.toHaveBeenCalled();
  });

  it('after the 60 days and the 7 days to tell us, or while a claim waits for the Team Lead, there is nothing to report', async () => {
    const late = setup({ rows: [placement({ joinedDate: new Date('2026-09-10T00:00:00.000Z') })] }); // last day 9 Nov, +7 = 16 Nov
    expect((await late.service.workers('acc-1', 'prof-1')).workers[0].state).toBe('guarantee_over');
    await expect(late.service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' })).rejects.toMatchObject({ status: 409 });
    const claimed = setup({ rows: [placement({ replacementClaims: [claim()] })] });
    expect((await claimed.service.workers('acc-1', 'prof-1')).workers[0].state).toBe('claim_open');
    await expect(claimed.service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' })).rejects.toMatchObject({ status: 409 });
  });

  it('a selected, paid worker who never came: only "never joined", from his joining day', async () => {
    const { service, tx } = setup({ rows: [placement({ status: 'confirmed', joinedDate: null, joiningDate: new Date('2026-11-18T00:00:00.000Z') })] });
    const row = (await service.workers('acc-1', 'prof-1')).workers[0];
    expect(row).toMatchObject({ neverJoined: true, leftOnEarliest: '2026-11-18', state: 'can_report' });
    await expect(service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' })).rejects.toMatchObject({ response: expect.objectContaining({ field: 'reason' }) });
    await service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'never_joined' });
    expect(tx.customerWorkerLeftReport.create.mock.calls[0][0].data.reason).toBe('never_joined');
  });

  it('a worker due to join later is not reportable yet', async () => {
    const { service } = setup({ rows: [placement({ status: 'confirmed', joinedDate: null, joiningDate: new Date('2026-11-25T00:00:00.000Z') })] });
    expect((await service.workers('acc-1', 'prof-1')).workers[0].state).toBe('not_started');
  });

  it('a worker who left on the last guarantee day can still be told about within the 7 days, as staff would file it', async () => {
    // Joined 17 Sep → last day 16 Nov; today 21 Nov is inside 16 Nov + 7 days.
    const { service, tx } = setup({ rows: [placement({ joinedDate: new Date('2026-09-17T00:00:00.000Z') })] });
    const row = (await service.workers('acc-1', 'prof-1')).workers[0];
    expect(row).toMatchObject({ state: 'can_report', guaranteeLastDay: '2026-11-16', leftOnLatest: '2026-11-16' });
    await service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-16', reason: 'resigned' });
    expect(tx.customerWorkerLeftReport.create).toHaveBeenCalled();
    await expect(service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-17', reason: 'resigned' })).rejects.toMatchObject({ response: expect.objectContaining({ field: 'workerLeftOn' }) });
  });

  it('a claim turned down for good (late, fee unpaid, not covered) cannot be reported again from the app', async () => {
    const { service, tx } = setup({ rows: [placement({ replacementClaims: [claim({ decision: 'rejected', rejectionCode: 'reported_late' })] })] });
    expect((await service.workers('acc-1', 'prof-1')).workers[0].state).toBe('not_again');
    await expect(service.reportLeft('acc-1', 'prof-1', 'pl-1', { workerLeftOn: '2026-11-19', reason: 'resigned' })).rejects.toMatchObject({ status: 409 });
    expect(tx.customerWorkerLeftReport.create).not.toHaveBeenCalled();
  });
});
