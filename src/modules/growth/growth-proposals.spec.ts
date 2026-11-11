import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FollowUpService } from '../follow-up/follow-up.service';
import { ShortageTaskService } from './shortage-task.service';
import { WinBackService } from './win-back.service';

jest.setTimeout(180000);

const DAY = 24 * 60 * 60 * 1000;

/**
 * Proposals N1–N5 confirmed by Agastya on 11 Nov, end to end against the database:
 * who may see each list, what it holds, and that the daily sweeps are idempotent.
 */
describe('Growth proposals N1–N5 (confirmed 11 Nov)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const short = stamp.slice(-7);
  let counter = 0;

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const vacancyIds: string[] = [];
  const paymentIds: string[] = [];
  const placementIds: string[] = [];
  const callIds: string[] = [];
  const tradeIds: string[] = [];

  type StaffRow = Awaited<ReturnType<PrismaService['staff']['create']>>;
  const staff: Record<string, StaffRow> = {};

  const bakerTrade = `Growth Baker ${stamp}`;
  const cookTrade = `Growth Cook ${stamp}`;
  const area = `Growth Area ${stamp}`;
  const lat = 12.9352;
  const lng = 77.6245;

  function tokenFor(row: StaffRow): string {
    return jwt.sign({ sub: row.id, email: row.email, role: row.role, code: row.code, teamLeadId: row.teamLeadId ?? null });
  }

  async function makeStaff(key: string, role: string, line: { reportsToId?: string; teamLeadId?: string } = {}) {
    counter += 1;
    const row = await prisma.staff.create({
      data: {
        code: `GR-${role.slice(0, 3).toUpperCase()}-${stamp}-${counter}`,
        name: `Growth ${role} ${counter}`,
        email: `growth-${role}-${stamp}-${counter}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        reportsToId: line.reportsToId ?? line.teamLeadId ?? null,
        teamLeadId: line.teamLeadId ?? null,
      },
    });
    staffIds.push(row.id);
    staff[key] = row;
    return row;
  }

  function phone(): string {
    counter += 1;
    return `97${short}${String(counter).padStart(3, '0')}`.slice(0, 12);
  }

  async function makeSeeker(data: {
    status: string;
    trade?: string;
    paidDaysAgo?: number;
    registeredBy?: string;
    consents?: string[];
    foundOwnJobAt?: Date;
  }) {
    counter += 1;
    const paidAt = data.paidDaysAgo === undefined ? null : new Date(Date.now() - data.paidDaysAgo * DAY);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-GR-${stamp}-${counter}`,
        name: `Ravi Growth${counter}`,
        phone: phone(),
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: data.status,
        paymentReceivedAt: paidAt,
        registeredByStaffId: data.registeredBy ?? null,
        dateOfBirth: new Date('1995-02-03T00:00:00.000Z'),
        latitude: lat + 0.001,
        longitude: lng + 0.001,
        travelDistanceKm: 20,
        shiftPreference: 'any',
        locality: area,
        foundOwnJobAt: data.foundOwnJobAt ?? null,
      },
    });
    seekerIds.push(seeker.id);
    if (data.trade) {
      await prisma.jobSeekerTrade.create({
        data: { jobSeekerId: seeker.id, trade: data.trade, yearsExperience: 3, isPrimary: true },
      });
    }
    if (data.consents?.length) {
      await prisma.consent.createMany({
        data: data.consents.map((purpose) => ({
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          purpose,
          noticeVersion: `growth-${stamp}`,
          granted: true,
          language: 'en',
          method: 'sms_link',
          grantedAt: new Date(Date.now() - 60 * DAY),
        })),
      });
    }
    return seeker;
  }

  async function makeBusiness(accountAgentId: string) {
    counter += 1;
    const business = await prisma.business.create({
      data: {
        code: `BZ-GR-${stamp}-${counter}`,
        name: `Growth Hotel ${counter}`,
        phone: `96${short}${String(counter).padStart(3, '0')}`.slice(0, 12),
        phoneVerified: true,
        verificationStatus: 'verified',
        accountAgentId,
        locality: area,
        latitude: lat,
        longitude: lng,
      },
    });
    businessIds.push(business.id);
    return business;
  }

  async function makeVacancy(businessId: string, trade: string, headcount: number) {
    counter += 1;
    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-GR-${stamp}-${counter}`,
        businessId,
        tradeSkill: trade,
        headcount,
        status: 'open',
        confirmedAt: new Date(),
        salaryMinPaise: 1500000,
        salaryMaxPaise: 2000000,
        salaryPeriod: 'monthly',
        shift: 'day',
        latitude: lat,
        longitude: lng,
        locality: area,
      },
    });
    vacancyIds.push(vacancy.id);
    return vacancy;
  }

  async function makePayment(data: {
    type: string;
    amount: number;
    status: string;
    jobSeekerId?: string;
    placementId?: string;
    confirmedAt?: Date;
    createdAt?: Date;
  }) {
    counter += 1;
    const payment = await prisma.payment.create({
      data: {
        code: `PAY-GR-${stamp}-${counter}`,
        type: data.type,
        amount: data.amount,
        status: data.status,
        subjectType: data.placementId ? 'placement' : 'job_seeker',
        subjectId: data.placementId ?? data.jobSeekerId!,
        jobSeekerId: data.jobSeekerId ?? null,
        placementId: data.placementId ?? null,
        confirmedAt: data.confirmedAt ?? null,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
    });
    paymentIds.push(payment.id);
    return payment;
  }

  async function makeCall(subjectId: string, staffId: string, answered: boolean) {
    counter += 1;
    const call = await prisma.callRecord.create({
      data: {
        code: `CALL-GR-${stamp}-${counter}`,
        provider: 'mock',
        providerCallId: `gr-${stamp}-${counter}`,
        providerStatus: answered ? 'completed' : 'no-answer',
        answered,
        staffId,
        subjectType: 'job_seeker',
        subjectId,
        purpose: 'general',
      },
    });
    callIds.push(call.id);
    return call;
  }

  const get = (path: string, who: StaffRow) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(who)}`);
  const post = (path: string, who: StaffRow, body: object = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(who)}`).send(body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const ceo = await makeStaff('ceo', 'ceo');
    const m1 = await makeStaff('manager1', 'manager', { reportsToId: ceo.id });
    const m2 = await makeStaff('manager2', 'manager', { reportsToId: ceo.id });
    const tl1 = await makeStaff('lead1', 'team_lead', { reportsToId: m1.id });
    const tl2 = await makeStaff('lead2', 'team_lead', { reportsToId: m2.id });
    await makeStaff('field1', 'field_agent', { teamLeadId: tl1.id });
    await makeStaff('call1', 'call_agent', { teamLeadId: tl1.id });
    await makeStaff('field2', 'field_agent', { teamLeadId: tl2.id });
    await makeStaff('call2', 'call_agent', { teamLeadId: tl2.id });
    await makeStaff('finance', 'finance', { reportsToId: ceo.id });

    for (const name of [bakerTrade, cookTrade]) {
      const trade = await prisma.trade.create({
        data: {
          name,
          nameKey: name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN'),
          salaryMinPaise: 1200000,
          salaryMaxPaise: 2500000,
        },
      });
      tradeIds.push(trade.id);
    }
  });

  afterAll(async () => {
    try {
      await prisma.winBackEntry.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
      await prisma.shortageTask.deleteMany({
        where: { tradeKey: { in: [bakerTrade, cookTrade].map((t) => t.toLocaleLowerCase('en-IN')) } },
      });
      await prisma.followUpTask.deleteMany({
        where: { OR: [{ subjectId: { in: [...seekerIds, ...businessIds] } }, { assignedStaffId: { in: staffIds } }] },
      });
      await prisma.interview.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.placement.deleteMany({ where: { id: { in: placementIds } } });
      await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
      await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
      await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
      await prisma.trade.deleteMany({ where: { id: { in: tradeIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
      await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    } finally {
      await app.close();
    }
  });

  describe('N1 money still under guarantee', () => {
    it('places each rupee received in its state, by date range and as of now, for the CEO and Finance', async () => {
      const business = await makeBusiness(staff.field1.id);
      const vacancy = await makeVacancy(business.id, bakerTrade, 1);
      // Fill it straight away so the shortage test below starts from its own vacancies.
      await prisma.vacancy.update({ where: { id: vacancy.id }, data: { status: 'filled' } });

      const inside = await makeSeeker({ status: 'active', paidDaysAgo: 5 });
      const owed = await makeSeeker({ status: 'active', paidDaysAgo: 40 });
      const placed = await makeSeeker({ status: 'placed', paidDaysAgo: 20 });
      const refunded = await makeSeeker({ status: 'active', paidDaysAgo: 10 });
      const paidAt = async (id: string) => (await prisma.jobSeeker.findUniqueOrThrow({ where: { id } })).paymentReceivedAt!;

      const pInside = await makePayment({ type: 'activation', amount: 49900, status: 'succeeded', jobSeekerId: inside.id, confirmedAt: await paidAt(inside.id) });
      const pOwed = await makePayment({ type: 'activation', amount: 49900, status: 'succeeded', jobSeekerId: owed.id, confirmedAt: await paidAt(owed.id) });
      const pPlaced = await makePayment({ type: 'activation', amount: 49900, status: 'succeeded', jobSeekerId: placed.id, confirmedAt: await paidAt(placed.id) });
      const pRefunded = await makePayment({ type: 'activation', amount: 49900, status: 'succeeded', jobSeekerId: refunded.id, confirmedAt: await paidAt(refunded.id) });
      await makePayment({ type: 'refund', amount: 49900, status: 'approved', jobSeekerId: refunded.id });

      const makePlacement = async (joinedDaysAgo: number, status: string) => {
        counter += 1;
        const row = await prisma.placement.create({
          data: {
            code: `PL-GR-${stamp}-${counter}`,
            vacancyId: vacancy.id,
            jobSeekerId: placed.id,
            businessId: business.id,
            placementFee: 750000,
            gstAmount: 135000,
            agreedSalary: 1500000,
            status,
            paidAt: new Date(Date.now() - (joinedDaysAgo + 1) * DAY),
            joinedDate: new Date(Date.now() - joinedDaysAgo * DAY),
          },
        });
        placementIds.push(row.id);
        return row;
      };
      const recent = await makePlacement(10, 'active');
      const old = await makePlacement(70, 'completed');
      const pRecent = await makePayment({ type: 'placement_fee', amount: 885000, status: 'succeeded', placementId: recent.id, confirmedAt: recent.paidAt! });
      const pOld = await makePayment({ type: 'placement_fee', amount: 885000, status: 'succeeded', placementId: old.id, confirmedAt: old.paidAt! });

      const all = await get('/growth/money-under-guarantee?details=true', staff.ceo).expect(200);
      const stateOf = (code: string) =>
        (all.body.rows as Array<{ paymentCode: string; state: string }>).find((row) => row.paymentCode === code)?.state;
      expect(stateOf(pInside.code)).toBe('under_guarantee');
      expect(stateOf(pOwed.code)).toBe('refund_due');
      expect(stateOf(pPlaced.code)).toBe('safely_earned');
      expect(stateOf(pRefunded.code)).toBe('refunded');
      expect(stateOf(pRecent.code)).toBe('under_guarantee');
      expect(stateOf(pOld.code)).toBe('safely_earned');

      const totals = all.body.asOfNow;
      expect(totals.activation.underGuaranteePaise).toBeGreaterThanOrEqual(49900);
      expect(totals.placementFee.underGuaranteePaise).toBeGreaterThanOrEqual(885000);
      for (const bucket of [totals.total, totals.activation, totals.placementFee]) {
        expect(bucket.couldGoBackPaise).toBe(bucket.underGuaranteePaise + bucket.refundDuePaise);
        expect(bucket.receivedPaise).toBe(
          bucket.underGuaranteePaise + bucket.refundDuePaise + bucket.refundedPaise + bucket.safelyEarnedPaise,
        );
      }
      expect(totals.total.receivedPaise).toBe(totals.activation.receivedPaise + totals.placementFee.receivedPaise);

      // A date range picks payments by the IST day they arrived.
      const istDay = new Date(pInside.confirmedAt!.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const ranged = await get(`/growth/money-under-guarantee?from=${istDay}&to=${istDay}&details=true`, staff.finance).expect(200);
      const rangedCodes = (ranged.body.rows as Array<{ paymentCode: string }>).map((row) => row.paymentCode);
      expect(rangedCodes).toContain(pInside.code);
      expect(rangedCodes).not.toContain(pOwed.code);
      expect(ranged.body.range).toMatchObject({ from: istDay, to: istDay });
      expect(ranged.body.range.activation.underGuaranteePaise).toBeGreaterThanOrEqual(49900);

      await get('/growth/money-under-guarantee?from=2026-11-01', staff.ceo).expect(400);
      await get('/growth/money-under-guarantee?from=1-11-2026&to=2026-11-02', staff.ceo).expect(400);
    });

    it.each(['manager1', 'lead1', 'call1', 'field1'])('refuses %s: only the CEO and Finance see money', async (key) => {
      await get('/growth/money-under-guarantee', staff[key]).expect(403);
    });
  });

  describe('N2 days to first interview', () => {
    let waiting12: string;
    let waiting5: string;
    let interviewed: string;
    let otherTeam: string;

    beforeAll(async () => {
      waiting12 = (await makeSeeker({ status: 'active', paidDaysAgo: 12, registeredBy: staff.call1.id })).id;
      waiting5 = (await makeSeeker({ status: 'active', paidDaysAgo: 5, registeredBy: staff.call1.id })).id;
      interviewed = (await makeSeeker({ status: 'active', paidDaysAgo: 12, registeredBy: staff.call1.id })).id;
      otherTeam = (await makeSeeker({ status: 'active', paidDaysAgo: 15, registeredBy: staff.call2.id })).id;
      // Not paying job seekers waiting for work: deactivated, and refunded in this guarantee.
      await makeSeeker({ status: 'deactivated', paidDaysAgo: 20, registeredBy: staff.call1.id });
      const refunded = await makeSeeker({ status: 'active', paidDaysAgo: 31, registeredBy: staff.call1.id });
      await makePayment({ type: 'refund', amount: 49900, status: 'approved', jobSeekerId: refunded.id });

      const business = await makeBusiness(staff.field1.id);
      const vacancy = await makeVacancy(business.id, cookTrade, 1);
      await prisma.vacancy.update({ where: { id: vacancy.id }, data: { status: 'filled' } });
      const slot = await prisma.vacancyInterviewSlot.create({
        data: { vacancyId: vacancy.id, startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() - 2 * DAY + 3600000) },
      });
      counter += 1;
      await prisma.interview.create({
        data: {
          code: `INT-GR-${stamp}-${counter}`,
          vacancyId: vacancy.id,
          businessId: business.id,
          jobSeekerId: interviewed,
          vacancyInterviewSlotId: slot.id,
          slotStartsAt: slot.startsAt,
          slotEndsAt: slot.endsAt,
          proposedByStaffId: staff.call1.id,
          proposedAt: new Date(Date.now() - 3 * DAY),
          suitabilitySnapshot: {},
          status: 'completed',
          offerSentAt: new Date(Date.now() - 3 * DAY),
          replyDueAt: new Date(Date.now() - DAY),
          resultDueAt: new Date(Date.now() - DAY),
        },
      });
    });

    const ids = (body: { rows: Array<{ jobSeekerId: string }> }) => body.rows.map((row) => row.jobSeekerId);

    it('lists a Team Lead\'s own team only: paid 10+ days ago with no interview booked since', async () => {
      const res = await get('/growth/days-to-first-interview', staff.lead1).expect(200);
      expect(res.body.minDays).toBe(10);
      expect(ids(res.body)).toEqual([waiting12]);
      expect(res.body.rows[0]).toMatchObject({ daysSincePaid: 12, daysLeftOnGuarantee: 18, firstName: expect.any(String) });
      expect(JSON.stringify(res.body)).not.toMatch(/paise|phone|amount/i);

      const lead2 = await get('/growth/days-to-first-interview', staff.lead2).expect(200);
      expect(ids(lead2.body)).toEqual([otherTeam]);

      const everyDay = await get('/growth/days-to-first-interview?minDays=0', staff.lead1).expect(200);
      expect(ids(everyDay.body)).toEqual([waiting12, waiting5]);
    });

    it('gives a Manager his own tree and the CEO everyone', async () => {
      const manager = await get('/growth/days-to-first-interview', staff.manager1).expect(200);
      expect(ids(manager.body)).toContain(waiting12);
      expect(ids(manager.body)).not.toContain(otherTeam);
      const ceo = await get('/growth/days-to-first-interview', staff.ceo).expect(200);
      expect(ids(ceo.body)).toEqual(expect.arrayContaining([waiting12, otherTeam]));
      expect(ids(ceo.body)).not.toContain(interviewed);
    });

    it('returns one number for the Command Center', async () => {
      const lead = await get('/growth/days-to-first-interview/summary', staff.lead1).expect(200);
      expect(lead.body).toMatchObject({ minDays: 10, waitingCount: 1, waitingAnyDays: 2, oldestDays: 12 });
      const ceo = await get('/growth/days-to-first-interview/summary', staff.ceo).expect(200);
      expect(ceo.body.waitingCount).toBeGreaterThanOrEqual(2);
    });

    it.each(['call1', 'field1', 'finance'])('refuses %s', async (key) => {
      await get('/growth/days-to-first-interview', staff[key]).expect(403);
      await get('/growth/days-to-first-interview/summary', staff[key]).expect(403);
    });

    it('rejects a nonsense minDays', async () => {
      await get('/growth/days-to-first-interview?minDays=-3', staff.ceo).expect(400);
    });
  });

  describe('N3 trade and area shortage tasks', () => {
    const key = `${bakerTrade.toLocaleLowerCase('en-IN')}|${area.toLocaleLowerCase('en-IN')}`;

    it('opens one task per trade and area for the Team Lead with the most open positions, once', async () => {
      const business1 = await makeBusiness(staff.field1.id);
      const business2 = await makeBusiness(staff.field2.id);
      await makeVacancy(business1.id, bakerTrade, 4);
      await makeVacancy(business2.id, bakerTrade, 2);

      const sweeps = app.get(ShortageTaskService);
      await sweeps.sweep(new Date());
      const task = await prisma.shortageTask.findUniqueOrThrow({ where: { openKey: key } });
      expect(task).toMatchObject({
        status: 'open',
        openPositions: 6,
        trade: bakerTrade,
        area,
        assignedTeamLeadId: staff.lead1.id,
      });
      expect(task.title).toBe(
        `${bakerTrade}, ${area}: 6 open, 0 available — send agents to register ${bakerTrade.toLocaleLowerCase('en-IN')}s here`,
      );

      await sweeps.sweep(new Date());
      const open = await prisma.shortageTask.findMany({ where: { tradeKey: task.tradeKey, areaKey: task.areaKey } });
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(task.id);
    });

    it('lists open tasks for the Team Lead, his Manager and the CEO only', async () => {
      const has = (body: Array<{ trade: string }>) => body.some((row) => row.trade === bakerTrade);
      expect(has((await get('/growth/shortage-tasks', staff.lead1).expect(200)).body)).toBe(true);
      expect(has((await get('/growth/shortage-tasks', staff.manager1).expect(200)).body)).toBe(true);
      expect(has((await get('/growth/shortage-tasks', staff.ceo).expect(200)).body)).toBe(true);
      expect(has((await get('/growth/shortage-tasks', staff.lead2).expect(200)).body)).toBe(false);
      expect(has((await get('/growth/shortage-tasks', staff.manager2).expect(200)).body)).toBe(false);
      const row = (await get('/growth/shortage-tasks', staff.lead1).expect(200)).body.find(
        (r: { trade: string }) => r.trade === bakerTrade,
      );
      expect(row).toMatchObject({ openPositions: 6, openVacancies: 2, available: 0, assignedTeamLead: { id: staff.lead1.id } });
      await get('/growth/shortage-tasks', staff.field1).expect(403);
      await get('/growth/shortage-tasks', staff.finance).expect(403);
      await post('/growth/shortage-tasks/run', staff.manager1).expect(403);
    });

    it('closes the task by itself when a matching job seeker registers nearby', async () => {
      await makeSeeker({ status: 'active', trade: bakerTrade, paidDaysAgo: 1, consents: ['job_matching', 'profile_sharing'] });
      const result = (await post('/growth/shortage-tasks/run', staff.ceo).expect(201)).body;
      expect(result.closed).toBeGreaterThanOrEqual(1);
      const tasks = await prisma.shortageTask.findMany({ where: { tradeKey: bakerTrade.toLocaleLowerCase('en-IN') } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ status: 'closed', openKey: null, closedReason: 'supply_appeared' });
    });
  });

  describe('N5 win-back list', () => {
    let deactivated: string;
    let refunded: string;
    let closedOwnJob: string;
    let noAlerts: string;
    const allConsents = ['job_matching', 'profile_sharing', 'job_updates', 'call_recording'];

    beforeAll(async () => {
      deactivated = (await makeSeeker({ status: 'deactivated', trade: cookTrade, paidDaysAgo: 40, registeredBy: staff.call1.id, consents: allConsents })).id;
      refunded = (await makeSeeker({ status: 'active', trade: cookTrade, paidDaysAgo: 35, registeredBy: staff.call1.id, consents: allConsents })).id;
      await makePayment({ type: 'refund', amount: 49900, status: 'approved', jobSeekerId: refunded, createdAt: new Date(Date.now() - 2 * DAY) });
      closedOwnJob = (await makeSeeker({ status: 'closed', trade: cookTrade, paidDaysAgo: 20, consents: allConsents, foundOwnJobAt: new Date(Date.now() - 5 * DAY) })).id;
      noAlerts = (await makeSeeker({ status: 'deactivated', trade: cookTrade, paidDaysAgo: 40, consents: ['job_matching', 'profile_sharing', 'call_recording'] })).id;

      const business = await makeBusiness(staff.field1.id);
      await makeVacancy(business.id, cookTrade, 1);
    });

    const entriesFor = (jobSeekerId: string) => prisma.winBackEntry.findMany({ where: { jobSeekerId } });

    it('adds refunded and deactivated job seekers matched by a new vacancy, once, with the vacancy', async () => {
      const sweeps = app.get(WinBackService);
      await sweeps.sweep(new Date());
      await sweeps.sweep(new Date());

      const d = await entriesFor(deactivated);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ status: 'open', reason: 'deactivated', openKey: deactivated });
      expect(vacancyIds).toContain(d[0].vacancyId);
      const r = await entriesFor(refunded);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ status: 'open', reason: 'refunded' });

      // Found his own job: never. No consent to job alerts: never.
      expect(await entriesFor(closedOwnJob)).toHaveLength(0);
      expect(await entriesFor(noAlerts)).toHaveLength(0);
    });

    it('shows the list to call agents with who can be called now (9 AM–9 PM, his window)', async () => {
      const noon = await get('/growth/win-back?asOf=2026-11-12T06:30:00.000Z', staff.call1).expect(200);
      const row = noon.body.rows.find((r: { jobSeeker: { id: string } }) => r.jobSeeker.id === deactivated);
      expect(row).toMatchObject({
        reason: 'deactivated',
        callableNow: true,
        vacancy: { trade: cookTrade, area },
        jobSeeker: { firstName: 'Ravi', trade: cookTrade },
      });
      expect(JSON.stringify(row)).not.toMatch(/phone|business/i);

      const night = await get('/growth/win-back?asOf=2026-11-12T17:00:00.000Z', staff.call1).expect(200);
      const nightRow = night.body.rows.find((r: { jobSeeker: { id: string } }) => r.jobSeeker.id === deactivated);
      expect(nightRow.callableNow).toBe(false);
      const nightCallable = await get('/growth/win-back?callableNow=true&asOf=2026-11-12T17:00:00.000Z', staff.call1).expect(200);
      expect(nightCallable.body.rows).toEqual([]);
    });

    it('scopes Team Leads to their team and refuses field agents and Finance', async () => {
      const has = (body: { rows: Array<{ jobSeeker: { id: string } }> }) => body.rows.some((r) => r.jobSeeker.id === deactivated);
      expect(has((await get('/growth/win-back', staff.lead1).expect(200)).body)).toBe(true);
      expect(has((await get('/growth/win-back', staff.lead2).expect(200)).body)).toBe(false);
      expect(has((await get('/growth/win-back', staff.ceo).expect(200)).body)).toBe(true);
      await get('/growth/win-back', staff.field1).expect(403);
      await get('/growth/win-back', staff.finance).expect(403);
    });

    it('takes him off when he says no on an answered call, and does not list him again', async () => {
      const [entry] = await entriesFor(deactivated);
      await post(`/growth/win-back/${entry.id}/decline`, staff.call1, {}).expect(400);
      const missed = await makeCall(deactivated, staff.call1.id, false);
      await post(`/growth/win-back/${entry.id}/decline`, staff.call1, { callRecordId: missed.id }).expect(400);
      const wrongPerson = await makeCall(refunded, staff.call1.id, true);
      await post(`/growth/win-back/${entry.id}/decline`, staff.call1, { callRecordId: wrongPerson.id }).expect(400);
      await post(`/growth/win-back/${entry.id}/decline`, staff.lead2, { callRecordId: wrongPerson.id }).expect(403);

      const answered = await makeCall(deactivated, staff.call1.id, true);
      const res = await post(`/growth/win-back/${entry.id}/decline`, staff.call1, { callRecordId: answered.id, reason: 'Working in his village now' }).expect(201);
      expect(res.body).toMatchObject({ status: 'declined', closedReason: 'said_no', openKey: null, callRecordId: answered.id });

      await app.get(WinBackService).sweep(new Date());
      const after = await entriesFor(deactivated);
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe('declined');
      const list = await get('/growth/win-back', staff.call1).expect(200);
      expect(list.body.rows.some((r: { jobSeeker: { id: string } }) => r.jobSeeker.id === deactivated)).toBe(false);
    });

    it('takes him off when he registers again (pays again)', async () => {
      await prisma.jobSeeker.update({ where: { id: refunded }, data: { paymentReceivedAt: new Date(), status: 'active' } });
      const list = await get('/growth/win-back', staff.call1).expect(200);
      expect(list.body.rows.some((r: { jobSeeker: { id: string } }) => r.jobSeeker.id === refunded)).toBe(false);
      await post('/growth/win-back/run', staff.ceo).expect(201);
      const [entry] = await entriesFor(refunded);
      expect(entry).toMatchObject({ status: 're_registered', closedReason: 're_registered', openKey: null });
    });
  });

  describe('N4 repeat-business reminders through the follow-up sweep', () => {
    it('creates the day-30 reminder for the account agent once', async () => {
      const business = await makeBusiness(staff.field1.id);
      const vacancy = await makeVacancy(business.id, cookTrade, 1);
      await prisma.vacancy.update({ where: { id: vacancy.id }, data: { status: 'filled' } });
      const worker = await makeSeeker({ status: 'placed' });
      counter += 1;
      const placement = await prisma.placement.create({
        data: {
          code: `PL-GR-${stamp}-${counter}`,
          vacancyId: vacancy.id,
          jobSeekerId: worker.id,
          businessId: business.id,
          placementFee: 750000,
          gstAmount: 135000,
          status: 'active',
          joinedDate: new Date(Date.now() - 30 * DAY - 60 * 60 * 1000),
        },
      });
      placementIds.push(placement.id);

      const startedAt = new Date();
      const followUps = app.get(FollowUpService);
      await followUps.createScheduledTasks(new Date());
      await followUps.createScheduledTasks(new Date());
      const tasks = await prisma.followUpTask.findMany({
        where: { relatedType: 'placement', relatedId: placement.id, kind: { startsWith: 'repeat_business' } },
      });
      // The daily sweep also creates tasks for other suites' leftovers; remove those again.
      await prisma.followUpTask.deleteMany({
        where: { createdAt: { gte: startedAt }, subjectId: { notIn: [...seekerIds, ...businessIds] } },
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        kind: 'repeat_business_day_30',
        subjectType: 'business',
        subjectId: business.id,
        assignedStaffId: staff.field1.id,
        status: 'pending',
      });
    });
  });
});
