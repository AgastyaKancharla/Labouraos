import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isJobSalaryKey, isMoneyKey } from '../../common/rbac/money-visibility';
import { MemoryBusinessPhotoStorage } from '../business/storefront-photo.storage';

jest.setTimeout(180000);

/** Every money-looking key left anywhere in an answer (job salaries are work details and allowed). */
function moneyKeys(data: unknown, path = '$', found: string[] = []): string[] {
  if (Array.isArray(data)) data.forEach((item, i) => moneyKeys(item, `${path}[${i}]`, found));
  else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      const pricing = ['feepercent', 'gstpercent', 'nobypasspenaltypercent', 'utr', 'activation', 'refunds', 'refund', 'payouts', 'payoutaccount', 'feepayment', 'joiningreward', 'invoicecode', 'payment'].includes(lower);
      if ((isMoneyKey(key) && !isJobSalaryKey(key)) || pricing) found.push(`${path}.${key}`);
      moneyKeys(value, `${path}.${key}`, found);
    }
  } else if (typeof data === 'string' && /₹\s?\d/.test(data)) found.push(`${path} (rupee text)`);
  return found;
}

/** Every phone-like value longer than the last 4 digits. */
function fullPhones(data: unknown, path = '$', found: string[] = []): string[] {
  if (Array.isArray(data)) data.forEach((item, i) => fullPhones(item, `${path}[${i}]`, found));
  else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (/phone/i.test(key) && typeof value === 'string' && !value.includes('*') && value.replace(/\D/g, '').length > 4) found.push(`${path}.${key}`);
      fullPhones(value, `${path}.${key}`, found);
    }
  }
  return found;
}

const codes = (body: { rows?: Array<{ code?: string }> }) => (body.rows ?? []).map((r) => r.code);

/**
 * Team Lead portal (Master Guide rev 194, "Team Lead portal, decided 17 Nov"):
 * the CEO pages reused as the Team Lead's lists and profiles, "My team" and
 * "Not assigned" (no owner, his city), Assign, the business numbers on T-Home
 * and the profile photos — no money, phone numbers masked, other teams 404/403.
 */
