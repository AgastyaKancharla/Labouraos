import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { GST_LOOKUP_PROVIDER } from '../business/gst-lookup.provider';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage } from '../business/storefront-photo.storage';

/**
 * Rev 193 item 8: every minimum wage check uses the business's zone and the
 * trade's skill level; businesses get their zone from the address and office
 * staff can change it; the CEO edits all twelve figures.
 */
describe('legal minimum wage by zone and skill level (rev 193)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
  const digits = String(Date.now()).slice(-6);
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  let ceoToken: string;
  let managerToken: string;
  let teamLeadToken: string;
  let otherTeamLeadToken: string;
  let callAgentToken: string;
  let callAgentId: string;
  let policyIdsBefore: string[] = [];

  const server = () => app.getHttpServer();
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function staff(role: string, extra: Record<string, unknown> = {}) {
    const row = await prisma.staff.create({ data: {
      code: `MW-${role}-${suffix}-${staffIds.length}`, name: `MW ${role}`, email: `mw-${role}-${suffix}-${staffIds.length}@laboura.local`,
      passwordHash: await bcrypt.hash('Wage-Password-1', 4), role, status: 'active', ...extra,
    } });
    staffIds.push(row.id);
    return { row, token: app.get(JwtService).sign({ sub: row.id, role: row.role, code: row.code, email: row.email }) };
  }

  async function business(n: number, fields: Record<string, unknown>) {
    const row = await prisma.business.create({ data: {
      code: `BZ-MW-${suffix}-${n}`, name: `Wage shop ${n}`, phone: `+9188${digits}${String(n).padStart(2, '0')}`, phoneVerified: true,
      additionalContactName: 'Owner', contactRole: 'owner', verificationStatus: 'verified', accountAgentId: callAgentId,
      ...fields,
    } });
    businessIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GST_LOOKUP_PROVIDER)
      .useValue({ lookup: async () => { throw new Error('mock lookup unavailable'); } })
      .overrideProvider(BUSINESS_PHOTO_STORAGE)
      .useValue(new MemoryBusinessPhotoStorage())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    policyIdsBefore = (await prisma.pricingPolicy.findMany({ select: { id: true } })).map((p) => p.id);
    ceoToken = (await staff('ceo')).token;
    managerToken = (await staff('manager')).token;
    const tl = await staff('team_lead');
    teamLeadToken = tl.token;
    otherTeamLeadToken = (await staff('team_lead')).token;
    const ca = await staff('call_agent', { teamLeadId: tl.row.id });
    callAgentToken = ca.token;
    callAgentId = ca.row.id;
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.pricingPolicy.deleteMany({ where: { id: { notIn: policyIdsBefore } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('the trades carry their reviewed level; a Zone 2 business is checked against Zone 2, not Bengaluru', async () => {
    const trades = await prisma.trade.findMany({ where: { nameKey: { in: ['cook', 'waiter', 'housekeeping', 'electrician'] } } });
    expect(Object.fromEntries(trades.map((t) => [t.nameKey, t.minimumWageLevel]))).toEqual({
      cook: 'skilled', waiter: 'semi_skilled', housekeeping: 'unskilled', electrician: 'skilled',
    });

    const mysuru = await business(1, { city: 'Mysuru', pincode: '570001', minimumWageZone: 2 });
    const bengaluru = await business(2, { city: 'Bengaluru', pincode: '560078', minimumWageZone: 1 });
    const cook = (businessId: string, salaryMinPaise: number, extra: Record<string, unknown> = {}) => request(server())
      .post(`/businesses/${businessId}/vacancies`).set(as(callAgentToken))
      .send({ tradeSkill: 'Cook', salaryMinPaise, headcount: 1, shift: 'day', ...extra });

    // ₹26,000 for a cook: above Zone 2's skilled minimum (₹25,714.07), below Zone 1's (₹28,285.47).
    const inMysuru = await cook(mysuru.id, 2600000).expect(201);
    expect(inMysuru.body).toMatchObject({ belowLegalMinimum: false, legalMinimumPaise: 2571407 });
    const refused = await cook(bengaluru.id, 2600000).expect(400);
    expect(refused.body).toMatchObject({ code: 'MINIMUM_WAGE_TICK_REQUIRED', legalMinimumPaise: 2828547, level: 'skilled', zone: 1 });
    const told = await cook(bengaluru.id, 2600000, { ownerToldMinimumWage: true }).expect(201);
    expect(told.body).toMatchObject({ belowLegalMinimum: true, ownerToldMinimumWage: true, legalMinimumPaise: 2828547 });

    // The trade list gives the business's zone figure, every zone's figures, and Zone 1 without a business.
    const forMysuru = await request(server()).get('/trades').query({ businessId: mysuru.id }).set(as(callAgentToken)).expect(200);
    const cookRow = forMysuru.body.find((t: { name: string }) => t.name === 'Cook');
    expect(cookRow).toMatchObject({ zone: 2, legalMinimumPaise: 2571407, legalMinimumPaiseByZone: { '1': 2828547, '2': 2571407, '3': 2337643 } });
    // The business id only picks the zone; an unknown one is refused.
    await request(server()).get('/trades').query({ businessId: '00000000-0000-0000-0000-000000000000' }).set(as(callAgentToken)).expect(404);
    const plain = await request(server()).get('/trades').set(as(callAgentToken)).expect(200);
    expect(plain.body.find((t: { name: string }) => t.name === 'Cook')).toMatchObject({ zone: 1, legalMinimumPaise: 2828547 });
    const zone3 = await request(server()).get('/trades').query({ zone: '3' }).set(as(callAgentToken)).expect(200);
    expect(zone3.body.find((t: { name: string }) => t.name === 'Housekeeping')).toMatchObject({ zone: 3, legalMinimumPaise: 1931936 });
  });

  it('a new business gets its zone from the address; an address edit moves an automatic zone', async () => {
    const create = async (fields: Record<string, unknown>) => {
      const phone = `+9187${digits}${String(10 + businessIds.length).padStart(2, '0')}`;
      const otpRequestId = await verifiedOtpFor(app, phone);
      const res = await request(server()).post('/businesses').set(as(callAgentToken)).send({
        name: `Zone shop ${randomUUID().slice(0, 6)}`, phone, otpRequestId, locality: 'Somewhere',
        contactPersonName: 'Owner', contactPersonRole: 'owner', heardFrom: 'field_visit', ...fields,
      });
      expect(res.status).toBe(201);
      businessIds.push(res.body.id as string);
      return res.body as { id: string; minimumWageZone: number; minimumWageZoneSource: string };
    };
    expect(await create({ pincode: '560041' })).toMatchObject({ minimumWageZone: 1, minimumWageZoneSource: 'auto' });
    const hubli = await create({ pincode: '580020', city: 'Hubli' });
    expect(hubli.minimumWageZone).toBe(2);
    const unsure = await create({ pincode: '571111', city: 'Bengaluru', street: 'Main road' });
    expect(unsure.minimumWageZone).toBe(1);

    // The street now names a district HQ (non-Bengaluru pin code): Zone 2.
    await request(server()).patch(`/businesses/${unsure.id}`).set(as(managerToken))
      .send({ street: 'Fort road, Chitradurga', reason: 'address corrected' }).expect(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: unsure.id } })).minimumWageZone).toBe(2);
  });

  it('office staff set the zone with a reason; it is kept on address edits and open vacancies are checked again', async () => {
    const shop = await business(3, { city: 'Bengaluru', pincode: '560011', minimumWageZone: 1 });
    // ₹22,000 for housekeeping: below Zone 1's unskilled minimum, above Zone 2's (₹21,251.30).
    const vacancy = await request(server()).post(`/businesses/${shop.id}/vacancies`).set(as(callAgentToken))
      .send({ tradeSkill: 'Housekeeping', salaryMinPaise: 2200000, headcount: 1, shift: 'day', ownerToldMinimumWage: true }).expect(201);
    expect(vacancy.body.belowLegalMinimum).toBe(true);

    const url = `/businesses/${shop.id}/minimum-wage-zone`;
    await request(server()).patch(url).set(as(callAgentToken)).send({ zone: 2, reason: 'Mysuru branch' }).expect(403);
    await request(server()).patch(url).set(as(otherTeamLeadToken)).send({ zone: 2, reason: 'not my team' }).expect(403);
    await request(server()).patch(url).set(as(teamLeadToken)).send({ zone: 2 }).expect(400);
    await request(server()).patch(url).set(as(teamLeadToken)).send({ zone: 4, reason: 'wrong' }).expect(400);

    const set = await request(server()).patch(url).set(as(teamLeadToken)).send({ zone: 2, reason: 'The shop is in Mysuru' }).expect(200);
    expect(set.body).toMatchObject({ minimumWageZone: 2, minimumWageZoneSource: 'staff', vacanciesRechecked: 1 });
    const rechecked = await prisma.vacancy.findUniqueOrThrow({ where: { id: vacancy.body.id } });
    expect(rechecked).toMatchObject({ belowLegalMinimum: false, legalMinimumPaise: 2125130, ownerToldMinimumWage: true });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'business.minimum_wage_zone_set', entityCode: shop.code } });
    expect(audit).toMatchObject({ reason: 'The shop is in Mysuru' });

    // A staff-set zone is kept when the address changes.
    await request(server()).patch(`/businesses/${shop.id}`).set(as(managerToken)).send({ pincode: '560012', reason: 'pin corrected' }).expect(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: shop.id } })).minimumWageZone).toBe(2);

    await request(server()).patch(url).set(as(managerToken)).send({ zone: 3, reason: 'Village outside Mysuru' }).expect(200);
    await request(server()).patch(url).set(as(ceoToken)).send({ zone: '1', reason: 'Back in Bengaluru' }).expect(200);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: shop.id } })).minimumWageZone).toBe(1);

    const detail = await request(server()).get(`/ceo/businesses/${shop.id}`).set(as(ceoToken)).expect(200);
    expect(detail.body).toMatchObject({ minimumWageZone: 1, minimumWageZoneSource: 'staff' });
  });

  it('the CEO edits all twelve figures; the minimum wage page shows the three zones', async () => {
    const body = {
      unskilledPaise: 2337643, semiSkilledPaise: 2571407, skilledPaise: 2828547, highlySkilledPaise: 3111402,
      zone2UnskilledPaise: 2125131, zone2SemiSkilledPaise: 2337644, zone2SkilledPaise: 2571408, zone2HighlySkilledPaise: 2828548,
      zone3UnskilledPaise: 1931937, effectiveFrom: '2026-05-22T00:00:00.000Z',
    };
    await request(server()).put('/pricing/legal-minimum-wages').set(as(managerToken)).send(body).expect(403);
    await request(server()).put('/pricing/legal-minimum-wages').set(as(ceoToken)).send({ ...body, zone3SkilledPaise: 0 }).expect(400);
    const saved = await request(server()).put('/pricing/legal-minimum-wages').set(as(ceoToken)).send(body).expect(200);
    expect(saved.body).toMatchObject({
      legalMinimumWageZone2UnskilledPaise: 2125131, legalMinimumWageZone2HighlySkilledPaise: 2828548,
      legalMinimumWageZone3UnskilledPaise: 1931937,
      // Left out: kept.
      legalMinimumWageZone3SemiSkilledPaise: 2125130, legalMinimumWageZone3HighlySkilledPaise: 2571407,
    });
    const page = await request(server()).get('/ceo/pricing/minimum-wage').set(as(ceoToken)).expect(200);
    expect(page.body.unskilledPaise).toBe(2337643);
    expect(page.body.zones['2']).toMatchObject({ unskilledPaise: 2125131, skilledPaise: 2571408 });
    expect(page.body.zones['3']).toMatchObject({ unskilledPaise: 1931937, highlySkilledPaise: 2571407 });
    expect(typeof page.body.zones['1'].businesses).toBe('number');
  });
});
