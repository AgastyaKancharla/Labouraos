import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdModule } from '../../common/id/id.module';
import { AuthModule } from '../../common/auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { DataRequestModule } from './data-request.module';
import { DATA_REQUEST_DUE_DAYS, DataRequestClock, dueDateFor, istDateKey } from './data-request.service';

/**
 * C-Privacy's register of data requests (India's data law): access,
 * correction and erasure requests from job seekers, businesses and referral
 * partners. The CEO logs, updates and closes them; nobody else can read or
 * write the register; every write is audited without the free text. The
 * guide gives no deadline, so a request is due 30 days after it arrived.
 */
describe('Data request register', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const now = { value: new Date('2026-11-16T06:30:00.000Z') }; // 16 Nov, 12:00 IST
  const clock = { now: () => now.value };
  const suffix = `${Date.now()}`.slice(-7);
  const staffIds: string[] = [];
  let seekerId = '';
  let businessId = '';
  let referralId = '';
  const seekerCode = `JS-9${suffix}`;
  const businessCode = `BZ-9${suffix}`;
  const referralCode = `RF-9${suffix}`;
  const tokens: Record<string, string> = {};

  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, IdModule, AuthModule, AuditModule, DataRequestModule],
      providers: [RbacGuard],
    })
      .overrideProvider(DataRequestClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    for (const role of ['ceo', 'manager', 'finance', 'team_lead', 'call_agent']) {
      const staff = await prisma.staff.create({
        data: { code: `DR-${role.slice(0, 3).toUpperCase()}-${suffix}`, name: `Data ${role}`, passwordHash: 'hash', role, status: 'active' },
      });
      staffIds.push(staff.id);
      tokens[role] = await jwt.signAsync({ sub: staff.id, role, email: null, code: staff.code });
    }
    seekerId = (await prisma.jobSeeker.create({ data: { code: seekerCode, name: 'Data Seeker', phone: `93${suffix}1`, city: 'Bengaluru', minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' } })).id;
    businessId = (await prisma.business.create({ data: { code: businessCode, name: 'Data Biz', phone: `93${suffix}2`, city: 'Bengaluru' } })).id;
    referralId = (await prisma.referral.create({ data: { code: referralCode, name: 'Data Partner', phone: `93${suffix}3` } })).id;
  });

  afterAll(async () => {
    await prisma.dataRequest.deleteMany({ where: { subjectId: { in: [seekerId, businessId, referralId] } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: seekerId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.referral.deleteMany({ where: { id: referralId } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  beforeEach(() => {
    now.value = new Date('2026-11-16T06:30:00.000Z');
  });

  it('works out the due date as 30 days after the IST day the request arrived', () => {
    expect(DATA_REQUEST_DUE_DAYS).toBe(30);
    expect(dueDateFor('2026-11-16')).toBe('2026-12-16');
    expect(dueDateFor('2026-01-31')).toBe('2026-03-02');
    // 20:00 UTC on 15 Nov is already 16 Nov in India.
    expect(istDateKey(new Date('2026-11-15T20:00:00.000Z'))).toBe('2026-11-16');
  });

  it('the CEO logs an erasure request from a job seeker: received date, who logged it, open, due in 30 days, audited', async () => {
    const res = await request(app.getHttpServer())
      .post('/data-requests')
      .set(as('ceo'))
      .send({ kind: 'erasure', subjectCode: seekerCode.toLowerCase(), receivedOn: '2026-11-10', details: 'Asked on the phone to delete everything' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: expect.stringMatching(/^DR-\d{5,}$/),
      kind: 'erasure',
      subjectType: 'job_seeker',
      subjectCode: seekerCode,
      receivedOn: '2026-11-10',
      dueOn: '2026-12-10',
      daysLeft: 24,
      overdue: false,
      status: 'open',
      loggedBy: { id: staffIds[0], name: 'Data ceo' },
      closedBy: null,
    });
    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { action: 'data_request.logged', entityCode: res.body.code } });
    expect(auditRow.actorId).toBe(staffIds[0]);
    expect(auditRow.after).toMatchObject({ kind: 'erasure', subjectCode: seekerCode, dueOn: '2026-12-10', status: 'open' });
    expect(JSON.stringify(auditRow.after)).not.toContain('delete everything');
  });

  it('takes requests from businesses and referral partners too, received today when no date is given', async () => {
    const biz = await request(app.getHttpServer()).post('/data-requests').set(as('ceo')).send({ kind: 'access', subjectCode: businessCode });
    expect(biz.status).toBe(201);
    expect(biz.body).toMatchObject({ subjectType: 'business', receivedOn: '2026-11-16', dueOn: '2026-12-16' });
    const partner = await request(app.getHttpServer()).post('/data-requests').set(as('ceo')).send({ kind: 'correction', subjectCode: referralCode, details: 'Spelling of the UPI name' });
    expect(partner.status).toBe(201);
    expect(partner.body.subjectType).toBe('referral');
  });

  it('refuses a bad kind, an unknown code, a future date and a phone number in the notes', async () => {
    const post = (body: Record<string, unknown>) => request(app.getHttpServer()).post('/data-requests').set(as('ceo')).send(body);
    expect((await post({ kind: 'delete', subjectCode: seekerCode })).status).toBe(400);
    expect((await post({ kind: 'access', subjectCode: 'JS-0000000099' })).status).toBe(404);
    expect((await post({ kind: 'access', subjectCode: 'Ravi' })).status).toBe(400);
    expect((await post({ kind: 'access', subjectCode: seekerCode, receivedOn: '2026-11-17' })).status).toBe(400);
    expect((await post({ kind: 'access', subjectCode: seekerCode, receivedOn: '2026-02-30' })).status).toBe(400);
    expect((await post({ kind: 'access', subjectCode: seekerCode, details: 'call him on 98450 12345' })).status).toBe(400);
  });

  it('lists open requests first, soonest due first, with overdue ones flagged', async () => {
    const created = await request(app.getHttpServer()).post('/data-requests').set(as('ceo')).send({ kind: 'access', subjectCode: seekerCode, receivedOn: '2026-10-01' });
    expect(created.body).toMatchObject({ dueOn: '2026-10-31', overdue: true, daysLeft: -16 });
    const res = await request(app.getHttpServer()).get('/data-requests').set(as('ceo'));
    expect(res.status).toBe(200);
    expect(res.body.dueDays).toBe(30);
    const mine = (res.body.rows as { code: string; dueOn: string; status: string }[]).filter((r) => r.status !== 'closed');
    const dues = mine.map((r) => r.dueOn);
    expect([...dues].sort()).toEqual(dues);
    expect(res.body.summary.overdue).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.open).toBeGreaterThanOrEqual(4);
  });

  it('the CEO moves a request to in progress, then closes it with the outcome and the closed date; a closed one cannot change', async () => {
    const created = await request(app.getHttpServer()).post('/data-requests').set(as('ceo')).send({ kind: 'correction', subjectCode: seekerCode, receivedOn: '2026-11-14' });
    const id = created.body.id as string;
    const moved = await request(app.getHttpServer()).patch(`/data-requests/${id}`).set(as('ceo')).send({ status: 'in_progress' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('in_progress');
    expect(await prisma.auditLog.count({ where: { action: 'data_request.updated', entityCode: created.body.code } })).toBe(1);

    expect((await request(app.getHttpServer()).post(`/data-requests/${id}/close`).set(as('ceo')).send({ outcome: 'done' })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(`/data-requests/${id}/close`).set(as('ceo')).send({ outcome: 'maybe', outcomeNote: 'x' })).status).toBe(400);

    now.value = new Date('2026-11-18T05:00:00.000Z');
    const closed = await request(app.getHttpServer())
      .post(`/data-requests/${id}/close`)
      .set(as('ceo'))
      .send({ outcome: 'done', outcomeNote: 'Name corrected on the profile' });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ status: 'closed', outcome: 'done', outcomeNote: 'Name corrected on the profile', daysLeft: null, overdue: false, closedBy: { id: staffIds[0] } });
    expect(closed.body.closedAt).toBe('2026-11-18T05:00:00.000Z');
    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { action: 'data_request.closed', entityCode: created.body.code } });
    expect(auditRow.after).toMatchObject({ status: 'closed', outcome: 'done', closedOn: '2026-11-18' });
    expect(JSON.stringify(auditRow.after)).not.toContain('Name corrected');

    expect((await request(app.getHttpServer()).patch(`/data-requests/${id}`).set(as('ceo')).send({ status: 'open' })).status).toBe(400);
    expect((await request(app.getHttpServer()).post(`/data-requests/${id}/close`).set(as('ceo')).send({ outcome: 'done', outcomeNote: 'again' })).status).toBe(400);
    expect((await request(app.getHttpServer()).patch(`/data-requests/${id}`).set(as('ceo')).send({ status: 'closed' })).status).toBe(400);
  });

  it.each(['manager', 'finance', 'team_lead', 'call_agent'])('a %s can neither read nor write the register', async (role) => {
    expect((await request(app.getHttpServer()).get('/data-requests').set(as(role))).status).toBe(403);
    expect((await request(app.getHttpServer()).post('/data-requests').set(as(role)).send({ kind: 'access', subjectCode: seekerCode })).status).toBe(403);
    const any = await prisma.dataRequest.findFirstOrThrow({ where: { subjectId: seekerId } });
    expect((await request(app.getHttpServer()).patch(`/data-requests/${any.id}`).set(as(role)).send({ status: 'in_progress' })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`/data-requests/${any.id}/close`).set(as(role)).send({ outcome: 'done', outcomeNote: 'x' })).status).toBe(403);
  });

  it('an unknown request is a 404', async () => {
    expect((await request(app.getHttpServer()).patch('/data-requests/00000000-0000-4000-8000-000000000000').set(as('ceo')).send({ status: 'in_progress' })).status).toBe(404);
  });
});
