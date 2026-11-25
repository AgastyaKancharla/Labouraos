import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.setTimeout(180000);

/**
 * "Where they're stuck" on every profile (Master Guide rev 204, 21 Nov): the
 * account owner, the step and the matching buttons, in the call agent, Team
 * Lead, Manager and CEO views, within each role's normal record scope; the
 * Team Lead's ID check shows as waiting with no resend; the buttons are the
 * existing routes, which seniors can use for records in their scope.
 */
describe("GET /profile-stuck — where they're stuck", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const ts = Date.now();
  const tail = String(ts).slice(-6);
  const staffIds: string[] = [];
  const people: Record<string, { id: string; token: string; code: string }> = {};
  const rec: Record<string, string> = {};
  const seekers: string[] = [];
  const businesses: string[] = [];
  const referrals: string[] = [];

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: { code: `PS-${key}-${ts}`, name: `Stuck ${key}`, email: `stuck_${key}_${ts}@laboura.local`, role, passwordHash: 'hash', status: 'active', ...extra },
    });
    staffIds.push(staff.id);
    const session = await prisma.staffSession.create({
      data: { staffId: staff.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000), absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), lastActivityAt: new Date() },
    });
    const payload: JwtPayload = { sub: staff.id, role, email: staff.email, code: staff.code, teamLeadId: staff.teamLeadId, sid: session.id };
    people[key] = { id: staff.id, token: jwt.sign(payload, { expiresIn: '15m' }), code: staff.code };
    return staff;
  }
  const get = (who: string, kind: string, id: string) =>
    request(app.getHttpServer()).get('/profile-stuck').query({ kind, id }).set('Authorization', `Bearer ${people[who].token}`);
  const post = (who: string, path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${people[who].token}`).send(body);
  const phone = (n: number) => `+917${tail}${String(n).padStart(3, '0')}`.slice(0, 13);

  async function seeker(key: string, n: number, owner: string | null, extra: Record<string, unknown> = {}) {
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-PS-${tail}-${key}`, name: `Stuck Seeker ${key}`, phone: phone(n), status: 'lead', city: 'Bengaluru', phoneVerified: true,
        minSalary: 1500000, maxSalary: 2000000, guaranteeFloorPaise: 1500000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
        registeredByStaffId: owner, ...extra,
      },
    });
    seekers.push(row.id);
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
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgr.id, city: 'Bengaluru' });
    const tlB = await mk('tlB', 'team_lead', { reportsToId: mgrB.id, city: 'Bengaluru' });
    await mk('caA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('faA', 'field_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('caB', 'call_agent', { teamLeadId: tlB.id, reportsToId: tlB.id });
    await mk('fin', 'finance');

    // Job seekers at each step.
    rec.sNew = await seeker('new', 1, people.caA.id);
    rec.sIdWait = await seeker('idw', 2, people.caA.id, { photoStoragePath: `selfies/${tail}/w.jpg`, photoTakenAt: new Date() });
    for (const purpose of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates']) {
      await prisma.consent.create({ data: { subjectType: 'job_seeker', subjectId: rec.sIdWait, purpose, granted: true, grantedAt: new Date(), noticeVersion: '1.2', language: 'en', method: 'sms_link' } });
    }
    await prisma.identityVerification.create({ data: { jobSeekerId: rec.sIdWait, method: 'other_id', vendor: 'team_lead_check', status: 'pending' } });
    rec.sB = await seeker('b', 3, people.caB.id);
    // A business with no agreement yet, one waiting for the Team Lead's approval.
    rec.bLead = (await prisma.business.create({ data: { code: `BZ-PS-${tail}-L`, name: 'Stuck Shop L', phone: phone(5), ownerName: 'Owner', accountAgentId: people.faA.id, verificationStatus: 'lead' } })).id;
    businesses.push(rec.bLead);
    // A partner who has not accepted the terms yet.
    rec.rNew = (await prisma.referral.create({ data: { code: `RF-PS-${tail}-N`, name: 'Stuck Partner', phone: phone(6), registeredByStaffId: people.caA.id } })).id;
    referrals.push(rec.rNew);
  });

  afterAll(async () => {
    const subjects = [...seekers, ...businesses, ...referrals];
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: subjects } } }).catch(() => undefined);
    await prisma.consent.deleteMany({ where: { subjectId: { in: subjects } } }).catch(() => undefined);
    await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: seekers } } }).catch(() => undefined);
    await prisma.messageLog?.deleteMany?.({ where: { subjectId: { in: subjects } } }).catch(() => undefined);
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekers } } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: { in: businesses } } }).catch(() => undefined);
    await prisma.referral.deleteMany({ where: { id: { in: referrals } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } }).catch(() => undefined);
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } }).catch(() => undefined);
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => undefined);
    await app.close();
  });

  it('shows the account owner and the step in every view; only the call agent gets the button (rev 211)', async () => {
    for (const who of ['caA', 'tlA', 'mgr', 'ceo']) {
      const res = await get(who, 'job_seeker', rec.sNew).expect(200);
      expect([who, res.body]).toEqual([who, expect.objectContaining({
        kind: 'job_seeker', code: `JS-PS-${tail}-new`, owner: { name: 'Stuck caA', code: people.caA.code }, step: 'consent', waitingForTeamLead: false,
        // Team Leads, Managers and the CEO keep the view of where he is stuck, with no send buttons.
        actions: who === 'caA' ? ['registration_link'] : [],
      })]);
    }
    // By code too.
    expect((await get('ceo', 'job_seeker', `JS-PS-${tail}-new`).expect(200)).body.id).toBe(rec.sNew);
    expect((await get('tlA', 'business', rec.bLead).expect(200)).body).toMatchObject({ step: 'agreement', owner: { name: 'Stuck faA', code: people.faA.code }, actions: [] });
    expect((await get('mgr', 'referral', rec.rNew).expect(200)).body).toMatchObject({ step: 'terms', owner: { code: people.caA.code }, actions: [] });
    expect((await get('caA', 'referral', rec.rNew).expect(200)).body).toMatchObject({ step: 'terms', actions: ['partner_terms_link'] });
  });

  it("waiting for the Team Lead's ID check shows that, with no resend button", async () => {
    const res = await get('caA', 'job_seeker', rec.sIdWait).expect(200);
    expect(res.body).toMatchObject({ step: 'id_check', state: 'in_progress', waitingForTeamLead: true, actions: [], reason: expect.stringContaining('Team Lead') });
  });

  it("keeps each role's record scope: another team's Team Lead and another tree's Manager get 404; Finance and field agents are refused", async () => {
    await get('tlB', 'job_seeker', rec.sNew).expect(404);
    await get('mgrB', 'job_seeker', rec.sNew).expect(404);
    await get('tlA', 'job_seeker', rec.sB).expect(404);
    expect((await get('tlB', 'job_seeker', rec.sB).expect(200)).body.owner.code).toBe(people.caB.code);
    await get('fin', 'job_seeker', rec.sNew).expect(403);
    await get('faA', 'job_seeker', rec.sNew).expect(403);
    await get('ceo', 'vacancy', rec.sNew).expect(400);
    await request(app.getHttpServer()).get('/profile-stuck').query({ kind: 'job_seeker', id: rec.sNew }).expect(401);
  });

  it('the buttons are the existing routes, for agents only: Team Lead, Manager and CEO are refused (rev 211)', async () => {
    for (const who of ['tlA', 'mgr', 'ceo']) {
      expect([who, (await post(who, '/consent/links', { jobSeekerId: rec.sNew })).status]).toEqual([who, 403]);
      expect([who, (await post(who, `/referrals/${rec.rNew}/terms-links`, {})).status]).toEqual([who, 403]);
      expect([who, (await post(who, `/businesses/${rec.bLead}/agreement-links`, {})).status]).toEqual([who, 403]);
    }
    const res = await post('caA', '/consent/links', { jobSeekerId: rec.sNew, channel: 'sms' });
    expect(res.status).toBe(201);
    expect(res.body.sentBy).toBe('sms');
    const partner = await post('caA', `/referrals/${rec.rNew}/terms-links`, {});
    expect([200, 201]).toContain(partner.status);
    expect(partner.body.sentBy).toBe('whatsapp');
    const first = await post('faA', `/businesses/${rec.bLead}/agreement-links`, {});
    expect([200, 201]).toContain(first.status);
  });

  it('22 Nov: GET /profile-stuck/list holds every stuck person of the agent (or the team): job seekers, businesses and partners', async () => {
    // A job seeker registered on the call (consent by the read-aloud code, no link) and stuck at payment.
    const sPay = await seeker('pay', 7, people.caA.id, { status: 'consented', photoStoragePath: `selfies/${tail}/p.jpg`, photoTakenAt: new Date(), dateOfBirth: new Date('1995-01-01') });
    for (const purpose of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates']) {
      await prisma.consent.create({ data: { subjectType: 'job_seeker', subjectId: sPay, purpose, granted: true, grantedAt: new Date(), noticeVersion: '1.2', language: 'en', method: 'staff_otp' } });
    }
    await prisma.identityVerification.create({ data: { jobSeekerId: sPay, method: 'aadhaar_qr', vendor: 'uidai_secure_qr', status: 'verified', isAdult: true, nameMatches: true, verifiedAt: new Date() } });
    // Registered by caA but assigned to caB: caB's (assigned wins), not caA's.
    const sMoved = await seeker('moved', 8, people.caA.id, { assignedStaffId: people.caB.id });
    const sMovedLink = await prisma.publicLink.create({ data: { purpose: 'registration', subjectType: 'job_seeker', subjectId: sMoved, tokenHash: `ps-${tail}-moved`, phone: phone(8), language: 'en', expiresAt: new Date(Date.now() + 3600_000) } }).catch(() => null);
    // A business caA created as a lead, agreement not signed.
    const bCa = (await prisma.business.create({ data: { code: `BZ-PS-${tail}-C`, name: 'Stuck Shop C', phone: phone(9), ownerName: 'Owner', leadCreatedByStaffId: people.caA.id, verificationStatus: 'lead' } })).id;
    businesses.push(bCa);

    const list = async (who: string) => (await request(app.getHttpServer()).get('/profile-stuck/list').set('Authorization', `Bearer ${people[who].token}`).expect(200)).body.rows as Array<{ kind: string; id: string; step: string; waitingForTeamLead: boolean; actions: string[]; owner: { code: string } | null; ownerId: string | null }>;
    const mine = await list('caA');
    const find = (rows: typeof mine, id: string) => rows.find((r) => r.id === id);
    expect(find(mine, sPay)).toMatchObject({ kind: 'job_seeker', step: 'payment', actions: ['payment_link', 'someone_else_pays'] });
    expect(find(mine, rec.sIdWait)).toMatchObject({ step: 'id_check', waitingForTeamLead: true, actions: [] });
    expect(find(mine, bCa)).toMatchObject({ kind: 'business', step: 'agreement', actions: ['agreement_link'], ownerId: people.caA.id });
    expect(find(mine, rec.rNew)).toMatchObject({ kind: 'referral', step: 'terms', actions: ['partner_terms_link'] });
    // A lead with no link and no progress is not "stuck" (sNew got its link in the test above: listed).
    const sBare = await seeker('bare', 10, people.caA.id);
    expect(find(await list('caA'), sBare)).toBeUndefined();
    expect(find(mine, rec.sNew)).toMatchObject({ step: 'consent', actions: ['registration_link'] });
    // Someone assigned away is not his.
    expect(find(mine, sMoved)).toBeUndefined();
    if (sMovedLink) expect(find(await list('caB'), sMoved)).toMatchObject({ owner: { code: people.caB.code }, ownerId: people.caB.id });

    // The Team Lead sees his team's (caA's and faA's), never another team's.
    const team = await list('tlA');
    for (const id of [sPay, rec.sIdWait, bCa, rec.rNew, rec.bLead]) expect(find(team, id)).toBeDefined();
    expect(find(team, rec.sB)).toBeUndefined();
    // Finance and the CEO have no such list.
    await request(app.getHttpServer()).get('/profile-stuck/list').set('Authorization', `Bearer ${people.fin.token}`).expect(403);
  });
});
