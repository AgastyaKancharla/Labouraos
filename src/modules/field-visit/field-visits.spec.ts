import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { openAvailableDay } from '../../test-support/available-day';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { FieldVisitClock } from './field-visit-clock';

/** 11:30 IST on 11 Nov 2026. */
const START = new Date('2026-11-11T06:00:00.000Z');
const MIN = 60 * 1000;
const SHOP = { latitude: 12.9116, longitude: 77.6101 };
const TODAY = '2026-11-11';

class FrozenClock {
  at = START;
  now(): Date {
    return this.at;
  }
}

describe('Laboura Field shop visits: proof, outcomes, Team Lead checks, Home/Map reads, Idempotency-Key', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const clock = new FrozenClock();
  const stamp = Date.now();
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  const visitIds: string[] = [];
  let photoCounter = 0;

  const tokenFor = (s: { id: string; role: string; code: string }) =>
    jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });

  async function makeStaff(role: string, teamLeadId?: string) {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `FV-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Visit ${role} ${n}`,
        email: `fv-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Visit-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  /** A fresh "photo" each call (different bytes, so a different hash). */
  function photo(): Buffer {
    photoCounter += 1;
    return Buffer.from(`jpeg-bytes-${stamp}-${photoCounter}-${randomUUID()}`);
  }

  function startVisit(
    who: { id: string; role: string; code: string },
    fields: Record<string, string | number>,
    bytes: Buffer = photo(),
    key?: string,
  ) {
    let req = request(app.getHttpServer()).post('/field-visits').set('Authorization', `Bearer ${tokenFor(who)}`);
    if (key) req = req.set('Idempotency-Key', key);
    const withDefaults: Record<string, string | number> = {
      latitude: SHOP.latitude,
      longitude: SHOP.longitude,
      accuracy: 8,
      source: 'live_camera',
      takenAt: clock.at.toISOString(),
      ...fields,
    };
    for (const [k, v] of Object.entries(withDefaults)) req = req.field(k, String(v));
    if (typeof withDefaults.id === 'string') visitIds.push(withDefaults.id);
    return req.attach('photo', bytes, { filename: 'shop.jpg', contentType: 'image/jpeg' });
  }

  let lead: Awaited<ReturnType<typeof makeStaff>>;
  let agent: Awaited<ReturnType<typeof makeStaff>>;
  let otherAgent: Awaited<ReturnType<typeof makeStaff>>;
  let callAgent: Awaited<ReturnType<typeof makeStaff>>;
  let manager: Awaited<ReturnType<typeof makeStaff>>;

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
    callAgent = await makeStaff('call_agent', lead.id);
    manager = await makeStaff('manager');
    await openAvailableDay(app, agent.id).catch(() => undefined);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    const flags = await prisma.reviewFlag.findMany({ where: { raisedForStaffId: { in: staffIds } }, select: { id: true } });
    await prisma.notification.deleteMany({
      where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectId: { in: flags.map((f) => f.id) } }] },
    });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
    await prisma.interview.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.jobSeeker.deleteMany({ where: { code: { startsWith: `JS-FV${String(stamp).slice(-5)}` } } });
    await prisma.businessVisit.deleteMany({ where: { OR: [{ id: { in: visitIds } }, { staffId: { in: staffIds } }] } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.fieldCheckIn.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('refuses visits and the field reads without a login, and to anyone but a field agent', async () => {
    await request(app.getHttpServer()).post('/field-visits').expect(401);
    await request(app.getHttpServer()).get('/field-work/home').expect(401);
    for (const who of [callAgent, manager, lead]) {
      await startVisit(who, { id: randomUUID() }).expect(403);
      await request(app.getHttpServer()).get('/field-work/home').set('Authorization', `Bearer ${tokenFor(who)}`).expect(403);
      await request(app.getHttpServer()).get('/field-work/visits').set('Authorization', `Bearer ${tokenFor(who)}`).expect(403);
      await request(app.getHttpServer())
        .get(`/field-work/map?lat=${SHOP.latitude}&lng=${SHOP.longitude}`)
        .set('Authorization', `Bearer ${tokenFor(who)}`)
        .expect(403);
    }
  });

  it('starts a visit outside with GPS and a live name-board photo; a repeated Idempotency-Key saves nothing twice', async () => {
    const id = randomUUID();
    const bytes = photo();
    const key = `q-${stamp}-first`;
    const first = await startVisit(agent, { id }, bytes, key).expect(201);
    expect(first.body).toMatchObject({ id, hasBoardPhoto: true, hasSelfie: false, outcome: null, purpose: 'shop_visit' });
    const again = await startVisit(agent, { id }, bytes, key).expect(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body).toEqual(first.body);
    // A different key for the same visit id is still the same visit (the phone made the id).
    await startVisit(agent, { id }, bytes, `q-${stamp}-other`).expect(201);
    expect(await prisma.businessVisit.count({ where: { id } })).toBe(1);
    expect(await prisma.idempotencyRecord.count({ where: { staffId: agent.id, key } })).toBe(1);
    // The same key on a different request is refused.
    await request(app.getHttpServer())
      .post(`/field-visits/${id}/outcome`)
      .set('Authorization', `Bearer ${tokenFor(agent)}`)
      .set('Idempotency-Key', key)
      .send({ outcome: 'not_interested', reason: 'fee_too_high', shopName: 'Mismatch' })
      .expect(422);
    // Another agent cannot reuse the id.
    await startVisit(otherAgent, { id }).expect(409);
  });

  it('accepts only the app camera and needs GPS', async () => {
    await startVisit(agent, { id: randomUUID(), source: 'gallery' }).expect(400);
    await startVisit(agent, { id: randomUUID(), latitude: '' }).expect(400);
  });

  it('rejects a photo already used before and tells the Team Lead', async () => {
    const bytes = photo();
    await startVisit(agent, { id: randomUUID() }, bytes).expect(201);
    const res = await startVisit(agent, { id: randomUUID() }, bytes).expect(409);
    expect(res.body.message).toMatch(/already used/);
    const flag = await prisma.reviewFlag.findFirst({ where: { kind: 'visit_photo_reused', raisedForStaffId: agent.id } });
    expect(flag).not.toBeNull();
    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: lead.id, subjectId: flag!.id, clearedAt: null } });
    expect(bell).not.toBeNull();
  });

  it('every visit gets an outcome; "owner not there" comes back on Home, Visits and the Map on its date; very short visits are flagged', async () => {
    const id = randomUUID();
    await startVisit(agent, { id }).expect(201);
    const auth = { Authorization: `Bearer ${tokenFor(agent)}` };
    await request(app.getHttpServer()).post(`/field-visits/${id}/outcome`).set(auth).send({ outcome: 'not_interested', shopName: 'Lakshmi Tiffins' }).expect(400);
    await request(app.getHttpServer()).post(`/field-visits/${id}/outcome`).set(auth).send({ outcome: 'owner_not_there', shopName: 'Lakshmi Tiffins' }).expect(400);
    await request(app.getHttpServer()).post(`/field-visits/${id}/outcome`).set(auth).send({ outcome: 'owner_not_there', revisitOn: TODAY }).expect(400);
    clock.at = new Date(START.getTime() + 1 * MIN);
    const saved = await request(app.getHttpServer())
      .post(`/field-visits/${id}/outcome`)
      .set(auth)
      .send({ outcome: 'owner_not_there', shopName: 'Lakshmi Tiffins', spokeTo: 'staff', contactPhone: '9900054321', revisitOn: TODAY, note: 'after Deepavali' })
      .expect(201);
    expect(saved.body).toMatchObject({ outcome: 'owner_not_there', revisitOn: TODAY, durationSeconds: 60 });
    expect(saved.body.contactPhone).toBe('******4321');
    expect(await prisma.reviewFlag.findFirst({ where: { kind: 'visit_short', subjectId: id } })).not.toBeNull();

    const home = await request(app.getHttpServer()).get('/field-work/home').set(auth).expect(200);
    expect(home.body.todos).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'revisit', visitId: id, when: 'today', name: 'Lakshmi Tiffins' })]));
    expect(home.body.today.shopsVisited).toBeGreaterThanOrEqual(3);
    const visits = await request(app.getHttpServer()).get('/field-work/visits').set(auth).expect(200);
    expect(visits.body.revisitsDue.map((r: { visitId: string }) => r.visitId)).toContain(id);
    expect(visits.body.doneToday.find((v: { id: string }) => v.id === id)).toMatchObject({ outcome: 'owner_not_there', hasBoardPhoto: true });
    const map = await request(app.getHttpServer()).get(`/field-work/map?lat=${SHOP.latitude}&lng=${SHOP.longitude + 0.003}`).set(auth).expect(200);
    const shop = map.body.shops.find((s: { visitId: string }) => s.visitId === id);
    expect(shop).toMatchObject({ kind: 'prospect', status: 'revisit_due', name: 'Lakshmi Tiffins' });
    expect(map.body.revisitsDue.map((s: { visitId: string }) => s.visitId)).toContain(id);

    // Coming back: the new visit continues the chain, so the old one is no longer "due".
    clock.at = new Date(START.getTime() + 3 * MIN);
    const back = randomUUID();
    await startVisit(agent, { id: back, revisitOfVisitId: id }).expect(201);
    const after = await request(app.getHttpServer()).get('/field-work/visits').set(auth).expect(200);
    expect(after.body.revisitsDue.map((r: { visitId: string }) => r.visitId)).not.toContain(id);
    expect((await prisma.businessVisit.findUnique({ where: { id: back } }))?.shopName).toBe('Lakshmi Tiffins');
  });

  it('flags two shops too far apart for the time between them, and GPS with no accuracy', async () => {
    clock.at = new Date(START.getTime() + 10 * MIN);
    const far = randomUUID();
    await startVisit(agent, { id: far, latitude: 13.1, longitude: 77.6101, takenAt: clock.at.toISOString() }).expect(201);
    expect(await prisma.reviewFlag.findFirst({ where: { kind: 'visits_too_far_apart', subjectId: far } })).not.toBeNull();
    clock.at = new Date(START.getTime() + 11 * MIN);
    const noAccuracy = randomUUID();
    await startVisit(agent, { id: noAccuracy, latitude: 13.1, longitude: 77.6101, accuracy: '', takenAt: clock.at.toISOString() }).expect(201);
    expect((await prisma.businessVisit.findUnique({ where: { id: noAccuracy } }))?.gpsSuspect).toBe(true);
    expect(await prisma.reviewFlag.findFirst({ where: { kind: 'visit_gps_suspect', subjectId: noAccuracy } })).not.toBeNull();
  });

  it('onboard now: selfie at the same spot opens registration, and the business is registered from the visit', async () => {
    clock.at = new Date(START.getTime() + 60 * MIN);
    const auth = { Authorization: `Bearer ${tokenFor(agent)}` };
    const id = randomUUID();
    await startVisit(agent, { id, takenAt: clock.at.toISOString() }).expect(201);
    clock.at = new Date(START.getTime() + 74 * MIN);
    const talk = await request(app.getHttpServer())
      .post(`/field-visits/${id}/outcome`)
      .set(auth)
      .send({ outcome: 'onboard_now', shopName: 'Sri Krishna Hotel', spokeTo: 'owner' })
      .expect(201);
    expect(talk.body).toMatchObject({ outcome: null, durationSeconds: 14 * 60 });

    const phone = `+919${String(stamp).slice(-7)}77`;
    const otpRequestId = await verifiedOtpFor(app, phone);
    const body = {
      name: 'Sri Krishna Hotel',
      phone,
      otpRequestId,
      contactPersonName: 'Shankar Rao',
      contactPersonRole: 'owner',
      businessType: 'restaurant_hotel',
      latitude: SHOP.latitude,
      longitude: SHOP.longitude,
      fieldVisitId: id,
    };
    // Registration stays closed until the proof selfie.
    await request(app.getHttpServer()).post('/businesses').set(auth).send(body).expect(400);

    const selfie = (lat: number) =>
      request(app.getHttpServer())
        .post(`/field-visits/${id}/proof`)
        .set(auth)
        .field('latitude', String(lat))
        .field('longitude', String(SHOP.longitude))
        .field('accuracy', '6')
        .field('source', 'live_camera')
        .field('takenAt', clock.at.toISOString())
        .attach('photo', photo(), { filename: 'selfie.jpg', contentType: 'image/jpeg' });
    await selfie(SHOP.latitude + 0.02).expect(400);
    const proof = await selfie(SHOP.latitude + 0.00005).expect(201);
    expect(proof.body).toMatchObject({ hasSelfie: true });
    expect(proof.body.proofDistanceMeters).toBeLessThan(10);

    const created = await request(app.getHttpServer()).post('/businesses').set(auth).send(body).expect(201);
    businessIds.push(created.body.id);
    const visit = await prisma.businessVisit.findUniqueOrThrow({ where: { id } });
    expect(visit).toMatchObject({ businessId: created.body.id, outcome: 'onboarded' });
    expect(await prisma.businessVisit.count({ where: { businessId: created.body.id } })).toBe(1);
    const business = await prisma.business.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(business).toMatchObject({ storefrontPhotoLive: true, storefrontPhotoHash: visit.boardPhotoHash, accountAgentId: agent.id });
    // A second registration from the same visit is refused.
    const secondPhone = `+919${String(stamp).slice(-7)}78`;
    const secondOtp = await verifiedOtpFor(app, secondPhone);
    await request(app.getHttpServer()).post('/businesses').set(auth).send({ ...body, phone: secondPhone, otpRequestId: secondOtp }).expect(409);

    const home = await request(app.getHttpServer()).get('/field-work/home').set(auth).expect(200);
    expect(home.body.today.onboarded).toBe(1);

    // FA08: full details for the account agent (number masked), not for another agent.
    const mine = await request(app.getHttpServer()).get(`/field-work/businesses/${created.body.code}`).set(auth).expect(200);
    expect(mine.body).toMatchObject({ isMine: true, name: 'Sri Krishna Hotel' });
    expect(mine.body.contact.phone).toMatch(/^\*{6}\d{4}$/);
    expect(mine.body.visits[0]).toMatchObject({ outcome: 'onboarded', hasBoardPhoto: true, hasSelfie: true, durationSeconds: 14 * 60 });
    const theirs = await request(app.getHttpServer())
      .get(`/field-work/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(otherAgent)}`)
      .expect(200);
    expect(theirs.body).toMatchObject({ isMine: false, contact: null, branches: [] });
    const map = await request(app.getHttpServer()).get(`/field-work/map?lat=${SHOP.latitude}&lng=${SHOP.longitude}`).set(auth).expect(200);
    expect(map.body.shops.find((s: { businessId: string }) => s.businessId === created.body.id)).toMatchObject({ kind: 'business', isMine: true });
  });

  it('interview day: the attending field agent marks "candidate arrived" with GPS at the shop', async () => {
    const businessId = businessIds[0];
    const vacancy = await prisma.vacancy.create({
      data: { code: `VC-FV${stamp}`, businessId, tradeSkill: 'Cook' },
    });
    const slot = await prisma.vacancyInterviewSlot.create({
      data: { vacancyId: vacancy.id, startsAt: new Date(START.getTime() + 2 * 60 * MIN), endsAt: new Date(START.getTime() + 3 * 60 * MIN) },
    });
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-FV${String(stamp).slice(-5)}1`,
        name: 'Ramesh Gowda',
        phone: `+918${String(stamp).slice(-7)}11`,
        minSalary: 1500000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
      },
    });
    const interview = await prisma.interview.create({
      data: {
        code: `IV-FV${stamp}`,
        vacancyId: vacancy.id,
        businessId,
        jobSeekerId: seeker.id,
        vacancyInterviewSlotId: slot.id,
        slotStartsAt: slot.startsAt,
        slotEndsAt: slot.endsAt,
        proposedByStaffId: agent.id,
        suitabilitySnapshot: {},
        status: 'confirmed',
        offerSentAt: START,
        replyDueAt: START,
        resultDueAt: slot.endsAt,
      },
    });
    const path = `/field-visits/interviews/${interview.id}/arrived`;
    await request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(otherAgent)}`).send(SHOP).expect(403);
    await request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(agent)}`).send({ latitude: 12.95, longitude: SHOP.longitude, accuracy: 5 }).expect(400);
    const res = await request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${tokenFor(agent)}`).send({ ...SHOP, accuracy: 5 }).expect(201);
    expect(res.body.candidateArrivedAt).toBe(clock.at.toISOString());
    expect((await prisma.interview.findUniqueOrThrow({ where: { id: interview.id } })).candidateArrivedByStaffId).toBe(agent.id);
  });
});
