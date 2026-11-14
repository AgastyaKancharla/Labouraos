import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { CallWorkClock } from '../screens-call-agent/call-work-clock';
import { BusinessClock } from '../business/business-clock';
import { CallAgentMetricsService } from '../target/call-agent-metrics.service';
import { openAvailableDay } from '../../test-support/available-day';
import { SignupTrackerClock } from './signup-tracker-clock';
import { SignupTrackerService } from './signup-tracker.service';

/** Wednesday 2 Dec 2026, 11:00 IST: a working day, inside calling hours and the shift. */
const WED_11 = new Date('2026-12-02T05:30:00.000Z');
const ist = (s: string) => new Date(`${s}:00+05:30`);
const HOLIDAY = new Date('2026-12-07T00:00:00.000Z');

class FrozenClock {
  at = WED_11;
  now(): Date {
    return this.at;
  }
}

describe('App sign-ups in the back office: assignment, call tasks, timing, team scope, credit, visit requests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let tracker: SignupTrackerService;
  const clock = new FrozenClock();
  const stamp = String(Date.now());
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const businessIds: string[] = [];
  const accountIds: string[] = [];
  const trackerIds: string[] = [];
  let phoneN = 0;
  const phone = () => `+916${stamp.slice(-7)}${String((phoneN += 1)).padStart(2, '0')}`;

  const token = (s: { id: string; role: string; code: string }) => jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });

  async function makeStaff(role: string, extra: { teamLeadId?: string; languages?: string[] } = {}) {
    const n = staffIds.length;
    const s = await prisma.staff.create({
      data: {
        code: `SU-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Signup ${role} ${n}`,
        email: `su-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Signup-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: extra.teamLeadId ?? null,
        reportsToId: extra.teamLeadId ?? null,
        spokenLanguages: extra.languages ?? [],
      },
    });
    staffIds.push(s.id);
    return s;
  }

  async function makeSeeker(name: string, registeredByStaffId: string | null = null) {
    const s = await prisma.jobSeeker.create({
      data: {
        code: `JS-8${stamp.slice(-4)}${seekerIds.length}`,
        name,
        phone: phone(),
        minSalary: 1500000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'lead',
        heardFrom: 'laboura_app',
        registeredByStaffId,
        trades: { create: { trade: 'Cook', isPrimary: true } },
      },
    });
    seekerIds.push(s.id);
    return s;
  }

  async function makeAccount() {
    const a = await prisma.customerAccount.create({
      data: { phone: phone(), phoneVerifiedAt: WED_11, createdVia: 'phone', contactMeConsent: true, language: 'kn' },
    });
    accountIds.push(a.id);
    return a;
  }

  async function makeTracker(data: {
    kind?: string;
    subjectType?: string | null;
    subjectId?: string | null;
    stage?: string;
    stoppedAt?: Date;
    remindersSent?: number;
    contactConsent?: boolean;
    language?: string;
    accountId?: string | null;
  }) {
    const t = await prisma.signupTracker.create({
      data: {
        accountId: data.accountId ?? null,
        profileKind: data.kind ?? 'job_seeker',
        subjectType: data.subjectType ?? null,
        subjectId: data.subjectId ?? null,
        stage: data.stage ?? 'B',
        stageReachedAt: data.stoppedAt ?? ist('2026-12-01T15:00'),
        lastActivityAt: data.stoppedAt ?? ist('2026-12-01T15:00'),
        remindersSent: data.remindersSent ?? 2,
        contactConsent: data.contactConsent ?? true,
        language: data.language ?? 'kn',
        source: 'store',
      },
    });
    trackerIds.push(t.id);
    return t;
  }

  let lead1: Awaited<ReturnType<typeof makeStaff>>;
  let lead2: Awaited<ReturnType<typeof makeStaff>>;
  let hindiAgent: Awaited<ReturnType<typeof makeStaff>>;
  let kannadaAgent: Awaited<ReturnType<typeof makeStaff>>;
  let offShiftAgent: Awaited<ReturnType<typeof makeStaff>>;
  let fieldAgent: Awaited<ReturnType<typeof makeStaff>>;
  let manager: Awaited<ReturnType<typeof makeStaff>>;
  let ceo: Awaited<ReturnType<typeof makeStaff>>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SignupTrackerClock)
      .useValue(clock)
      .overrideProvider(AttendanceClock)
      .useValue(clock)
      .overrideProvider(CallWorkClock)
      .useValue(clock)
      .overrideProvider(BusinessClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    tracker = app.get(SignupTrackerService);

    ceo = await makeStaff('ceo');
    manager = await makeStaff('manager');
    lead1 = await makeStaff('team_lead');
    lead2 = await makeStaff('team_lead');
    hindiAgent = await makeStaff('call_agent', { teamLeadId: lead1.id, languages: ['Hindi'] });
    kannadaAgent = await makeStaff('call_agent', { teamLeadId: lead1.id, languages: ['Kannada', 'English'] });
    offShiftAgent = await makeStaff('call_agent', { teamLeadId: lead2.id, languages: ['Kannada'] });
    fieldAgent = await makeStaff('field_agent', { teamLeadId: lead1.id, languages: ['Kannada'] });
    await openAvailableDay(app, hindiAgent.id);
    await openAvailableDay(app, kannadaAgent.id);
    await prisma.holiday.upsert({ where: { date: HOLIDAY }, create: { date: HOLIDAY, name: `Signup test ${stamp}` }, update: {} });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.callTask.deleteMany({ where: { OR: [{ signupTrackerId: { in: trackerIds } }, { staffId: { in: staffIds } }] } });
    await prisma.customerCallbackRequest.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.customerProfile.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.signupTracker.deleteMany({ where: { id: { in: trackerIds } } });
    await prisma.customerAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.callRecord.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: [...seekerIds, ...businessIds] } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: businessIds } } });
    await prisma.visitAssignment.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.fieldCheckIn.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.holiday.deleteMany({ where: { date: HOLIDAY, name: `Signup test ${stamp}` } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  beforeEach(() => {
    clock.at = WED_11;
  });

  it('assigns by language among agents on shift, fewest open tasks, and puts a sign-up help task on the work list', async () => {
    const seeker = await makeSeeker('Ravi Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, language: 'kn' });
    await tracker.process(t.id, await tracker.context(WED_11));
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ assignedStaffId: kannadaAgent.id, assignmentReason: 'language', callTries: 1 });
    const task = await prisma.callTask.findFirstOrThrow({ where: { signupTrackerId: t.id } });
    expect(task).toMatchObject({ kind: 'signup_help', staffId: kannadaAgent.id, subjectType: 'job_seeker', subjectId: seeker.id, status: 'open' });

    const home = await request(app.getHttpServer()).get('/call-work/home').set('Authorization', `Bearer ${token(kannadaAgent)}`).expect(200);
    const item = home.body.work.items.find((i: { subjectId: string }) => i.subjectId === seeker.id);
    expect(item).toMatchObject({ kind: 'signup_help', category: 'app_signups' });
    expect(item.detail).toMatchObject({ stage: 'B', step: 'consent', signupKind: 'job_seeker', scriptHint: 'job_seeker.consent' });
    expect(item.detail.missing).toContain('payment');
    // Before consent the only call allowed is the one explaining it.
    expect(item.call.purpose).toBe('consent_explain');
    expect(home.body.work.counts.app_signups).toBeGreaterThanOrEqual(1);
  });

  it('gives it to the agent who registered the person when they are on shift', async () => {
    const seeker = await makeSeeker('Asha Appsignup', hindiAgent.id);
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, language: 'kn' });
    await tracker.process(t.id, await tracker.context(WED_11));
    expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      assignedStaffId: hindiAgent.id,
      assignmentReason: 'existing_agent',
    });
  });

  it('never assigns to an agent who has not started the day', async () => {
    const seeker = await makeSeeker('Off Shift Appsignup', offShiftAgent.id);
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id });
    await tracker.process(t.id, await tracker.context(WED_11));
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.assignedStaffId).not.toBe(offShiftAgent.id);
    expect([hindiAgent.id, kannadaAgent.id]).toContain(after.assignedStaffId);
  });

  it('respects the contact-me tick: without it no call task, only reminders', async () => {
    const account = await prisma.customerAccount.create({
      data: { phone: phone(), phoneVerifiedAt: WED_11, createdVia: 'phone', contactMeConsent: false },
    });
    accountIds.push(account.id);
    const seeker = await makeSeeker('No Calls Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, contactConsent: false, accountId: account.id });
    await tracker.process(t.id, await tracker.context(WED_11));
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(0);
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.nextActionAt!.getTime()).toBeGreaterThan(WED_11.getTime());
  });

  it('waits for the next working morning, skipping Sunday and a public holiday', async () => {
    clock.at = ist('2026-12-05T16:00'); // Saturday
    const seeker = await makeSeeker('Weekend Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, stoppedAt: ist('2026-12-05T15:00') });
    await tracker.process(t.id, await tracker.context(clock.at));
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(0);
    // Sunday 6 Dec is off and Monday 7 Dec is a holiday: Tuesday 09:30 IST.
    expect(after.nextActionAt).toEqual(ist('2026-12-08T09:30'));
  });

  it('a stage-A sign-up (no record yet) gets reminders only: there is nobody to call through the calling system', async () => {
    const account = await makeAccount();
    const t = await makeTracker({ stage: 'A', accountId: account.id, remindersSent: 0, stoppedAt: ist('2026-12-02T06:00') });
    await tracker.process(t.id, await tracker.context(WED_11));
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.remindersSent).toBe(2);
    expect(await prisma.signupTrackerEvent.count({ where: { trackerId: t.id, kind: 'reminder' } })).toBe(2);
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(0);
  });

  it('Team Lead sees only their own team, moves a sign-up inside the team, and is refused outside it', async () => {
    const mine = await makeTracker({ subjectType: 'job_seeker', subjectId: (await makeSeeker('Team One Appsignup')).id });
    await tracker.process(mine.id, await tracker.context(WED_11));
    const other = await makeTracker({ subjectType: 'job_seeker', subjectId: (await makeSeeker('Team Two Appsignup')).id });
    await prisma.signupTracker.update({ where: { id: other.id }, data: { assignedStaffId: offShiftAgent.id, assignedAt: WED_11 } });

    const page = await request(app.getHttpServer()).get('/signup-tracker/team-lead').set('Authorization', `Bearer ${token(lead1)}`).expect(200);
    const ids = page.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(other.id);
    for (const row of page.body.rows) expect(row.maskedPhone ?? '').toMatch(/^(\*{6}\d{4})?$/);

    const current = (await prisma.signupTracker.findUniqueOrThrow({ where: { id: mine.id } })).assignedStaffId;
    const to = current === kannadaAgent.id ? hindiAgent : kannadaAgent;
    await request(app.getHttpServer())
      .post(`/signup-tracker/${mine.id}/reassign`)
      .set('Authorization', `Bearer ${token(lead1)}`)
      .send({ staffId: to.id, reason: 'Speaks his language' })
      .expect(201);
    expect((await prisma.callTask.findFirstOrThrow({ where: { signupTrackerId: mine.id, status: 'open' } })).staffId).toBe(to.id);
    expect(await prisma.auditLog.count({ where: { actorId: lead1.id, action: 'signup_tracker.reassigned' } })).toBe(1);

    await request(app.getHttpServer())
      .post(`/signup-tracker/${mine.id}/reassign`)
      .set('Authorization', `Bearer ${token(lead1)}`)
      .send({ staffId: offShiftAgent.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/signup-tracker/${other.id}/reassign`)
      .set('Authorization', `Bearer ${token(lead1)}`)
      .send({ staffId: kannadaAgent.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/signup-tracker/${mine.id}/reassign`)
      .set('Authorization', `Bearer ${token(kannadaAgent)}`)
      .send({ staffId: hindiAgent.id })
      .expect(403);
  });

  it('each view is for its own role; the Manager gets counts with no names, phones or money', async () => {
    await request(app.getHttpServer()).get('/signup-tracker/team-lead').set('Authorization', `Bearer ${token(manager)}`).expect(403);
    await request(app.getHttpServer()).get('/signup-tracker/manager').set('Authorization', `Bearer ${token(lead1)}`).expect(403);
    await request(app.getHttpServer()).get('/signup-tracker/ceo').set('Authorization', `Bearer ${token(manager)}`).expect(403);
    await request(app.getHttpServer()).get('/signup-tracker/ceo').set('Authorization', `Bearer ${token(kannadaAgent)}`).expect(403);
    const res = await request(app.getHttpServer()).get('/signup-tracker/manager').set('Authorization', `Bearer ${token(manager)}`).expect(200);
    expect(res.body.started).toBeGreaterThan(0);
    expect(res.body.openByStage.job_seeker).toBeDefined();
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/Paise|maskedPhone|"name"|"rows"|Appsignup/);
    const ceoView = await request(app.getHttpServer()).get('/signup-tracker/ceo').set('Authorization', `Bearer ${token(ceo)}`).expect(200);
    expect(ceoView.body.rows.length).toBeGreaterThan(0);
    expect(ceoView.body.settings.firstReminderMinutes).toBe(30);
  });

  it('credits the assigned agent only with a connected call on record; a self-finished sign-up credits nobody', async () => {
    const helped = await makeSeeker('Helped Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: helped.id });
    await tracker.process(t.id, await tracker.context(WED_11));
    const assigned = (await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).assignedStaffId!;
    const agent = [hindiAgent, kannadaAgent].find((a) => a.id === assigned)!;
    const before = await app.get(CallAgentMetricsService).getCallAgentMetrics(agent.id, 2026, 12, undefined, WED_11);
    await prisma.callRecord.create({
      data: {
        code: `CR-SU-${stamp}`,
        provider: 'mock',
        providerCallId: `su-${stamp}`,
        providerStatus: 'completed',
        answered: true,
        answeredAt: new Date(WED_11.getTime() + 10 * 60_000),
        staffId: agent.id,
        subjectType: 'job_seeker',
        subjectId: helped.id,
        direction: 'outbound',
      },
    });
    clock.at = new Date(WED_11.getTime() + 60 * 60_000);
    await prisma.jobSeeker.update({ where: { id: helped.id }, data: { paymentReceivedAt: clock.at, status: 'active' } });
    await tracker.process(t.id, await tracker.context(clock.at));
    expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ outcome: 'assisted', stage: 'done' });
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(0);
    const metrics = await app.get(CallAgentMetricsService).getCallAgentMetrics(agent.id, 2026, 12, undefined, clock.at);
    expect(metrics.metrics.candidatesActivated).toBe(before.metrics.candidatesActivated + 1);

    const alone = await makeSeeker('Alone Appsignup');
    const t2 = await makeTracker({ subjectType: 'job_seeker', subjectId: alone.id, remindersSent: 0, stoppedAt: clock.at });
    await prisma.jobSeeker.update({ where: { id: alone.id }, data: { paymentReceivedAt: clock.at, status: 'active' } });
    await tracker.process(t2.id, await tracker.context(clock.at));
    expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: t2.id } })).toMatchObject({ outcome: 'self', assignedStaffId: null });
  });

  it('business sign-up: suggests the nearest field agent on the existing visit request, never a second one, Team Lead confirms', async () => {
    const business = await prisma.business.create({
      data: {
        code: `BZ-SU-${stamp}`,
        name: 'Appsignup Bakery',
        phone: phone(),
        phoneVerified: true,
        latitude: 12.9716,
        longitude: 77.5946,
        verificationStatus: 'lead',
        heardFrom: 'laboura_app',
      },
    });
    businessIds.push(business.id);
    await prisma.fieldCheckIn.create({ data: { staffId: fieldAgent.id, latitude: 12.972, longitude: 77.595, accuracyMeters: 10, checkedInAt: WED_11 } });
    const t = await makeTracker({ kind: 'business', subjectType: 'business', subjectId: business.id, remindersSent: 1, stoppedAt: ist('2026-12-02T09:45') });
    const request0 = await prisma.visitAssignment.create({
      data: { businessId: business.id, purpose: 'business_signup', status: 'pending', signupTrackerId: t.id, requestedFor: ist('2026-12-03T11:00') },
    });
    await tracker.process(t.id, await tracker.context(WED_11));
    await tracker.process(t.id, await tracker.context(WED_11));
    expect(await prisma.visitAssignment.count({ where: { businessId: business.id } })).toBe(1);
    expect(await prisma.visitAssignment.findUniqueOrThrow({ where: { id: request0.id } })).toMatchObject({ suggestedStaffId: fieldAgent.id, status: 'pending' });
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).verificationStatus).toBe('pending_visit');
    // A business is called 4 hours after it stopped (09:45 → 13:45): not yet at 11:00.
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(0);
    expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).nextActionAt).toEqual(ist('2026-12-02T13:45'));

    const list = await request(app.getHttpServer()).get('/businesses/visit-assignments').set('Authorization', `Bearer ${token(lead1)}`).expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toContain(request0.id);
    const other = await request(app.getHttpServer()).get('/businesses/visit-assignments').set('Authorization', `Bearer ${token(lead2)}`).expect(200);
    expect(other.body.map((a: { id: string }) => a.id)).not.toContain(request0.id);
    await request(app.getHttpServer())
      .post(`/businesses/${business.id}/visit-assignments/${request0.id}/assign`)
      .set('Authorization', `Bearer ${token(lead2)}`)
      .send({ assignedStaffId: fieldAgent.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/businesses/${business.id}/visit-assignments/${request0.id}/assign`)
      .set('Authorization', `Bearer ${token(lead1)}`)
      .send({ assignedStaffId: fieldAgent.id })
      .expect(201);
    const visits = await request(app.getHttpServer()).get('/field-work/visits').set('Authorization', `Bearer ${token(fieldAgent)}`).expect(200);
    const planned = visits.body.planned.find((p: { assignmentId: string }) => p.assignmentId === request0.id);
    expect(planned).toMatchObject({ purpose: 'business_signup', requestedFor: ist('2026-12-03T11:00').toISOString() });
  });

  it('"Call me back" during a sign-up becomes a sign-up help task for an agent on shift', async () => {
    const account = await makeAccount();
    const seeker = await makeSeeker('Callback Appsignup');
    const profile = await prisma.customerProfile.create({ data: { accountId: account.id, kind: 'job_seeker', jobSeekerId: seeker.id, linkedVia: 'self_registered' } });
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, accountId: account.id, remindersSent: 0, stoppedAt: WED_11 });
    const cb = await prisma.customerCallbackRequest.create({ data: { accountId: account.id, profileId: profile.id, topic: 'signup', note: 'UPI failed' } });
    await tracker.onCallbackRequested(cb.id);
    const after = await prisma.customerCallbackRequest.findUniqueOrThrow({ where: { id: cb.id } });
    expect(after.status).toBe('assigned');
    const task = await prisma.callTask.findUniqueOrThrow({ where: { id: after.callTaskId! } });
    expect(task).toMatchObject({ kind: 'signup_help', signupTrackerId: t.id });
    expect([hindiAgent.id, kannadaAgent.id]).toContain(task.staffId);

    const labels = await request(app.getHttpServer())
      .get(`/signup-tracker/app-labels?type=job_seeker&ids=${seeker.id},${seekerIds[0]}`)
      .set('Authorization', `Bearer ${token(kannadaAgent)}`)
      .expect(200);
    expect(labels.body[seeker.id]).toMatchObject({ registeredInApp: true, hasApp: true });
    expect(labels.body[seekerIds[0]]).toBeUndefined();
  });

  it('the CEO edits the languages a staff member speaks; nobody else can', async () => {
    await request(app.getHttpServer())
      .put(`/signup-tracker/staff-languages/${hindiAgent.id}`)
      .set('Authorization', `Bearer ${token(manager)}`)
      .send({ languages: ['Kannada'] })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/signup-tracker/staff-languages/${hindiAgent.id}`)
      .set('Authorization', `Bearer ${token(ceo)}`)
      .send({ languages: ['Klingon'] })
      .expect(400);
    const res = await request(app.getHttpServer())
      .put(`/signup-tracker/staff-languages/${hindiAgent.id}`)
      .set('Authorization', `Bearer ${token(ceo)}`)
      .send({ languages: ['Hindi', 'Kannada'] })
      .expect(200);
    expect(res.body.spokenLanguages).toEqual(['Hindi', 'Kannada']);
    expect(await prisma.auditLog.count({ where: { actorId: ceo.id, action: 'staff.spoken_languages_changed' } })).toBe(1);
  });
});