describe('Team Lead records, assign, pipeline and profile photos', () => {
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

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: { code: `TLR-${key}-${ts}`, name: `TlRec ${key}`, email: `tlrec_${key}_${ts}@laboura.local`, role, passwordHash: 'hash', status: 'active', ...extra },
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
  const phone = (n: number) => `+918${tail}${String(n).padStart(3, '0')}`.slice(0, 13);

  async function seeker(key: string, n: number, owner: string | null, extra: Record<string, unknown> = {}) {
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-TLR-${tail}-${key}`, name: `TlRec Seeker ${key}`, phone: phone(n), status: 'lead', city: 'Bengaluru', phoneVerified: true,
        minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
        registeredByStaffId: owner, ...extra,
      },
    });
    seekers.push(row.id);
    return row.id;
  }

  async function business(key: string, n: number, owner: string | null, extra: Record<string, unknown> = {}) {
    const row = await prisma.business.create({
      data: { code: `BZ-TLR-${tail}-${key}`, name: `TlRec Shop ${key}`, phone: phone(n), ownerName: 'Owner', accountAgentId: owner, verificationStatus: 'verified', ...extra },
    });
    businesses.push(row.id);
    return row.id;
  }

  async function referral(key: string, n: number, owner: string | null, extra: Record<string, unknown> = {}) {
    const row = await prisma.referral.create({ data: { code: `RF-TLR-${tail}-${key}`, name: `TlRec Partner ${key}`, phone: phone(n), registeredByStaffId: owner, ...extra } });
    referrals.push(row.id);
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
    await mk('offA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id, status: 'deactivated' });
    await mk('caB', 'call_agent', { teamLeadId: tlB.id, reportsToId: tlB.id });

    rec.sA = await seeker('A', 1, people.caA.id, { status: 'active', paymentReceivedAt: new Date(), photoStoragePath: `selfies/${tail}/a.jpg`, photoTakenAt: new Date() });
    rec.sB = await seeker('B', 2, people.caB.id);
    rec.sNone = await seeker('N', 3, null);
    rec.sMys = await seeker('M', 4, null, { city: 'Mysuru' });
    await prisma.payment.create({
      data: { code: `PAY-TLR-${tail}-1`, type: 'activation', amount: 49900, status: 'confirmed', subjectType: 'job_seeker', subjectId: rec.sA, jobSeekerId: rec.sA, bankUtr: 'UTR987654321', confirmedAt: new Date() },
    });

    rec.bA = await business('A', 5, people.faA.id);
    rec.bB = await business('B', 6, people.caB.id);
    rec.bNone = await business('N', 7, null);
    rec.bMys = await business('M', 8, null, { city: 'Mysuru' });
    rec.vA = (await prisma.vacancy.create({ data: { code: `VC-TLR-${tail}-A`, businessId: rec.bA, tradeSkill: 'Cook', status: 'open', capturedByStaffId: people.faA.id, headcount: 2 } })).id;
    rec.vNone = (await prisma.vacancy.create({ data: { code: `VC-TLR-${tail}-N`, businessId: rec.bNone, tradeSkill: 'Cook', status: 'open' } })).id;
    rec.vB = (await prisma.vacancy.create({ data: { code: `VC-TLR-${tail}-B`, businessId: rec.bB, tradeSkill: 'Cook', status: 'open', capturedByStaffId: people.caB.id } })).id;
    rec.pA = (
      await prisma.placement.create({
        data: { code: `PL-TLR-${tail}-A`, vacancyId: rec.vA, jobSeekerId: rec.sA, businessId: rec.bA, placementFee: 900000, gstAmount: 162000, agreedSalary: 1800000, status: 'active', paidAt: new Date(), selectedAt: new Date(), joinedDate: new Date(), invoiceCode: `INV-TLR-${tail}` },
      })
    ).id;
    rec.pB = (await prisma.placement.create({ data: { code: `PL-TLR-${tail}-B`, vacancyId: rec.vB, jobSeekerId: rec.sB, businessId: rec.bB, placementFee: 900000, gstAmount: 162000, status: 'awaiting_payment' } })).id;

    rec.rA = await referral('A', 9, people.caA.id);
    rec.rB = await referral('B', 10, people.caB.id);
    rec.rNone = await referral('N', 11, null);
    await prisma.payment.create({
      data: { code: `PAY-TLR-${tail}-2`, type: 'referral_payout', amount: 20000, status: 'pending', subjectType: 'referral', subjectId: rec.rA, referralId: rec.rA },
    });
    rec.sRef = await seeker('R', 12, people.caA.id, { referredById: rec.rA });

    const store = new MemoryBusinessPhotoStorage();
    await store.put(`visits/${tail}/board.jpg`, Buffer.from('board-bytes'));
    await store.put(`visits/${tail}/selfie.jpg`, Buffer.from('selfie-bytes'));
    rec.visitA = (
      await prisma.businessVisit.create({
        data: { businessId: rec.bA, staffId: people.faA.id, latitude: 12.9, longitude: 77.6, shopName: 'TlRec Shop A', boardPhotoPath: `visits/${tail}/board.jpg`, selfieUrl: `visits/${tail}/selfie.jpg`, photoLive: true, visitedAt: new Date() },
      })
    ).id;
    rec.visitGone = (
      await prisma.businessVisit.create({ data: { businessId: rec.bA, staffId: people.faA.id, latitude: 12.9, longitude: 77.6, shopName: 'TlRec Shop A', boardPhotoPath: null, selfieUrl: null, visitedAt: new Date() } })
    ).id;
    rec.visitB = (
      await prisma.businessVisit.create({ data: { businessId: rec.bB, staffId: people.caB.id, latitude: 12.9, longitude: 77.6, boardPhotoPath: `visits/${tail}/board.jpg`, visitedAt: new Date() } })
    ).id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { code: { startsWith: `PAY-TLR-${tail}` } } });
    await prisma.businessVisit.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.placement.deleteMany({ where: { id: { in: [rec.pA, rec.pB].filter(Boolean) } } });
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businesses } } });
    await prisma.followUpTask.deleteMany({ where: { subjectId: { in: businesses } } });
    await prisma.business.deleteMany({ where: { id: { in: businesses } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekers } } });
    await prisma.referral.deleteMany({ where: { id: { in: referrals } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const LISTS = ['/team-lead/job-seekers', '/team-lead/businesses', '/team-lead/vacancies', '/team-lead/interviews', '/team-lead/placements', '/team-lead/referrals'];

  it('only a Team Lead opens them: the CEO, a Manager and an agent are refused', async () => {
    for (const who of ['ceo', 'mgr', 'caA']) {
      for (const path of [...LISTS, '/team-lead/pipeline', `/team-lead/job-seekers/${rec.sA}`]) {
        expect([path, who, (await get(who, path)).status]).toEqual([path, who, 403]);
      }
      expect((await post(who, '/team-lead/assign', { kind: 'job_seeker', id: rec.sNone, toStaffId: people.caA.id })).status).toBe(403);
    }
  });

  it('"My team" holds the team\'s records and "Not assigned" the unowned ones in his city', async () => {
    const team = await get('tlA', '/team-lead/job-seekers?section=team');
    expect(team.status).toBe(200);
    expect(codes(team.body)).toEqual(expect.arrayContaining([`JS-TLR-${tail}-A`, `JS-TLR-${tail}-R`]));
    expect(codes(team.body)).not.toEqual(expect.arrayContaining([`JS-TLR-${tail}-B`]));
    expect(codes(team.body)).not.toContain(`JS-TLR-${tail}-N`);
    const defaultSection = await get('tlA', '/team-lead/job-seekers');
    expect(codes(defaultSection.body)).toEqual(codes(team.body));

    const open = await get('tlA', '/team-lead/job-seekers?section=unassigned');
    expect(open.status).toBe(200);
    expect(codes(open.body)).toContain(`JS-TLR-${tail}-N`);
    for (const code of ['A', 'B', 'M', 'R']) expect(codes(open.body)).not.toContain(`JS-TLR-${tail}-${code}`);

    const bizTeam = await get('tlA', '/team-lead/businesses?section=team');
    expect(codes(bizTeam.body)).toContain(`BZ-TLR-${tail}-A`);
    expect(codes(bizTeam.body)).not.toContain(`BZ-TLR-${tail}-B`);
    const bizOpen = await get('tlA', '/team-lead/businesses?section=unassigned');
    expect(codes(bizOpen.body)).toContain(`BZ-TLR-${tail}-N`);
    expect(codes(bizOpen.body)).not.toContain(`BZ-TLR-${tail}-M`);
    expect(codes(bizOpen.body)).not.toContain(`BZ-TLR-${tail}-A`);

    const vacOpen = await get('tlA', '/team-lead/vacancies?section=unassigned');
    expect(codes(vacOpen.body)).toContain(`VC-TLR-${tail}-N`);
    expect(codes(vacOpen.body)).not.toContain(`VC-TLR-${tail}-A`);
    expect(codes(vacOpen.body)).not.toContain(`VC-TLR-${tail}-B`);
    const vacTeam = await get('tlA', '/team-lead/vacancies?section=team');
    expect(codes(vacTeam.body)).toContain(`VC-TLR-${tail}-A`);
    expect(codes(vacTeam.body)).not.toContain(`VC-TLR-${tail}-N`);

    const refTeam = await get('tlA', '/team-lead/referrals?section=team');
    expect(codes(refTeam.body)).toContain(`RF-TLR-${tail}-A`);
    expect(codes(refTeam.body)).not.toContain(`RF-TLR-${tail}-B`);
    const refOpen = await get('tlA', '/team-lead/referrals?section=unassigned');
    expect(codes(refOpen.body)).toContain(`RF-TLR-${tail}-N`);

    const placements = await get('tlA', '/team-lead/placements?section=team');
    expect(codes(placements.body)).toContain(`PL-TLR-${tail}-A`);
    expect(codes(placements.body)).not.toContain(`PL-TLR-${tail}-B`);
    for (const section of ['team', 'unassigned']) expect((await get('tlA', `/team-lead/interviews?section=${section}`)).status).toBe(200);

    expect((await get('tlA', '/team-lead/job-seekers?section=everyone')).status).toBe(400);
  });

  it('profiles open for his team and unassigned records in his city; other teams and other cities are 404', async () => {
    for (const path of [`/team-lead/job-seekers/${rec.sA}`, `/team-lead/job-seekers/${rec.sNone}`, `/team-lead/businesses/${rec.bA}`, `/team-lead/businesses/${rec.bNone}`, `/team-lead/vacancies/${rec.vNone}`, `/team-lead/placements/${rec.pA}`, `/team-lead/referrals/${rec.rA}`, `/team-lead/referrals/${rec.rNone}`]) {
      expect([path, (await get('tlA', path)).status]).toEqual([path, 200]);
    }
    for (const path of [`/team-lead/job-seekers/${rec.sB}`, `/team-lead/job-seekers/${rec.sMys}`, `/team-lead/businesses/${rec.bB}`, `/team-lead/businesses/${rec.bMys}`, `/team-lead/vacancies/${rec.vB}`, `/team-lead/placements/${rec.pB}`, `/team-lead/referrals/${rec.rB}`]) {
      expect([path, (await get('tlA', path)).status]).toEqual([path, 404]);
    }
    const profile = await get('tlA', `/team-lead/job-seekers/${rec.sNone}`);
    expect(profile.body.assignment).toEqual({ section: 'unassigned', assignedTo: null, canAssign: true });
    // One line per route (SERVICE_SCOPED_ROUTES proofs): another team's record is 404.
    expect((await get('tlA', `/team-lead/job-seekers/${rec.sB}`)).status).toBe(404); // TL records: job seeker profile
    expect((await get('tlA', `/team-lead/job-seekers/${rec.sB}/selfie`)).status).toBe(404); // TL records: job seeker selfie
    expect((await get('tlA', `/team-lead/businesses/${rec.bB}`)).status).toBe(404); // TL records: business profile
    expect((await get('tlA', `/team-lead/businesses/${rec.bB}/visits/${rec.visitB}/photos`)).status).toBe(404); // TL records: visit photos
    expect((await get('tlA', `/team-lead/vacancies/${rec.vB}`)).status).toBe(404); // TL records: vacancy profile
    expect((await get('tlA', `/team-lead/placements/${rec.pB}`)).status).toBe(404); // TL records: placement profile
    expect((await get('tlA', `/team-lead/referrals/${rec.rB}`)).status).toBe(404); // TL records: partner profile
    expect((await get('tlA', `/team-lead/referrals/${rec.rB}/photo`)).status).toBe(404); // TL records: partner photo
    expect((await get('tlA', `/team-lead/referrals/${rec.rA}/photo`)).body).toEqual({ kept: false, url: null, expiresInSeconds: 0 });
    expect((await get('ceo', `/ceo/referrals/${rec.rB}/photo`)).status).toBe(200);
    expect((await get('mgr', `/manager/referrals/${rec.rB}/photo`)).status).toBe(404);
  });

  it('no money and no unmasked phone number in any list or profile', async () => {
    const paths = [
      ...LISTS.map((p) => `${p}?section=team`),
      ...LISTS.map((p) => `${p}?section=unassigned`),
      `/team-lead/job-seekers/${rec.sA}`,
      `/team-lead/businesses/${rec.bA}`,
      `/team-lead/vacancies/${rec.vA}`,
      `/team-lead/placements/${rec.pA}`,
      `/team-lead/referrals/${rec.rA}`,
      '/team-lead/pipeline',
    ];
    for (const path of paths) {
      const res = await get('tlA', path);
      expect([path, res.status]).toEqual([path, 200]);
      expect([path, moneyKeys(res.body)]).toEqual([path, []]);
      expect([path, fullPhones(res.body)]).toEqual([path, []]);
    }
  });

  it('assigns an unassigned job seeker: registeredBy stays, he moves to My team, other teams lose sight of him, audited', async () => {
    const res = await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sNone, toStaffId: people.caA.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, kind: 'job_seeker', to: { id: people.caA.id, name: 'TlRec caA' }, from: null });
    const row = await prisma.jobSeeker.findUnique({ where: { id: rec.sNone }, select: { registeredByStaffId: true, assignedStaffId: true, assignedAt: true } });
    expect(row).toMatchObject({ registeredByStaffId: null, assignedStaffId: people.caA.id });
    expect(row?.assignedAt).toBeInstanceOf(Date);

    expect(codes((await get('tlA', '/team-lead/job-seekers?section=team')).body)).toContain(`JS-TLR-${tail}-N`);
    expect(codes((await get('tlA', '/team-lead/job-seekers?section=unassigned')).body)).not.toContain(`JS-TLR-${tail}-N`);
    expect(codes((await get('tlB', '/team-lead/job-seekers?section=unassigned')).body)).not.toContain(`JS-TLR-${tail}-N`);
    expect((await get('tlB', `/team-lead/job-seekers/${rec.sNone}`)).status).toBe(404);
    // The other team's Manager no longer sees him as "no owner"; this team's Manager does.
    expect((await get('mgrB', `/manager/job-seekers/${rec.sNone}`)).status).toBe(404);
    expect((await get('mgr', `/manager/job-seekers/${rec.sNone}`)).status).toBe(200);
    // The assigned agent's own "My job seekers" (Laboura Field) lists him too.
    const profile = await get('tlA', `/team-lead/job-seekers/${rec.sNone}`);
    expect(profile.body.assignment).toEqual({ section: 'team', assignedTo: { id: people.caA.id, name: 'TlRec caA' }, canAssign: true });

    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: people.caA.id, kind: 'job_seeker_assigned' }, orderBy: { createdAt: 'desc' } });
    expect(bell).toMatchObject({ title: 'New job seeker assigned to you', link: `/call-agent/people/${rec.sNone}` });
    expect(bell?.body).toContain(`JS-TLR-${tail}-N`);

    const audit = await prisma.auditLog.findFirst({ where: { actorId: people.tlA.id, action: 'record_assigned', entityCode: `JS-TLR-${tail}-N` } });
    expect(audit).not.toBeNull();
    expect(audit?.before).toMatchObject({ kind: 'job_seeker', id: rec.sNone, from: null });
    expect(audit?.after).toMatchObject({ kind: 'job_seeker', id: rec.sNone, to: people.caA.id });
  });

  it('moves a team job seeker inside the team, never to another team, an inactive agent, or from another team or city', async () => {
    const move = await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sA, toStaffId: people.tlA.id });
    expect(move.status).toBe(200);
    expect(await prisma.jobSeeker.findUnique({ where: { id: rec.sA }, select: { registeredByStaffId: true, assignedStaffId: true } })).toEqual({ registeredByStaffId: people.caA.id, assignedStaffId: people.tlA.id });
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sA, toStaffId: people.tlA.id })).status).toBe(400);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sA, toStaffId: people.caB.id })).status).toBe(400);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sA, toStaffId: people.offA.id })).status).toBe(400);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sB, toStaffId: people.caA.id })).status).toBe(403);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: rec.sMys, toStaffId: people.caA.id })).status).toBe(403);
    expect((await post('tlA', '/team-lead/assign', { kind: 'referral', id: rec.rB, toStaffId: people.caA.id })).status).toBe(403);
    expect((await post('tlA', '/team-lead/assign', { kind: 'business', id: rec.bB, toStaffId: people.faA.id })).status).toBe(403);
    expect((await post('tlA', '/team-lead/assign', { kind: 'placement', id: rec.pA, toStaffId: people.caA.id })).status).toBe(400);
    expect((await post('tlA', '/team-lead/assign', { kind: 'job_seeker', id: 'nope', toStaffId: people.caA.id })).status).toBe(404);
  });

  it('assigns an unassigned referral partner to the Team Lead himself', async () => {
    const res = await post('tlA', '/team-lead/assign', { kind: 'referral', id: rec.rNone, toStaffId: people.tlA.id });
    expect(res.status).toBe(200);
    expect(await prisma.referral.findUnique({ where: { id: rec.rNone }, select: { registeredByStaffId: true, assignedStaffId: true } })).toEqual({ registeredByStaffId: null, assignedStaffId: people.tlA.id });
    // Nobody is told about what he gave himself.
    expect(await prisma.notification.count({ where: { recipientStaffId: people.tlA.id, kind: 'referral_assigned' } })).toBe(0);
    expect(codes((await get('tlA', '/team-lead/referrals?section=team')).body)).toContain(`RF-TLR-${tail}-N`);
  });

  it("assigns an unassigned business through the account-agent path (field agent or himself), with the account agent's history", async () => {
    expect((await post('tlA', '/team-lead/assign', { kind: 'business', id: rec.bNone, toStaffId: people.caA.id })).status).toBe(400);
    const res = await post('tlA', '/team-lead/assign', { kind: 'business', id: rec.bNone, toStaffId: people.faA.id });
    expect(res.status).toBe(200);
    const row = await prisma.business.findUnique({ where: { id: rec.bNone }, select: { accountAgentId: true, accountAgentAssignedAt: true } });
    expect(row?.accountAgentId).toBe(people.faA.id);
    expect(row?.accountAgentAssignedAt).toBeInstanceOf(Date);
    const history = await prisma.auditLog.findFirst({ where: { action: 'business.account_agent_assigned', entityCode: `BZ-TLR-${tail}-N`, actorId: people.tlA.id } });
    expect(history?.before).toMatchObject({ accountAgentId: null });
    expect(history?.after).toMatchObject({ accountAgentId: people.faA.id });
    expect(await prisma.auditLog.count({ where: { action: 'record_assigned', entityCode: `BZ-TLR-${tail}-N` } })).toBe(1);
    // The field agent's bell (Laboura Field has no web link: link stays empty).
    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: people.faA.id, kind: 'business_assigned' } });
    expect(bell).toMatchObject({ title: 'New business assigned to you', link: null });
    // Its vacancy follows the business into My team.
    expect(codes((await get('tlA', '/team-lead/vacancies?section=team')).body)).toContain(`VC-TLR-${tail}-N`);
    // T-Work's move works on it now, as on any team business.
    expect((await post('tlA', `/team-lead/businesses/${rec.bNone}/move`, { toStaffId: people.faA.id })).status).toBe(400);
  });

  it('lists who an assignment can go to: himself and his active agents', async () => {
    const res = await get('tlA', '/team-lead/assignees');
    expect(res.status).toBe(200);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    expect(ids[0]).toBe(people.tlA.id);
    expect(ids).toEqual(expect.arrayContaining([people.caA.id, people.faA.id]));
    expect(ids).not.toContain(people.offA.id);
    expect(ids).not.toContain(people.caB.id);
  });

  it('shows the team\'s close-to-a-refund rows with names and counts, never rupees', async () => {
    const res = await get('tlA', '/team-lead/close-to-refund');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['buckets', 'businesses', 'jobSeekers', 'rows', 'total', 'windowDays']);
    expect(moneyKeys(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/atStake/i);
    for (const row of res.body.rows as Array<{ agent: { id: string } | null }>) {
      expect([people.tlA.id, people.caA.id, people.faA.id]).toContain(row.agent?.id);
    }
  });

  it('counts the business numbers for the team only, as counts', async () => {
    const res = await get('tlA', '/team-lead/pipeline');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.jobSeekers).sort()).toEqual(['accepted', 'interviewed', 'joined', 'notPaid', 'offered', 'paid', 'registered', 'stuckBeforePaying']);
    expect(Object.keys(res.body.businesses).sort()).toEqual(['droppedOut', 'fieldVisits', 'filled', 'openings', 'signedUp', 'vacanciesAdded']);
    expect(Object.keys(res.body.referralPartners).sort()).toEqual(['introduced', 'introducedPaid', 'partnersNotPaid', 'partnersPaid', 'registered']);
    expect(res.body.jobSeekers.registered).toBeGreaterThanOrEqual(3); // A, R and the assigned N
    expect(res.body.jobSeekers.paid).toBeGreaterThanOrEqual(1);
    expect(res.body.jobSeekers.joined).toBeGreaterThanOrEqual(1);
    expect(res.body.businesses.fieldVisits).toBeGreaterThanOrEqual(2);
    expect(res.body.businesses.openings).toBeGreaterThanOrEqual(3);
    expect(res.body.referralPartners.introduced).toBeGreaterThanOrEqual(1);
    expect(res.body.referralPartners.partnersNotPaid).toBeGreaterThanOrEqual(1);
    const other = await get('tlB', '/team-lead/pipeline');
    expect(other.body.jobSeekers.registered).toBeLessThan(res.body.jobSeekers.registered + 100);
    expect(other.body.businesses.fieldVisits).toBe(1);
  });

  it('serves profile photos through private links, checked against each viewer\'s scope', async () => {
    const visit = await get('tlA', `/team-lead/businesses/${rec.bA}/visits/${rec.visitA}/photos`);
    expect(visit.status).toBe(200);
    expect(visit.body.boardPhoto).toEqual({ kept: true, url: `data:image/jpeg;base64,${Buffer.from('board-bytes').toString('base64')}`, expiresInSeconds: 300 });
    expect(visit.body.selfie.url).toBe(`data:image/jpeg;base64,${Buffer.from('selfie-bytes').toString('base64')}`);
    const gone = await get('tlA', `/team-lead/businesses/${rec.bA}/visits/${rec.visitGone}/photos`);
    expect(gone.body.boardPhoto).toEqual({ kept: false, url: null, expiresInSeconds: 0 });
    expect((await get('tlA', `/team-lead/businesses/${rec.bB}/visits/${rec.visitB}/photos`)).status).toBe(404);
    expect((await get('tlA', `/team-lead/businesses/${rec.bA}/visits/${rec.visitB}/photos`)).status).toBe(404);

    const selfie = await get('tlA', `/team-lead/job-seekers/${rec.sA}/selfie`);
    expect(selfie.status).toBe(200);
    expect(selfie.body.kept).toBe(true);
    expect(typeof selfie.body.url).toBe('string');
    expect((await get('tlA', `/team-lead/job-seekers/${rec.sNone}/selfie`)).body).toEqual({ kept: false, url: null, expiresInSeconds: 0 });
    expect((await get('tlA', `/team-lead/job-seekers/${rec.sB}/selfie`)).status).toBe(404);

    expect((await get('ceo', `/ceo/job-seekers/${rec.sB}/selfie`)).status).toBe(200);
    expect((await get('ceo', `/ceo/businesses/${rec.bB}/visits/${rec.visitB}/photos`)).status).toBe(200);
    expect((await get('mgr', `/manager/businesses/${rec.bA}/visits/${rec.visitA}/photos`)).body.boardPhoto.url).toBe(visit.body.boardPhoto.url);
    expect((await get('mgr', `/manager/job-seekers/${rec.sB}/selfie`)).status).toBe(404);
    expect((await get('mgr', `/manager/businesses/${rec.bB}/visits/${rec.visitB}/photos`)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { actorId: people.tlA.id, action: { in: ['record.selfie_viewed', 'record.visit_photos_viewed'] } } })).toBeGreaterThanOrEqual(2);

    const detail = await get('ceo', `/ceo/businesses/${rec.bA}`);
    expect(detail.body.visits.find((v: { id: string }) => v.id === rec.visitA)).toMatchObject({ hasSelfie: true, hasBoardPhoto: true });
    expect((await get('ceo', `/ceo/job-seekers/${rec.sA}`)).body.registration.hasSelfie).toBe(true);
  });
});
