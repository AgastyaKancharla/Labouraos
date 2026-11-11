import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as request from 'supertest';
import { Subscription } from 'rxjs';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiveEventsService, LiveMessage } from '../../common/live/live-events.service';
import { CallClock } from '../call/call-clock';
import { CallService } from '../call/call.service';
import { CallStatusEvent } from '../call/call-status.event';
import { AttendanceClock } from '../attendance/attendance-clock';
import { ConsentClock } from '../consent/consent-clock';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { openAvailableDay } from '../../test-support/available-day';
import { CallWorkClock } from './call-work-clock';

/** 11:30 IST on 11 Nov 2026: inside calling hours. */
const NOON_ISH = new Date('2026-11-11T06:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const TELEPHONY_SECRET = 'call_work_telephony_secret_32_characters';
const ROUTING_KEY = 'call_work_routing_key_32_characters_long';

class FrozenClock {
  at = NOON_ISH;
  now(): Date {
    return this.at;
  }
}

describe('Call agent console: work queue, Call next, search, live channel, no-answer follow-through', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let live: LiveEventsService;
  const clock = new FrozenClock();
  const stamp = Date.now();
  const digits = (n: number) => `9${String(stamp).slice(-7)}${String(n).padStart(2, '0')}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const phones: string[] = [];

  const sign = (raw: string) => crypto.createHmac('sha256', TELEPHONY_SECRET).update(raw).digest('hex');

  function tokenFor(staff: { id: string; role: string; code: string }) {
    return jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: null });
  }

  async function makeStaff(role: string, extra: { teamLeadId?: string; routing?: string } = {}) {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `CW-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Work ${role} ${n}`,
        email: `cw-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Work-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: extra.teamLeadId ?? null,
        callRoutingPhone: extra.routing ? encryptCallRoutingPhone(extra.routing) : null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  async function makeSeeker(n: number, data: { name: string; registeredByStaffId?: string; paidDaysAgo?: number; status?: string }) {
    const phone = `+91${digits(n)}`;
    phones.push(phone);
    const seeker = await prisma.jobSeeker.create({
      data: {
        // Real ID format (JS- and digits) so the search reads it as an ID.
        code: `JS-9${String(stamp).slice(-3)}${n}`,
        name: data.name,
        phone,
        minSalary: 1500000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: data.status ?? 'active',
        registeredByStaffId: data.registeredByStaffId ?? null,
        paymentReceivedAt: data.paidDaysAgo !== undefined ? new Date(NOON_ISH.getTime() - data.paidDaysAgo * DAY) : null,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
      },
    });
    seekerIds.push(seeker.id);
    for (const purpose of ['call_recording', 'job_matching']) {
      await prisma.consent.create({
        data: {
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          purpose,
          noticeVersion: 'call-work-test',
          granted: true,
          language: 'en',
          method: 'sms_link',
          grantedAt: new Date(NOON_ISH.getTime() - 40 * DAY),
        },
      });
    }
    return seeker;
  }

  function collect(staffId: string): { messages: LiveMessage[]; sub: Subscription } {
    const messages: LiveMessage[] = [];
    const sub = live.streamFor(staffId).subscribe((m) => messages.push(m));
    return { messages, sub };
  }

  let teamLead: Awaited<ReturnType<typeof makeStaff>>;
  let otherLead: Awaited<ReturnType<typeof makeStaff>>;
  let agent: Awaited<ReturnType<typeof makeStaff>>;
  let idleAgent: Awaited<ReturnType<typeof makeStaff>>;
  let manager: Awaited<ReturnType<typeof makeStaff>>;
  let finance: Awaited<ReturnType<typeof makeStaff>>;
  let nearRefund: Awaited<ReturnType<typeof makeSeeker>>;
  let callbackPerson: Awaited<ReturnType<typeof makeSeeker>>;
  let placedCallId: string;

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
    live = app.get(LiveEventsService);

    teamLead = await makeStaff('team_lead');
    otherLead = await makeStaff('team_lead');
    agent = await makeStaff('call_agent', { teamLeadId: teamLead.id, routing: '+919812300001' });
    idleAgent = await makeStaff('call_agent', { teamLeadId: otherLead.id, routing: '+919812300002' });
    manager = await makeStaff('manager');
    finance = await makeStaff('finance');
    await openAvailableDay(app, agent.id);

    nearRefund = await makeSeeker(1, { name: 'Ramesh Workqueue', registeredByStaffId: agent.id, paidDaysAgo: 26 });
    callbackPerson = await makeSeeker(2, { name: 'Lakshmi Workqueue' });
    await prisma.callTask.create({
      data: {
        staffId: agent.id,
        subjectType: 'job_seeker',
        subjectId: callbackPerson.id,
        kind: 'callback',
        dueAt: new Date(NOON_ISH.getTime() - 60 * 60 * 1000),
      },
    });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.callTask.deleteMany({ where: { OR: [{ staffId: { in: staffIds } }, { subjectId: { in: seekerIds } }] } });
    await prisma.callbackTask.deleteMany({ where: { phone: { in: [...phones, '+919000000017'] } } });
    await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.callRecord.deleteMany({ where: { OR: [{ staffId: { in: staffIds } }, { subjectId: { in: seekerIds } }] } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('refuses every console read without a login, and to anyone but a call agent', async () => {
    await request(app.getHttpServer()).get('/call-work/home').expect(401);
    await request(app.getHttpServer()).get('/search?q=Ramesh').expect(401);
    await request(app.getHttpServer()).get('/live/events').expect(401);
    for (const who of [manager, teamLead, finance]) {
      await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${tokenFor(who)}`).expect(403);
      await request(app.getHttpServer()).post('/call-work/call-next').set('Authorization', `Bearer ${tokenFor(who)}`).send({}).expect(403);
    }
  });

  it('lists the person close to a refund first, with masked numbers and no rupees, and Call next dials them', async () => {
    const res = await request(app.getHttpServer())
      .get('/call-work/home')
      .set('Authorization', `Bearer ${tokenFor(agent)}`)
      .expect(200);
    const items = res.body.work.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ subjectId: nearRefund.id, priority: true, kind: 'close_to_refund', daysLeft: 4 });
    expect(items.find((i) => i.subjectId === callbackPerson.id)).toMatchObject({ kind: 'callback', callable: true });
    for (const item of items) {
      if (item.maskedPhone) expect(item.maskedPhone).toMatch(/^\*{6}\d{4}$/);
    }
    expect(JSON.stringify(res.body)).not.toContain(nearRefund.phone);
    expect(res.body.nearRefund).toEqual({ count: expect.any(Number), windowDays: expect.any(Number) });
    expect(res.body.nearRefund.count).toBeGreaterThanOrEqual(1);
    expect(res.body.canCall).toBe(true);
    expect(res.body.callNext).toMatchObject({ subjectId: nearRefund.id });

    const next = await request(app.getHttpServer())
      .post('/call-work/call-next')
      .set('Authorization', `Bearer ${tokenFor(agent)}`)
      .send({})
      .expect(201);
    expect(next.body).toMatchObject({ placed: true, item: { subjectId: nearRefund.id } });
    placedCallId = next.body.callRecordId;
    const call = await prisma.callRecord.findUniqueOrThrow({ where: { id: placedCallId } });
    expect(call).toMatchObject({ staffId: agent.id, subjectId: nearRefund.id, direction: 'outbound' });
  });

  it('Call next refuses when the agent is not Available, and outside calling hours', async () => {
    const notAvailable = await request(app.getHttpServer())
      .post('/call-work/call-next')
      .set('Authorization', `Bearer ${tokenFor(idleAgent)}`)
      .send({})
      .expect(201);
    expect(notAvailable.body).toMatchObject({ placed: false, blocked: 'not_available' });

    clock.at = new Date('2026-11-11T16:00:00.000Z'); // 21:30 IST
    try {
      const late = await request(app.getHttpServer())
        .post('/call-work/call-next')
        .set('Authorization', `Bearer ${tokenFor(agent)}`)
        .send({})
        .expect(201);
      expect(late.body).toMatchObject({ placed: false, blocked: 'outside_calling_hours' });
    } finally {
      clock.at = NOON_ISH;
    }
  });

  it('search finds a person by last 4 digits, full number, unpadded ID and name, masked, scoped for Team Leads', async () => {
    const last4 = nearRefund.phone.slice(-4);
    const auth = { Authorization: `Bearer ${tokenFor(agent)}` };
    const byLast4 = await request(app.getHttpServer()).get(`/search?q=${last4}`).set(auth).expect(200);
    const hit = (byLast4.body.results as Array<Record<string, unknown>>).find((r) => r.id === nearRefund.id);
    expect(hit).toMatchObject({ type: 'job_seeker', maskedPhone: `******${last4}`, openRef: nearRefund.code });
    expect(JSON.stringify(byLast4.body)).not.toContain(nearRefund.phone);

    const byFull = await request(app.getHttpServer()).get(`/search?q=${encodeURIComponent(nearRefund.phone)}`).set(auth).expect(200);
    expect(byFull.body.kind).toBe('phone');
    expect(byFull.body.results.some((r: { id: string }) => r.id === nearRefund.id)).toBe(true);
    // Any spelling of the number finds the person saved as +91 and 10 digits.
    const ten = nearRefund.phone.slice(-10);
    for (const typed of [ten, `0${ten}`, `91${ten}`, `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`]) {
      const res = await request(app.getHttpServer()).get(`/search?q=${encodeURIComponent(typed)}`).set(auth).expect(200);
      expect(res.body.kind).toBe('phone');
      expect(res.body.results.some((r: { id: string }) => r.id === nearRefund.id)).toBe(true);
    }

    const byCode = await request(app.getHttpServer()).get(`/search?q=${nearRefund.code.toLowerCase()}`).set(auth).expect(200);
    expect(byCode.body.results.map((r: { id: string }) => r.id)).toEqual([nearRefund.id]);

    const byName = await request(app.getHttpServer()).get('/search?q=ramesh%20workqueue').set(auth).expect(200);
    expect(byName.body.results.some((r: { id: string }) => r.id === nearRefund.id)).toBe(true);

    const ownLead = await request(app.getHttpServer()).get(`/search?q=${nearRefund.code}`).set('Authorization', `Bearer ${tokenFor(teamLead)}`).expect(200);
    expect(ownLead.body.counts.job_seeker).toBe(1);
    const otherTeam = await request(app.getHttpServer()).get(`/search?q=${nearRefund.code}`).set('Authorization', `Bearer ${tokenFor(otherLead)}`).expect(200);
    expect(otherTeam.body.counts.job_seeker).toBe(0);

    const asFinance = await request(app.getHttpServer()).get(`/search?q=${last4}`).set('Authorization', `Bearer ${tokenFor(finance)}`).expect(200);
    expect(JSON.stringify(asFinance.body)).not.toContain(nearRefund.phone);
  });

  it('pops an inbound call up on the agent it rings only, once, even when the webhook repeats', async () => {
    const mine = collect(agent.id);
    const theirs = collect(idleAgent.id);
    try {
      const raw = JSON.stringify({ CallSid: `cw-in-${stamp}`, From: nearRefund.phone, To: '18001234567' });
      const first = await request(app.getHttpServer())
        .post('/telephony/inbound')
        .set('Content-Type', 'application/json')
        .set('x-telephony-signature', sign(raw))
        .send(raw)
        .expect(201);
      expect(first.body.routedToStaffId).toBe(agent.id);
      await request(app.getHttpServer())
        .post('/telephony/inbound')
        .set('Content-Type', 'application/json')
        .set('x-telephony-signature', sign(raw))
        .send(raw)
        .expect(201);

      const incoming = mine.messages.filter((m) => m.type === 'incoming_call');
      expect(incoming).toHaveLength(1);
      expect(incoming[0]!.data).toMatchObject({
        known: true,
        subjectType: 'job_seeker',
        subjectId: nearRefund.id,
        code: nearRefund.code,
        maskedPhone: `******${nearRefund.phone.slice(-4)}`,
      });
      expect(JSON.stringify(incoming[0]!.data)).not.toContain(nearRefund.phone);
      expect(theirs.messages).toHaveLength(0);

      const task = await prisma.callbackTask.findUniqueOrThrow({ where: { callId: `cw-in-${stamp}` } });
      expect(task).toMatchObject({ assignedToStaffId: agent.id, status: 'assigned', jobSeekerId: nearRefund.id });

      const card = await request(app.getHttpServer())
        .get(`/call-work/incoming/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(agent)}`)
        .expect(200);
      expect(card.body).toMatchObject({ known: true, caller: { code: nearRefund.code }, likelyAbout: 'job_search_refund' });
      await request(app.getHttpServer())
        .get(`/call-work/incoming/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(idleAgent)}`)
        .expect(403);

      // The phone system may send the caller as 0XXXXXXXXXX or 91XXXXXXXXXX: same person, same agent.
      const ten = nearRefund.phone.slice(-10);
      for (const [index, from] of [`0${ten}`, `91${ten}`].entries()) {
        const spelledRaw = JSON.stringify({ CallSid: `cw-in-${stamp}-spelling-${index}`, From: from, To: '18001234567' });
        const spelled = await request(app.getHttpServer())
          .post('/telephony/inbound')
          .set('Content-Type', 'application/json')
          .set('x-telephony-signature', sign(spelledRaw))
          .send(spelledRaw)
          .expect(201);
        expect(spelled.body.routedToStaffId).toBe(agent.id);
        const spelledTask = await prisma.callbackTask.findUniqueOrThrow({ where: { callId: `cw-in-${stamp}-spelling-${index}` } });
        expect(spelledTask).toMatchObject({ phone: nearRefund.phone, jobSeekerId: nearRefund.id, assignedToStaffId: agent.id });
      }
      const routedIncoming = mine.messages.filter((m) => m.type === 'incoming_call' && m.data.subjectId === nearRefund.id);
      expect(routedIncoming).toHaveLength(3);

      // The calling company names the agent it rang (rule 1).
      const unknownRaw = JSON.stringify({ CallSid: `cw-unknown-${stamp}`, From: '+919000000017', agentCode: agent.code });
      await request(app.getHttpServer())
        .post('/telephony/inbound')
        .set('Content-Type', 'application/json')
        .set('x-telephony-signature', sign(unknownRaw))
        .send(unknownRaw)
        .expect(201);
      const unknown = mine.messages.filter((m) => m.type === 'incoming_call' && m.data.known === false);
      expect(unknown).toHaveLength(1);
      expect(unknown[0]!.data).toMatchObject({ code: null, maskedPhone: '******0017' });
    } finally {
      mine.sub.unsubscribe();
      theirs.sub.unsubscribe();
    }
  });

  it('streams the signed-in staff member their own events over Server-Sent Events, and no one else', async () => {
    const server = app.getHttpServer() as http.Server;
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const open = (token: string) =>
      new Promise<{ chunks: string[]; req: http.ClientRequest; status: number }>((resolve, reject) => {
        const chunks: string[] = [];
        const req = http.get(
          { host: '127.0.0.1', port, path: '/live/events', headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } },
          (res) => {
            res.setEncoding('utf8');
            res.on('data', (c: string) => chunks.push(c));
            resolve({ chunks, req, status: res.statusCode ?? 0 });
          },
        );
        req.on('error', reject);
      });
    const waitFor = async (chunks: string[], text: string) => {
      for (let i = 0; i < 50; i += 1) {
        if (chunks.join('').includes(text)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`Timed out waiting for ${text}; got ${chunks.join('')}`);
    };
    const a = await open(tokenFor(agent));
    const b = await open(tokenFor(idleAgent));
    try {
      expect(a.status).toBe(200);
      await waitFor(a.chunks, 'event: ready');
      await waitFor(b.chunks, 'event: ready');
      live.publish(agent.id, 'call_status', { callRecordId: 'cw-sse-test', status: 'ringing' });
      await waitFor(a.chunks, 'cw-sse-test');
      expect(a.chunks.join('')).toContain('event: call_status');
      await new Promise((r) => setTimeout(r, 150));
      expect(b.chunks.join('')).not.toContain('cw-sse-test');
    } finally {
      a.req.destroy();
      b.req.destroy();
    }
  });

  it('after no answer: WhatsApp once, a retry on the list, nothing doubled when the webhook repeats', async () => {
    const calls = app.get(CallService);
    const call = await prisma.callRecord.findUniqueOrThrow({ where: { id: placedCallId } });
    const mine = collect(agent.id);
    try {
      const event: CallStatusEvent = {
        provider: call.provider,
        providerCallId: call.providerCallId,
        status: 'no_answer',
        answered: false,
        startedAt: NOON_ISH,
        answeredAt: null,
        endedAt: new Date(NOON_ISH.getTime() + 30_000),
        durationSec: 0,
        recordingUrl: null,
        direction: 'outbound',
      };
      await calls.applyStatus(event);
      await calls.applyStatus(event);
      expect(mine.messages.filter((m) => m.type === 'call_status' && m.data.callRecordId === call.id)).toHaveLength(1);
    } finally {
      mine.sub.unsubscribe();
    }
    const retries = await prisma.callTask.findMany({ where: { sourceCallRecordId: call.id, kind: 'retry' } });
    expect(retries).toHaveLength(1);
    // Missed at 11:30 IST: tried again this afternoon, at noon IST.
    expect(retries[0]!.dueAt.toISOString()).toBe('2026-11-11T06:30:00.000Z');
    const messages = await prisma.messageLog.findMany({ where: { subjectId: nearRefund.id, template: 'call_attempt_notice' } });
    expect(messages).toHaveLength(1);

    const screen = await request(app.getHttpServer())
      .get(`/call-work/calls/${call.id}`)
      .set('Authorization', `Bearer ${tokenFor(agent)}`)
      .expect(200);
    expect(screen.body).toMatchObject({ final: true, answered: false, noAnswer: { nextTryAt: '2026-11-11T06:30:00.000Z', missedForHit: 2 } });
    expect(screen.body.noAnswer.whatsapp).not.toBeNull();
    await request(app.getHttpServer()).get(`/call-work/calls/${call.id}`).set('Authorization', `Bearer ${tokenFor(idleAgent)}`).expect(403);
  });

  it('"Call me back" needs a future time inside calling hours and puts him back on the list then', async () => {
    const answered = await prisma.callRecord.create({
      data: {
        code: `CR-CW-${stamp}`,
        provider: 'mock-cloud-telephony',
        providerCallId: `cw-answered-${stamp}`,
        direction: 'outbound',
        staffId: agent.id,
        subjectType: 'job_seeker',
        subjectId: callbackPerson.id,
        purpose: 'general',
        providerStatus: 'completed',
        answered: true,
        answeredAt: NOON_ISH,
      },
    });
    const auth = { Authorization: `Bearer ${tokenFor(agent)}` };
    const url = `/calls/${answered.id}/outcome`;
    await request(app.getHttpServer()).post(url).set(auth).send({ agentOutcome: 'callback_requested' }).expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set(auth)
      .send({ agentOutcome: 'callback_requested', callbackAt: '2026-11-11T05:00:00.000Z' })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set(auth)
      .send({ agentOutcome: 'callback_requested', callbackAt: '2026-11-11T16:30:00.000Z' })
      .expect(400);
    await request(app.getHttpServer()).post(url).set(auth).send({ agentOutcome: 'rejected_offer' }).expect(400);
    const ok = await request(app.getHttpServer())
      .post(url)
      .set(auth)
      .send({ agentOutcome: 'callback_requested', callbackAt: '2026-11-11T09:00:00.000Z', reason: 'Busy at work' })
      .expect(201);
    expect(ok.body.callbackAt).toBe('2026-11-11T09:00:00.000Z');
    const open = await prisma.callTask.findMany({ where: { subjectId: callbackPerson.id, status: 'open' } });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: 'callback', sourceCallRecordId: answered.id, staffId: agent.id });
    expect(open[0]!.dueAt.toISOString()).toBe('2026-11-11T09:00:00.000Z');
  });
});
