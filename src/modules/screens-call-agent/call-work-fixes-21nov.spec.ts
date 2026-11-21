import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as request from 'supertest';
import { CallRecord } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CallClock } from '../call/call-clock';
import { CallService } from '../call/call.service';
import { CallFollowThroughService, RETRY_UNANSWERED_LIMIT } from '../call/call-follow-through.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { ConsentClock } from '../consent/consent-clock';
import { PricingService } from '../pricing/pricing.service';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { openAvailableDay } from '../../test-support/available-day';
import { MissedCallAssigner } from '../telephony/missed-call-assigner.service';
import { InboundCallRouter } from '../telephony/inbound-call-router.service';
import { FollowUpHandoverService } from '../follow-up/follow-up-handover.service';
import { WorkHandoverService, FIELD_HANDOVER } from '../follow-up/work-handover.service';
import { CallWorkClock } from './call-work-clock';

/**
 * 21 Nov fixes (Master Guide rev 202, "Call agent and field agent fixes"), call
 * work and leads: missed calls handed out and grouped, new callers listed, the
 * Team Lead's missed-call list and bells, inbound routing by fewest open items,
 * the new call results (wrong number, do not call, busy, switched off), every
 * retry stopping after 3 tries, Assign reaching the agent's lists, and the leave
 * and no-show handover of all open call work.
 */

