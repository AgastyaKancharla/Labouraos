import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { CustomerTokenService } from '../../common/customer-auth/customer-token.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { CallWorkClock } from '../screens-call-agent/call-work-clock';
import { BusinessClock } from '../business/business-clock';
import { CallAgentMetricsService } from '../target/call-agent-metrics.service';
import { openAvailableDay } from '../../test-support/available-day';
import { SignupTrackerClock } from './signup-tracker-clock';
import { SignupTrackerService } from './signup-tracker.service';
import { assistedActivations } from './signup-credit';
import { CallFollowThroughService } from '../call/call-follow-through.service';

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
    await prisma.staff.update({ where: { id: lead1.id }, data: { reportsToId: manager.id } });
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
    await prisma.teamLeadCheck.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.callTask.deleteMany({ where: { OR: [{ signupTrackerId: { in: trackerIds } }, { staffId: { in: staffIds } }] } });
    await prisma.customerCallbackRequest.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.customerProfile.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.signupTrackerEvent.deleteMany({ where: { trackerId: { in: trackerIds } } });
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
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
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
    // 21 Nov fixes: the task is on the list, but it is a try only once the agent places the call.
    expect(after).toMatchObject({ assignedStaffId: kannadaAgent.id, assignmentReason: 'language', callTries: 0 });
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

  it('without the contact-me tick an OTP-verified sign-up gets exactly one help call (21 Nov fixes); after that try it is closed', async () => {
    const account = await prisma.customerAccount.create({
      data: { phone: phone(), phoneVerifiedAt: WED_11, createdVia: 'phone', contactMeConsent: false },
    });
    accountIds.push(account.id);
    const seeker = await makeSeeker('One Call Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, contactConsent: false, accountId: account.id });
    await tracker.process(t.id, await tracker.context(WED_11));
    const task = await prisma.callTask.findFirstOrThrow({ where: { signupTrackerId: t.id } });
    expect(task).toMatchObject({ kind: 'signup_help', status: 'open' });
    // The agent places the call; nobody answers.
    await prisma.callRecord.create({
      data: { code: `CR-SU-ONE-${stamp}`, provider: 'mock', providerCallId: `su-one-${stamp}`, providerStatus: 'no_answer', answered: false, staffId: task.staffId, subjectType: 'job_seeker', subjectId: seeker.id, direction: 'outbound', purpose: 'consent_explain', createdAt: new Date(WED_11.getTime() + 60_000) },
    });
    const thu = ist('2026-12-03T11:00');
    clock.at = thu;
    await tracker.process(t.id, await tracker.context(thu));
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ callTries: 1, outcome: 'no_response' });
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(1);
  });

  it('without the tick and without a verified mobile: no call task, only reminders', async () => {
    const account = await prisma.customerAccount.create({ data: { createdVia: 'google', contactMeConsent: false } });
    accountIds.push(account.id);
    const seeker = await makeSeeker('No Calls Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, contactConsent: false, accountId: account.id });
    await tracker.process(t.id, await tracker.context(WED_11));
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(0);
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.nextActionAt!.getTime()).toBeGreaterThan(WED_11.getTime());
  });

  it('a help task nobody called is not a try: it stays open on the list and the Team Lead is told once (21 Nov fixes)', async () => {
    const seeker = await makeSeeker('Not Called Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id });
    await tracker.process(t.id, await tracker.context(WED_11));
    const task = await prisma.callTask.findFirstOrThrow({ where: { signupTrackerId: t.id } });
    for (const at of [ist('2026-12-03T11:00'), ist('2026-12-03T12:00'), ist('2026-12-04T11:00')]) {
      clock.at = at;
      await tracker.process(t.id, await tracker.context(at));
    }
    expect(await prisma.callTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'open' });
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(1);
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ callTries: 0, outcome: 'open' });
    const flags = await prisma.reviewFlag.findMany({ where: { kind: 'signup_call_not_attempted', subjectId: seeker.id } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ raisedForStaffId: task.staffId, status: 'open' });
  });

  it('giving the contact-me tick later re-plans the sign-up at once and reopens one closed only because nobody could call', async () => {
    const account = await prisma.customerAccount.create({ data: { createdVia: 'google', contactMeConsent: false } });
    accountIds.push(account.id);
    const seeker = await makeSeeker('Late Tick Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, contactConsent: false, accountId: account.id });
    await prisma.signupTracker.update({ where: { id: t.id }, data: { outcome: 'no_response', nextActionAt: ist('2027-01-01T10:00') } });
    await prisma.customerAccount.update({ where: { id: account.id }, data: { contactMeConsent: true, contactMeConsentAt: WED_11 } });
    await tracker.onContactConsentChanged(account.id);
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ outcome: 'open', contactConsent: true });
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(1);
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
    // 21 Nov fixes: the reminders really go out (inbox + push through the customer notification service).
    expect(after.remindersSent).toBe(2);
    expect(await prisma.signupTrackerEvent.count({ where: { trackerId: t.id, kind: 'reminder' } })).toBe(2);
    expect(await prisma.signupTrackerEvent.count({ where: { trackerId: t.id, kind: 'reminder_due' } })).toBe(0);
    expect(await prisma.customerInboxMessage.count({ where: { accountId: account.id, kind: 'signup_reminder' } })).toBe(2);
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(0);
    // Nobody may call: it waits until the tries window ends (a fixed time), never overdue every 5 minutes.
    expect(after.nextActionAt!.getTime()).toBeGreaterThan(WED_11.getTime());
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
        durationSec: 120,
        staffId: agent.id,
        subjectType: 'job_seeker',
        subjectId: helped.id,
        direction: 'outbound',
      },
    });
    clock.at = new Date(WED_11.getTime() + 60 * 60_000);
    await prisma.jobSeeker.update({ where: { id: helped.id }, data: { paymentReceivedAt: clock.at, guaranteeStartsAt: clock.at, status: 'active' } });
    await tracker.process(t.id, await tracker.context(clock.at));
    expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ outcome: 'assisted', stage: 'done' });
    expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(0);
    const metrics = await app.get(CallAgentMetricsService).getCallAgentMetrics(agent.id, 2026, 12, undefined, clock.at);
    expect(metrics.metrics.candidatesActivated).toBe(before.metrics.candidatesActivated + 1);

    const alone = await makeSeeker('Alone Appsignup');
    const t2 = await makeTracker({ subjectType: 'job_seeker', subjectId: alone.id, remindersSent: 0, stoppedAt: clock.at });
    await prisma.jobSeeker.update({ where: { id: alone.id }, data: { paymentReceivedAt: clock.at, guaranteeStartsAt: clock.at, status: 'active' } });
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
    // 21 Nov fixes: the suggested field agent's Team Lead gets a bell until a field agent is sent.
    expect(await prisma.notification.count({ where: { kind: 'signup_visit_request', subjectId: request0.id, recipientStaffId: lead1.id, clearedAt: null } })).toBe(1);

    const list = await request(app.getHttpServer()).get('/businesses/visit-assignments').set('Authorization', `Bearer ${token(lead1)}`).expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toContain(request0.id);
    const other = await request(app.getHttpServer()).get('/businesses/visit-assignments').set('Authorization', `Bearer ${token(lead2)}`).expect(200);
    expect(other.body.map((a: { id: string }) => a.id)).not.toContain(request0.id);
    await request(app.getHttpServer())
      .post(`/signup-tracker/visit-requests/${request0.id}/assign`)
      .set('Authorization', `Bearer ${token(lead2)}`)
      .send({ assignedStaffId: fieldAgent.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/signup-tracker/visit-requests/${request0.id}/assign`)
      .set('Authorization', `Bearer ${token(kannadaAgent)}`)
      .send({ assignedStaffId: fieldAgent.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/signup-tracker/visit-requests/${request0.id}/assign`)
      .set('Authorization', `Bearer ${token(lead1)}`)
      .send({ assignedStaffId: fieldAgent.id })
      .expect(201);
    await tracker.process(t.id, await tracker.context(WED_11));
    expect(await prisma.notification.count({ where: { kind: 'signup_visit_request', subjectId: request0.id, clearedAt: null } })).toBe(0);
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

  it('an owner account has no attendance: it takes sign-ups while signed in, and its help never counts toward targets', async () => {
    const owner = await makeStaff('call_agent', { teamLeadId: lead1.id, languages: ['Tamil'] });
    await prisma.staff.update({ where: { id: owner.id }, data: { isOwnerAccount: true } });
    const seeker = await makeSeeker('Owner Appsignup');
    const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, language: 'Tamil' });
    // Not signed in: never picked, even though it is the only Tamil speaker.
    await tracker.process(t.id, await tracker.context(WED_11));
    expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).assignedStaffId).not.toBe(owner.id);

    await prisma.callTask.deleteMany({ where: { signupTrackerId: t.id } });
    await prisma.signupTracker.update({ where: { id: t.id }, data: { assignedStaffId: null, assignedAt: null, callTries: 0 } });
    const hour = 60 * 60_000;
    await prisma.staffSession.create({
      data: { staffId: owner.id, expiresAt: new Date(WED_11.getTime() + hour), absoluteExpiresAt: new Date(WED_11.getTime() + 2 * hour), lastActivityAt: WED_11 },
    });
    await tracker.process(t.id, await tracker.context(WED_11));
    const after = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ assignedStaffId: owner.id, assignmentReason: 'language' });

    await prisma.signupTracker.update({ where: { id: t.id }, data: { outcome: 'assisted', finishedAt: WED_11 } });
    await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { paymentReceivedAt: new Date(WED_11.getTime() + 3600_000), guaranteeStartsAt: new Date(WED_11.getTime() + 3600_000), status: 'active' } });
    const month = { from: new Date('2026-11-30T18:30:00.000Z'), to: new Date('2026-12-31T18:29:59.999Z') };
    expect(await assistedActivations(prisma, owner.id, month.from, month.to)).toBe(0);
    await prisma.staff.update({ where: { id: owner.id }, data: { isOwnerAccount: false } });
    expect(await assistedActivations(prisma, owner.id, month.from, month.to)).toBe(1);
  });

  describe('review fixes (PR #144)', () => {
    async function seekerTracker(name: string, over: Parameters<typeof makeTracker>[0] = {}, registeredBy: string | null = null) {
      const seeker = await makeSeeker(name, registeredBy);
      return { seeker, t: await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id, ...over }) };
    }

    it('H1: a sign-up nobody may call is closed onto the monthly list when the tries window ends, and is then not due again', async () => {
      const { t } = await seekerTracker('Window Appsignup', { contactConsent: false });
      await tracker.process(t.id, await tracker.context(WED_11));
      const waiting = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
      expect(waiting.outcome).toBe('open');
      expect(waiting.nextActionAt!.getTime()).toBeGreaterThan(WED_11.getTime());
      clock.at = new Date(waiting.nextActionAt!.getTime() + 60_000);
      await tracker.process(t.id, await tracker.context(clock.at));
      const closed = await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } });
      expect(closed.outcome).toBe('no_response');
      expect(closed.nextActionAt!.getTime()).toBeGreaterThan(clock.at.getTime() + 20 * 24 * 3600_000);
      const due = await prisma.signupTracker.count({ where: { id: t.id, nextActionAt: { lte: clock.at } } });
      expect(due).toBe(0);
    });

    it('H3: withdrawing the contact-me tick in the app (PATCH /me) takes the queued call off the list, drops the "not called" flag and never leaves a help call; a late tick plans it again', async () => {
      const account = await makeAccount();
      const tokens = app.get(CustomerTokenService);
      const session = await prisma.customerSession.create({
        data: { accountId: account.id, refreshTokenHash: tokens.hashRefreshToken(`h3-${stamp}`), signedInWith: 'phone', expiresAt: new Date(Date.now() + 86_400_000) },
      });
      const patchMe = (contactMe: boolean) =>
        request(app.getHttpServer()).patch('/customer-api/v1/me').set('Authorization', `Bearer ${tokens.signAccess(account.id, session.id).accessToken}`).send({ contactMe });
      await patchMe(true).expect(200);
      const { seeker, t } = await seekerTracker('Consent Appsignup', { accountId: account.id, contactConsent: true });
      await tracker.process(t.id, await tracker.context(WED_11));
      expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(1);
      const flag = await prisma.reviewFlag.create({ data: { code: `RF-H3-${stamp}`, kind: 'signup_call_not_attempted', subjectType: 'job_seeker', subjectId: seeker.id, status: 'open' } });
      await patchMe(false).expect(200);
      expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(0);
      expect(await prisma.reviewFlag.findUniqueOrThrow({ where: { id: flag.id } })).toMatchObject({ status: 'dismissed' });
      // Later runs never bring the "one help call" back after a withdrawal.
      for (const at of [ist('2026-12-03T11:00'), ist('2026-12-04T11:00')]) {
        clock.at = at;
        await tracker.process(t.id, await tracker.context(at));
        expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(0);
      }
      clock.at = WED_11;
      await patchMe(true).expect(200);
      expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(1);
      await prisma.customerSession.deleteMany({ where: { accountId: account.id } });
    });

    it('no in-app reminder (nor a monthly nudge) after the contact-me tick is withdrawn', async () => {
      const account = await prisma.customerAccount.create({
        data: { phone: phone(), phoneVerifiedAt: WED_11, createdVia: 'phone', contactMeConsent: false, contactMeNoticeVersion: 'contact-me-2026-11-14' },
      });
      accountIds.push(account.id);
      const t = await makeTracker({ stage: 'A', accountId: account.id, remindersSent: 0, contactConsent: false, stoppedAt: ist('2026-12-02T06:00') });
      await tracker.process(t.id, await tracker.context(WED_11));
      expect(await prisma.signupTrackerEvent.count({ where: { trackerId: t.id, kind: { in: ['reminder', 'reminder_due'] } } })).toBe(0);
      expect(await prisma.customerInboxMessage.count({ where: { accountId: account.id, kind: 'signup_reminder' } })).toBe(0);
      await prisma.signupTracker.update({ where: { id: t.id }, data: { outcome: 'no_response', nextActionAt: WED_11 } });
      await tracker.process(t.id, await tracker.context(WED_11));
      expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ nextActionAt: null });
      expect(await prisma.signupTrackerEvent.count({ where: { trackerId: t.id, kind: { in: ['reengage', 'reengage_due'] } } })).toBe(0);
    });

    it('H3: an account that asked to be deleted stops everything, with no re-engagement', async () => {
      const account = await makeAccount();
      const { t } = await seekerTracker('Deleted Appsignup', { accountId: account.id });
      await tracker.process(t.id, await tracker.context(WED_11));
      await prisma.customerAccount.update({ where: { id: account.id }, data: { status: 'deletion_requested' } });
      await tracker.process(t.id, await tracker.context(WED_11));
      expect(await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ outcome: 'gave_up', nextActionAt: null });
      expect(await prisma.callTask.count({ where: { signupTrackerId: t.id, status: 'open' } })).toBe(0);
    });

    it('M1: runs started together (the app’s call and the job) put exactly one task on the lists', async () => {
      const { t } = await seekerTracker('Race Appsignup');
      const ctx = await tracker.context(WED_11);
      await Promise.all([tracker.process(t.id, ctx), tracker.process(t.id, ctx), tracker.onSignupChanged(t.id)]);
      expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(1);
      // Not a try until the call is placed (21 Nov fixes).
      expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).callTries).toBe(0);
    });

    it('M2: an unanswered sign-up help call adds no automatic retry on top of the sign-up tries', async () => {
      const { seeker, t } = await seekerTracker('Noanswer Appsignup');
      await tracker.process(t.id, await tracker.context(WED_11));
      const task = await prisma.callTask.findFirstOrThrow({ where: { signupTrackerId: t.id } });
      const call = await prisma.callRecord.create({
        data: {
          code: `CR-SU-NA-${stamp}`,
          provider: 'mock',
          providerCallId: `su-na-${stamp}`,
          providerStatus: 'no_answer',
          answered: false,
          staffId: task.staffId,
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          direction: 'outbound',
          purpose: 'consent_explain',
        },
      });
      await app.get(CallFollowThroughService).onStatusChanged(null, call);
      expect(await prisma.callTask.count({ where: { subjectId: seeker.id, kind: 'retry' } })).toBe(0);
      expect(await prisma.messageLog.count({ where: { subjectId: seeker.id } })).toBe(0);
    });

    it('M3: Team Leads see and move only their own team’s sign-ups; no-team ones go to Managers and the CEO', async () => {
      const { t: noTeam } = await seekerTracker('Noteam Appsignup');
      const { t: ours } = await seekerTracker('Ourteam Appsignup', {}, kannadaAgent.id);
      const page = await request(app.getHttpServer()).get('/signup-tracker/team-lead').set('Authorization', `Bearer ${token(lead1)}`).expect(200);
      const unassigned = page.body.unassigned.map((r: { id: string }) => r.id);
      expect(unassigned).toContain(ours.id);
      expect(unassigned).not.toContain(noTeam.id);
      await request(app.getHttpServer()).post(`/signup-tracker/${noTeam.id}/reassign`).set('Authorization', `Bearer ${token(lead1)}`).send({ staffId: kannadaAgent.id }).expect(403);
      await request(app.getHttpServer()).post(`/signup-tracker/${noTeam.id}/reassign`).set('Authorization', `Bearer ${token(manager)}`).send({ staffId: kannadaAgent.id }).expect(201);
      // Same agent again: refused (it would only reset the assignment time).
      await request(app.getHttpServer()).post(`/signup-tracker/${noTeam.id}/reassign`).set('Authorization', `Bearer ${token(ceo)}`).send({ staffId: kannadaAgent.id }).expect(400);
    });

    it('a Team Lead’s move sticks: the next try goes to the chosen agent even when they are not on shift', async () => {
      const away = await makeStaff('call_agent', { teamLeadId: lead1.id, languages: ['Hindi'] });
      const { t } = await seekerTracker('Sticky Appsignup', {}, kannadaAgent.id);
      await request(app.getHttpServer()).post(`/signup-tracker/${t.id}/reassign`).set('Authorization', `Bearer ${token(lead1)}`).send({ staffId: away.id }).expect(201);
      await tracker.process(t.id, await tracker.context(WED_11));
      const task = await prisma.callTask.findFirstOrThrow({ where: { signupTrackerId: t.id, status: 'open' } });
      expect(task.staffId).toBe(away.id);
      expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).assignmentReason).toBe('manual');
    });

    it('never hands a call out after office hours, even to an agent whose day is still open', async () => {
      clock.at = ist('2026-12-02T19:30');
      const { t } = await seekerTracker('Evening Appsignup');
      await tracker.process(t.id, await tracker.context(clock.at));
      expect(await prisma.callTask.count({ where: { signupTrackerId: t.id } })).toBe(0);
      expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).nextActionAt).toEqual(ist('2026-12-03T09:30'));
    });

    it('M4: no reminder in quiet hours; the monthly nudge stops after 3 and never reaches "not interested"', async () => {
      const account = await makeAccount();
      clock.at = ist('2026-12-02T22:15');
      const quiet = await makeTracker({ stage: 'A', accountId: account.id, remindersSent: 0, stoppedAt: ist('2026-12-02T20:00') });
      await tracker.process(quiet.id, await tracker.context(clock.at));
      expect(await prisma.signupTrackerEvent.count({ where: { trackerId: quiet.id, kind: { in: ['reminder', 'reminder_due'] } } })).toBe(0);
      expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: quiet.id } })).nextActionAt).toEqual(ist('2026-12-03T09:00'));

      clock.at = WED_11;
      const capped = await makeTracker({ accountId: account.id });
      await prisma.signupTracker.update({ where: { id: capped.id }, data: { outcome: 'no_response', nextActionAt: ist('2026-12-01T10:00') } });
      await prisma.signupTrackerEvent.createMany({ data: [1, 2, 3].map(() => ({ trackerId: capped.id, kind: 'reengage_due' })) });
      await tracker.process(capped.id, await tracker.context(WED_11));
      expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: capped.id } })).nextActionAt).toBeNull();
      expect(await prisma.signupTrackerEvent.count({ where: { trackerId: capped.id, kind: { in: ['reengage', 'reengage_due'] } } })).toBe(3);

      const declined = await makeTracker({ accountId: account.id });
      await prisma.signupTracker.update({ where: { id: declined.id }, data: { outcome: 'gave_up', nextActionAt: ist('2026-12-01T10:00') } });
      await tracker.sweep(WED_11);
      expect(await prisma.signupTrackerEvent.count({ where: { trackerId: declined.id, kind: { in: ['reengage', 'reengage_due'] } } })).toBe(0);
    });

    it('M5: a call shorter than 60 seconds is not help: the sign-up counts as finished alone', async () => {
      const { seeker, t } = await seekerTracker('Shortcall Appsignup');
      await tracker.process(t.id, await tracker.context(WED_11));
      const agentId = (await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).assignedStaffId!;
      await prisma.callRecord.create({
        data: {
          code: `CR-SU-SH-${stamp}`, provider: 'mock', providerCallId: `su-sh-${stamp}`, providerStatus: 'completed', answered: true,
          answeredAt: new Date(WED_11.getTime() + 5 * 60_000), durationSec: 25, staffId: agentId, subjectType: 'job_seeker', subjectId: seeker.id, direction: 'outbound',
        },
      });
      clock.at = new Date(WED_11.getTime() + 30 * 60_000);
      await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { paymentReceivedAt: clock.at, guaranteeStartsAt: clock.at, status: 'active' } });
      await tracker.process(t.id, await tracker.context(clock.at));
      expect((await prisma.signupTracker.findUniqueOrThrow({ where: { id: t.id } })).outcome).toBe('self');
    });

    it('H2: business sign-up visits — a Team Lead acts only for their own team’s business; no team means Managers and the CEO', async () => {
      const otherField = await makeStaff('field_agent', { teamLeadId: lead2.id });
      const mkBiz = async (n: number, leadCreatedByStaffId: string | null) => {
        const b = await prisma.business.create({
          data: { code: `BZ-SU${n}-${stamp}`, name: `Appsignup Shop ${n}`, phone: phone(), latitude: 12.97, longitude: 77.59, verificationStatus: 'pending_visit', leadCreatedByStaffId },
        });
        businessIds.push(b.id);
        return b;
      };
      // Team 1's business (lead created by a team 1 agent), suggestion pointing at a team 2 field agent.
      const owned = await mkBiz(1, kannadaAgent.id);
      const va1 = await prisma.visitAssignment.create({ data: { businessId: owned.id, purpose: 'business_signup', status: 'pending', suggestedStaffId: otherField.id } });
      await request(app.getHttpServer()).post(`/signup-tracker/visit-requests/${va1.id}/assign`).set('Authorization', `Bearer ${token(lead2)}`).send({ assignedStaffId: otherField.id }).expect(403);
      const lead2List = await request(app.getHttpServer()).get('/businesses/visit-assignments').set('Authorization', `Bearer ${token(lead2)}`).expect(200);
      expect(lead2List.body.map((a: { id: string }) => a.id)).not.toContain(va1.id);
      await request(app.getHttpServer()).post(`/signup-tracker/visit-requests/${va1.id}/assign`).set('Authorization', `Bearer ${token(lead1)}`).send({ assignedStaffId: otherField.id }).expect(403);
      await request(app.getHttpServer()).post(`/signup-tracker/visit-requests/${va1.id}/assign`).set('Authorization', `Bearer ${token(lead1)}`).send({ assignedStaffId: fieldAgent.id }).expect(201);

      // No owner and no suggestion: no team. Team Leads neither see nor assign it; the CEO does.
      const orphan = await mkBiz(2, null);
      const va2 = await prisma.visitAssignment.create({ data: { businessId: orphan.id, purpose: 'business_signup', status: 'pending' } });
      const lead1List = await request(app.getHttpServer()).get('/businesses/visit-assignments').set('Authorization', `Bearer ${token(lead1)}`).expect(200);
      expect(lead1List.body.map((a: { id: string }) => a.id)).not.toContain(va2.id);
      await request(app.getHttpServer()).post(`/signup-tracker/visit-requests/${va2.id}/assign`).set('Authorization', `Bearer ${token(lead1)}`).send({ assignedStaffId: fieldAgent.id }).expect(403);
      await request(app.getHttpServer()).post(`/signup-tracker/visit-requests/${va2.id}/assign`).set('Authorization', `Bearer ${token(ceo)}`).send({ assignedStaffId: fieldAgent.id }).expect(201);
    });

    it('a "Call me back" with no registered profile becomes a new lead on the missed-call list, tied to the verified mobile (21 Nov fixes)', async () => {
      const account = await makeAccount();
      const cb = await prisma.customerCallbackRequest.create({ data: { accountId: account.id, topic: 'signup' } });
      await tracker.onCallbackRequested(cb.id);
      await tracker.onCallbackRequested(cb.id);
      expect((await prisma.customerCallbackRequest.findUniqueOrThrow({ where: { id: cb.id } })).status).toBe('assigned');
      const lead = await prisma.callbackTask.findMany({ where: { callId: `app-callback:${cb.id}` } });
      expect(lead).toHaveLength(1);
      expect(lead[0]).toMatchObject({ phone: account.phone, status: 'pending' });
      await prisma.callbackTask.deleteMany({ where: { callId: `app-callback:${cb.id}` } });
    });

    it('a "Call me back" with no profile and no verified mobile is closed, not left open forever', async () => {
      const account = await prisma.customerAccount.create({ data: { createdVia: 'google', contactMeConsent: true } });
      accountIds.push(account.id);
      const cb = await prisma.customerCallbackRequest.create({ data: { accountId: account.id, topic: 'signup' } });
      await tracker.onCallbackRequested(cb.id);
      expect((await prisma.customerCallbackRequest.findUniqueOrThrow({ where: { id: cb.id } })).status).toBe('cancelled');
    });

    it('labels for a Team Lead cover only their own team’s records', async () => {
      const account = await makeAccount();
      const mine = await makeSeeker('Label Mine Appsignup', kannadaAgent.id);
      const loose = await makeSeeker('Label Loose Appsignup');
      for (const s of [mine, loose]) {
        await prisma.customerProfile.create({ data: { accountId: account.id, kind: 'job_seeker', jobSeekerId: s.id, linkedVia: 'self_registered' } });
      }
      const res = await request(app.getHttpServer())
        .get(`/signup-tracker/app-labels?type=job_seeker&ids=${mine.id},${loose.id}`)
        .set('Authorization', `Bearer ${token(lead1)}`)
        .expect(200);
      expect(Object.keys(res.body)).toEqual([mine.id]);
    });

    it('Team Lead checks: an app sign-up counts for the team of the agent it is assigned to', async () => {
      const seeker = await makeSeeker('Verify Appsignup');
      // The Team Lead screens read the (frozen) attendance clock: the registration is from this week.
      await prisma.jobSeeker.update({ where: { id: seeker.id }, data: { status: 'pending_activation', createdAt: new Date(WED_11.getTime() - 3600_000) } });
      const t = await makeTracker({ subjectType: 'job_seeker', subjectId: seeker.id });
      await prisma.signupTracker.update({ where: { id: t.id }, data: { assignedStaffId: kannadaAgent.id, assignedAt: WED_11 } });
      const mine = await request(app.getHttpServer()).get('/team-lead/registrations').set('Authorization', `Bearer ${token(lead1)}`).expect(200);
      const row = mine.body.rows.find((r: { jobSeeker: { id: string } }) => r.jobSeeker.id === seeker.id);
      expect(row?.registeredBy?.id).toBe(kannadaAgent.id);
      const other = await request(app.getHttpServer()).get('/team-lead/registrations').set('Authorization', `Bearer ${token(lead2)}`).expect(200);
      expect(other.body.rows.some((r: { jobSeeker: { id: string } }) => r.jobSeeker.id === seeker.id)).toBe(false);
      await request(app.getHttpServer()).post(`/team-lead/registrations/${seeker.id}/check`).set('Authorization', `Bearer ${token(lead2)}`).send({ verdict: 'ok' }).expect(404);
      await request(app.getHttpServer()).post(`/team-lead/registrations/${seeker.id}/check`).set('Authorization', `Bearer ${token(lead1)}`).send({ verdict: 'ok' }).expect(200);
    });
  });
});
