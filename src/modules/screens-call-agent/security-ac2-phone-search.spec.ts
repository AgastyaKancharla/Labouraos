import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FULL_NUMBER_SEARCH_ACTION, FULL_NUMBER_SEARCHES_PER_HOUR } from '../../common/phone/full-number-search';

/**
 * Security AC-2 (proved on the range in 17 requests): the search bar matched
 * any 4-to-9-digit suffix, so a call agent could rebuild a full number one
 * digit at a time from the result counts. Now: exactly the last 4 digits, or
 * a full number — and every full-number search is audited and limited per
 * staff member.
 */
describe('Security AC-2: phone search accepts only the last 4 digits or a full number', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token = '';
  let agentId = '';
  const suffix = Date.now().toString().slice(-6);
  const ten = `97${suffix.slice(-4)}5${suffix.slice(-3)}`; // 10 digits starting with 9
  const phone = `+91${ten}`;
  let seekerId = '';
  let businessId = '';

  const search = (q: string) => request(app.getHttpServer()).get('/search').query({ q }).set('Authorization', `Bearer ${token}`);
  const businesses = (q: string) =>
    request(app.getHttpServer()).get('/screens/call-registration/businesses').query({ q }).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const agent = await prisma.staff.create({
      data: { code: `AC2CA-${suffix}`, name: 'AC2 Agent', email: `ac2_${suffix}@laboura.local`, passwordHash: 'hash', role: 'call_agent', city: 'Bengaluru' },
    });
    agentId = agent.id;
    token = await app.get(JwtService).signAsync({ sub: agent.id, role: 'call_agent', email: agent.email, code: agent.code });
    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-AC2-${suffix}`, name: 'AC2 Seeker', phone, city: 'Bengaluru', minSalary: 1, maxSalary: 2, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' },
    });
    seekerId = seeker.id;
    const business = await prisma.business.create({
      // The name is searched with "contains": spelled in letters, so a 5–9 digit phone tail can never
      // match the time-stamp digits in it (a name with the digits made the test fail ~1 run in 100).
      data: { code: `BZ-AC2-${suffix}`, name: `AC2 Shop ${suffix.replace(/\d/g, (d) => 'abcdefghij'[Number(d)])}`, phone: `+91${ten.slice(0, 9)}${(Number(ten[9]) + 1) % 10}`, city: 'Bengaluru' },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { actorId: agentId } }).catch(() => undefined);
      await prisma.jobSeeker.deleteMany({ where: { id: seekerId } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: businessId } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: agentId } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  it('5 to 9 trailing digits find nothing (no suffix oracle), on the search bar and the CA09 business picker', async () => {
    for (let n = 5; n <= 9; n += 1) {
      const res = await search(ten.slice(-n)).expect(200);
      expect([n, res.body.kind, res.body.counts.all]).toEqual([n, null, 0]);
      const picker = await businesses(ten.slice(-n)).expect(200);
      expect([n, picker.body.length]).toEqual([n, 0]);
    }
  });

  it('the last 4 digits still search, without an audit row', async () => {
    const res = await search(ten.slice(-4)).expect(200);
    expect(res.body.kind).toBe('phone');
    expect(res.body.results.some((r: { id: string }) => r.id === seekerId)).toBe(true);
    expect(await prisma.auditLog.count({ where: { actorId: agentId, action: FULL_NUMBER_SEARCH_ACTION } })).toBe(0);
  });

  it('a full number finds the record, is audited with the last 4 only, and is limited per staff member', async () => {
    const res = await search(ten).expect(200);
    expect(res.body.results.some((r: { id: string; maskedPhone: string }) => r.id === seekerId && !r.maskedPhone.includes(ten.slice(0, 6)))).toBe(true);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { actorId: agentId, action: FULL_NUMBER_SEARCH_ACTION } });
    expect(JSON.stringify(row.after)).not.toContain(ten);
    expect(JSON.stringify(row.after)).toContain(ten.slice(-4));

    for (let i = 1; i < FULL_NUMBER_SEARCHES_PER_HOUR; i += 1) await search(ten).expect(200);
    const refused = await search(ten);
    expect(refused.status).toBe(429);
    // The CA09 picker shares the same budget.
    expect((await businesses(`+91 ${ten}`)).status).toBe(429);
    // The last 4 digits are not limited.
    await search(ten.slice(-4)).expect(200);
  });
});
