import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.setTimeout(180000);

const DAY = 24 * 3600 * 1000;
const codes = (body: { rows?: Array<{ code?: string }> }) => (body.rows ?? []).map((r) => r.code);

/**
 * Fixes after the independent check of PR #162: the vacancy list's "Owner slow
 * to record results" is scoped; "Not assigned" interviews and placements are
 * NULL-safe; app sign-ups given to an agent are owned; a vacancy captured by
 * another team is not "Not assigned"; cities compare trimmed and
 * case-insensitive; Close to a refund follows the assigned agent; an assign
 * that lost a race is 409; a photo view is audited once per 30 minutes; a
 * Manager is never a business's account agent.
 */
describe('Team Lead / Manager records: review fixes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const ts = Date.now();
  const tail = String(ts).slice(-6);
  const staffIds: string[] = [];
  const people: Record<string, { id: string; token: string }> = {};
  const rec: Record<string, string> = {};
  const seekers: string[] = [];
  const businesses: string[] = [];
  const referrals: string[] = [];
  const trackers: string[] = [];
  let n = 0;

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: { code: `TLV-${key}-${ts}`, name: `TlRev ${key}`, email: `tlrev_${key}_${ts}@laboura.local`, role, passwordHash: 'hash', status: 'active', ...extra },
    });
    staffIds.push(staff.id);
    const session = await prisma.staffSession.create({
      data: { staffId: staff.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000), absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), lastActivityAt: new Date() },
    });
    const payload: JwtPayload = { sub: staff.id, role, email: staff.email, code: staff.code, teamLeadId: staff.teamLeadId, sid: session.id };
    people[key] = { id: staff.id, token: jwt.sign(payload, { expiresIn: '15m' }) };
    return staff;
  }
  const get = (who: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${people[who].token}`);
  const post = (who: string, path: string, body: Record<string, unknown>) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${people[who].token}`).send(body);
  const phone = () => `+917${tail}${String(++n).padStart(3, '0')}`.slice(0, 13);

  async function seeker(key: string, owner: string | null, extra: Record<string, unknown> = {}) {
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-TLV-${tail}-${key}`, name: `TlRev Seeker ${key}`, phone: phone(), status: 'lead', city: 'Bengaluru', phoneVerified: true,
        minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', registeredByStaffId: owner, ...extra,
      },
    });
    seekers.push(row.id);
    return row.id;
  }
  async function business(key: string, owner: string | null, extra: Record<string, unknown> = {}) {
    const row = await prisma.business.create({ data: { code: `BZ-TLV-${tail}-${key}`, name: `TlRev Shop ${key}`, phone: phone(), ownerName: 'Owner', accountAgentId: owner, verificationStatus: 'verified', ...extra } });
    businesses.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const ceo = await mk('ceo', 'ceo');
    const mgr = await mk('mgr', 'manager', { reportsToId: ceo.id });
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id, city: 'Mysuru' });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgr.id, city: 'Bengaluru' });
    const tlB = await mk('tlB', 'team_lead', { reportsToId: mgrB.id, city: 'Mysuru' });
    await mk('caA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('faA', 'field_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('caB', 'call_agent', { teamLeadId: tlB.id, reportsToId: tlB.id, city: 'Mysuru' });

    // Another team's business (Bengaluru) whose owner is slow to record a result.
    rec.bB = await business('B', people.caB.id);
    rec.sB = await seeker('B', people.caB.id);
    const vB = await prisma.vacancy.create({ data: { code: `VC-TLV-${tail}-B`, businessId: rec.bB, tradeSkill: 'Cook', status: 'open', capturedByStaffId: people.caB.id } });
    const slot = await prisma.vacancyInterviewSlot.create({ data: { vacancyId: vB.id, startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() - 3 * DAY + 3600000) } });
    await prisma.interview.create({
      data: {
        code: `INT-TLV-${tail}-B`, vacancyId: vB.id, businessId: rec.bB, jobSeekerId: rec.sB, vacancyInterviewSlotId: slot.id, slotStartsAt: slot.startsAt, slotEndsAt: slot.endsAt,
        proposedByStaffId: people.caB.id, proposedAt: new Date(Date.now() - 4 * DAY), suitabilitySnapshot: {}, status: 'confirmed',
        offerSentAt: new Date(Date.now() - 4 * DAY), replyDueAt: new Date(Date.now() - 3 * DAY), resultDueAt: new Date(Date.now() - DAY),
      },
    });
    // An unowned business and an unowned job seeker with a placement: "Not assigned" placements.
    rec.bNone = await business('N', null);
    rec.sNone = await seeker('N', null);
    const vN = await prisma.vacancy.create({ data: { code: `VC-TLV-${tail}-N`, businessId: rec.bNone, tradeSkill: 'Cook', status: 'open' } });
    rec.pNone = (await prisma.placement.create({ data: { code: `PL-TLV-${tail}-N`, vacancyId: vN.id, jobSeekerId: rec.sNone, businessId: rec.bNone, placementFee: 900000, gstAmount: 162000, status: 'awaiting_payment' } })).id;
    // A vacancy another team captured on an unowned business.
    await prisma.vacancy.create({ data: { code: `VC-TLV-${tail}-X`, businessId: rec.bNone, tradeSkill: 'Driver', status: 'open', capturedByStaffId: people.caB.id } });
    // App sign-ups (no registering agent): one given to the team's agent, one to another team's.
    rec.sAppA = await seeker('APA', null);
    rec.sAppB = await seeker('APB', null);
    for (const [subjectId, staffId] of [[rec.sAppA, people.caA.id], [rec.sAppB, people.caB.id]]) {
      trackers.push((await prisma.signupTracker.create({ data: { profileKind: 'job_seeker', subjectType: 'job_seeker', subjectId, assignedStaffId: staffId, assignedAt: new Date() } })).id);
    }
    // City spelled differently.
    rec.sCity = await seeker('CITY', null, { city: '  bengaluru ' });
    // Registered by the other team, assigned to this team's agent, close to a refund.
    rec.sNear = await seeker('NEAR', people.caB.id, { status: 'active', assignedStaffId: people.caA.id, assignedAt: new Date(), paymentReceivedAt: new Date(Date.now() - 27 * DAY) });
    rec.sRace = await seeker('RACE', null, { photoStoragePath: `selfies/${tail}/race.jpg` });
    rec.bTeam = await business('T', people.faA.id);
  });

  afterAll(async () => {
    await prisma.interview.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.placement.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.vacancyInterviewSlot.deleteMany({ where: { vacancy: { businessId: { in: businesses } } } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.business.deleteMany({ where: { id: { in: businesses } } });
    await prisma.signupTracker.deleteMany({ where: { id: { in: trackers } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekers } } });
    await prisma.referral.deleteMany({ where: { id: { in: referrals } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it("never shows another team's business as \"Owner slow to record results\" (CEO still sees it)", async () => {
    // Shop B belongs to Team Lead B's team: Team Lead A (and Manager A) must never see its name.
    for (const [who, path] of [['tlA', '/team-lead/vacancies?section=team'], ['tlA', '/team-lead/vacancies?section=unassigned'], ['mgr', '/manager/vacancies?section=team'], ['mgr', '/manager/vacancies?section=unassigned']]) {
      const res = await get(who, path).expect(200);
      expect([who, path, res.body.whyOpen.slowOwners]).toEqual([who, path, expect.not.arrayContaining([`TlRev Shop B`])]);
    }
    expect((await get('tlB', '/team-lead/vacancies?section=team').expect(200)).body.whyOpen.slowOwners).toContain('TlRev Shop B');
    expect((await get('mgrB', '/manager/vacancies?section=team').expect(200)).body.whyOpen.slowOwners).toContain('TlRev Shop B');
    const ceo = await get('ceo', '/ceo/vacancies?status=all&pageSize=5').expect(200);
    expect(ceo.body.whyOpen.slowOwnerCount).toBeGreaterThanOrEqual(1);
  });

  it('lists unowned placements under Not assigned (NULL-safe), for the Team Lead and the Manager', async () => {
    expect(codes((await get('tlA', '/team-lead/placements?section=unassigned&pageSize=100').expect(200)).body)).toContain(`PL-TLV-${tail}-N`);
    expect(codes((await get('tlA', '/team-lead/placements?section=team&pageSize=100').expect(200)).body)).not.toContain(`PL-TLV-${tail}-N`);
    expect(codes((await get('mgr', '/manager/placements?section=unassigned&pageSize=100').expect(200)).body)).toContain(`PL-TLV-${tail}-N`);
    expect((await get('tlA', `/team-lead/placements/${rec.pNone}`)).status).toBe(200);
  });

  it("leaves a vacancy captured by another team out of Not assigned", async () => {
    const open = codes((await get('tlA', '/team-lead/vacancies?section=unassigned&pageSize=100').expect(200)).body);
    expect(open).toContain(`VC-TLV-${tail}-N`);
    expect(open).not.toContain(`VC-TLV-${tail}-X`);
  });

  it('counts an app sign-up given to an agent as that team\'s, never as Not assigned', async () => {
    const team = codes((await get('tlA', '/team-lead/job-seekers?section=team&pageSize=100').expect(200)).body);
    const open = codes((await get('tlA', '/team-lead/job-seekers?section=unassigned&pageSize=100').expect(200)).body);
    expect(team).toContain(`JS-TLV-${tail}-APA`);
    expect(open).not.toContain(`JS-TLV-${tail}-APA`);
    expect(open).not.toContain(`JS-TLV-${tail}-APB`);
    expect(team).not.toContain(`JS-TLV-${tail}-APB`);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sAppB, toStaffId: people.caA.id })).status).toBe(403);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sAppA, toStaffId: people.faA.id })).status).toBe(200);
  });

  it('matches cities trimmed and case-insensitive', async () => {
    expect(codes((await get('tlA', '/team-lead/job-seekers?section=unassigned&pageSize=100').expect(200)).body)).toContain(`JS-TLV-${tail}-CITY`);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sCity, toStaffId: people.caA.id })).status).toBe(200);
  });

  it('puts a close-to-refund job seeker with the agent he was assigned to', async () => {
    const res = await get('tlA', '/team-lead/close-to-refund').expect(200);
    const row = res.body.rows.find((r: { id: string }) => r.id === rec.sNear);
    expect(row?.agent?.id).toBe(people.caA.id);
    expect((await get('tlB', '/team-lead/close-to-refund').expect(200)).body.rows.map((r: { id: string }) => r.id)).not.toContain(rec.sNear);
  });

  it('refuses an assign that lost a race with 409 "Already assigned to <name>"', async () => {
    // Someone else takes it between the read and the write.
    const original = prisma.signupTracker.findFirst.bind(prisma.signupTracker);
    const spy = jest.spyOn(prisma.signupTracker, 'findFirst').mockImplementationOnce((async (args: unknown) => {
      await prisma.jobSeeker.update({ where: { id: rec.sRace }, data: { assignedStaffId: people.faA.id } });
      return original(args as never);
    }) as never);
    const res = await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sRace, toStaffId: people.caA.id });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Already assigned to TlRev faA');
    expect((await prisma.jobSeeker.findUnique({ where: { id: rec.sRace }, select: { assignedStaffId: true } }))?.assignedStaffId).toBe(people.faA.id);
  });

  it('audits a photo view once per viewer and record in 30 minutes', async () => {
    for (let i = 0; i < 3; i++) expect((await get('tlA', `/team-lead/job-seekers/${rec.sRace}/selfie`)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorId: people.tlA.id, action: 'record.selfie_viewed', entityCode: `JS-TLV-${tail}-RACE` } })).toBe(1);
    await get('mgr', `/manager/job-seekers/${rec.sRace}/selfie`).expect(200);
    expect(await prisma.auditLog.count({ where: { actorId: people.mgr.id, action: 'record.selfie_viewed', entityCode: `JS-TLV-${tail}-RACE` } })).toBe(1);
  });

  it('never makes a Manager (or a call agent) a business\'s account agent', async () => {
    expect((await post('mgr', '/manager/assign', { kind: 'business', id: rec.bTeam, toStaffId: people.mgr.id })).status).toBe(400);
    expect((await post('mgr', '/manager/assign', { kind: 'business', id: rec.bTeam, toStaffId: people.caA.id })).status).toBe(400);
    const pick = await get('mgr', '/manager/assignees').expect(200);
    expect(pick.body.rows.find((r: { id: string }) => r.id === people.mgr.id).canHoldBusiness).toBe(false);
    expect((await post('mgr', '/manager/assign', { kind: 'business', id: rec.bTeam, toStaffId: people.tlA.id })).status).toBe(200);
  });

  it('links a call agent\'s partner bell to the partner', async () => {
    const partner = await prisma.referral.create({ data: { code: `RF-TLV-${tail}-N`, name: 'TlRev Partner', phone: phone(), city: 'Bengaluru' } });
    referrals.push(partner.id);
    expect((await post('tlA', '/team-lead/assign', { kind: 'referral', id: partner.id, toStaffId: people.caA.id })).status).toBe(200);
    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: people.caA.id, kind: 'referral_assigned' } });
    expect(bell?.link).toBe(`/call-agent/people/${partner.id}`);
  });
});
