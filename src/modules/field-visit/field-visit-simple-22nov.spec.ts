import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { FieldVisitClock } from './field-visit-clock';
import { onePerShop, sameShop } from './revisit-shops';

/** 11:30 IST on 22 Nov 2026. */
const START = new Date('2026-11-22T06:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SHOP = { latitude: 12.8901, longitude: 77.5902 };

class FrozenClock {
  at = START;
  now(): Date {
    return this.at;
  }
}

describe('Same shop (22 Nov): one row per shop', () => {
  it('a business is its id; an unregistered shop is the same board name close by', () => {
    const a = { businessId: null, shopName: 'Reddy mess', ...SHOP };
    expect(sameShop(a, { businessId: null, shopName: ' REDDY  Mess ', latitude: SHOP.latitude + 0.001, longitude: SHOP.longitude })).toBe(true);
    expect(sameShop(a, { businessId: null, shopName: 'Reddy mess', latitude: SHOP.latitude + 0.01, longitude: SHOP.longitude })).toBe(false);
    expect(sameShop(a, { businessId: null, shopName: 'Andhra ruchilu', ...SHOP })).toBe(false);
    expect(sameShop({ ...a, businessId: 'b-1' }, { ...a, businessId: 'b-1', shopName: 'x' })).toBe(true);
    expect(sameShop({ ...a, businessId: 'b-1' }, a)).toBe(false);
    expect(onePerShop([a, { ...a, latitude: SHOP.latitude + 0.0005 }, { ...a, shopName: 'Other' }])).toHaveLength(2);
  });
});

/**
 * Laboura Field shop visit simplified (Master Guide rev 207–208, owner's
 * field test 22 Nov): "whom did you speak to" only when not onboarded now;
 * revisits one row per shop; "Close this revisit" with a reason, audited,
 * nothing deleted, seen by the Team Lead.
 */
describe('Field shop visit simplified (22 Nov)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const clock = new FrozenClock();
  const stamp = Date.now();
  const staffIds: string[] = [];
  let photoCounter = 0;
  type Who = { id: string; role: string; code: string };
  const authOf = (s: Who) => ({ Authorization: `Bearer ${jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null })}` });
  const http = () => request(app.getHttpServer());

  async function makeStaff(role: string, teamLeadId?: string) {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `FS-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Simple ${role} ${n}`,
        email: `fs-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Visit-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  function startVisit(who: Who) {
    photoCounter += 1;
    let req = http().post('/field-visits').set(authOf(who));
    const id = randomUUID();
    for (const [k, v] of Object.entries({ id, latitude: SHOP.latitude, longitude: SHOP.longitude, accuracy: 8, source: 'live_camera', takenAt: clock.at.toISOString() })) req = req.field(k, String(v));
    return { id, req: req.attach('photo', Buffer.from(`jpeg-simple-${stamp}-${photoCounter}-${randomUUID()}`), { filename: 'shop.jpg', contentType: 'image/jpeg' }) };
  }

  let lead: Awaited<ReturnType<typeof makeStaff>>;
  let agent: Awaited<ReturnType<typeof makeStaff>>;
  let other: Awaited<ReturnType<typeof makeStaff>>;

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
    other = await makeStaff('field_agent', lead.id);
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    const flags = await prisma.reviewFlag.findMany({ where: { raisedForStaffId: { in: staffIds } }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectId: { in: flags.map((f) => f.id) } }] } });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: staffIds } } });
    await prisma.businessVisit.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { day: { staffId: { in: staffIds } } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('step 2: "whom did you speak to" is required only when the shop is not onboarded now', async () => {
    clock.at = START;
    const later = startVisit(agent);
    await later.req.expect(201);
    const missing = await http().post(`/field-visits/${later.id}/outcome`).set(authOf(agent)).send({ outcome: 'interested_later', shopName: 'Ganesh Stores', revisitOn: '2026-11-24' }).expect(400);
    expect(missing.body.code).toBe('SPOKE_TO_REQUIRED');
    await http().post(`/field-visits/${later.id}/outcome`).set(authOf(agent)).send({ outcome: 'interested_later', shopName: 'Ganesh Stores', spokeTo: 'staff', revisitOn: '2026-11-24' }).expect(201);
    // Onboard now: no spokeTo, no shop phone; the registration step asks the contact person once.
    const onboard = startVisit(agent);
    await onboard.req.expect(201);
    const ok = await http().post(`/field-visits/${onboard.id}/outcome`).set(authOf(agent)).send({ outcome: 'onboard_now', shopName: 'Annapoorna Mess' }).expect(201);
    expect(ok.body).toMatchObject({ spokeTo: null, contactPhone: null, nextStep: 'take_selfie' });
  });

  it('revisits: one row per shop on Visits, Today and the map; close it with a reason (audited, kept, seen by the Team Lead)', async () => {
    clock.at = START;
    const base = { staffId: agent.id, shopName: 'Reddy mess', outcome: 'owner_not_there', spokeTo: 'staff', purpose: 'shop_visit', note: 'currently he does not have the staff requirements' };
    const older = await prisma.businessVisit.create({ data: { ...base, ...SHOP, revisitOn: new Date('2026-11-18T00:00:00.000Z'), visitedAt: new Date(START.getTime() - 5 * DAY) } });
    const newer = await prisma.businessVisit.create({ data: { ...base, latitude: SHOP.latitude + 0.0008, longitude: SHOP.longitude, revisitOn: new Date('2026-11-20T00:00:00.000Z'), visitedAt: new Date(START.getTime() - 3 * DAY) } });

    const visits = await http().get('/field-work/visits').set(authOf(agent)).expect(200);
    const reddy = visits.body.revisitsDue.filter((r: { name: string }) => r.name === 'Reddy mess');
    expect(reddy).toHaveLength(1);
    expect(reddy[0]).toMatchObject({ visitId: newer.id, note: base.note });
    const today = await http().get('/field-work/today').set(authOf(agent)).expect(200);
    expect(today.body.needsYou.filter((n: { kind: string; title: string }) => n.kind === 'revisit_due' && n.title === 'Reddy mess')).toHaveLength(1);
    const map = await http().get(`/field-work/map?lat=${SHOP.latitude}&lng=${SHOP.longitude}`).set(authOf(agent)).expect(200);
    const pins = map.body.shops.filter((s: { name: string }) => s.name === 'Reddy mess');
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ status: 'revisit_due', revisitClosable: true, visitId: newer.id, canAct: true });

    const close = (who: Who, id: string, body: Record<string, unknown>) => http().post(`/field-visits/${id}/close-revisit`).set(authOf(who)).send(body);
    // POST /field-visits/:id/close-revisit: another field agent is refused (404)
    await close(other, newer.id, { reason: 'shop_closed' }).expect(404);
    expect((await close(agent, newer.id, { reason: 'bored' }).expect(400)).body.code).toBe('REVISIT_CLOSE_REASON_REQUIRED');
    expect((await close(agent, newer.id, { reason: 'other', note: ' ' }).expect(400)).body.code).toBe('REVISIT_CLOSE_NOTE_REQUIRED');
    const closed = await close(agent, newer.id, { reason: 'other', note: 'Owner moved to Hosur' }).expect(201);
    expect(closed.body.revisitClosed).toMatchObject({ reason: 'other', note: 'Owner moved to Hosur', visitsClosed: 2 });
    // Both visits of the shop are closed, never deleted.
    const rows = await prisma.businessVisit.findMany({ where: { id: { in: [older.id, newer.id] } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revisitClosedAt && r.revisitClosedReason === 'other' && r.revisitClosedByStaffId === agent.id)).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: agent.id, action: 'field_visit.revisit_closed', entityCode: newer.id } });
    expect(audit).toBeTruthy();
    // It never comes back.
    expect((await http().get('/field-work/visits').set(authOf(agent)).expect(200)).body.revisitsDue.filter((r: { name: string }) => r.name === 'Reddy mess')).toHaveLength(0);
    expect((await http().get('/field-work/today').set(authOf(agent)).expect(200)).body.needsYou.filter((n: { title: string }) => n.title === 'Reddy mess')).toHaveLength(0);
    const after = (await http().get(`/field-work/map?lat=${SHOP.latitude}&lng=${SHOP.longitude}`).set(authOf(agent)).expect(200)).body.shops.filter((s: { name: string }) => s.name === 'Reddy mess');
    expect(after.every((s: { status: string }) => s.status !== 'revisit_due')).toBe(true);
    // Closing again is a harmless repeat; a visit with no revisit cannot be closed.
    await close(agent, newer.id, { reason: 'shop_closed' }).expect(201);
    const plain = await prisma.businessVisit.create({ data: { staffId: agent.id, shopName: 'Plain', outcome: 'not_interested', outcomeReason: 'fee_too_high', ...SHOP } });
    expect((await close(agent, plain.id, { reason: 'shop_closed' }).expect(409)).body.code).toBe('VISIT_NOT_A_REVISIT');
    // The Team Lead sees it in Visit proof.
    const board = await http().get('/team-lead/visits').set(authOf(lead)).expect(200);
    expect(board.body.closedRevisits).toEqual(expect.arrayContaining([expect.objectContaining({ id: newer.id, shop: 'Reddy mess', reason: 'other', note: 'Owner moved to Hosur' })]));
  });
});
