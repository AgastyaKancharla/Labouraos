import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isJobSalaryKey, isMoneyKey } from '../../common/rbac/money-visibility';

/** Every money-looking key left anywhere in an answer (job salaries are allowed, as everywhere for a Manager). */
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

/**
 * The Manager's pipeline lists and profiles (/manager/job-seekers … /manager/referrals):
 * the CEO pages reused for a Manager — their own reporting tree only (plus
 * records with no owner), phone numbers masked, and no money anywhere.
 */
describe('Manager pipeline lists and profiles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const ts = Date.now();
  const tail = String(ts).slice(-6);
  const staffIds: string[] = [];
  const people: Record<string, { id: string; token: string }> = {};
  const rec: Record<string, string> = {};

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: { code: `MGR-${key}-${ts}`, name: `MgrRec ${key}`, email: `mgrrec_${key}_${ts}@laboura.local`, role, passwordHash: 'hash', status: 'active', ...extra },
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
  const phone = (n: number) => `+919${tail}${n}${n}${n}`.slice(0, 13);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const ceo = await mk('ceo', 'ceo');
    const mgrA = await mk('mgrA', 'manager', { reportsToId: ceo.id });
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgrA.id });
    const tlB = await mk('tlB', 'team_lead', { reportsToId: mgrB.id });
    await mk('caA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('caB', 'call_agent', { teamLeadId: tlB.id, reportsToId: tlB.id });

    const seeker = (key: string, n: number, owner: string | null, extra: Record<string, unknown> = {}) =>
      prisma.jobSeeker.create({
        data: {
          code: `JS-MGR-${tail}-${key}`, name: `MgrRec Seeker ${key}`, phone: phone(n), status: 'lead', city: 'Bengaluru',
          minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00',
          registeredByStaffId: owner, ...extra,
        },
      });
    rec.sA = (await seeker('A', 1, people.caA.id, { status: 'active', paymentReceivedAt: new Date() })).id;
    rec.sB = (await seeker('B', 2, people.caB.id)).id;
    rec.sNone = (await seeker('N', 3, null)).id;
    await prisma.payment.create({
      data: { code: `PAY-MGR-${tail}-1`, type: 'activation', amount: 49900, status: 'confirmed', subjectType: 'job_seeker', subjectId: rec.sA, jobSeekerId: rec.sA, bankUtr: 'UTR123456789', confirmedAt: new Date() },
    });

    const business = (key: string, n: number, owner: string) =>
      prisma.business.create({
        data: { code: `BZ-MGR-${tail}-${key}`, name: `MgrRec Shop ${key}`, phone: phone(n), ownerName: 'Owner', accountAgentId: owner, verificationStatus: 'verified' },
      });
    rec.bA = (await business('A', 4, people.caA.id)).id;
    rec.bB = (await business('B', 5, people.caB.id)).id;
    await prisma.businessAgreement.create({
      data: {
        businessId: rec.bA, version: '1.1', language: 'en', signedName: 'Owner', signedRole: 'owner', signedAt: new Date(),
        feePercent: 50, gstPercent: 18, noBypassMonths: 12, noBypassPenaltyPercent: 50, termsHash: 'h', documentStoragePath: 'x',
      } as never,
    }).catch(() => undefined);
    rec.vA = (await prisma.vacancy.create({ data: { code: `VC-MGR-${tail}-A`, businessId: rec.bA, tradeSkill: 'Cook', status: 'open', capturedByStaffId: people.caA.id, salaryMinPaise: 1500000, salaryMaxPaise: 2000000 } })).id;
    rec.vB = (await prisma.vacancy.create({ data: { code: `VC-MGR-${tail}-B`, businessId: rec.bB, tradeSkill: 'Cook', status: 'open', capturedByStaffId: people.caB.id } })).id;
    rec.pA = (
      await prisma.placement.create({
        data: { code: `PL-MGR-${tail}-A`, vacancyId: rec.vA, jobSeekerId: rec.sA, businessId: rec.bA, placementFee: 900000, gstAmount: 162000, agreedSalary: 1800000, status: 'active', paidAt: new Date(), joinedDate: new Date(), invoiceCode: `INV-MGR-${tail}` },
      })
    ).id;
    rec.pB = (await prisma.placement.create({ data: { code: `PL-MGR-${tail}-B`, vacancyId: rec.vB, jobSeekerId: rec.sB, businessId: rec.bB, placementFee: 900000, gstAmount: 162000, status: 'awaiting_payment' } })).id;
    await prisma.payment.create({
      data: { code: `PAY-MGR-${tail}-2`, type: 'placement_fee', amount: 1062000, status: 'confirmed', subjectType: 'placement', subjectId: rec.pA, placementId: rec.pA, businessId: rec.bA, confirmedAt: new Date() },
    });
    rec.rA = (await prisma.referral.create({ data: { code: `RF-MGR-${tail}-A`, name: 'MgrRec Partner A', phone: phone(6), registeredByStaffId: people.caA.id } })).id;
    rec.rB = (await prisma.referral.create({ data: { code: `RF-MGR-${tail}-B`, name: 'MgrRec Partner B', phone: phone(7), registeredByStaffId: people.caB.id } })).id;
    await prisma.payment.create({
      data: { code: `PAY-MGR-${tail}-3`, type: 'referral_payout', amount: 20000, status: 'pending', subjectType: 'referral', subjectId: rec.rA, referralId: rec.rA },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { code: { startsWith: `PAY-MGR-${tail}` } } });
    await prisma.placement.deleteMany({ where: { id: { in: [rec.pA, rec.pB].filter(Boolean) } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: [rec.vA, rec.vB].filter(Boolean) } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: [rec.bA, rec.bB].filter(Boolean) } } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: { in: [rec.bA, rec.bB].filter(Boolean) } } });
    await prisma.referral.deleteMany({ where: { id: { in: [rec.rA, rec.rB].filter(Boolean) } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: [rec.sA, rec.sB, rec.sNone].filter(Boolean) } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const LISTS = ['/manager/job-seekers', '/manager/businesses', '/manager/vacancies', '/manager/interviews', '/manager/placements', '/manager/referrals'];

  it('only a Manager opens them: the CEO, a Team Lead and an agent are refused', async () => {
    for (const who of ['ceo', 'tlA', 'caA']) {
      for (const path of [...LISTS, `/manager/job-seekers/${rec.sA}`, `/manager/placements/${rec.pA}`]) {
        expect([path, who, (await get(who, path)).status]).toEqual([path, who, 403]);
      }
    }
  });

  it('lists show the own tree ("My team") and, apart, records with no owner ("Not assigned"), never another Manager’s tree', async () => {
    const codes = async (path: string) => ((await get('mgrA', `${path}${path.includes('?') ? '&' : '?'}pageSize=100`).expect(200)).body.rows as Array<{ id: string }>).map((r) => r.id);
    const seekers = await codes('/manager/job-seekers');
    expect(seekers).toContain(rec.sA);
    expect(seekers).not.toContain(rec.sNone);
    expect(seekers).not.toContain(rec.sB);
    expect(await codes('/manager/job-seekers?section=team')).toEqual(seekers);
    const open = await codes('/manager/job-seekers?section=unassigned');
    expect(open).toContain(rec.sNone);
    expect(open).not.toContain(rec.sA);
    expect(open).not.toContain(rec.sB);
    expect((await get('mgrA', '/manager/job-seekers?section=all')).status).toBe(400);
    expect((await get('mgrA', `/manager/job-seekers/${rec.sNone}`)).status).toBe(200);
    const businesses = await codes('/manager/businesses');
    expect(businesses).toContain(rec.bA);
    expect(businesses).not.toContain(rec.bB);
    const vacancies = await codes('/manager/vacancies');
    expect(vacancies).toContain(rec.vA);
    expect(vacancies).not.toContain(rec.vB);
    const placements = await codes('/manager/placements');
    expect(placements).toContain(rec.pA);
    expect(placements).not.toContain(rec.pB);
    const referrals = await codes('/manager/referrals');
    expect(referrals).toContain(rec.rA);
    expect(referrals).not.toContain(rec.rB);
    // The other Manager sees the mirror image.
    expect(await (async () => ((await get('mgrB', '/manager/job-seekers?pageSize=100').expect(200)).body.rows as Array<{ id: string }>).map((r) => r.id))()).not.toContain(rec.sA);
  });

  it("another tree's profiles are 404 (job seeker, business, vacancy, placement, partner)", async () => {
    for (const path of [`/manager/job-seekers/${rec.sB}`, `/manager/businesses/${rec.bB}`, `/manager/vacancies/${rec.vB}`, `/manager/placements/${rec.pB}`, `/manager/referrals/${rec.rB}`]) {
      expect([path, (await get('mgrA', path)).status]).toEqual([path, 404]);
    }
    expect((await get('mgrB', `/manager/job-seekers/${rec.sA}`)).status).toBe(404);
  });

  it('no money in any list or profile: no fee, GST, payment, refund, payout or UTR', async () => {
    const paths = [
      ...LISTS,
      `/manager/job-seekers/${rec.sA}`,
      `/manager/businesses/${rec.bA}`,
      `/manager/vacancies/${rec.vA}`,
      `/manager/placements/${rec.pA}`,
      `/manager/referrals/${rec.rA}`,
    ];
    for (const path of paths) {
      const res = await get('mgrA', path).expect(200);
      expect([path, moneyKeys(res.body)]).toEqual([path, []]);
      expect(JSON.stringify(res.body)).not.toContain('UTR123456789');
      expect(JSON.stringify(res.body)).not.toContain(`INV-MGR-${tail}`);
    }
    // The job seeker profile keeps the work details (salary range, guarantee day) a Manager may see.
    const seeker = (await get('mgrA', `/manager/job-seekers/${rec.sA}`).expect(200)).body;
    expect(seeker.profile.salaryMinPaise).toBe(1500000);
    expect(seeker.history.some((e: { kind: string }) => e.kind.startsWith('payment_'))).toBe(false);
  });

  it('phone numbers are masked to the last 4 digits everywhere', async () => {
    for (const path of [...LISTS, `/manager/job-seekers/${rec.sA}`, `/manager/businesses/${rec.bA}`, `/manager/referrals/${rec.rA}`]) {
      const res = await get('mgrA', path).expect(200);
      expect([path, fullPhones(res.body)]).toEqual([path, []]);
    }
    const seeker = (await get('mgrA', `/manager/job-seekers/${rec.sA}`).expect(200)).body;
    expect(seeker.phone).toMatch(/^\*+\d{4}$/);
  });

  it('CEO lists: each tile filter returns the tile’s rows, and "all" shows every vacancy', async () => {
    const ids = async (path: string) => ((await get('ceo', path).expect(200)).body.rows as Array<{ id: string }>).map((r) => r.id);
    const notPaid = await ids(`/ceo/job-seekers?status=not_paid&search=MgrRec&pageSize=100`);
    expect(notPaid).toEqual(expect.arrayContaining([rec.sB, rec.sNone]));
    expect(notPaid).not.toContain(rec.sA);
    const kyc = await ids(`/ceo/job-seekers?status=waiting_kyc&search=MgrRec&pageSize=100`);
    expect(kyc).toContain(rec.sA); // active, no verified ID
    expect(kyc).not.toContain(rec.sB); // a lead is not waiting on KYC
    const everyone = await ids(`/ceo/job-seekers?search=MgrRec&pageSize=100`);
    expect(everyone).toEqual(expect.arrayContaining([rec.sA, rec.sB, rec.sNone]));
    await prisma.vacancy.update({ where: { id: rec.vB }, data: { status: 'filled' } });
    expect(await ids(`/ceo/vacancies?status=all&search=VC-MGR-${tail}&pageSize=100`)).toEqual(expect.arrayContaining([rec.vA, rec.vB]));
    expect(await ids(`/ceo/vacancies?search=VC-MGR-${tail}&pageSize=100`)).not.toContain(rec.vB);
    const working = await ids(`/ceo/placements?stage=joined_this_month&search=PL-MGR-${tail}&pageSize=100`);
    expect(working).toContain(rec.pA);
    expect(working).not.toContain(rec.pB);
  });

  it('assigns an unowned record to someone in his tree, with a bell for the receiver; never outside the tree (rev 196)', async () => {
    const post = (who: string, body: Record<string, unknown>) => request(app.getHttpServer()).post('/manager/assign').set('Authorization', `Bearer ${people[who].token}`).send(body);
    const pick = await get('mgrA', '/manager/assignees').expect(200);
    const ids = pick.body.rows.map((r: { id: string }) => r.id);
    expect(ids[0]).toBe(people.mgrA.id);
    expect(ids).toEqual(expect.arrayContaining([people.tlA.id, people.caA.id]));
    expect(ids).not.toContain(people.caB.id);

    expect((await post('mgrA', { kind: 'job_seeker', id: rec.sNone, toStaffId: people.caB.id })).status).toBe(400);
    expect((await post('mgrA', { kind: 'job_seeker', id: rec.sB, toStaffId: people.caA.id })).status).toBe(403);
    expect((await post('mgrA', { kind: 'business', id: rec.bB, toStaffId: people.tlA.id })).status).toBe(403);
    expect((await post('tlA', { kind: 'job_seeker', id: rec.sNone, toStaffId: people.caA.id })).status).toBe(403);
    const res = await post('mgrA', { kind: 'job_seeker', id: rec.sNone, toStaffId: people.caA.id });
    expect(res.status).toBe(200);
    expect(await prisma.jobSeeker.findUnique({ where: { id: rec.sNone }, select: { registeredByStaffId: true, assignedStaffId: true } })).toEqual({ registeredByStaffId: null, assignedStaffId: people.caA.id });
    expect(await prisma.auditLog.count({ where: { actorId: people.mgrA.id, action: 'record_assigned', entityCode: `JS-MGR-${tail}-N` } })).toBe(1);
    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: people.caA.id, kind: 'job_seeker_assigned' } });
    expect(bell).toMatchObject({ title: 'New job seeker assigned to you', link: `/call-agent/people/${rec.sNone}` });
    const team = ((await get('mgrA', '/manager/job-seekers?pageSize=100').expect(200)).body.rows as Array<{ id: string }>).map((r) => r.id);
    expect(team).toContain(rec.sNone);
    // The other Manager no longer sees him, as an unowned record or otherwise.
    expect((await get('mgrB', `/manager/job-seekers/${rec.sNone}`)).status).toBe(404);
    // A business he owns can go to a Team Lead in his tree; to a call agent it cannot.
    expect((await post('mgrA', { kind: 'business', id: rec.bA, toStaffId: people.caA.id })).status).toBe(400);
    expect((await post('mgrA', { kind: 'business', id: rec.bA, toStaffId: people.tlA.id })).status).toBe(200);
    expect((await prisma.business.findUnique({ where: { id: rec.bA }, select: { accountAgentId: true } }))?.accountAgentId).toBe(people.tlA.id);
    const bizBell = await prisma.notification.findFirst({ where: { recipientStaffId: people.tlA.id, kind: 'business_assigned' } });
    expect(bizBell?.link).toBe(`/team-lead/businesses/${rec.bA}`);
  });

  it('the CEO still sees the money on his own pages (unchanged)', async () => {
    const res = await get('ceo', `/ceo/placements/${rec.pA}`).expect(200);
    expect(res.body.feePaise).toBe(900000);
  });
});
