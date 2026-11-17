import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

jest.setTimeout(120000);

type Who = { id: string; role: string; code: string };

/**
 * Shifts per business (17 Nov, Master Guide rev 193): staff routes scoped by
 * the business write rule, audit-logged, and a vacancy that picks a shift
 * keeps its label and times.
 */
describe('Business shifts (staff)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  let n = 0;

  const token = (w: Who) => `Bearer ${jwt.sign({ sub: w.id, role: w.role, code: w.code, email: null })}`;
  const call = (w: Who, method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) => {
    const r = request(app.getHttpServer())[method](path).set('Authorization', token(w));
    return body ? r.send(body) : r;
  };

  async function staff(role: string, teamLeadId?: string): Promise<Who> {
    n += 1;
    const s = await prisma.staff.create({
      data: { code: `SH-${role.slice(0, 2).toUpperCase()}-${stamp}-${n}`, name: `Shift ${role} ${n}`, email: `shift-${role}-${stamp}-${n}@laboura.local`, passwordHash: 'x', role, status: 'active', teamLeadId: teamLeadId ?? null },
    });
    staffIds.push(s.id);
    return s;
  }

  async function business(fields: { accountAgentId?: string | null; leadCreatedByStaffId?: string | null; verificationStatus?: string }) {
    n += 1;
    const b = await prisma.business.create({
      data: {
        code: `BZ-SH${tag}${n}`, name: `Shift Shop ${n}`, phone: `+9197${tag}${String(n).padStart(2, '0')}`, phoneVerified: true,
        latitude: 12.93, longitude: 77.63, locality: 'Jayanagar', verificationStatus: fields.verificationStatus ?? 'verified',
        accountAgentId: fields.accountAgentId ?? null, leadCreatedByStaffId: fields.leadCreatedByStaffId ?? null, leadChannel: 'field_visit',
      },
    });
    businessIds.push(b.id);
    return b;
  }

  let lead: Who;
  let agent: Who;
  let otherAgent: Who;
  let callAgent: Who;
  let outsider: Who;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    lead = await staff('team_lead');
    agent = await staff('field_agent', lead.id);
    otherAgent = await staff('field_agent', lead.id);
    callAgent = await staff('call_agent', lead.id);
    const otherLead = await staff('team_lead');
    outsider = await staff('field_agent', otherLead.id);
  });

  afterAll(async () => {
    await prisma.vacancy.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('the account agent adds, changes and removes shifts; another agent can read but not change them; all audit-logged', async () => {
    const shop = await business({ accountAgentId: agent.id, leadCreatedByStaffId: agent.id });
    const base = `/businesses/${shop.id}/shifts`;
    const morning = await call(agent, 'post', base, { name: 'Morning', startTime: '07:00', endTime: '15:00' }).expect(201);
    expect(morning.body).toEqual(expect.objectContaining({ businessId: shop.id, label: 'Morning 07:00–15:00', category: 'day' }));
    const bad = await call(agent, 'post', base, { name: 'Broken', startTime: '9am', endTime: '17:00' }).expect(400);
    expect(bad.body.code ?? bad.body.details?.code).toBe('SHIFT_INVALID');
    const dup = await call(agent, 'post', base, { name: 'Morning', startTime: '06:00', endTime: '14:00' }).expect(409);
    expect(dup.body.code ?? dup.body.details?.code).toBe('SHIFT_NAME_TAKEN');
    await call(agent, 'patch', `${base}/${morning.body.id}`, { name: 'Early' }).expect(200);

    // By code too; any field agent reads; only the account agent's side changes.
    const read = await call(otherAgent, 'get', `/businesses/${shop.code}/shifts`).expect(200);
    expect(read.body.map((s: { name: string }) => s.name)).toEqual(['Early']);
    await call(otherAgent, 'post', base, { name: 'Evening', startTime: '15:00', endTime: '23:00' }).expect(403);
    await call(otherAgent, 'patch', `${base}/${morning.body.id}`, { name: 'Mine now' }).expect(403);
    await call(otherAgent, 'delete', `${base}/${morning.body.id}`).expect(403);
    // Team Lead of the agent's team may; a Team Lead's field agent outside the team may not.
    await call(lead, 'post', base, { name: 'Evening', startTime: '15:00', endTime: '23:00' }).expect(201);
    await call(outsider, 'post', base, { name: 'Late', startTime: '16:00', endTime: '00:00' }).expect(403);
    // A shift id from another business is not found here.
    const elsewhere = await business({ accountAgentId: agent.id });
    const foreign = await call(agent, 'post', `/businesses/${elsewhere.id}/shifts`, { name: 'Night', startTime: '22:00', endTime: '06:00' }).expect(201);
    await call(agent, 'delete', `${base}/${foreign.body.id}`).expect(404);

    await call(agent, 'delete', `${base}/${morning.body.id}`).expect(200);
    const actions = (await prisma.auditLog.findMany({ where: { entityCode: shop.code, action: { startsWith: 'business.shift_' } }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['business.shift_added', 'business.shift_changed', 'business.shift_added', 'business.shift_removed']);
  });

  it('a call agent edits shifts on his own lead (the business write rule)', async () => {
    const leadShop = await business({ leadCreatedByStaffId: callAgent.id, verificationStatus: 'lead' });
    await call(callAgent, 'post', `/businesses/${leadShop.id}/shifts`, { name: 'Day', startTime: '09:00', endTime: '18:00' }).expect(201);
    const theirs = await business({ accountAgentId: agent.id });
    await call(callAgent, 'post', `/businesses/${theirs.id}/shifts`, { name: 'Day', startTime: '09:00', endTime: '18:00' }).expect(403);
  });

  it('a vacancy picks one of its business\'s shifts and keeps the label and times; a typed shift drops the pick', async () => {
    const shop = await business({ accountAgentId: agent.id });
    const night = await call(agent, 'post', `/businesses/${shop.id}/shifts`, { name: 'Night', startTime: '22:00', endTime: '06:00' }).expect(201);
    const day = await call(agent, 'post', `/businesses/${shop.id}/shifts`, { name: 'Day', startTime: '09:00', endTime: '18:00' }).expect(201);
    const other = await business({ accountAgentId: agent.id });
    const foreign = await call(agent, 'post', `/businesses/${other.id}/shifts`, { name: 'X', startTime: '10:00', endTime: '19:00' }).expect(201);
    const body = { businessId: shop.id, tradeSkill: 'Security guard', headcount: 1, salaryMinPaise: 3000000, salaryPeriod: 'monthly', startDate: '2026-12-01', interviewType: 'walk_in' };

    await call(agent, 'post', '/vacancies', { ...body, businessShiftId: foreign.body.id }).expect(400);
    const created = await call(agent, 'post', '/vacancies', { ...body, businessShiftId: night.body.id }).expect(201);
    let row = await prisma.vacancy.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toEqual(expect.objectContaining({ shift: 'Night 22:00–06:00', businessShiftId: night.body.id, shiftStartTime: '22:00', shiftEndTime: '06:00' }));

    await call(agent, 'patch', `/vacancies/${row.id}`, { businessShiftId: day.body.id, reason: 'Owner moved it to the day shift' }).expect(200);
    row = await prisma.vacancy.findUniqueOrThrow({ where: { id: row.id } });
    expect(row).toEqual(expect.objectContaining({ shift: 'Day 09:00–18:00', businessShiftId: day.body.id, shiftStartTime: '09:00', shiftEndTime: '18:00' }));

    await call(agent, 'patch', `/vacancies/${row.id}`, { shift: 'night', reason: 'Owner said night, no fixed times' }).expect(200);
    row = await prisma.vacancy.findUniqueOrThrow({ where: { id: row.id } });
    expect(row).toEqual(expect.objectContaining({ shift: 'night', businessShiftId: null, shiftStartTime: null, shiftEndTime: null }));

    // An older vacancy with a free-text shift still shows it.
    const old = await call(agent, 'post', '/vacancies', { ...body, shift: 'Morning 6 to 2' }).expect(201);
    expect((await prisma.vacancy.findUniqueOrThrow({ where: { id: old.body.id } })).shift).toBe('Morning 6 to 2');
  });
});
