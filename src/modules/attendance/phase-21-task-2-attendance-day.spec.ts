import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { localCalendarToUtc } from '../../common/time/period-boundary';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { CallClock } from '../call/call-clock';
import { signCallStatusBody } from '../call/call-signature';
import { AttendanceClock } from './attendance-clock';
import { AttendanceService } from './attendance.service';

jest.setTimeout(120000);

const shared = { at: new Date('2026-11-10T04:00:00.000Z') };

class DayClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

class CallDayClock extends CallClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

describe('Phase 21 Task 2: the working day', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let attendance: AttendanceService;
  const stamp = `${Date.now()}`;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const callIds: string[] = [];
  const callbackIds: string[] = [];
  const previousRoutingKey = process.env.CALL_ROUTING_KEY;
  const previousWebhookSecret = process.env.TELEPHONY_WEBHOOK_SECRET;
  const webhookSecret = 'attendance_day_webhook_secret_32b!';

  function tokenFor(staff: { id: string; role: string; code: string }) {
    return jwt.sign({
      sub: staff.id,
      email: `${staff.id}@laboura.local`,
      role: staff.role,
      code: staff.code,
    });
  }

  function at(iso: string) {
    shared.at = new Date(iso);
  }

  async function make(
    role: string,
    prefix: string,
    line?: { teamLeadId?: string; reportsToId?: string },
  ) {
    const row = await prisma.staff.create({
      data: {
        code: `${prefix}-${stamp}-${staffIds.length}`,
        name: `${prefix} attendance`,
        email: `${prefix.toLowerCase()}.${staffIds.length}.${stamp}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: line?.teamLeadId ?? null,
        reportsToId: line?.reportsToId ?? null,
      },
    });
    staffIds.push(row.id);
    return row;
  }

  function login(token: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/attendance/login')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function postStatus(token: string, status: string) {
    return request(app.getHttpServer())
      .post('/attendance/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status });
  }

  function today(token: string) {
    return request(app.getHttpServer())
      .get('/attendance/today')
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    process.env.CALL_ROUTING_KEY = 'attendance_day_routing_key_32_chars';
    process.env.TELEPHONY_WEBHOOK_SECRET = webhookSecret;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AttendanceClock)
      .useClass(DayClock)
      .overrideProvider(CallClock)
      .useClass(CallDayClock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    attendance = app.get(AttendanceService);
  });

  afterAll(async () => {
    try {
      if (callIds.length > 0) {
        await prisma.contactAttempt.deleteMany({ where: { callRecordId: { in: callIds } } });
        await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
      }
      if (callbackIds.length > 0) {
        await prisma.callbackTask.deleteMany({ where: { id: { in: callbackIds } } });
      }
      if (seekerIds.length > 0) {
        await prisma.consent.deleteMany({
          where: { subjectType: 'job_seeker', subjectId: { in: seekerIds } },
        });
        await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
      }
      if (staffIds.length > 0) {
        await prisma.reviewFlag.deleteMany({
          where: { raisedForStaffId: { in: staffIds } },
        });
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
      }
    } finally {
      if (previousRoutingKey === undefined) delete process.env.CALL_ROUTING_KEY;
      else process.env.CALL_ROUTING_KEY = previousRoutingKey;
      if (previousWebhookSecret === undefined) delete process.env.TELEPHONY_WEBHOOK_SECRET;
      else process.env.TELEPHONY_WEBHOOK_SECRET = previousWebhookSecret;
      await app.close();
    }
  });

  it('stores the attendance settings and hides them from a Manager', async () => {
    const policy = await prisma.pricingPolicy.findFirstOrThrow({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    expect(policy.shiftStart).toBe('09:30');
    expect(policy.shiftEnd).toBe('18:30');
    expect(policy.productionHoursFullDay).toBe(8);
    expect(policy.halfDayBelowHours).toBe(4.5);
    expect(policy.dayToleranceMinutes).toBe(10);
    expect(policy.lateGraceMinutes).toBe(10);
    expect(policy.shortBreakMinutes).toBe(15);
    expect(policy.lunchMinutes).toBe(30);
    expect(policy.idleAfterMinutes).toBe(10);
    expect(policy.casualLeavePerMonth).toBe(1);
    expect(policy.emergencyLeavePerMonth).toBe(1);
    expect(policy.refundPriorityWindowDays).toBe(15);

    const ceo = await make('ceo', 'CEO');
    const manager = await make('manager', 'MGR', { reportsToId: ceo.id });
    const ceoView = await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${tokenFor(ceo)}`)
      .expect(200);
    expect(ceoView.body.shiftStart).toBe('09:30');
    // A Manager does not see pricing and policy settings at all (Master
    // Guide, reconfirmed 11 Nov); this replaced the partial view that hid only
    // the attendance keys.
    await request(app.getHttpServer())
      .get('/pricing')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .expect(403);
  });

  it('takes the login time from the server and marks late minutes from the shift start', async () => {
    const grace = await make('call_agent', 'GRC');
    const late = await make('call_agent', 'LTE');
    const onTime = localCalendarToUtc(2026, 11, 10, 9, 40);
    at(onTime.toISOString());
    const ignored = await login(tokenFor(grace), { loginAt: '2000-01-01T00:00:00.000Z' });
    expect(ignored.status).toBe(201);
    expect(ignored.body.loginAt).toBe(onTime.toISOString());
    expect(ignored.body.lateMinutes).toBe(0);

    const pastGrace = localCalendarToUtc(2026, 11, 10, 9, 41);
    at(pastGrace.toISOString());
    const marked = await login(tokenFor(late));
    expect(marked.status).toBe(201);
    expect(marked.body.lateMinutes).toBe(11);
    expect(marked.body.loginAt).toBe(pastGrace.toISOString());
  });

  it('requires a field agent location and does not keep one for office staff', async () => {
    at('2026-11-10T04:00:00.000Z');
    const field = await make('field_agent', 'FLD');
    const office = await make('finance', 'FIN');
    const missing = await login(tokenFor(field), {});
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('location');
    const saved = await login(tokenFor(field), { latitude: 12.93, longitude: 77.62 });
    expect(saved.status).toBe(201);
    const row = await prisma.attendanceDay.findFirstOrThrow({ where: { staffId: field.id } });
    expect(row.loginLat).toBe(12.93);
    expect(row.loginLng).toBe(77.62);
    const officeLogin = await login(tokenFor(office), { latitude: 1, longitude: 2 });
    expect(officeLogin.status).toBe(201);
    const officeRow = await prisma.attendanceDay.findFirstOrThrow({ where: { staffId: office.id } });
    expect(officeRow.loginLat).toBeNull();
    expect(officeRow.loginLng).toBeNull();
  });

  it('refuses phone-system, visit and idle statuses set by hand', async () => {
    at('2026-11-10T04:00:00.000Z');
    const agent = await make('call_agent', 'HND');
    await login(tokenFor(agent)).expect(201);
    for (const status of ['on_call', 'after_call_notes', 'on_visit', 'travelling', 'idle']) {
      const refused = await postStatus(tokenFor(agent), status);
      expect(refused.status).toBe(400);
    }
    const before = await login(tokenFor(agent));
    expect(before.body.status).toBe('available');
  });

  it('adds production across calls, breaks, lunch, idle and an approved system problem', async () => {
    const ceo = await make('ceo', 'CEO2');
    const manager = await make('manager', 'MGR2', { reportsToId: ceo.id });
    const lead = await make('team_lead', 'TL2', { reportsToId: manager.id });
    const agent = await make('call_agent', 'PRD', { teamLeadId: lead.id, reportsToId: lead.id });
    const token = tokenFor(agent);
    const start = new Date('2026-11-10T04:00:00.000Z');
    const plus = (minutes: number) => {
      at(new Date(start.getTime() + minutes * 60 * 1000).toISOString());
    };

    plus(0);
    expect((await login(token)).body).toMatchObject({
      status: 'available',
      productionSeconds: 0,
      lateMinutes: 0,
    });
    plus(10);
    expect((await postStatus(token, 'short_break')).body.productionSeconds).toBe(600);
    plus(20);
    expect((await postStatus(token, 'available')).body.breakSeconds).toBe(600);
    plus(30);
    expect((await postStatus(token, 'lunch')).body.productionSeconds).toBe(1200);
    plus(61);
    const afterLunch = await postStatus(token, 'available');
    expect(afterLunch.body.breakSeconds).toBe(2460);
    expect(afterLunch.body.productionSeconds).toBe(1200);
    const overrun = await prisma.reviewFlag.findFirst({
      where: { kind: 'break_overrun', raisedForStaffId: lead.id, subjectType: 'attendance_segment' },
    });
    expect(overrun).toBeTruthy();

    plus(72);
    expect((await today(token)).body).toMatchObject({ status: 'idle', productionSeconds: 1860, idleSeconds: 0 });
    plus(87);
    expect((await today(token)).body.idleSeconds).toBe(900);
    const problem = await postStatus(token, 'system_problem');
    expect(problem.body.status).toBe('system_problem');
    expect(problem.body.productionSeconds).toBe(1860);
    plus(97);
    expect((await today(token)).body.productionSeconds).toBe(1860);

    const segment = await prisma.attendanceSegment.findFirstOrThrow({
      where: { staffId: agent.id, status: 'system_problem', endedAt: null },
    });
    const own = await request(app.getHttpServer())
      .post(`/attendance/system-problem/${segment.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(403);

    const approved = await request(app.getHttpServer())
      .post(`/attendance/system-problem/${segment.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`)
      .expect(201);
    expect(approved.body).toEqual({ approved: true });
    const viewed = await today(token);
    expect(viewed.body.productionSeconds).toBe(2460);
    expect(viewed.body.breakSeconds).toBe(2460);
    expect(viewed.body.idleSeconds).toBe(900);
    expect(viewed.body.shortfallSeconds).toBe(8 * 3600 - 2460);
  });

  it('marks Idle after 11 minutes without a heartbeat and clears it when one arrives', async () => {
    at('2026-11-10T04:00:00.000Z');
    const agent = await make('call_agent', 'IDL');
    const token = tokenFor(agent);
    const start = shared.at.getTime();
    await login(token).expect(201);
    at(new Date(start + 10 * 60 * 1000).toISOString());
    expect((await today(token)).body.status).toBe('available');
    at(new Date(start + 11 * 60 * 1000).toISOString());
    expect((await today(token)).body.status).toBe('idle');
    const lateLook = await make('call_agent', 'ID2');
    at(new Date(start).toISOString());
    await login(tokenFor(lateLook)).expect(201);
    at(new Date(start + 20 * 60 * 1000).toISOString());
    const openedLate = await today(tokenFor(lateLook));
    expect(openedLate.body.status).toBe('idle');
    expect(openedLate.body.productionSeconds).toBe(11 * 60);
    expect(openedLate.body.idleSeconds).toBe(9 * 60);
    at(new Date(start + 11 * 60 * 1000).toISOString());
    const beat = await request(app.getHttpServer())
      .post('/attendance/heartbeat')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(beat.body.status).toBe('available');
  });

  it('moves an agent to On call from the webhook and back to Available after two minutes', async () => {
    at('2026-11-10T04:00:00.000Z');
    const agent = await make('call_agent', 'CLL');
    const token = tokenFor(agent);
    await prisma.staff.update({
      where: { id: agent.id },
      data: { callRoutingPhone: encryptCallRoutingPhone('+919811100001') },
    });
    await login(token).expect(201);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-AT2-${stamp}`,
        name: 'Attendance Caller',
        phone: `+9197${stamp.slice(-8)}`,
        trades: { create: { trade: 'Electrician', isPrimary: true } },
        minSalary: 1000000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    seekerIds.push(seeker.id);
    await prisma.consent.create({
      data: {
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose: 'call_recording',
        noticeVersion: 'attendance-day',
        granted: true,
        language: 'en',
        method: 'sms_link',
        grantedAt: new Date(),
      },
    });
    const placed = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({ subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'general' })
      .expect(201);
    callIds.push(placed.body.callRecordId);
    const call = await prisma.callRecord.findUniqueOrThrow({ where: { id: placed.body.callRecordId } });

    const postWebhook = async (payload: Record<string, unknown>) => {
      const raw = JSON.stringify(payload);
      return request(app.getHttpServer())
        .post('/telephony/webhook/call-status')
        .set('Content-Type', 'application/json')
        .set('x-telephony-signature', signCallStatusBody(raw, webhookSecret))
        .send(raw);
    };
    const answered = await postWebhook({
      provider: call.provider,
      providerCallId: call.providerCallId,
      status: 'answered',
      answered: true,
      answeredAt: shared.at.toISOString(),
      direction: 'outbound',
    });
    expect(answered.status).toBe(201);
    expect((await today(token)).body.status).toBe('on_call');

    at(new Date(shared.at.getTime() + 5 * 60 * 1000).toISOString());
    const ended = await postWebhook({
      provider: call.provider,
      providerCallId: call.providerCallId,
      status: 'completed',
      answered: true,
      answeredAt: call.answeredAt?.toISOString() ?? shared.at.toISOString(),
      endedAt: shared.at.toISOString(),
      durationSec: 300,
      direction: 'outbound',
    });
    expect(ended.status).toBe(201);
    expect((await today(token)).body.status).toBe('after_call_notes');

    at(new Date(shared.at.getTime() + 2 * 60 * 1000).toISOString());
    expect((await today(token)).body.status).toBe('available');

    await postStatus(token, 'lunch').expect(201);
    const refused = await request(app.getHttpServer())
      .post('/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({ subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'general' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Available');
  });

  it('does not route an inbound callback to an agent who is not Available', async () => {
    at('2026-11-10T04:00:00.000Z');
    const busy = await make('call_agent', 'BSY');
    const free = await make('call_agent', '0FRE');
    await login(tokenFor(busy)).expect(201);
    await login(tokenFor(free)).expect(201);
    await postStatus(tokenFor(busy), 'lunch').expect(201);
    const task = await prisma.callbackTask.create({
      data: { callId: `AT2-${stamp}`, phone: '+919800044455', status: 'pending' },
    });
    callbackIds.push(task.id);
    const expected = await attendance.nextAvailableAgent(busy.id);
    const assigned = await request(app.getHttpServer())
      .post(`/telephony/callbacks/${task.id}/assign`)
      .set('Authorization', `Bearer ${tokenFor(free)}`)
      .send({ staffId: busy.id })
      .expect(201);
    expect(expected).toBeTruthy();
    expect(assigned.body.assignedToStaffId).toBe(expected);
    expect(assigned.body.assignedToStaffId).not.toBe(busy.id);
  });

  it('alerts the Team Lead when a short break passes 15 minutes and not before', async () => {
    const lead = await make('team_lead', 'TLB');
    const exact = await make('call_agent', 'BRK', { teamLeadId: lead.id, reportsToId: lead.id });
    const over = await make('call_agent', 'BRO', { teamLeadId: lead.id, reportsToId: lead.id });
    const start = new Date('2026-11-10T04:00:00.000Z');
    at(start.toISOString());
    await login(tokenFor(exact)).expect(201);
    await login(tokenFor(over)).expect(201);
    await postStatus(tokenFor(exact), 'short_break').expect(201);
    await postStatus(tokenFor(over), 'short_break').expect(201);
    at(new Date(start.getTime() + 15 * 60 * 1000).toISOString());
    await postStatus(tokenFor(exact), 'available').expect(201);
    at(new Date(start.getTime() + 16 * 60 * 1000).toISOString());
    await postStatus(tokenFor(over), 'available').expect(201);
    const flags = await prisma.reviewFlag.findMany({
      where: { kind: 'break_overrun', raisedForStaffId: lead.id },
    });
    const subjects = await prisma.attendanceSegment.findMany({
      where: { id: { in: flags.map((flag) => flag.subjectId) } },
      select: { staffId: true },
    });
    expect(subjects.map((row) => row.staffId)).toContain(over.id);
    expect(subjects.map((row) => row.staffId)).not.toContain(exact.id);
  });

  it('sets On visit at a business check-in and Travelling at check-out', async () => {
    at('2026-11-10T04:00:00.000Z');
    const field = await make('field_agent', 'VIS');
    const token = tokenFor(field);
    await login(token, { latitude: 12.97, longitude: 77.59 }).expect(201);
    const arrived = await request(app.getHttpServer())
      .post('/attendance/business-check-in')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(arrived.body.status).toBe('on_visit');
    const left = await request(app.getHttpServer())
      .post('/attendance/business-check-out')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(left.body.status).toBe('travelling');
  });

  it('closes a forgotten day at the last activity and flags it', async () => {
    const start = new Date('2026-11-10T04:00:00.000Z');
    at(start.toISOString());
    const agent = await make('call_agent', 'FGT');
    const token = tokenFor(agent);
    await login(token).expect(201);
    at(new Date(start.getTime() + 5 * 60 * 1000).toISOString());
    await request(app.getHttpServer())
      .post('/attendance/heartbeat')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    at(new Date(start.getTime() + 5 * 60 * 60 * 1000).toISOString());
    const result = await attendance.closeForgottenDays(agent.id);
    expect(result).toEqual({ closed: 1 });
    const row = await prisma.attendanceDay.findFirstOrThrow({ where: { staffId: agent.id } });
    expect(row.closedReason).toBe('auto_closed_no_logout');
    expect(row.flagged).toBe(true);
    expect(row.logoutAt?.toISOString()).toBe(new Date(start.getTime() + 5 * 60 * 1000).toISOString());
    expect(row.productionSeconds).toBe(300);
    const again = await login(token);
    expect(again.status).toBe(400);
    expect(again.body.message).toContain('already closed');
  });
});
