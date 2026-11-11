import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { AttendanceClock } from '../attendance/attendance-clock';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { NotificationSweepJob } from '../../jobs/notification-sweep.job';
import { NotificationClock } from './notification-clock';
import { NotificationService } from './notification.service';
import { NotificationSourcesService } from './notification-sources.service';

jest.setTimeout(180000);

const shared = { at: new Date('2027-06-14T04:30:00.000Z') };

class SharedAttendanceClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}
class SharedNotificationClock extends NotificationClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

type Person = { id: string; role: string; code: string };
type Item = {
  id: string;
  kind: string;
  title: string;
  link: string | null;
  subjectType: string;
  subjectId: string;
  status: 'open' | 'cleared';
  seen: boolean;
  clearedReason: string | null;
  clearedBy: { id: string } | null;
};

describe('Phase 21 Task 6: notification bells', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let sources: NotificationSourcesService;
  let notifications: NotificationService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const paymentIds: string[] = [];
  const creditIds: string[] = [];

  let ceo: Person;
  let managerA: Person;
  let managerB: Person;
  let leadA: Person;
  let leadB: Person;
  let finance: Person;

  function tokenFor(staff: Person) {
    return jwt.sign({ sub: staff.id, email: `${staff.id}@laboura.local`, role: staff.role, code: staff.code });
  }

  function at(year: number, month: number, day: number, hour: number, minute = 0) {
    shared.at = localCalendarToUtc(year, month, day, hour, minute);
  }

  async function make(role: string, prefix: string, reportsToId?: string | null): Promise<Person> {
    const agent = role === 'call_agent' || role === 'field_agent';
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} bells`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: agent ? (reportsToId ?? null) : null,
        reportsToId: reportsToId ?? null,
        createdAt: new Date('2027-01-10T06:00:00.000Z'),
      },
    });
    staffIds.push(row.id);
    return row;
  }

  function post(person: Person, path: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(person)}`).send(body);
  }

  function get(person: Person, path: string) {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(person)}`);
  }

  /** Everything the person has about one subject (any status), read through the API. */
  async function about(person: Person, subjectId: string, kind?: string): Promise<Item[]> {
    sources.resetReadThrottle();
    const res = await get(person, `/notifications?status=all&limit=200${kind ? `&kind=${kind}` : ''}`);
    expect(res.status).toBe(200);
    return (res.body.items as Item[]).filter((item) => item.subjectId === subjectId);
  }

  async function openAbout(person: Person, subjectId: string, kind?: string): Promise<Item[]> {
    return (await about(person, subjectId, kind)).filter((item) => item.status === 'open');
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(SharedAttendanceClock)
      .overrideProvider(NotificationClock)
      .useClass(SharedNotificationClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    sources = app.get(NotificationSourcesService);
    notifications = app.get(NotificationService);

    ceo = await make('ceo', 'CEO6');
    managerA = await make('manager', 'MGA6', ceo.id);
    managerB = await make('manager', 'MGB6', ceo.id);
    leadA = await make('team_lead', 'TLA6', managerA.id);
    leadB = await make('team_lead', 'TLB6', managerB.id);
    finance = await make('finance', 'FIN6', ceo.id);
  });

  afterAll(async () => {
    try {
      if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      if (creditIds.length) await prisma.bankCredit.deleteMany({ where: { id: { in: creditIds } } });
      if (staffIds.length > 0) {
        await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
        await prisma.messageLog.deleteMany({ where: { subjectType: 'staff', subjectId: { in: staffIds } } });
        await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      await app.close();
    }
  });

  it('puts a leave request on the Team Lead’s bell only, clears it on the decision with who decided, and tells the requester', async () => {
    at(2027, 6, 14, 10);
    const agent = await make('call_agent', 'LV6', leadA.id);
    const asked = await post(agent, '/attendance/leave', {
      kind: 'casual',
      fromDate: '2027-06-21',
      toDate: '2027-06-21',
      reason: 'Family function',
    });
    expect(asked.status).toBe(201);
    const id = asked.body.id as string;

    const forLead = await openAbout(leadA, id, 'leave_request');
    expect(forLead).toHaveLength(1);
    expect(forLead[0].link).toBe(`/team-lead/requests?kind=leave&id=${id}`);
    expect(await openAbout(leadB, id)).toHaveLength(0);
    expect(await openAbout(managerA, id)).toHaveLength(0);
    expect(await openAbout(agent, id)).toHaveLength(0);

    // Seen is not cleared.
    expect((await post(leadA, `/notifications/${forLead[0].id}/seen`)).body).toMatchObject({ seen: true, status: 'open' });

    expect((await post(leadA, `/attendance/requests/leave/${id}/approve`, { reason: 'Fine' })).status).toBe(201);
    const after = await about(leadA, id, 'leave_request');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: 'cleared', clearedReason: 'request_approved', clearedBy: { id: leadA.id } });

    const told = await openAbout(agent, id, 'request_decided');
    expect(told).toHaveLength(1);
    expect(told[0].title).toContain('was approved');
    // Informational: reading it is the work.
    expect((await post(agent, '/notifications/seen', { ids: [told[0].id] })).body).toMatchObject({ seen: 1, cleared: 1 });
    expect(await openAbout(agent, id, 'request_decided')).toHaveLength(0);
    // A later sync does not bring it back.
    await sources.syncRequest('leave', id);
    expect(await about(agent, id, 'request_decided')).toHaveLength(1);
  });

  it('escalates a request the Team Lead has not answered in 24 hours to the Manager, then to the CEO after 48 more', async () => {
    at(2027, 6, 15, 10);
    const agent = await make('call_agent', 'ESC6', leadA.id);
    const asked = await post(agent, '/attendance/corrections', {
      date: '2027-06-14',
      from: '10:00',
      to: '11:00',
      status: 'available',
      reason: 'Forgot to switch back',
    });
    expect(asked.status).toBe(201);
    const id = asked.body.id as string;
    expect(await openAbout(leadA, id, 'correction_request')).toHaveLength(1);
    expect(await openAbout(managerA, id)).toHaveLength(0);

    at(2027, 6, 16, 10, 30);
    // Still with the Team Lead, and now also with the Manager.
    expect(await openAbout(managerA, id, 'correction_request')).toHaveLength(1);
    expect(await openAbout(leadA, id, 'correction_request')).toHaveLength(1);
    expect(await openAbout(managerB, id)).toHaveLength(0);
    expect(await openAbout(ceo, id)).toHaveLength(0);

    at(2027, 6, 18, 11);
    expect(await openAbout(ceo, id, 'correction_request')).toHaveLength(1);

    // The sweep keeps it to one each however often it runs (no duplicates).
    await app.get(NotificationSweepJob).process(shared.at);
    await app.get(NotificationSweepJob).process(shared.at);
    expect(await openAbout(ceo, id, 'correction_request')).toHaveLength(1);
    expect(await openAbout(managerA, id, 'correction_request')).toHaveLength(1);

    expect((await post(managerA, `/attendance/requests/correction/${id}/approve`, { reason: 'Checked' })).status).toBe(201);
    for (const person of [leadA, managerA, ceo]) {
      const rows = await about(person, id, 'correction_request');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'cleared', clearedReason: 'request_approved', clearedBy: { id: managerA.id } });
    }
  });

  it('moves a forwarded request from the Team Lead to the Manager; a Team Lead’s own request goes to the Manager', async () => {
    at(2027, 6, 21, 10);
    const agent = await make('call_agent', 'FWD6', leadA.id);
    const asked = await post(agent, '/attendance/leave', {
      kind: 'emergency',
      fromDate: '2027-06-22',
      reason: 'Hospital visit',
    });
    const id = asked.body.id as string;
    expect((await post(leadA, `/attendance/requests/leave/${id}/forward`, { note: 'Please decide' })).status).toBe(201);
    const lead = await about(leadA, id, 'leave_request');
    expect(lead[0]).toMatchObject({ status: 'cleared', clearedReason: 'forwarded', clearedBy: { id: leadA.id } });
    expect(await openAbout(managerA, id, 'leave_request')).toHaveLength(1);

    const own = await post(leadA, '/attendance/leave', { kind: 'casual', fromDate: '2027-06-28', reason: 'Wedding' });
    expect(own.status).toBe(201);
    const managerRows = await openAbout(managerA, own.body.id, 'leave_request');
    expect(managerRows).toHaveLength(1);
    expect(managerRows[0].link).toBe(`/manager/requests?kind=leave&id=${own.body.id}`);
    expect(await openAbout(managerB, own.body.id)).toHaveLength(0);
    expect(await openAbout(leadA, own.body.id, 'leave_request')).toHaveLength(0);
  });

  it('alerts the Team Lead about a break that runs over and clears it when the break ends', async () => {
    at(2027, 6, 23, 9, 30);
    const agent = await make('call_agent', 'BRK6', leadA.id);
    expect((await post(agent, '/attendance/login')).status).toBe(201);
    at(2027, 6, 23, 11, 0);
    expect((await post(agent, '/attendance/status', { status: 'short_break' })).status).toBe(201);
    at(2027, 6, 23, 11, 20);
    expect((await get(agent, '/attendance/today')).status).toBe(200);
    const segment = await prisma.attendanceSegment.findFirstOrThrow({
      where: { staffId: agent.id, status: 'short_break' },
    });
    const open = await openAbout(leadA, segment.id, 'break_overrun');
    expect(open).toHaveLength(1);
    expect(open[0].title).toContain('short break over 15 minutes');
    expect(await openAbout(leadB, segment.id)).toHaveLength(0);
    // Asking again does not add another.
    await get(agent, '/attendance/today');
    expect(await about(leadA, segment.id, 'break_overrun')).toHaveLength(1);

    at(2027, 6, 23, 11, 22);
    expect((await post(agent, '/attendance/status', { status: 'available' })).status).toBe(201);
    const done = await about(leadA, segment.id, 'break_overrun');
    expect(done[0]).toMatchObject({ status: 'cleared', clearedReason: 'break_ended', clearedBy: { id: agent.id } });
  });

  it('asks the Team Lead to approve a system problem and clears it with who approved', async () => {
    at(2027, 6, 24, 9, 30);
    const agent = await make('call_agent', 'SYS6', leadA.id);
    await post(agent, '/attendance/login');
    at(2027, 6, 24, 12, 0);
    expect((await post(agent, '/attendance/status', { status: 'system_problem' })).status).toBe(201);
    const segment = await prisma.attendanceSegment.findFirstOrThrow({
      where: { staffId: agent.id, status: 'system_problem' },
    });
    expect(await openAbout(leadA, segment.id, 'system_problem')).toHaveLength(1);
    expect(await openAbout(leadB, segment.id)).toHaveLength(0);
    expect((await post(leadA, `/attendance/system-problem/${segment.id}/approve`)).status).toBe(201);
    const done = await about(leadA, segment.id, 'system_problem');
    expect(done[0]).toMatchObject({ status: 'cleared', clearedReason: 'approved', clearedBy: { id: leadA.id } });
  });

  it('tells the Team Lead about an agent idle over 30 minutes and clears it when the agent is back', async () => {
    at(2027, 6, 25, 9, 30);
    const agent = await make('call_agent', 'IDL6', leadA.id);
    await post(agent, '/attendance/login');
    // Idle from 09:41 (10 minutes, then a minute to answer "Still there?").
    at(2027, 6, 25, 10, 0);
    await app.get(NotificationSweepJob).process(shared.at);
    const idle = await prisma.attendanceSegment.findFirstOrThrow({ where: { staffId: agent.id, status: 'idle' } });
    expect(await openAbout(leadA, idle.id, 'agent_idle')).toHaveLength(0);

    at(2027, 6, 25, 10, 15);
    await app.get(NotificationSweepJob).process(shared.at);
    expect(await openAbout(leadA, idle.id, 'agent_idle')).toHaveLength(1);
    expect(await openAbout(leadB, idle.id)).toHaveLength(0);

    at(2027, 6, 25, 10, 20);
    expect((await post(agent, '/attendance/heartbeat')).status).toBe(201);
    const done = await about(leadA, idle.id, 'agent_idle');
    expect(done[0]).toMatchObject({ status: 'cleared', clearedReason: 'idle_ended', clearedBy: { id: agent.id } });
  });

  it('puts a review flag on the person’s own Team Lead and Manager only, and clears it when resolved', async () => {
    at(2027, 6, 28, 10);
    const agent = await make('call_agent', 'FLG6', leadA.id);
    const flags = app.get(ReviewFlagService);
    const flag = await flags.raise({
      kind: 'odd_hour_login',
      subjectType: 'staff',
      subjectId: agent.id,
      raisedForStaffId: agent.id,
    });
    expect(await openAbout(leadA, flag.id, 'review_flag')).toHaveLength(1);
    expect(await openAbout(managerA, flag.id, 'review_flag')).toHaveLength(1);
    expect(await openAbout(leadB, flag.id)).toHaveLength(0);
    expect(await openAbout(managerB, flag.id)).toHaveLength(0);
    expect(await openAbout(finance, flag.id)).toHaveLength(0);

    expect(
      (await post(leadA, `/review-flags/${flag.id}/resolve`, { status: 'resolved', resolution: 'Spoke to him' })).status,
    ).toBe(201);
    for (const person of [leadA, managerA]) {
      const rows = await about(person, flag.id, 'review_flag');
      expect(rows[0]).toMatchObject({ status: 'cleared', clearedReason: 'flag_resolved', clearedBy: { id: leadA.id } });
    }

    // A third hit removal goes to the Team Lead's Manager.
    const needsManager = await flags.raise({
      kind: 'hit_reversal_needs_manager',
      subjectType: 'job_seeker_hit',
      subjectId: `hit-${stamp}`,
      raisedForStaffId: leadA.id,
    });
    expect(await openAbout(managerA, needsManager.id, 'hit_reversal_needs_manager')).toHaveLength(1);
    expect(await openAbout(managerB, needsManager.id)).toHaveLength(0);
    expect(await openAbout(leadA, needsManager.id)).toHaveLength(0);

    // A flag resolved by code that skips the service is still cleared by the sweep.
    await prisma.reviewFlag.update({
      where: { id: needsManager.id },
      data: { status: 'dismissed', resolvedAt: shared.at, resolvedByStaffId: managerA.id },
    });
    await app.get(NotificationSweepJob).process(shared.at);
    const swept = await about(managerA, needsManager.id, 'hit_reversal_needs_manager');
    expect(swept[0]).toMatchObject({ status: 'cleared', clearedReason: 'flag_dismissed', clearedBy: { id: managerA.id } });
  });

  it('sends refunds above Finance’s limit to the CEO, refunds ready to pay and failed payouts to Finance, never to a Manager', async () => {
    at(2027, 6, 29, 10);
    const make$ = async (data: { type: string; status: string; amount: number; ceoApprovalReason?: string }) => {
      const row = await prisma.payment.create({
        data: {
          code: `PAY6-${stamp}-${paymentIds.length}`,
          type: data.type,
          status: data.status,
          amount: data.amount,
          subjectType: 'business',
          subjectId: `biz-${stamp}`,
          ceoApprovalReason: data.ceoApprovalReason ?? null,
          sentToCeoAt: data.ceoApprovalReason ? shared.at : null,
        },
      });
      paymentIds.push(row.id);
      return row;
    };
    const big = await make$({ type: 'refund', status: 'pending', amount: 2_000_000, ceoApprovalReason: 'above_finance_limit' });
    const ceoRows = await openAbout(ceo, big.id, 'refund_needs_ceo');
    expect(ceoRows).toHaveLength(1);
    expect(ceoRows[0].title).toContain(big.code);
    expect(await openAbout(finance, big.id)).toHaveLength(0);
    expect(await openAbout(managerA, big.id)).toHaveLength(0);

    await prisma.payment.update({
      where: { id: big.id },
      data: { status: 'approved', approvedByStaffId: ceo.id, approvedAt: shared.at },
    });
    const approved = await about(ceo, big.id, 'refund_needs_ceo');
    expect(approved[0]).toMatchObject({ status: 'cleared', clearedReason: 'payment_approved', clearedBy: { id: ceo.id } });
    // Approved: Finance pays it.
    expect(await openAbout(finance, big.id, 'refund_ready_to_pay')).toHaveLength(1);
    await prisma.payment.update({
      where: { id: big.id },
      data: { status: 'succeeded', paidByStaffId: finance.id, paidAt: shared.at },
    });
    const paid = await about(finance, big.id, 'refund_ready_to_pay');
    expect(paid[0]).toMatchObject({ status: 'cleared', clearedReason: 'payment_succeeded', clearedBy: { id: finance.id } });

    const failed = await make$({ type: 'referral_payout', status: 'failed', amount: 20_000 });
    expect(await openAbout(finance, failed.id, 'payout_failed')).toHaveLength(1);
    expect(await openAbout(managerA, failed.id)).toHaveLength(0);
    await prisma.payment.update({ where: { id: failed.id }, data: { status: 'succeeded', paidByStaffId: finance.id } });
    const retried = await about(finance, failed.id, 'payout_failed');
    expect(retried[0]).toMatchObject({ status: 'cleared', clearedReason: 'payment_succeeded', clearedBy: { id: finance.id } });

    const credit = await prisma.bankCredit.create({
      data: { bankUtr: `UTR6${stamp}`, amountPaise: 49_900, receivedAt: shared.at, source: 'finance_manual' },
    });
    creditIds.push(credit.id);
    expect(await openAbout(finance, credit.id, 'bank_credit_unmatched')).toHaveLength(1);
    await prisma.bankCredit.update({ where: { id: credit.id }, data: { status: 'ignored', ignoredReason: 'Test' } });
    expect((await about(finance, credit.id, 'bank_credit_unmatched'))[0]).toMatchObject({
      status: 'cleared',
      clearedReason: 'credit_ignored',
    });
  });

  it('tells the CEO and Managers about someone without a reporting line until one is set', async () => {
    at(2027, 6, 30, 10);
    const orphan = await make('call_agent', 'ORP6', null);
    expect(await openAbout(ceo, orphan.id, 'no_reporting_line')).toHaveLength(1);
    expect(await openAbout(managerA, orphan.id, 'no_reporting_line')).toHaveLength(1);
    expect(await openAbout(leadA, orphan.id)).toHaveLength(0);
    await prisma.staff.update({ where: { id: orphan.id }, data: { teamLeadId: leadA.id, reportsToId: leadA.id } });
    expect((await about(ceo, orphan.id, 'no_reporting_line'))[0]).toMatchObject({
      status: 'cleared',
      clearedReason: 'line_set',
    });
  });

  it('never opens the same notification twice, even when asked at the same moment', async () => {
    const draft = {
      recipientStaffId: leadA.id,
      kind: 'shortage_task' as const,
      title: 'Same thing',
      subjectType: 'shortage_task',
      subjectId: `dup-${stamp}`,
    };
    await Promise.all([notifications.open(draft), notifications.open(draft), notifications.open(draft)]);
    expect(await prisma.notification.count({ where: { subjectId: draft.subjectId, clearedAt: null } })).toBe(1);
    await notifications.clear({ subjectType: draft.subjectType, subjectId: draft.subjectId }, { byStaffId: leadA.id, reason: 'test' });
    expect(await prisma.notification.count({ where: { subjectId: draft.subjectId, clearedAt: null } })).toBe(0);
  });

  it('shows each person only their own notifications: the bell, the page, and seen', async () => {
    const mine = await notifications.open({
      recipientStaffId: leadA.id,
      kind: 'shortage_task',
      title: 'Only for Team Lead A',
      subjectType: 'shortage_task',
      subjectId: `own-${stamp}`,
    });
    const bellA = await get(leadA, '/notifications/bell');
    expect(bellA.status).toBe(200);
    expect(bellA.body.latest.some((n: Item) => n.id === mine!.id)).toBe(true);
    expect(bellA.body).toEqual(
      expect.objectContaining({ openCount: expect.any(Number), latest: expect.any(Array), doneToday: expect.any(Array) }),
    );
    const bellB = await get(leadB, '/notifications/bell');
    expect(bellB.body.latest.some((n: Item) => n.id === mine!.id)).toBe(false);
    expect((await get(leadB, '/notifications?status=all&limit=200')).body.items.some((n: Item) => n.id === mine!.id)).toBe(false);
    expect((await post(leadB, `/notifications/${mine!.id}/seen`)).status).toBe(404);
    expect((await post(leadB, '/notifications/seen', { ids: [mine!.id] })).body).toMatchObject({ seen: 0 });

    expect((await get(leadA, '/notifications?kind=not_a_kind')).status).toBe(400);
    expect((await get(leadA, '/notifications?status=maybe')).status).toBe(400);
    expect((await request(app.getHttpServer()).get('/notifications/bell')).status).toBe(401);
  });
});
