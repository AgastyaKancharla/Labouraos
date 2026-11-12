import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(180000);

/** Keys that must never appear in any answer (security check 12 Nov, P1). */
const SECRET_KEY = /"(passwordHash|totpSecret|totpLastStep|[A-Za-z]*[tT]okenHash)"\s*:/;

/**
 * P1: `GET /telephony/callbacks` used to return the whole staff row (password
 * hash, TOTP secret, invite token hash) and every job seeker to every agent.
 * Now it selects only what a row shows, is scoped by the reporting line, and
 * the response interceptor strips account secrets from every answer for every
 * role. This scans the main list endpoints for those keys.
 */
describe('No account secrets in any response; the callback queue is scoped', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = `${Date.now()}`;
  const tail = stamp.slice(-7);
  const staffIds: string[] = [];
  const callbackIds: string[] = [];
  const seekerIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function makeStaff(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `SEC-${key}-${stamp}`,
        name: `Sec ${key}`,
        email: `sec-${key}-${stamp}@laboura.local`,
        passwordHash: '$2b$04$secrethashsecrethashsecrethashsecrethashsecrethashsecr',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        totpEnabled: true,
        totpLastStep: 123,
        inviteTokenHash: `invite-hash-${key}-${stamp}`,
        inviteUsedTokenHash: `used-hash-${key}-${stamp}`,
        role,
        status: 'active',
        ...extra,
      },
    });
    staffIds.push(staff.id);
    ids[key] = staff.id;
    tokens[key] = jwt.sign({ sub: staff.id, email: staff.email, role, code: staff.code, teamLeadId: (extra.teamLeadId as string) ?? null });
    return staff;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    const ceo = await makeStaff('ceo', 'ceo');
    const mgr = await makeStaff('mgr', 'manager', { reportsToId: ceo.id });
    const tl = await makeStaff('tl', 'team_lead', { reportsToId: mgr.id });
    const otherTl = await makeStaff('tl2', 'team_lead', { reportsToId: mgr.id });
    await makeStaff('ca', 'call_agent', { reportsToId: tl.id, teamLeadId: tl.id });
    await makeStaff('ca2', 'call_agent', { reportsToId: otherTl.id, teamLeadId: otherTl.id });
    await makeStaff('fin', 'finance', { reportsToId: ceo.id });

    const seeker = await prisma.jobSeeker.create({
      data: { code: `JS-SEC-${tail}`, name: 'Secret Seeker', phone: `+9193${tail}1`.slice(0, 13), minSalary: 1500000, maxSalary: 2000000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', status: 'active' },
    });
    seekerIds.push(seeker.id);
    for (const [key, assigned] of [['mine', ids.ca], ['other', ids.ca2], ['open', null]] as const) {
      const cb = await prisma.callbackTask.create({
        data: { callId: `sec-${key}-${stamp}`, phone: `+9194${tail}2`.slice(0, 13), jobSeekerId: seeker.id, assignedToStaffId: assigned, status: assigned ? 'assigned' : 'pending' },
      });
      callbackIds.push(cb.id);
      ids[`cb_${key}`] = cb.id;
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.callbackTask.deleteMany({ where: { id: { in: callbackIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokens[who]}`);

  it('the callback queue returns only id, code and name for staff, and is scoped by the reporting line', async () => {
    const seen = async (who: string) => {
      const res = await get('/telephony/callbacks', who).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(SECRET_KEY);
      return res.body as Array<{ id: string; assignedToStaff: Record<string, unknown> | null; jobSeeker: Record<string, unknown> | null }>;
    };
    const ceoRows = await seen('ceo');
    const mine = ceoRows.find((r) => r.id === ids.cb_mine)!;
    expect(Object.keys(mine.assignedToStaff!).sort()).toEqual(['code', 'id', 'name']);
    expect(Object.keys(mine.jobSeeker!).sort()).toEqual(['code', 'id', 'name', 'phone', 'status']);

    const has = (rows: Array<{ id: string }>, key: string) => rows.some((r) => r.id === ids[key]);
    const agentRows = await seen('ca');
    expect([has(agentRows, 'cb_mine'), has(agentRows, 'cb_open'), has(agentRows, 'cb_other')]).toEqual([true, true, false]);
    const tlRows = await seen('tl');
    expect([has(tlRows, 'cb_mine'), has(tlRows, 'cb_open'), has(tlRows, 'cb_other')]).toEqual([true, true, false]);
    const mgrRows = await seen('mgr');
    expect([has(mgrRows, 'cb_mine'), has(mgrRows, 'cb_open'), has(mgrRows, 'cb_other')]).toEqual([true, true, true]);
    expect([has(ceoRows, 'cb_mine'), has(ceoRows, 'cb_open'), has(ceoRows, 'cb_other')]).toEqual([true, true, true]);
  });

  it('no main list endpoint answers with a password hash, TOTP secret or token hash, for any role', async () => {
    const endpoints: Record<string, string[]> = {
      ceo: ['/staff', `/staff/${ids.ca}`, '/staff/reporting-tree', '/ceo/team', '/telephony/callbacks', '/job-seekers', '/businesses', '/notifications/bell', '/staff/password-resets'],
      mgr: ['/staff', `/staff/${ids.ca}`, '/manager/staff', '/telephony/callbacks', '/job-seekers', '/notifications/bell'],
      tl: ['/staff', '/team-lead/team', '/telephony/callbacks', '/job-seekers', '/notifications/bell'],
      ca: ['/telephony/callbacks', '/job-seekers', '/notifications/bell'],
      fin: ['/staff', '/notifications/bell'],
    };
    let answered = 0;
    for (const [who, paths] of Object.entries(endpoints)) {
      for (const path of paths) {
        const res = await get(path, who);
        if (res.status >= 400) continue; // Not this role's screen: nothing to scan.
        answered += 1;
        expect({ who, path, leak: SECRET_KEY.test(JSON.stringify(res.body)) }).toEqual({ who, path, leak: false });
      }
    }
    expect(answered).toBeGreaterThanOrEqual(10);
  });
});
