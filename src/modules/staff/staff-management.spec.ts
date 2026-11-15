import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatCode } from '../../common/id/id.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { StaffService } from './staff.service';
import { TEMP_PASSWORD_TTL_MS, normaliseTemporaryPassword } from '../../common/auth/temporary-password';
import { TEMP_PASSWORD_EXPIRED } from '../../common/auth/auth.service';
import { takeSetupSelfie } from '../../test-support/setup-selfie';

const TEMP_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

type Actor = { id: string; code: string; email: string; role: string };

describe('Phase 8 Task 9: Staff account management', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let staffService: StaffService;

  const ts = Date.now();
  const goodPassword = 'Correct-Horse-Battery-9';
  const createdStaffIds: string[] = [];
  let ipCounter = 0;

  let ceo: Actor;
  let manager: Actor;
  let teamLead: Actor;
  let callAgent: Actor;
  let fieldAgent: Actor;
  let finance: Actor;
  const tokens: Record<string, string> = {};

  // Each call comes from its own simulated client IP (as reported by the one
  // trusted proxy) so the per-IP throttle (5/min) does not couple tests together.
  const freshIp = () => `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  async function mkStaff(
    role: string,
    extra: Partial<{ teamLeadId: string; status: string; reportsToId: string }> = {},
  ): Promise<Actor> {
    const email = `t9_${role}_${ts}_${createdStaffIds.length}@laboura.local`;
    const staff = await prisma.staff.create({
      data: {
        code: `T9-${role.toUpperCase()}-${ts}-${createdStaffIds.length}`,
        name: `T9 ${role}`,
        email,
        role,
        passwordHash: await bcrypt.hash(goodPassword, 4),
        ...extra,
      },
    });
    createdStaffIds.push(staff.id);
    return { id: staff.id, code: staff.code, email, role };
  }

  async function mkToken(actor: Actor): Promise<string> {
    const session = await prisma.staffSession.create({
      data: {
        staffId: actor.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });
    const payload: JwtPayload = {
      sub: actor.id,
      role: actor.role,
      email: actor.email,
      code: actor.code,
      teamLeadId: null,
      sid: session.id,
    };
    return jwt.sign(payload, { expiresIn: '15m' });
  }

  const auth = (actor: Actor) => `Bearer ${tokens[actor.id]}`;

  async function createViaApi(
    actor: Actor,
    body: Record<string, unknown>,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', auth(actor))
      .send(body);
  }

  const newHire = (role: string, extra: Record<string, unknown> = {}) => ({
    name: `New ${role}`,
    email: `hire_${role}_${ts}_${ipCounter++}@laboura.local`,
    role,
    ...extra,
  });

  /** First login (rev 174–175): staff code + temporary password → set-up ticket → the new password. */
  async function startSetup(h: { code: string; tempPassword: string }) {
    const start = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: h.code, password: h.tempPassword, deviceId: `setup-${h.code}` });
    // The live selfie comes first whenever none is on file.
    if (start.body?.status === 'setup_required') await takeSetupSelfie(app, start.body, `setup-${h.code}`);
    return start;
  }
  async function accept(h: { code: string; tempPassword: string }, password = goodPassword) {
    const start = await startSetup(h);
    if (start.body?.status !== 'setup_required') return start;
    return request(app.getHttpServer())
      .post('/auth/setup/complete')
      .set('X-Forwarded-For', freshIp())
      .send({ setupTicket: start.body.setupTicket, deviceId: `setup-${h.code}`, newPassword: password });
  }

  async function login(email: string | null, passwordForLogin: string) {
    const row = email
      ? await prisma.staff.findUnique({
          where: { email },
          select: { id: true, code: true, role: true },
        })
      : null;
    const deviceId = 'staff-mgmt-device';
    // Only the CEO approves his own device; Managers and Finance need an
    // approved device like everyone else (decided 11 Nov).
    if (row && row.role !== 'ceo') {
      await prisma.staffDevice.upsert({
        where: { staffId_deviceId: { staffId: row.id, deviceId } },
        create: {
          staffId: row.id,
          deviceId,
          label: 'Staff management test',
          platform: 'web',
          status: 'approved',
          approvedAt: new Date(),
        },
        update: { status: 'approved', revokedAt: null },
      });
    }
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({
        staffCode: row?.code ?? 'missing-staff-code',
        password: passwordForLogin,
        deviceId,
      });
    if (res.body?.status !== 'awaiting_code') {
      return res;
    }
    return request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .set('X-Forwarded-For', freshIp())
      .send({
        loginRequestId: res.body.loginRequestId,
        code: loginCodeFor(res.body.loginRequestId),
        deviceId: deviceId,
        loginRequestProof: res.body.loginRequestProof,
      });
  }

  /** Creates a hire through the API and tracks it for cleanup. */
  async function hire(role = 'call_agent', extra: Record<string, unknown> = {}) {
    const line =
      role === 'call_agent' || role === 'field_agent'
        ? { teamLeadId: teamLead.id }
        : role === 'team_lead'
          ? { reportsToId: manager.id }
          : role === 'manager' || role === 'finance'
            ? { reportsToId: ceo.id }
            : {};
    const res = await createViaApi(ceo, newHire(role, { ...line, ...extra }));
    expect(res.status).toBe(201);
    createdStaffIds.push(res.body.staff.id);
    return {
      id: res.body.staff.id as string,
      code: res.body.staff.code as string,
      email: res.body.staff.email as string,
      role,
      tempPassword: res.body.tempPassword as string,
      body: res.body,
    };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Behave as if behind one real proxy: the X-Forwarded-For entry it appends
    // is trusted, so each simulated client IP gets its own throttle bucket.
    applyTrustProxy(app, '1');
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    staffService = app.get(StaffService);

    ceo = await mkStaff('ceo');
    manager = await mkStaff('manager');
    teamLead = await mkStaff('team_lead');
    callAgent = await mkStaff('call_agent');
    fieldAgent = await mkStaff('field_agent');
    finance = await mkStaff('finance');
    // A Manager acts only inside their own tree, so the shared Team Lead
    // reports to the shared Manager, and the Manager to the CEO.
    await prisma.staff.update({ where: { id: manager.id }, data: { reportsToId: ceo.id } });
    await prisma.staff.update({ where: { id: teamLead.id }, data: { reportsToId: manager.id } });
    await prisma.staff.update({ where: { id: finance.id }, data: { reportsToId: ceo.id } });
    for (const a of [ceo, manager, teamLead, callAgent, fieldAgent, finance]) {
      tokens[a.id] = await mkToken(a);
    }
  });

  afterAll(async () => {
    const ids = createdStaffIds.filter(Boolean);
    const staff = await prisma.staff.findMany({
      where: { id: { in: ids } },
      select: { code: true },
    });
    const codes = staff.map((s) => s.code);
    await prisma.staffSession.deleteMany({
      where: { staffId: { in: ids } },
    });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'staff', subjectId: { in: ids } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffAwayPeriod.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: ids } },
          { entityType: 'staff', entityCode: { in: codes } },
        ],
      },
    });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  describe('POST /staff — creation', () => {
    it('CEO creates a call agent: role-prefixed code, "Not signed in yet", temporary password returned once', async () => {
      const h = await hire('call_agent');

      expect(h.body.staff.code).toMatch(/^CA-\d{5}$/);
      expect(h.body.staff.status).toBe('pending_invite');
      expect(h.tempPassword).toMatch(TEMP_FORMAT);
      expect(new Date(h.body.tempPasswordExpiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('Manager can create a field agent without an assigned area', async () => {
      const res = await createViaApi(
        manager,
        newHire('field_agent', { teamLeadId: teamLead.id }),
      );
      createdStaffIds.push(res.body.staff?.id);

      expect(res.status).toBe(201);
      expect(res.body.staff.code).toMatch(/^FA-\d{5}$/);
      expect(res.body.staff).not.toHaveProperty('area');
      expect(res.body.staff.teamLeadId).toBe(teamLead.id);
    });

    it('never returns or stores secrets: no hash in the response, the temporary password stored only as a bcrypt hash', async () => {
      const h = await hire('finance');

      const raw = JSON.stringify(h.body);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('tempPasswordHash');
      expect(raw).not.toContain('totpSecret');

      const row = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
      expect(row.tempPasswordHash).toMatch(/^\$2[aby]\$/);
      expect(await bcrypt.compare(normaliseTemporaryPassword(h.tempPassword)!, row.tempPasswordHash!)).toBe(true);
      expect(JSON.stringify(row)).not.toContain(h.tempPassword);
      expect(JSON.stringify(row)).not.toContain(normaliseTemporaryPassword(h.tempPassword)!);
      // The creator never sets the password: the stored hash matches no input
      expect(await bcrypt.compare(goodPassword, row.passwordHash)).toBe(false);
    });

    it('the temporary password ends exactly 24 hours after creation (injectable clock)', async () => {
      const at = new Date('2026-01-10T00:00:00.000Z');
      const result = await staffService.createStaff(
        newHire('call_agent', { teamLeadId: teamLead.id }),
        { sub: ceo.id, role: 'ceo' } as JwtPayload,
        at,
      );
      createdStaffIds.push(result.staff.id);

      expect(result.tempPasswordExpiresAt.getTime()).toBe(at.getTime() + TEMP_PASSWORD_TTL_MS);
    });

    it('normalises the email to lower case', async () => {
      const body = newHire('call_agent', { teamLeadId: teamLead.id });
      const res = await createViaApi(ceo, {
        ...body,
        email: body.email.toUpperCase(),
      });
      createdStaffIds.push(res.body.staff?.id);

      expect(res.status).toBe(201);
      expect(res.body.staff.email).toBe(body.email.toLowerCase());
    });

    it('audit-logs staff creation with actor, before/after and no secrets', async () => {
      const h = await hire('call_agent');

      const log = await prisma.auditLog.findFirst({
        where: { action: 'staff.created', entityCode: h.code },
      });
      expect(log).not.toBeNull();
      expect(log!.actorId).toBe(ceo.id);
      expect(log!.before).toBeNull();
      expect(log!.after).toMatchObject({
        code: h.code,
        role: 'call_agent',
        status: 'pending_invite',
      });
      expect(JSON.stringify(log!.after)).not.toContain(h.tempPassword);
      expect(JSON.stringify(log!.after)).not.toContain('Hash');
    });

    it.each([
      ['missing name', { name: '  ' }],
      ['invalid email', { email: 'not-an-email' }],
      ['unknown role', { role: 'superuser' }],
    ])('rejects %s with 400', async (_label, override) => {
      const res = await createViaApi(ceo, {
        ...newHire('call_agent'),
        ...override,
      });
      expect(res.status).toBe(400);
    });

    it('does not require or return a legacy area for a field agent', async () => {
      const body = newHire('field_agent', { teamLeadId: teamLead.id });
      const res = await createViaApi(ceo, body);
      createdStaffIds.push(res.body.staff?.id);
      expect(res.status).toBe(201);
      expect(res.body.staff).not.toHaveProperty('area');
    });

    it('rejects a duplicate email with 409', async () => {
      const h = await hire('call_agent');
      const res = await createViaApi(ceo, {
        ...newHire('call_agent', { teamLeadId: teamLead.id }),
        email: h.email,
      });
      expect(res.status).toBe(409);
    });

    it('teamLeadId must reference an active team lead, and only for call/field agents', async () => {
      const notALead = await createViaApi(
        ceo,
        newHire('call_agent', { teamLeadId: callAgent.id }),
      );
      expect(notALead.status).toBe(400);

      const unknown = await createViaApi(
        ceo,
        newHire('call_agent', { teamLeadId: '00000000-0000-0000-0000-000000000000' }),
      );
      expect(unknown.status).toBe(400);

      const gone = await mkStaff('team_lead', { status: 'deactivated' });
      const deactivatedLead = await createViaApi(
        ceo,
        newHire('call_agent', { teamLeadId: gone.id }),
      );
      expect(deactivatedLead.status).toBe(400);

      const wrongRole = await createViaApi(
        ceo,
        newHire('finance', { teamLeadId: teamLead.id }),
      );
      expect(wrongRole.status).toBe(400);
    });

    it('only a CEO can create ceo or manager accounts (Manager gets 403)', async () => {
      for (const role of ['ceo', 'manager']) {
        const res = await createViaApi(manager, newHire(role));
        expect(res.status).toBe(403);
      }

      const ok = await createViaApi(ceo, newHire('manager', { reportsToId: ceo.id }));
      createdStaffIds.push(ok.body.staff?.id);
      expect(ok.status).toBe(201);
    });

    it('still gets a unique code when the next sequence value is already taken by another row', async () => {
      const [{ last_value, is_called }] = await prisma.$queryRawUnsafe<
        { last_value: bigint; is_called: boolean }[]
      >('SELECT last_value, is_called FROM "seq_id_fin"');
      const next = Number(last_value) + (is_called ? 1 : 0);
      const squatter = await prisma.staff.create({
        data: {
          code: formatCode('FIN', next),
          name: 'Code squatter',
          email: `squatter_${ts}@laboura.local`,
          role: 'finance',
          passwordHash: 'x',
        },
      });
      createdStaffIds.push(squatter.id);

      const h = await hire('finance');

      expect(h.code).not.toBe(squatter.code);
      expect(h.code).toMatch(/^FIN-\d{5}$/);
    });
  });

  describe('First login — a new account cannot sign in until it finishes set-up with its temporary password', () => {
    it('no session whatever password is tried; the temporary password gives only a set-up ticket', async () => {
      const h = await hire('call_agent');
      for (const guess of [goodPassword, 'password123456']) {
        const res = await login(h.email, guess);
        expect(res.status).toBe(401);
        expect(res.body.accessToken).toBeUndefined();
      }
      const start = await startSetup(h);
      expect(start.status).toBe(200);
      expect(start.body.status).toBe('setup_required');
      expect(start.body.accessToken).toBeUndefined();
    });

    it('finishing set-up sets the hire’s own password and activates the account', async () => {
      const h = await hire('call_agent');
      const accepted = await accept(h);
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ success: true, code: h.code });
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
      expect(row.status).toBe('active');
      expect(row.tempPasswordHash).toBeNull();
      expect(row.tempPasswordExpiresAt).toBeNull();
      const loggedIn = await login(h.email, goodPassword);
      expect(loggedIn.status).toBe(200);
      expect(loggedIn.body.accessToken).toBeDefined();
      expect(loggedIn.body.staff.code).toBe(h.code);
    });

    it('audit-logs the set-up with the new hire as actor', async () => {
      const h = await hire('call_agent');
      await accept(h);
      const log = await prisma.auditLog.findFirst({ where: { action: 'staff.setup_completed', entityCode: h.code } });
      expect(log).not.toBeNull();
      expect(log!.actorId).toBe(h.id);
      expect(log!.before).toMatchObject({ status: 'pending_invite' });
      expect(log!.after).toMatchObject({ status: 'active' });
    });

    it('the temporary password works once: a second set-up fails and cannot change the password', async () => {
      const h = await hire('call_agent');
      expect((await accept(h)).status).toBe(200);
      const second = await accept(h, 'Attacker-Chosen-Pass-1');
      expect(second.status).toBe(401);
      expect((await login(h.email, 'Attacker-Chosen-Pass-1')).status).toBe(401);
      expect((await login(h.email, goodPassword)).status).toBe(200);
    });

    it('two simultaneous completions with one ticket: exactly one wins', async () => {
      const h = await hire('call_agent');
      const start = await startSetup(h);
      const done = (password: string) =>
        request(app.getHttpServer())
          .post('/auth/setup/complete')
          .set('X-Forwarded-For', freshIp())
          .send({ setupTicket: start.body.setupTicket, deviceId: `setup-${h.code}`, newPassword: password });
      const results = await Promise.all([done('First-Password-Chosen-1'), done('Second-Password-Chosen-2')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('an expired temporary password is refused and the account stays "Not signed in yet"', async () => {
      const h = await hire('call_agent');
      await prisma.staff.update({ where: { id: h.id }, data: { tempPasswordExpiresAt: new Date(Date.now() - 60_000) } });
      const res = await startSetup(h);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe(TEMP_PASSWORD_EXPIRED);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
      expect(row.status).toBe('pending_invite');
    });

    it('rejects unknown and empty set-up tickets with the same answer', async () => {
      for (const setupTicket of ['f'.repeat(64), '', '   ']) {
        const res = await request(app.getHttpServer())
          .post('/auth/setup/complete')
          .set('X-Forwarded-For', freshIp())
          .send({ setupTicket, deviceId: 'any', newPassword: goodPassword });
        expect(res.status).toBe(401);
        expect(res.body.message).toContain('This set-up has ended');
      }
    });

    it('rejects too-short (under 8) and over-long passwords, leaving the temporary password usable', async () => {
      const h = await hire('call_agent');
      const start = await startSetup(h);
      const send = (newPassword: string) =>
        request(app.getHttpServer())
          .post('/auth/setup/complete')
          .set('X-Forwarded-For', freshIp())
          .send({ setupTicket: start.body.setupTicket, deviceId: `setup-${h.code}`, newPassword });
      const short = await send('short12');
      expect(short.status).toBe(400);
      expect(short.body.message).toContain('at least 8 characters');
      expect((await send('a'.repeat(73))).status).toBe(400);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
      expect(row.status).toBe('pending_invite');
      expect((await send('eight-ch')).status).toBe(200);
    });

    it('set-up is public (no bearer token) but throttled', async () => {
      const ip = freshIp();
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/setup/complete')
          .set('X-Forwarded-For', ip)
          .send({ setupTicket: 'e'.repeat(64), deviceId: 'x', newPassword: goodPassword });
        statuses.push(res.status);
      }
      expect(statuses[0]).toBe(401); // reached the handler without a bearer token
      expect(statuses).toContain(429);
    });
  });

  describe('GET /staff — listing', () => {
    it('lists staff for CEO and Manager, filterable by role / team / status', async () => {
      // The lead reports to the Manager: a Manager lists only their own tree (security check L6).
      const lead = await mkStaff('team_lead', { reportsToId: manager.id });
      const a = await hire('field_agent', { teamLeadId: lead.id });
      const b = await hire('call_agent', { teamLeadId: lead.id });
      await accept(a);

      for (const actor of [ceo, manager]) {
        const byTeam = await request(app.getHttpServer())
          .get('/staff')
          .query({ teamLeadId: lead.id })
          .set('Authorization', auth(actor));
        expect(byTeam.status).toBe(200);
        expect(byTeam.body.map((s: { id: string }) => s.id).sort()).toEqual(
          [a.id, b.id].sort(),
        );
      }

      const byRole = await request(app.getHttpServer())
        .get('/staff')
        .query({ role: 'field_agent' })
        .set('Authorization', auth(ceo));
      expect(byRole.body.map((s: { id: string }) => s.id)).toEqual(
        expect.arrayContaining([a.id, fieldAgent.id]),
      );
      expect(
        byRole.body.every(
          (s: { role: string }) => s.role === 'field_agent',
        ),
      ).toBe(true);

      const pending = await request(app.getHttpServer())
        .get('/staff')
        .query({ teamLeadId: lead.id, status: 'pending_invite' })
        .set('Authorization', auth(manager));
      expect(pending.body.map((s: { id: string }) => s.id)).toEqual([b.id]);
    });

    it('exposes only the allow-listed fields — never hashes, TOTP secrets, device ids or phone', async () => {
      const res = await request(app.getHttpServer())
        .get('/staff')
        .query({ role: 'field_agent' })
        .set('Authorization', auth(ceo));

      expect(res.body.length).toBeGreaterThan(0);
      for (const row of res.body) {
        expect(Object.keys(row).sort()).toEqual(
          [
            'code',
            'createdAt',
            'deactivatedAt',
            'email',
            'id',
            'isIntern',
            'isOwnerAccount',
            'name',
            'reportsToId',
            'role',
            'joinedOn',
            'status',
            'teamLeadId',
          ].sort(),
        );
      }
    });

    it('rejects an unknown role or status filter with 400', async () => {
      const badRole = await request(app.getHttpServer())
        .get('/staff')
        .query({ role: 'wizard' })
        .set('Authorization', auth(ceo));
      expect(badRole.status).toBe(400);

      const badStatus = await request(app.getHttpServer())
        .get('/staff')
        .query({ status: 'sleeping' })
        .set('Authorization', auth(ceo));
      expect(badStatus.status).toBe(400);
    });
  });

  describe('POST /staff/:id/deactivate', () => {
    async function activeHireWithSession() {
      const h = await hire('call_agent');
      await accept(h);
      // Enrolled, as a real employee would be, so the token is not scope-limited.
      const loggedIn = await enrolledLogin(app.getHttpServer(), {
        email: h.email,
        password: goodPassword,
      });
      expect(loggedIn.status).toBe(200);
      return { ...h, accessToken: loggedIn.body.accessToken as string };
    }

    it('a deactivated account’s valid credentials are rejected at login', async () => {
      const h = await activeHireWithSession();

      const res = await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(manager));
      expect(res.status).toBe(200);
      expect(res.body.staff.status).toBe('deactivated');

      const retry = await login(h.email, goodPassword);
      expect(retry.status).toBe(401);
      expect(retry.body.accessToken).toBeUndefined();
    });

    it('immediately kills the account’s live sessions via the shared revocation path', async () => {
      const h = await activeHireWithSession();
      const before = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${h.accessToken}`);
      expect(before.status).toBe(200);

      const res = await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(ceo));
      expect(res.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

      const after = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${h.accessToken}`);
      expect(after.status).toBe(401);
      expect(after.body.message).toContain('Session has been revoked');

      const live = await prisma.staffSession.count({
        where: { staffId: h.id, revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('keeps the Staff record and every past audit-logged action', async () => {
      const h = await activeHireWithSession();
      const pastLog = await prisma.auditLog.create({
        data: {
          code: `AUD-T9-${ts}-${ipCounter++}`,
          actorId: h.id,
          action: 'job_seeker.created',
          entityType: 'job_seeker',
          entityCode: 'JS-00001',
        },
      });

      await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(ceo));

      const row = await prisma.staff.findUnique({ where: { id: h.id } });
      expect(row).not.toBeNull();
      expect(row!.status).toBe('deactivated');
      expect(row!.deactivatedAt).toBeInstanceOf(Date);
      expect(row!.code).toBe(h.code);

      const kept = await prisma.auditLog.findUnique({
        where: { id: pastLog.id },
      });
      expect(kept?.actorId).toBe(h.id);

      await prisma.auditLog.delete({ where: { id: pastLog.id } });
    });

    it('audit-logs deactivation with actor and before/after status', async () => {
      const h = await activeHireWithSession();
      await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(manager));

      const log = await prisma.auditLog.findFirst({
        where: { action: 'staff.deactivated', entityCode: h.code },
      });
      expect(log).not.toBeNull();
      expect(log!.actorId).toBe(manager.id);
      expect(log!.before).toEqual({ status: 'active' });
      expect(log!.after).toMatchObject({ status: 'deactivated' });
    });

    it('is idempotent: deactivating twice is a no-op with a single audit entry', async () => {
      const h = await activeHireWithSession();
      const first = await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(ceo));
      const second = await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(ceo));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.sessionsRevoked).toBe(0);
      const entries = await prisma.auditLog.count({
        where: { action: 'staff.deactivated', entityCode: h.code },
      });
      expect(entries).toBe(1);
    });

    it('voids an unused temporary password, so a deactivated pending account cannot be revived by it', async () => {
      const h = await hire('call_agent');
      await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(ceo));

      const res = await accept(h);
      expect(res.status).toBe(401);
      expect((await prisma.staff.findUniqueOrThrow({ where: { id: h.id } })).tempPasswordHash).toBeNull();

      const row = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
      expect(row.status).toBe('deactivated');
      expect((await login(h.email, goodPassword)).status).toBe(401);
    });

    it('does not reveal account state to someone with the wrong password', async () => {
      const h = await activeHireWithSession();
      await request(app.getHttpServer())
        .post(`/staff/${h.id}/deactivate`)
        .set('Authorization', auth(ceo));

      const res = await login(h.email, 'definitely-not-the-password');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid staff code or password');
    });

    it('a still-unrevoked session of a deactivated account is refused (defence in depth)', async () => {
      const victim = await mkStaff('call_agent');
      const token = await mkToken(victim);
      await prisma.staff.update({
        where: { id: victim.id },
        data: { status: 'deactivated' },
      });

      const res = await request(app.getHttpServer())
        .get('/staff/sessions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Account is not active');
    });

    it('cannot deactivate yourself, an unknown id, and only a CEO can deactivate ceo/manager accounts', async () => {
      const self = await request(app.getHttpServer())
        .post(`/staff/${ceo.id}/deactivate`)
        .set('Authorization', auth(ceo));
      expect(self.status).toBe(400);

      const unknown = await request(app.getHttpServer())
        .post('/staff/00000000-0000-0000-0000-000000000000/deactivate')
        .set('Authorization', auth(ceo));
      expect(unknown.status).toBe(404);

      const otherManager = await mkStaff('manager');
      const byManager = await request(app.getHttpServer())
        .post(`/staff/${otherManager.id}/deactivate`)
        .set('Authorization', auth(manager));
      expect(byManager.status).toBe(403);
      const ceoTarget = await request(app.getHttpServer())
        .post(`/staff/${ceo.id}/deactivate`)
        .set('Authorization', auth(manager));
      expect(ceoTarget.status).toBe(403);

      const byCeo = await request(app.getHttpServer())
        .post(`/staff/${otherManager.id}/deactivate`)
        .set('Authorization', auth(ceo));
      expect(byCeo.status).toBe(200);
    });
  });

  describe('RBAC — roles other than CEO/Manager are denied on every endpoint', () => {
    const denied = () => [
      ['team_lead', teamLead],
      ['call_agent', callAgent],
      ['field_agent', fieldAgent],
      ['finance', finance],
    ] as const;

    it.each(['call_agent', 'field_agent', 'finance'])(
      '%s gets 403 on POST /staff, GET /staff and POST /staff/:id/deactivate',
      async (roleName) => {
        const actor = denied().find(([name]) => name === roleName)![1];
        const target = await mkStaff('call_agent');

        const attempted = newHire('call_agent');
        const create = await createViaApi(actor, attempted);
        const list = await request(app.getHttpServer())
          .get('/staff')
          .set('Authorization', auth(actor));
        const deactivate = await request(app.getHttpServer())
          .post(`/staff/${target.id}/deactivate`)
          .set('Authorization', auth(actor));

        expect([create.status, list.status, deactivate.status]).toEqual([
          403, 403, 403,
        ]);

        // And nothing happened as a side effect
        const row = await prisma.staff.findUniqueOrThrow({
          where: { id: target.id },
        });
        expect(row.status).toBe('active');
        expect(
          await prisma.staff.count({ where: { email: attempted.email } }),
        ).toBe(0);
      },
    );

    it('team_lead gets 403 on POST /staff and POST /staff/:id/deactivate, and 200 on GET /staff', async () => {
      const actor = teamLead;
      const target = await mkStaff('call_agent');

      const attempted = newHire('call_agent');
      const create = await createViaApi(actor, attempted);
      const list = await request(app.getHttpServer())
        .get('/staff')
        .set('Authorization', auth(actor));
      const deactivate = await request(app.getHttpServer())
        .post(`/staff/${target.id}/deactivate`)
        .set('Authorization', auth(actor));

      expect([create.status, list.status, deactivate.status]).toEqual([
        403, 200, 403,
      ]);

      const row = await prisma.staff.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(row.status).toBe('active');
      expect(
        await prisma.staff.count({ where: { email: attempted.email } }),
      ).toBe(0);
    });

    it('unauthenticated requests get 401 on the protected endpoints', async () => {
      const server = app.getHttpServer();
      expect((await request(server).post('/staff').send(newHire('call_agent'))).status).toBe(401);
      expect((await request(server).get('/staff')).status).toBe(401);
      expect(
        (await request(server).post(`/staff/${callAgent.id}/deactivate`)).status,
      ).toBe(401);
    });
  });

  describe('temporary password form', () => {
    it('is accepted in any case, with or without the dash; anything else is never compared', () => {
      expect(normaliseTemporaryPassword('k7m4-q2px')).toBe('K7M4Q2PX');
      expect(normaliseTemporaryPassword('K7M4Q2PX')).toBe('K7M4Q2PX');
      expect(normaliseTemporaryPassword(' k7m4 q2px ')).toBe('K7M4Q2PX');
      expect(normaliseTemporaryPassword('K7M4-Q2P')).toBeNull();
      expect(normaliseTemporaryPassword('K7M4-Q2P0')).toBeNull(); // 0 is never used
      expect(normaliseTemporaryPassword('Correct-Horse-Battery-9')).toBeNull();
      expect(normaliseTemporaryPassword(12345678)).toBeNull();
    });
  });
});
