import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { AttendanceClock } from '../attendance/attendance-clock';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { FieldVisitClock } from './field-visit-clock';

/** 11:30 IST on 12 Nov 2026. */
const START = new Date('2026-11-12T06:00:00.000Z');
const MIN = 60 * 1000;
const SHOP = { latitude: 12.9216, longitude: 77.6201 };

class FrozenClock {
  at = START;
  now(): Date {
    return this.at;
  }
}

/**
 * Laboura Field redesign (Master Guide rev 188), the visit side: a result is never
 * overwritten (B3), "Change result" needs a reason and keeps history, never once
 * onboarded; visit details with photos; revisits of a registered business are marked
 * onboarded without a second registration (B9); an interrupted onboarding can resume
 * (B8); a completed verification visit has its result (B19); another agent's visit or
 * business is view-only.
 */
describe('Laboura Field redesign: visit results, change result, details, own-only', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const clock = new FrozenClock();
  const stamp = Date.now();
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  let photoCounter = 0;

  const tokenFor = (s: { id: string; role: string; code: string }) => jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });
  const authOf = (s: { id: string; role: string; code: string }) => ({ Authorization: `Bearer ${tokenFor(s)}` });

  async function makeStaff(role: string, teamLeadId?: string) {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `FR-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Redesign ${role} ${n}`,
        email: `fr-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Visit-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  function photo(): Buffer {
    photoCounter += 1;
    return Buffer.from(`jpeg-redesign-${stamp}-${photoCounter}-${randomUUID()}`);
  }

  function startVisit(who: { id: string; role: string; code: string }, fields: Record<string, string | number>) {
    let req = request(app.getHttpServer()).post('/field-visits').set(authOf(who));
    const withDefaults: Record<string, string | number> = {
      latitude: SHOP.latitude,
      longitude: SHOP.longitude,
      accuracy: 8,
      source: 'live_camera',
      takenAt: clock.at.toISOString(),
      ...fields,
    };
    for (const [k, v] of Object.entries(withDefaults)) req = req.field(k, String(v));
    return req.attach('photo', photo(), { filename: 'shop.jpg', contentType: 'image/jpeg' });
  }

  function selfie(who: { id: string; role: string; code: string }, id: string) {
    return request(app.getHttpServer())
      .post(`/field-visits/${id}/proof`)
      .set(authOf(who))
      .field('latitude', String(SHOP.latitude + 0.00003))
      .field('longitude', String(SHOP.longitude))
      .field('accuracy', '6')
      .field('source', 'live_camera')
      .field('takenAt', clock.at.toISOString())
      .attach('photo', photo(), { filename: 'selfie.jpg', contentType: 'image/jpeg' });
  }

  const outcome = (who: { id: string; role: string; code: string }, id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/field-visits/${id}/outcome`).set(authOf(who)).send(body);
  const changeResult = (who: { id: string; role: string; code: string }, id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/field-visits/${id}/change-result`).set(authOf(who)).send(body);
  const details = (who: { id: string; role: string; code: string }, id: string) =>
    request(app.getHttpServer()).get(`/field-visits/${id}`).set(authOf(who));

  async function makeBusiness(fields: {
    accountAgentId?: string | null; leadCreatedByStaffId?: string | null; verificationStatus?: string; suffix: string; leadChannel?: string;
  }) {
    const business = await prisma.business.create({
      data: {
        code: `BZ-FR${String(stamp).slice(-6)}${fields.suffix}`,
        name: `Redesign Shop ${fields.suffix}`,
        phone: `+9197${String(stamp).slice(-6)}${fields.suffix.padStart(2, '0').slice(-2)}`,
        latitude: SHOP.latitude,
        longitude: SHOP.longitude,
        accountAgentId: fields.accountAgentId ?? null,
        leadCreatedByStaffId: fields.leadCreatedByStaffId ?? null,
        verificationStatus: fields.verificationStatus ?? 'lead',
        leadChannel: fields.leadChannel ?? 'field_visit',
      },
    });
    businessIds.push(business.id);
    return business;
  }

  let lead: Awaited<ReturnType<typeof makeStaff>>;
  let agent: Awaited<ReturnType<typeof makeStaff>>;
  let otherAgent: Awaited<ReturnType<typeof makeStaff>>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FieldVisitClock)
      .useValue(clock)
      .overrideProvider(AttendanceClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    lead = await makeStaff('team_lead');
    agent = await makeStaff('field_agent', lead.id);
    otherAgent = await makeStaff('field_agent', lead.id);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    const flags = await prisma.reviewFlag.findMany({ where: { raisedForStaffId: { in: staffIds } }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectId: { in: flags.map((f) => f.id) } }] } });
    await prisma.reviewFlag.deleteMany({ where: { OR: [{ raisedForStaffId: { in: staffIds } }, { subjectId: { in: businessIds } }] } });
    await prisma.businessVisit.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.visitAssignment.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('never overwrites a result: a second, different result is 409 VISIT_RESULT_ALREADY_SET; the same one again is a harmless repeat', async () => {
    clock.at = START;
    const id = randomUUID();
    await startVisit(agent, { id }).expect(201);
    clock.at = new Date(START.getTime() + 20 * MIN);
    await outcome(agent, id, { outcome: 'owner_not_there', shopName: 'Ganesh Stores', revisitOn: '2026-11-13' }).expect(201);
    const again = await outcome(agent, id, { outcome: 'owner_not_there', shopName: 'Ganesh Stores', revisitOn: '2026-11-13' }).expect(201);
    expect(again.body).toMatchObject({ outcome: 'owner_not_there', revisitOn: '2026-11-13', nextStep: 'done' });
    const stale = await outcome(agent, id, { outcome: 'interested_later', revisitOn: '2026-11-14' }).expect(409);
    expect(stale.body).toMatchObject({ code: 'VISIT_RESULT_ALREADY_SET', currentOutcome: 'owner_not_there' });
    await outcome(agent, id, { outcome: 'onboard_now' }).expect(409);
    expect((await prisma.businessVisit.findUniqueOrThrow({ where: { id } })).outcome).toBe('owner_not_there');
  });

  it('a business form saved from the visit locks it as onboarded (B3): a stale "Come back" and Change result are refused', async () => {
    clock.at = new Date(START.getTime() + 60 * MIN);
    const id = randomUUID();
    await startVisit(agent, { id }).expect(201);
    clock.at = new Date(START.getTime() + 75 * MIN);
    await outcome(agent, id, { outcome: 'onboard_now', shopName: 'Annapurna Mess', spokeTo: 'owner' }).expect(201);
    // Interrupted after the selfie (B8): the visit says where to pick up.
    await selfie(agent, id).expect(201);
    expect((await details(agent, id).expect(200)).body.nextStep).toBe('continue_business_form');
    const phone = `+919${String(stamp).slice(-7)}55`;
    const created = await request(app.getHttpServer())
      .post('/businesses')
      .set(authOf(agent))
      .send({
        name: 'Annapurna Mess', phone, otpRequestId: await verifiedOtpFor(app, phone), contactPersonName: 'Shiva', contactPersonRole: 'owner',
        heardFrom: 'field_visit', businessType: 'restaurant_hotel', locality: 'BTM Layout', latitude: SHOP.latitude, longitude: SHOP.longitude,
        fieldVisitId: id,
      })
      .expect(201);
    businessIds.push(created.body.id);
    const visit = (await details(agent, id).expect(200)).body;
    expect(visit).toMatchObject({ outcome: 'onboarded', nextStep: 'done', canChangeResult: false });
    const stale = await outcome(agent, id, { outcome: 'interested_later', revisitOn: '2026-11-13' }).expect(409);
    expect(stale.body.code).toBe('VISIT_RESULT_ALREADY_SET');
    const locked = await changeResult(agent, id, { outcome: 'interested_later', revisitOn: '2026-11-13', reason: 'Owner wants to think it over' }).expect(409);
    expect(locked.body.code).toBe('VISIT_ONBOARDED_LOCKED');
    expect((await prisma.businessVisit.findUniqueOrThrow({ where: { id } })).outcome).toBe('onboarded');
    // Home counts it once (B3/B24).
    const home = await request(app.getHttpServer()).get('/field-work/home').set(authOf(agent)).expect(200);
    expect(home.body.today.onboarded).toBe(1);
  });

  it('Change result needs a reason, keeps who/when/from/to/why in history, and checks the new result', async () => {
    clock.at = new Date(START.getTime() + 120 * MIN);
    const id = randomUUID();
    await startVisit(agent, { id }).expect(201);
    // No result yet: change-result is not the way in.
    expect((await changeResult(agent, id, { outcome: 'not_interested', outcomeReason: 'fee_too_high', reason: 'Owner said no on the phone' }).expect(409)).body.code)
      .toBe('VISIT_HAS_NO_RESULT');
    clock.at = new Date(START.getTime() + 140 * MIN);
    await outcome(agent, id, { outcome: 'owner_not_there', shopName: 'Vinayaka Bakery', revisitOn: '2026-11-13' }).expect(201);
    // POST /field-visits/:id/change-result: another field agent is refused (404)
    await changeResult(otherAgent, id, { outcome: 'interested_later', revisitOn: '2026-11-14', reason: 'Not mine to change at all' }).expect(404);
    const bad = async (body: Record<string, unknown>, code: string) =>
      expect((await changeResult(agent, id, body).expect(400)).body.code).toBe(code);
    await bad({ outcome: 'interested_later', revisitOn: '2026-11-14', reason: 'short' }, 'CHANGE_REASON_REQUIRED');
    await bad({ outcome: 'onboarded', reason: 'He signed up after all' }, 'OUTCOME_INVALID');
    await bad({ outcome: 'interested_later', reason: 'Owner called me back today' }, 'REVISIT_DATE_REQUIRED');
    await bad({ outcome: 'interested_later', revisitOn: '2026-11-11', reason: 'Owner called me back today' }, 'REVISIT_DATE_PAST');
    await bad({ outcome: 'interested_later', revisitOn: '2026-11-31', reason: 'Owner called me back today' }, 'REVISIT_DATE_REQUIRED');
    await bad({ outcome: 'not_interested', reason: 'Owner called me back today' }, 'NOT_INTERESTED_REASON_REQUIRED');
    await bad({ outcome: 'owner_not_there', revisitOn: '2026-11-13', reason: 'Nothing changed really' }, 'RESULT_UNCHANGED');

    clock.at = new Date(START.getTime() + 200 * MIN);
    const changed = await changeResult(agent, id, {
      outcome: 'interested_later', revisitOn: '2026-11-16', reason: 'Owner called back, wants us on Monday',
    }).expect(201);
    expect(changed.body).toMatchObject({ outcome: 'interested_later', revisitOn: '2026-11-16', canChangeResult: true });
    expect(changed.body.resultHistory).toEqual([
      expect.objectContaining({
        at: clock.at.toISOString(),
        byMe: true,
        byName: agent.name,
        from: { outcome: 'owner_not_there', outcomeReason: null, revisitOn: '2026-11-13' },
        to: { outcome: 'interested_later', outcomeReason: null, revisitOn: '2026-11-16' },
        reason: 'Owner called back, wants us on Monday',
      }),
    ]);
    clock.at = new Date(START.getTime() + 210 * MIN);
    await changeResult(agent, id, { outcome: 'not_interested', outcomeReason: 'other_agency', reason: 'Went with another agency' }).expect(201);
    const rows = await prisma.businessVisitResultChange.findMany({ where: { visitId: id }, orderBy: { changedAt: 'asc' } });
    expect(rows.map((r) => [r.fromOutcome, r.toOutcome, r.changedByStaffId])).toEqual([
      ['owner_not_there', 'interested_later', agent.id],
      ['interested_later', 'not_interested', agent.id],
    ]);
    const visit = await prisma.businessVisit.findUniqueOrThrow({ where: { id } });
    expect(visit).toMatchObject({ outcome: 'not_interested', outcomeReason: 'other_agency', revisitOn: null });
    expect(await prisma.auditLog.count({ where: { action: 'field_visit.result_changed', entityCode: id } })).toBe(2);
  });

  it('visit details: board photo and selfie as short-lived links, time at the shop and the next step', async () => {
    clock.at = new Date(START.getTime() + 300 * MIN);
    const id = randomUUID();
    await startVisit(agent, { id }).expect(201);
    expect((await details(agent, id).expect(200)).body).toMatchObject({ nextStep: 'record_result', selfie: null });
    clock.at = new Date(START.getTime() + 310 * MIN);
    await outcome(agent, id, { outcome: 'onboard_now', shopName: 'Shanthi Sweets' }).expect(201);
    expect((await details(agent, id).expect(200)).body.nextStep).toBe('take_selfie');
    await selfie(agent, id).expect(201);
    const body = (await details(agent, id).expect(200)).body;
    expect(body).toMatchObject({ durationSeconds: 600, nextStep: 'continue_business_form', canChangeResult: false, resultHistory: [] });
    expect(body.boardPhoto.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.boardPhoto.takenAt).toBe(new Date(START.getTime() + 300 * MIN).toISOString());
    expect(body.selfie).toMatchObject({ distanceMeters: expect.any(Number) });
    expect(body.selfie.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("refuses another agent's visit as a revisit (NOT_YOUR_VISIT) and recording a visit at another agent's business (NOT_YOUR_BUSINESS)", async () => {
    clock.at = new Date(START.getTime() + 400 * MIN);
    const theirs = randomUUID();
    await startVisit(otherAgent, { id: theirs }).expect(201);
    clock.at = new Date(START.getTime() + 420 * MIN);
    await outcome(otherAgent, theirs, { outcome: 'interested_later', shopName: 'Their Shop', revisitOn: '2026-11-13' }).expect(201);
    const asRevisit = await startVisit(agent, { id: randomUUID(), revisitOfVisitId: theirs }).expect(403);
    expect(asRevisit.body.code).toBe('NOT_YOUR_VISIT');
    const business = await makeBusiness({ accountAgentId: otherAgent.id, leadCreatedByStaffId: otherAgent.id, suffix: '1' });
    const atTheirs = await startVisit(agent, { id: randomUUID(), businessId: business.id }).expect(403);
    expect(atTheirs.body.code).toBe('NOT_YOUR_BUSINESS');
    // The account agent may.
    await startVisit(otherAgent, { id: randomUUID(), businessId: business.id }).expect(201);
  });

  it('revisit of my registered business + onboard now: no second registration; it was onboarded already, so the result is already_onboarded (B9, rev 189)', async () => {
    clock.at = new Date(START.getTime() + 500 * MIN);
    const business = await makeBusiness({ accountAgentId: agent.id, leadCreatedByStaffId: agent.id, suffix: '2' });
    const id = randomUUID();
    await startVisit(agent, { id, businessId: business.id }).expect(201);
    clock.at = new Date(START.getTime() + 515 * MIN);
    await outcome(agent, id, { outcome: 'onboard_now', spokeTo: 'owner' }).expect(201);
    expect((await outcome(agent, id, { outcome: 'onboarded' }).expect(400)).body.code).toBe('SELFIE_REQUIRED');
    await selfie(agent, id).expect(201);
    expect((await details(agent, id).expect(200)).body).toMatchObject({ nextStep: 'mark_onboarded', businessAlreadyOnboarded: true });
    const done = await outcome(agent, id, { outcome: 'onboarded' }).expect(201);
    expect(done.body).toMatchObject({ outcome: 'already_onboarded', nextStep: 'done', business: { id: business.id } });
    // A repeat of the same tap is harmless; Change result treats it as finished.
    expect((await outcome(agent, id, { outcome: 'onboarded' }).expect(201)).body.outcome).toBe('already_onboarded');
    expect((await changeResult(agent, id, { outcome: 'interested_later', revisitOn: '2026-11-14', reason: 'Owner asked us to come back' }).expect(409)).body.code)
      .toBe('VISIT_ONBOARDED_LOCKED');
    expect((await details(agent, id).expect(200)).body.canChangeResult).toBe(false);
    expect(await prisma.business.count({ where: { name: business.name } })).toBe(1);

    // A plain visit (no business) cannot be marked onboarded without the business form.
    const plain = randomUUID();
    await startVisit(agent, { id: plain }).expect(201);
    expect((await outcome(agent, plain, { outcome: 'onboarded', shopName: 'Nobody' }).expect(400)).body.code).toBe('BUSINESS_NOT_REGISTERED');
  });

  it('rev 189: a business counts as Onboarded once; already_onboarded only for a business onboarded before; never the no-onboarding flag', async () => {
    clock.at = new Date(START.getTime() + 540 * MIN);
    // A lead that came in by phone (never onboarded), held by this agent.
    const business = await makeBusiness({ accountAgentId: agent.id, leadCreatedByStaffId: agent.id, suffix: '4', leadChannel: 'phone' });
    const first = randomUUID();
    await startVisit(agent, { id: first, businessId: business.id }).expect(201);
    clock.at = new Date(START.getTime() + 550 * MIN);
    await outcome(agent, first, { outcome: 'onboard_now' }).expect(201);
    await selfie(agent, first).expect(201);
    expect((await details(agent, first).expect(200)).body.businessAlreadyOnboarded).toBe(false);
    expect((await outcome(agent, first, { outcome: 'already_onboarded' }).expect(400)).body.code).toBe('BUSINESS_NOT_ONBOARDED');
    expect((await outcome(agent, first, { outcome: 'onboarded' }).expect(201)).body.outcome).toBe('onboarded');
    const before = (await request(app.getHttpServer()).get('/field-work/today').set(authOf(agent)).expect(200)).body.numbers.onboarded;

    // Back the same day: recorded as already_onboarded, and Onboarded does not go up.
    clock.at = new Date(START.getTime() + 570 * MIN);
    const second = randomUUID();
    await startVisit(agent, { id: second, businessId: business.id }).expect(201);
    clock.at = new Date(START.getTime() + 580 * MIN);
    await outcome(agent, second, { outcome: 'onboard_now' }).expect(201);
    await selfie(agent, second).expect(201);
    expect((await outcome(agent, second, { outcome: 'already_onboarded' }).expect(201)).body.outcome).toBe('already_onboarded');
    const today = (await request(app.getHttpServer()).get('/field-work/today').set(authOf(agent)).expect(200)).body;
    expect(today.numbers.onboarded).toBe(before);
    const home = (await request(app.getHttpServer()).get('/field-work/home').set(authOf(agent)).expect(200)).body;
    expect(home.today.onboarded).toBe(before);
    const day = (await request(app.getHttpServer()).get('/field-work/day').set(authOf(agent)).expect(200)).body;
    const row = (visitId: string) => day.items.find((i: { id: string }) => i.id === `visit:${visitId}`);
    expect(row(first)).toMatchObject({ status: 'onboarded', countsAsOnboarded: true });
    expect(row(second)).toMatchObject({ status: 'already_onboarded', countsAsOnboarded: false });

    // already_onboarded visits never count towards "visits with no onboarding".
    const fresh = await makeStaff('field_agent', lead.id);
    const policy = await prisma.pricingPolicy.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const own = await makeBusiness({ accountAgentId: fresh.id, leadCreatedByStaffId: fresh.id, suffix: '5' });
    for (let i = 0; i < policy.visitNoOnboardingCount; i += 1) {
      await prisma.businessVisit.create({
        data: {
          staffId: fresh.id, businessId: own.id, latitude: SHOP.latitude, longitude: SHOP.longitude, purpose: 'shop_visit',
          outcome: 'already_onboarded', outcomeRecordedAt: clock.at, visitedAt: new Date(clock.at.getTime() - (i + 1) * MIN),
        },
      });
    }
    const last = randomUUID();
    await startVisit(fresh, { id: last }).expect(201);
    clock.at = new Date(clock.at.getTime() + 20 * MIN);
    await outcome(fresh, last, { outcome: 'not_interested', reason: 'fee_too_high', shopName: 'One More Shop' }).expect(201);
    expect(await prisma.reviewFlag.count({ where: { kind: 'visits_no_onboarding', subjectId: fresh.id } })).toBe(0);
  });

  it('a completed verification visit gets its result (B19)', async () => {
    clock.at = new Date(START.getTime() + 600 * MIN);
    const business = await makeBusiness({ verificationStatus: 'pending_visit', suffix: '3', leadChannel: 'phone' });
    const assignment = await prisma.visitAssignment.create({
      data: { businessId: business.id, purpose: 'verification', assignedStaffId: agent.id, status: 'assigned' },
    });
    const id = randomUUID();
    await startVisit(agent, { id, assignmentId: assignment.id }).expect(201);
    expect((await details(agent, id).expect(200)).body.nextStep).toBe('verify');
    await selfie(agent, id).expect(201);
    const sent = await request(app.getHttpServer())
      .post(`/businesses/${business.id}/visit-assignments/${assignment.id}/owner-otp`)
      .set(authOf(agent))
      .expect(201);
    const code = (app.get(OtpService).getProvider() as MockOtpProvider).getCode(sent.body.requestId);
    const verified = await request(app.getHttpServer())
      .post(`/field-visits/${id}/verify`)
      .set(authOf(agent))
      .send({ ownerOtpRequestId: sent.body.requestId, ownerOtpCode: code })
      .expect(201);
    expect(verified.body).toMatchObject({ outcome: 'onboarded', nextStep: 'done' });
    expect((await prisma.businessVisit.findUniqueOrThrow({ where: { id } })).outcomeRecordedAt).toEqual(clock.at);
    const visits = await request(app.getHttpServer()).get('/field-work/visits').set(authOf(agent)).expect(200);
    expect(visits.body.doneToday.find((v: { id: string }) => v.id === id)).toMatchObject({ needsOutcome: false, nextStep: 'done' });
  });

  async function completeVerificationVisit(who: typeof agent, businessId: string) {
    const assignment = await prisma.visitAssignment.create({
      data: { businessId, purpose: 'verification', assignedStaffId: who.id, status: 'assigned' },
    });
    const id = randomUUID();
    await startVisit(who, { id, assignmentId: assignment.id }).expect(201);
    await selfie(who, id).expect(201);
    const sent = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/visit-assignments/${assignment.id}/owner-otp`)
      .set(authOf(who))
      .expect(201);
    const code = (app.get(OtpService).getProvider() as MockOtpProvider).getCode(sent.body.requestId);
    return request(app.getHttpServer())
      .post(`/field-visits/${id}/verify`)
      .set(authOf(who))
      .send({ ownerOtpRequestId: sent.body.requestId, ownerOtpCode: code })
      .expect(201);
  }

  it('S1 (rev 192): completing a verification visit of a business with no account agent makes the verifying agent its account agent, so the agreement step is his', async () => {
    clock.at = new Date(START.getTime() + 640 * MIN);
    const fresh = await makeStaff('field_agent', lead.id);
    // A phone / app lead: nobody is its account agent and the lead was not created by him.
    const business = await makeBusiness({ verificationStatus: 'pending_visit', suffix: '6', leadChannel: 'phone' });
    const verified = await completeVerificationVisit(fresh, business.id);
    expect(verified.body).toMatchObject({ outcome: 'onboarded', becameAccountAgent: true, isAccountAgent: true });

    const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(after.accountAgentId).toBe(fresh.id);
    expect(after.accountAgentAssignedAt).toBeInstanceOf(Date);
    // Recorded in the account agent's history (audit log), like every other account-agent change.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actorId: fresh.id, action: 'business.account_agent_assigned', entityCode: business.code } });
    expect(audit.before).toMatchObject({ accountAgentId: null });
    expect(audit.after).toMatchObject({ accountAgentId: fresh.id });

    // The assignment is closed, yet the next step (agreement) is his: no 403 NOT_YOUR_BUSINESS.
    expect(await prisma.visitAssignment.count({ where: { businessId: business.id, status: 'assigned' } })).toBe(0);
    const agreement = await request(app.getHttpServer()).get(`/field-work/businesses/${business.id}/agreement`).set(authOf(fresh)).expect(200);
    expect(agreement.body).toMatchObject({ state: 'not_sent', canResend: true });
    const page = await request(app.getHttpServer()).get(`/field-work/businesses/${business.id}/page`).set(authOf(fresh)).expect(200);
    expect(page.body).toMatchObject({ canAct: true, isMine: true, accountAgent: { id: fresh.id, isMe: true } });
    // In My businesses and in Needs you now (agreement waiting).
    const mine = await request(app.getHttpServer()).get('/field-work/businesses').set(authOf(fresh)).expect(200);
    expect(mine.body.results.map((b: { id: string }) => b.id)).toContain(business.id);
    const today = await request(app.getHttpServer()).get('/field-work/today').set(authOf(fresh)).expect(200);
    expect(today.body.needsYou).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'agreement_waiting', target: expect.objectContaining({ id: business.id, step: 'agreement' }) })]),
    );
  });

  it('S1: a verification visit never takes a business from its existing account agent', async () => {
    clock.at = new Date(START.getTime() + 680 * MIN);
    const fresh = await makeStaff('field_agent', lead.id);
    const business = await makeBusiness({ accountAgentId: otherAgent.id, verificationStatus: 'pending_visit', suffix: '7', leadChannel: 'phone' });
    const verified = await completeVerificationVisit(fresh, business.id);
    expect(verified.body).toMatchObject({ becameAccountAgent: false, isAccountAgent: false });
    expect((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).accountAgentId).toBe(otherAgent.id);
    expect(await prisma.auditLog.count({ where: { actorId: fresh.id, action: 'business.account_agent_assigned' } })).toBe(0);
  });
});