/** 11:30 IST on Wednesday 11 Nov 2026: inside calling hours, 2 hours after the 09:30 shift start. */
const NOW = new Date('2026-11-11T06:00:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const TELEPHONY_SECRET = 'call_work_fixes_telephony_secret_32chars';
const ROUTING_KEY = 'call_work_fixes_routing_key_32_characters';

class FrozenClock {
  at = NOW;
  now(): Date {
    return this.at;
  }
}

describe('21 Nov fixes: call work and leads', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const clock = new FrozenClock();
  const stamp = Date.now();
  const digits = (n: number) => `8${String(stamp).slice(-7)}${String(n).padStart(2, '0')}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const phones: string[] = [];
  let seq = 0;

  const token = (s: { id: string; role: string; code: string }) => jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });

  async function makeStaff(role: string, extra: { teamLeadId?: string; reportsToId?: string; routing?: string } = {}) {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `CF-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Fix ${role} ${n}`,
        email: `cf-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Fix-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: extra.teamLeadId ?? null,
        reportsToId: extra.reportsToId ?? null,
        callRoutingPhone: extra.routing ? encryptCallRoutingPhone(extra.routing) : null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  async function makeSeeker(data: { name: string; registeredByStaffId?: string | null; assignedStaffId?: string | null; paidDaysAgo?: number; status?: string }) {
    const n = ++seq;
    const phone = `+91${digits(n)}`;
    phones.push(phone);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-8${String(stamp).slice(-3)}${String(n).padStart(2, '0')}`,
        name: data.name,
        phone,
        minSalary: 1500000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: data.status ?? 'active',
        registeredByStaffId: data.registeredByStaffId ?? null,
        assignedStaffId: data.assignedStaffId ?? null,
        paymentReceivedAt: data.paidDaysAgo !== undefined ? new Date(NOW.getTime() - data.paidDaysAgo * DAY) : null,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
      },
    });
    seekerIds.push(seeker.id);
    for (const purpose of ['call_recording', 'job_matching']) {
      await prisma.consent.create({
        data: { subjectType: 'job_seeker', subjectId: seeker.id, purpose, noticeVersion: 'fix-21nov', granted: true, language: 'en', method: 'sms_link', grantedAt: new Date(NOW.getTime() - 40 * DAY) },
      });
    }
    return seeker;
  }

  async function missedCall(phone: string, minutesAgo: number, assignedToStaffId: string | null = null) {
    if (!phones.includes(phone)) phones.push(phone);
    return prisma.callbackTask.create({
      data: {
        callId: `cf-${stamp}-${++seq}`,
        phone,
        status: assignedToStaffId ? 'assigned' : 'pending',
        assignedToStaffId,
        createdAt: new Date(NOW.getTime() - minutesAgo * MIN),
      },
    });
  }

  async function callRecord(data: { staffId: string; subjectId: string; answered: boolean; status: string; minutesAgo?: number; purpose?: string }): Promise<CallRecord> {
    const n = ++seq;
    const at = new Date(NOW.getTime() - (data.minutesAgo ?? 0) * MIN);
    return prisma.callRecord.create({
      data: {
        code: `CR-CF-${stamp}-${n}`,
        provider: 'mock',
        providerCallId: `cf-${stamp}-${n}`,
        direction: 'outbound',
        staffId: data.staffId,
        subjectType: 'job_seeker',
        subjectId: data.subjectId,
        purpose: data.purpose ?? 'general',
        providerStatus: data.status,
        answered: data.answered,
        startedAt: at,
        answeredAt: data.answered ? at : null,
        endedAt: new Date(at.getTime() + 30_000),
        createdAt: at,
      },
    });
  }

  let manager: Awaited<ReturnType<typeof makeStaff>>;
  let lead1: Awaited<ReturnType<typeof makeStaff>>;
  let lead2: Awaited<ReturnType<typeof makeStaff>>;
  let agentA: Awaited<ReturnType<typeof makeStaff>>;
  let agentB: Awaited<ReturnType<typeof makeStaff>>;
  let agentC: Awaited<ReturnType<typeof makeStaff>>;
  let agentD: Awaited<ReturnType<typeof makeStaff>>;

  beforeAll(async () => {
    process.env.TELEPHONY_WEBHOOK_SECRET = TELEPHONY_SECRET;
    process.env.CALL_ROUTING_KEY = ROUTING_KEY;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CallClock)
      .useValue(clock)
      .overrideProvider(AttendanceClock)
      .useValue(clock)
      .overrideProvider(CallWorkClock)
      .useValue(clock)
      .overrideProvider(ConsentClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    manager = await makeStaff('manager');
    lead1 = await makeStaff('team_lead', { reportsToId: manager.id });
    lead2 = await makeStaff('team_lead');
    agentA = await makeStaff('call_agent', { teamLeadId: lead1.id, routing: '+918812300001' });
    agentB = await makeStaff('call_agent', { teamLeadId: lead1.id, routing: '+918812300002' });
    agentC = await makeStaff('call_agent', { teamLeadId: lead2.id, routing: '+918812300003' });
    agentD = await makeStaff('call_agent', { teamLeadId: lead2.id, routing: '+918812300004' });
    await openAvailableDay(app, agentA.id);
    await openAvailableDay(app, agentB.id);
    await openAvailableDay(app, agentD.id);
  }, 120000);

  afterEach(async () => {
    clock.at = NOW;
    // Each test starts with empty lists for its agents.
    await prisma.callTask.deleteMany({ where: { OR: [{ staffId: { in: staffIds } }, { subjectId: { in: seekerIds } }] } });
    await prisma.callbackTask.deleteMany({ where: { OR: [{ phone: { in: phones } }, { assignedToStaffId: { in: staffIds } }] } });
    await prisma.followUpTask.deleteMany({ where: { OR: [{ subjectId: { in: seekerIds } }, { assignedStaffId: { in: staffIds } }] } });
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: staffIds } } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.workHandover.deleteMany({ where: { fromStaffId: { in: staffIds } } });
    await prisma.signupTrackerEvent.deleteMany({ where: { tracker: { assignedStaffId: { in: staffIds } } } });
    await prisma.signupTracker.deleteMany({ where: { OR: [{ assignedStaffId: { in: staffIds } }, { subjectId: { in: seekerIds } }] } });
    await prisma.contactBlock.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.callRecord.deleteMany({ where: { OR: [{ staffId: { in: staffIds } }, { subjectId: { in: seekerIds } }] } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [...staffIds, 'system'] }, createdAt: { gte: new Date(stamp - 60_000) }, action: { startsWith: 'call' } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.leaveRequest.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  // ------------------------------------------------------------------ missed calls

  it('hands out missed calls: the same caller to one agent, his own agent if on shift, else the fewest open items; repeats are one row and unknown numbers a "New caller" row', async () => {
    const assigner = app.get(MissedCallAssigner);
    const own = await makeSeeker({ name: 'Own Missedcall', registeredByStaffId: agentA.id });
    // agentA already has more open work than agentB.
    for (const minutes of [10, 20, 30]) {
      await prisma.callTask.create({ data: { staffId: agentA.id, subjectType: 'job_seeker', subjectId: own.id, kind: 'retry', dueAt: new Date(NOW.getTime() + minutes * MIN) } });
    }
    const unknown = `+91${digits(90)}`;
    const first = await missedCall(unknown, 40);
    const repeat = await missedCall(unknown, 25);
    const known = await missedCall(own.phone, 30);

    expect(await assigner.assignWaiting(NOW)).toBeGreaterThanOrEqual(3);
    const rows = await prisma.callbackTask.findMany({ where: { id: { in: [first.id, repeat.id, known.id] } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first.id)).toMatchObject({ assignedToStaffId: agentB.id, assignmentReason: 'fewest_open', status: 'assigned' });
    expect(byId.get(repeat.id)).toMatchObject({ assignedToStaffId: agentB.id, assignmentReason: 'same_caller' });
    expect(byId.get(known.id)).toMatchObject({ assignedToStaffId: agentA.id, assignmentReason: 'own_agent', jobSeekerId: own.id });
    // A repeat run gives nothing out twice.
    expect(await assigner.assignWaiting(NOW)).toBe(0);

    const homeB = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentB)}`).expect(200);
    expect(homeB.body.newCallers).toHaveLength(1);
    expect(homeB.body.newCallers[0]).toMatchObject({ callbackTaskId: first.id, count: 2, maskedPhone: `******${unknown.slice(-4)}` });
    expect(JSON.stringify(homeB.body)).not.toContain(unknown);

    const homeA = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentA)}`).expect(200);
    const missed = homeA.body.work.items.find((i: { kind: string }) => i.kind === 'missed_call');
    expect(missed).toMatchObject({ subjectId: own.id, detail: { callbackTaskId: known.id, count: 1 } });
  });

  it('ranks missed calls just below callbacks due now and above callbacks due later', async () => {
    const dueNow = await makeSeeker({ name: 'Due Now Rank' });
    const dueLater = await makeSeeker({ name: 'Due Later Rank' });
    const caller = await makeSeeker({ name: 'Caller Rank', registeredByStaffId: agentA.id });
    await prisma.callTask.create({ data: { staffId: agentA.id, subjectType: 'job_seeker', subjectId: dueNow.id, kind: 'callback', dueAt: new Date(NOW.getTime() - 5 * MIN) } });
    await prisma.callTask.create({ data: { staffId: agentA.id, subjectType: 'job_seeker', subjectId: dueLater.id, kind: 'callback', dueAt: new Date(NOW.getTime() + 60 * MIN) } });
    await missedCall(caller.phone, 50, agentA.id);
    const home = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentA)}`).expect(200);
    const order = home.body.work.items.map((i: { subjectId: string }) => i.subjectId).filter((id: string) => [dueNow.id, dueLater.id, caller.id].includes(id));
    expect(order).toEqual([dueNow.id, caller.id, dueLater.id]);
  });

  it('bells the Team Lead after 15 minutes without a first call back and the Manager after an hour; the bells clear once he is called back', async () => {
    const assigner = app.get(MissedCallAssigner);
    const caller = await makeSeeker({ name: 'Bell Missedcall', registeredByStaffId: agentA.id });
    const task = await missedCall(caller.phone, 10, agentA.id);
    await assigner.sweep(NOW);
    expect(await prisma.notification.count({ where: { kind: 'missed_call_waiting', subjectId: task.id, clearedAt: null } })).toBe(0);

    await assigner.sweep(new Date(NOW.getTime() + 6 * MIN));
    expect(await prisma.notification.findMany({ where: { kind: 'missed_call_waiting', subjectId: task.id, clearedAt: null }, select: { recipientStaffId: true } })).toEqual([{ recipientStaffId: lead1.id }]);

    await assigner.sweep(new Date(NOW.getTime() + 55 * MIN));
    const open = await prisma.notification.findMany({ where: { kind: 'missed_call_waiting', subjectId: task.id, clearedAt: null }, select: { recipientStaffId: true } });
    expect(open.map((n) => n.recipientStaffId).sort()).toEqual([lead1.id, manager.id].sort());
    expect(open.map((n) => n.recipientStaffId)).not.toContain(lead2.id);

    // agentA calls him back (no answer): the missed call is done, with its first try recorded.
    const call = await callRecord({ staffId: agentA.id, subjectId: caller.id, answered: false, status: 'no_answer', minutesAgo: -56 });
    await app.get(CallFollowThroughService).onStatusChanged(null, call);
    expect(await prisma.callbackTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'completed', firstAttemptAt: call.startedAt });
    await assigner.sweep(new Date(NOW.getTime() + 60 * MIN));
    expect(await prisma.notification.count({ where: { kind: 'missed_call_waiting', subjectId: task.id, clearedAt: null } })).toBe(0);
  });

  it('a missed call nobody holds rings every Team Lead; nothing is handed out or rung outside the calling hours', async () => {
    const assigner = app.get(MissedCallAssigner);
    const night = new Date('2026-11-11T17:00:00.000Z'); // 22:30 IST
    const task = await missedCall(`+91${digits(91)}`, 30);
    expect(await assigner.sweep(night)).toEqual({ assigned: 0, waiting: 0, bells: 0 });
    // Inside the hours, with nobody on shift to take it.
    await prisma.attendanceDay.updateMany({ where: { staffId: { in: [agentA.id, agentB.id, agentD.id] } }, data: { logoutAt: NOW } });
    try {
      await assigner.sweep(NOW);
      expect(await prisma.callbackTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ assignedToStaffId: null });
      const leads = await prisma.notification.findMany({ where: { kind: 'missed_call_waiting', subjectId: task.id, clearedAt: null }, select: { recipientStaffId: true } });
      expect(leads.map((l) => l.recipientStaffId)).toEqual(expect.arrayContaining([lead1.id, lead2.id]));
    } finally {
      await prisma.attendanceDay.updateMany({ where: { staffId: { in: [agentA.id, agentB.id, agentD.id] } }, data: { logoutAt: null } });
    }
  });

  it("Team Lead's missed-call list: their team's and nobody's, grouped by number, with agents to give them to; agents may take one only for themselves", async () => {
    const shared = `+91${digits(92)}`;
    const free1 = await missedCall(shared, 30);
    await missedCall(shared, 20);
    const mine = await missedCall(`+91${digits(93)}`, 15, agentB.id);
    const theirs = await missedCall(`+91${digits(94)}`, 15, agentC.id);

    const list = await request(app.getHttpServer()).get('/telephony/missed-calls').set('Authorization', `Bearer ${token(lead1)}`).expect(200);
    const ids = list.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([free1.id, mine.id]));
    expect(ids).not.toContain(theirs.id);
    expect(list.body.rows.find((r: { id: string }) => r.id === free1.id)).toMatchObject({ count: 2, holder: null, maskedPhone: `******${shared.slice(-4)}` });
    expect(JSON.stringify(list.body)).not.toContain(shared);
    expect(list.body.agents.map((a: { id: string }) => a.id).sort()).toEqual([agentA.id, agentB.id].sort());
    await request(app.getHttpServer()).get('/telephony/missed-calls').set('Authorization', `Bearer ${token(agentA)}`).expect(403);

    // POST /telephony/callbacks/:id/assign: an agent gives a missed call to a colleague — refused (403)
    await request(app.getHttpServer()).post(`/telephony/callbacks/${free1.id}/assign`).set('Authorization', `Bearer ${token(agentA)}`).send({ staffId: agentB.id }).expect(403);
    const taken = await request(app.getHttpServer()).post(`/telephony/callbacks/${free1.id}/assign`).set('Authorization', `Bearer ${token(agentA)}`).send({}).expect(201);
    expect(taken.body).toMatchObject({ assignedToStaffId: agentA.id, assignmentReason: 'taken' });
    // The repeat from the same number goes with it.
    expect(await prisma.callbackTask.count({ where: { phone: shared, assignedToStaffId: agentA.id } })).toBe(2);
    // The Team Lead gives one to their own agent; another team's stays out of reach.
    await request(app.getHttpServer()).post(`/telephony/callbacks/${mine.id}/assign`).set('Authorization', `Bearer ${token(lead1)}`).send({ staffId: agentA.id }).expect(201);
    await request(app.getHttpServer()).post(`/telephony/callbacks/${theirs.id}/assign`).set('Authorization', `Bearer ${token(lead1)}`).send({ staffId: agentA.id }).expect(403);
  });

  it('inbound calls go to the free agent with the fewest open items, round robin on a tie — never always the first by staff code', async () => {
    const router = app.get(InboundCallRouter);
    const someone = await makeSeeker({ name: 'Load Inbound' });
    // agentD is free too (other team); give both B and D more work than A.
    for (const staffId of [agentB.id, agentD.id]) {
      await prisma.callTask.create({ data: { staffId, subjectType: 'job_seeker', subjectId: someone.id, kind: 'retry', dueAt: NOW } });
    }
    expect(await router.pickAgent({}, null)).toBe(agentA.id);
    // Now A has the most; B and D tie: the one rung longest ago (never rung = first).
    for (let i = 0; i < 3; i += 1) {
      await prisma.callTask.create({ data: { staffId: agentA.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'retry', dueAt: NOW } });
    }
    await missedCall(`+91${digits(95)}`, 1, agentB.id);
    await prisma.callTask.create({ data: { staffId: agentD.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'retry', dueAt: NOW } });
    // B: 1 task + 1 missed call = 2, D: 2 tasks, A: 3. D was never rung, B was rung a minute ago.
    expect(await router.pickAgent({}, null)).toBe(agentD.id);
  });

  // ------------------------------------------------------------------ call results

  it('busy and switched off count as no answer: a label on an unanswered call, a retry on one a network message picked up', async () => {
    const calls = app.get(CallService);
    const person = await makeSeeker({ name: 'Busy Result' });
    const unanswered = await callRecord({ staffId: agentA.id, subjectId: person.id, answered: false, status: 'no_answer' });
    await expect(calls.recordOutcome({ id: agentA.id, role: 'call_agent' }, unanswered.id, { agentOutcome: 'busy' })).resolves.toMatchObject({ agentOutcome: 'busy' });
    await expect(calls.recordOutcome({ id: agentA.id, role: 'call_agent' }, unanswered.id, { agentOutcome: 'interested' })).rejects.toThrow(/not answered/);

    const picked = await callRecord({ staffId: agentA.id, subjectId: person.id, answered: true, status: 'completed', minutesAgo: -1 });
    await calls.recordOutcome({ id: agentA.id, role: 'call_agent' }, picked.id, { agentOutcome: 'switched_off' });
    const retry = await prisma.callTask.findFirst({ where: { subjectId: person.id, kind: 'retry', status: 'open' } });
    expect(retry).toMatchObject({ staffId: agentA.id, sourceCallRecordId: picked.id });
    // Never a contact attempt or a hit: those come only from the phone system.
    expect(await prisma.contactAttempt.count({ where: { callRecordId: picked.id } })).toBe(0);
  });

  it('wrong number: retries and messages stop, the person is locked on the list, and a paid job seeker goes to the Team Lead', async () => {
    const calls = app.get(CallService);
    const followThrough = app.get(CallFollowThroughService);
    const person = await makeSeeker({ name: 'Wrong Number', registeredByStaffId: agentA.id, paidDaysAgo: 5 });
    await prisma.callTask.create({ data: { staffId: agentA.id, subjectType: 'job_seeker', subjectId: person.id, kind: 'callback', dueAt: NOW } });
    const call = await callRecord({ staffId: agentA.id, subjectId: person.id, answered: true, status: 'completed' });
    await calls.recordOutcome({ id: agentA.id, role: 'call_agent' }, call.id, { agentOutcome: 'wrong_number' });

    expect(await prisma.contactBlock.findFirst({ where: { subjectId: person.id, liftedAt: null } })).toMatchObject({ kind: 'wrong_number', byStaffId: agentA.id });
    expect(await prisma.callTask.count({ where: { subjectId: person.id, status: 'open' } })).toBe(0);
    expect(await prisma.reviewFlag.findFirst({ where: { kind: 'wrong_number_paid', subjectId: person.id } })).toMatchObject({ raisedForStaffId: agentA.id, status: 'open' });

    // A later unanswered call: no retry, no WhatsApp.
    const later = await callRecord({ staffId: agentA.id, subjectId: person.id, answered: false, status: 'no_answer', minutesAgo: -5 });
    await followThrough.onStatusChanged(null, later);
    expect(await prisma.callTask.count({ where: { subjectId: person.id, kind: 'retry' } })).toBe(0);
    expect(await prisma.messageLog.count({ where: { subjectId: person.id } })).toBe(0);

    // On his list (a follow-up) he is shown but cannot be dialled.
    await prisma.followUpTask.create({ data: { code: `FUT-CF-${stamp}`, kind: 'not_selected_day_7', subjectType: 'job_seeker', subjectId: person.id, dueAt: NOW, assignedStaffId: agentA.id } });
    const home = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentA)}`).expect(200);
    expect(home.body.work.items.find((i: { subjectId: string }) => i.subjectId === person.id)).toMatchObject({ callable: false, lockedReason: 'wrong_number' });
    // A new number lifts it by itself.
    await prisma.jobSeeker.update({ where: { id: person.id }, data: { phone: `+91${digits(80)}` } });
    phones.push(`+91${digits(80)}`);
    const again = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentA)}`).expect(200);
    expect(again.body.work.items.find((i: { subjectId: string }) => i.subjectId === person.id)?.lockedReason).not.toBe('wrong_number');
  });

  it('do not call blocks calls until a Team Lead of the team lifts it with a reason (audited)', async () => {
    const calls = app.get(CallService);
    const person = await makeSeeker({ name: 'Do Not Call' });
    const call = await callRecord({ staffId: agentA.id, subjectId: person.id, answered: true, status: 'completed' });
    await calls.recordOutcome({ id: agentA.id, role: 'call_agent' }, call.id, { agentOutcome: 'do_not_call' });
    await expect(calls.place({ id: agentA.id, role: 'call_agent' }, { subjectType: 'job_seeker', subjectId: person.id, purpose: 'general' })).rejects.toThrow(/do not call/);
    const profile = await request(app.getHttpServer()).get(`/call-work/people/${person.code}`).set('Authorization', `Bearer ${token(agentA)}`).expect(200);
    expect(profile.body).toMatchObject({ contactBlocks: ['do_not_call'], canCallNow: false });

    const lift = (who: { id: string; role: string; code: string }, body: Record<string, string>) =>
      request(app.getHttpServer()).post('/contact-blocks/lift').set('Authorization', `Bearer ${token(who)}`).send({ subjectType: 'job_seeker', subjectId: person.id, kind: 'do_not_call', ...body });
    await lift(agentA, { reason: 'x' }).expect(403);
    await lift(lead2, { reason: 'other team' }).expect(403);
    await lift(lead1, {}).expect(400);
    await lift(lead1, { reason: 'He called in and asked us to call again' }).expect(201);
    expect(await prisma.contactBlock.findFirst({ where: { subjectId: person.id } })).toMatchObject({ liftedByStaffId: lead1.id, liveKey: null });
    expect(await prisma.auditLog.count({ where: { action: 'call.contact_block_lifted', actorId: lead1.id } })).toBe(1);
    await expect(calls.place({ id: agentA.id, role: 'call_agent' }, { subjectType: 'job_seeker', subjectId: person.id, purpose: 'general' })).resolves.toHaveProperty('callRecordId');
  });

  it(`every retry stops after ${RETRY_UNANSWERED_LIMIT} unanswered tries in a row and the Team Lead is told once`, async () => {
    const followThrough = app.get(CallFollowThroughService);
    const person = await makeSeeker({ name: 'Three Tries' });
    for (let i = 1; i <= RETRY_UNANSWERED_LIMIT + 1; i += 1) {
      const call = await callRecord({ staffId: agentA.id, subjectId: person.id, answered: false, status: 'no_answer', minutesAgo: 100 - i * 10 });
      await followThrough.onStatusChanged(null, call);
      const open = await prisma.callTask.count({ where: { subjectId: person.id, kind: 'retry', status: 'open' } });
      expect([i, open]).toEqual([i, i < RETRY_UNANSWERED_LIMIT ? 1 : 0]);
    }
    expect(await prisma.reviewFlag.count({ where: { kind: 'calls_unanswered', subjectId: person.id } })).toBe(1);
    // Once he is reached the count starts again.
    expect(await followThrough.unansweredInARow('job_seeker', person.id)).toBe(RETRY_UNANSWERED_LIMIT + 1);
    await callRecord({ staffId: agentA.id, subjectId: person.id, answered: true, status: 'completed', minutesAgo: 1 });
    expect(await followThrough.unansweredInARow('job_seeker', person.id)).toBe(0);
  });

  // ------------------------------------------------------------------ Assign reaches the lists

  it("a Team Lead's Assign puts the person on the assigned agent's lists (close to a refund, stuck registrations), not the registering agent's", async () => {
    const near = await makeSeeker({ name: 'Assigned Near Refund', registeredByStaffId: agentA.id, assignedStaffId: agentB.id, paidDaysAgo: 26 });
    const stuck = await makeSeeker({ name: 'Assigned Stuck', registeredByStaffId: agentA.id, assignedStaffId: agentB.id, status: 'lead' });
    await prisma.publicLink.create({
      data: { tokenHash: crypto.randomBytes(16).toString('hex'), purpose: 'registration', subjectType: 'job_seeker', subjectId: stuck.id, phone: stuck.phone, expiresAt: new Date(NOW.getTime() + DAY) },
    });
    const homeB = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentB)}`).expect(200);
    expect(homeB.body.work.items.find((i: { subjectId: string }) => i.subjectId === near.id)).toMatchObject({ kind: 'close_to_refund', priority: true });
    expect(homeB.body.stuck.map((s: { jobSeekerId: string }) => s.jobSeekerId)).toContain(stuck.id);
    const homeA = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentA)}`).expect(200);
    expect(homeA.body.work.items.map((i: { subjectId: string }) => i.subjectId)).not.toContain(near.id);
    expect(homeA.body.stuck.map((s: { jobSeekerId: string }) => s.jobSeekerId)).not.toContain(stuck.id);
  });

  it('"Waiting for the Team Lead\'s ID check" is not stuck work: listed without Resend, never a call row', async () => {
    const waiting = await makeSeeker({ name: 'Waiting Idcheck', registeredByStaffId: agentA.id, status: 'consented' });
    for (const purpose of ['profile_sharing', 'aadhaar_verification', 'job_updates']) {
      await prisma.consent.create({ data: { subjectType: 'job_seeker', subjectId: waiting.id, purpose, noticeVersion: 'fix-21nov', granted: true, language: 'en', method: 'sms_link', grantedAt: NOW } });
    }
    await prisma.jobSeeker.update({ where: { id: waiting.id }, data: { photoStoragePath: `job-seekers/${waiting.id}/selfie.jpg` } });
    await prisma.identityVerification.create({ data: { jobSeekerId: waiting.id, method: 'other_id', vendor: 'team_lead', status: 'pending' } });
    await prisma.publicLink.create({
      data: { tokenHash: crypto.randomBytes(16).toString('hex'), purpose: 'registration', subjectType: 'job_seeker', subjectId: waiting.id, phone: waiting.phone, expiresAt: new Date(NOW.getTime() + DAY) },
    });
    const home = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(agentA)}`).expect(200);
    expect(home.body.stuck.find((s: { jobSeekerId: string }) => s.jobSeekerId === waiting.id)).toMatchObject({ step: 'id_team_lead_check', waitingForTeamLead: true });
    expect(home.body.work.items.map((i: { subjectId: string }) => i.subjectId)).not.toContain(waiting.id);
  });

  it('TeleCMI webhook: refused without our key; a missed call lands on the missed-call list once; an outgoing report updates our call', async () => {
    process.env.TELECMI_WEBHOOK_KEY = 'telecmi_webhook_key_for_tests_32_chars_x';
    process.env.TELECMI_APP_ID = '1111113';
    try {
      const from = digits(98);
      phones.push(`+91${from}`);
      const missed = { appid: 1111113, type: 'cdr', direction: 'inbound', cmiuuid: `tc-${stamp}`, status: 'missed', from: Number(from), time: NOW.getTime(), waitedsec: 30 };
      await request(app.getHttpServer()).post('/telephony/webhook/telecmi?key=wrong').send(missed).expect(401);
      await request(app.getHttpServer()).post('/telephony/webhook/telecmi').send(missed).expect(401);
      const url = `/telephony/webhook/telecmi?key=${process.env.TELECMI_WEBHOOK_KEY}`;
      const first = await request(app.getHttpServer()).post(url).send(missed).expect(201);
      const again = await request(app.getHttpServer()).post(url).send(missed).expect(201);
      expect(again.body).toMatchObject({ callbackTaskId: first.body.callbackTaskId, duplicate: true });
      expect(await prisma.callbackTask.findUniqueOrThrow({ where: { id: first.body.callbackTaskId } })).toMatchObject({ status: 'pending', assignedToStaffId: null });

      const person = await makeSeeker({ name: 'Telecmi Outgoing' });
      const ours = await callRecord({ staffId: agentA.id, subjectId: person.id, answered: false, status: 'initiated' });
      const report = { type: 'cdr', appid: 1111113, to: Number(person.phone.slice(-10)), cmiuuid: `tco-${stamp}`, status: 'answered', user: '103_1111113', time: NOW.getTime(), direction: 'outbound', answeredsec: 75, custom: ours.id };
      await request(app.getHttpServer()).post(url).send(report).expect(201);
      expect(await prisma.callRecord.findUniqueOrThrow({ where: { id: ours.id } })).toMatchObject({ providerStatus: 'completed', answered: true, durationSec: 75 });
      const other = await request(app.getHttpServer()).post(url).send({ ...report, appid: 999 }).expect(201);
      expect(other.body).toEqual({ ignored: 'another app' });
    } finally {
      delete process.env.TELECMI_WEBHOOK_KEY;
      delete process.env.TELECMI_APP_ID;
    }
  });

  // ------------------------------------------------------------------ leave and no-show

  it('on an approved leave everything open moves to the teammate the Team Lead picked (field items too) and people and sign-ups come back after it', async () => {
    const person = await makeSeeker({ name: 'Leave Stuck', registeredByStaffId: agentA.id, status: 'lead' });
    const near = await makeSeeker({ name: 'Leave Near', registeredByStaffId: agentA.id, paidDaysAgo: 25 });
    const tomorrow = new Date(NOW.getTime() + DAY);
    const task = await prisma.callTask.create({ data: { staffId: agentA.id, subjectType: 'job_seeker', subjectId: near.id, kind: 'callback', dueAt: tomorrow } });
    const missed = await missedCall(`+91${digits(96)}`, 5, agentA.id);
    const tracker = await prisma.signupTracker.create({ data: { profileKind: 'job_seeker', subjectType: 'job_seeker', subjectId: person.id, assignedStaffId: agentA.id, assignedAt: NOW, stage: 'B' } });
    const leave = await prisma.leaveRequest.create({
      data: { staffId: agentA.id, kind: 'casual', fromDate: new Date('2026-11-12T00:00:00.000Z'), toDate: new Date('2026-11-12T00:00:00.000Z'), days: 1, reason: 'family', status: 'approved', routedToRole: 'team_lead', routedToStaffId: lead1.id, routeReason: 'team_lead' },
    });
    const field = { handOver: jest.fn().mockResolvedValue({ moved: 2 }) };
    const service = new WorkHandoverService(prisma, app.get(AuditService), app.get(PricingService), app.get(FollowUpHandoverService), { get: (t: string) => (t === FIELD_HANDOVER ? field : null) } as never);
    const moved = await service.onLeaveApproved(lead1.id, leave.id, { mode: 'teammate', staffId: agentB.id }, NOW);
    expect(moved).toMatchObject({ callTasks: 1, missedCalls: 1, signups: 1, field: 'moved' });
    expect(moved!.people).toBeGreaterThanOrEqual(2);
    expect(field.handOver).toHaveBeenCalledWith(agentA.id, agentB.id, expect.objectContaining({ reason: 'leave', leaveRequestId: leave.id }));
    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ staffId: agentB.id });
    expect(await prisma.callbackTask.findUniqueOrThrow({ where: { id: missed.id } })).toMatchObject({ assignedToStaffId: agentB.id, assignmentReason: 'handover' });
    expect(await prisma.jobSeeker.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({ assignedStaffId: agentB.id, registeredByStaffId: agentA.id });
    expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: tracker.id } })).toMatchObject({ assignedStaffId: agentB.id, assignmentReason: 'handover' });
    expect(await prisma.auditLog.count({ where: { action: 'call_work.handed_over', actorId: lead1.id } })).toBe(1);

    // "Keep for her return" moves nothing; a second approval adds nothing.
    expect(await service.onLeaveApproved(lead1.id, leave.id, { mode: 'keep' }, NOW)).toBeNull();

    // After the leave the people and the sign-up go back; the done call work stays done.
    expect((await service.returnAfterLeave(new Date('2026-11-12T12:00:00.000Z'))).returned).toBe(0);
    const back = await service.returnAfterLeave(new Date('2026-11-12T19:00:00.000Z'));
    expect(back.returned).toBeGreaterThanOrEqual(3);
    expect(await prisma.jobSeeker.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({ assignedStaffId: agentA.id });
    expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: tracker.id } })).toMatchObject({ assignedStaffId: agentA.id });
    await prisma.leaveRequest.delete({ where: { id: leave.id } });
  });

  it('"share" spreads the open work across the team by fewest open items', async () => {
    const extra = await makeStaff('call_agent', { teamLeadId: lead1.id });
    const someone = await makeSeeker({ name: 'Share Leave' });
    for (let i = 0; i < 4; i += 1) {
      await prisma.callTask.create({ data: { staffId: agentA.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'retry', dueAt: new Date(NOW.getTime() + DAY + i * MIN) } });
    }
    // agentB already has two open items today; extra has none.
    for (let i = 0; i < 2; i += 1) {
      await prisma.callTask.create({ data: { staffId: agentB.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'retry', dueAt: NOW } });
    }
    const leave = await prisma.leaveRequest.create({
      data: { staffId: agentA.id, kind: 'casual', fromDate: new Date('2026-11-12T00:00:00.000Z'), toDate: new Date('2026-11-12T00:00:00.000Z'), days: 1, reason: 'family', status: 'approved', routedToRole: 'team_lead', routedToStaffId: lead1.id, routeReason: 'team_lead' },
    });
    const moved = await app.get(WorkHandoverService).onLeaveApproved(lead1.id, leave.id, { mode: 'share' }, NOW);
    expect(moved).toMatchObject({ callTasks: 4, field: 'not_connected' });
    // extra gets 3 (0→3 while B stays at 2... then they alternate): B ends with 3 or fewer.
    expect(await prisma.callTask.count({ where: { staffId: extra.id, status: 'open' } })).toBe(3);
    expect(await prisma.callTask.count({ where: { staffId: agentB.id, status: 'open' } })).toBe(3);
    await prisma.leaveRequest.delete({ where: { id: leave.id } });
  });

  it("an agent not logged in an hour after their shift start has today's open call work spread across the teammates on shift", async () => {
    const someone = await makeSeeker({ name: 'No Show Work' });
    const task = await prisma.callTask.create({ data: { staffId: agentC.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'callback', dueAt: NOW } });
    const later = await prisma.callTask.create({ data: { staffId: agentC.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'callback', dueAt: new Date(NOW.getTime() + 2 * DAY) } });
    const missed = await missedCall(`+91${digits(97)}`, 30, agentC.id);
    const followUp = await prisma.followUpTask.create({ data: { code: `FUT-NS-${stamp}`, kind: 'not_selected_day_7', subjectType: 'job_seeker', subjectId: someone.id, dueAt: NOW, assignedStaffId: agentC.id } });
    const service = app.get(WorkHandoverService);
    // 10:15 IST: not yet an hour after 09:30.
    expect((await service.sweepNoShows(new Date('2026-11-11T04:45:00.000Z'))).moved).toBe(0);
    await service.sweepNoShows(NOW);
    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ staffId: agentD.id });
    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: later.id } })).toMatchObject({ staffId: agentC.id });
    expect(await prisma.callbackTask.findUniqueOrThrow({ where: { id: missed.id } })).toMatchObject({ assignedToStaffId: agentD.id, assignmentReason: 'no_show' });
    expect(await prisma.followUpTask.findUniqueOrThrow({ where: { id: followUp.id } })).toMatchObject({ assignedStaffId: agentD.id });
    // On a full day of leave today: whatever reached her after the approval is spread too, from the shift start.
    const away = await makeStaff('call_agent', { teamLeadId: lead2.id });
    const leave = await prisma.leaveRequest.create({
      data: { staffId: away.id, kind: 'casual', fromDate: new Date('2026-11-11T00:00:00.000Z'), toDate: new Date('2026-11-11T00:00:00.000Z'), days: 1, reason: 'family', status: 'approved', routedToRole: 'team_lead', routedToStaffId: lead2.id, routeReason: 'team_lead' },
    });
    const arrived = await prisma.callTask.create({ data: { staffId: away.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'retry', dueAt: NOW } });
    await service.sweepNoShows(new Date('2026-11-11T04:15:00.000Z')); // 09:45 IST
    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: arrived.id } })).toMatchObject({ staffId: agentD.id });
    expect(await prisma.workHandover.findFirst({ where: { recordId: arrived.id } })).toMatchObject({ reason: 'leave', fromStaffId: away.id });
    await prisma.leaveRequest.delete({ where: { id: leave.id } });
    // Someone logged in keeps their work.
    const kept = await prisma.callTask.create({ data: { staffId: agentD.id, subjectType: 'job_seeker', subjectId: someone.id, kind: 'callback', dueAt: NOW } });
    await service.sweepNoShows(NOW);
    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: kept.id } })).toMatchObject({ staffId: agentD.id });
  });
});
