import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { authenticator } from 'otplib';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthClock } from './auth.service';
import { applyTrustProxy } from '../http/trust-proxy';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { stableTotpCode } from '../../test-support/enrolled-login-spec';

describe('Phase 10 Task 5: sessions, lockout, lock and unlock', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let now = new Date('2026-06-15T05:30:00.000Z');
  const clock = { now: () => now };
  const password = 'Session-Lock-Password-1';
  const createdIds: string[] = [];
  let counter = 0;

  async function policy() {
    return prisma.pricingPolicy.findFirstOrThrow({
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async function makeStaff(role: string, extra: Record<string, unknown> = {}) {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `SL-${role.slice(0, 3).toUpperCase()}-${Date.now()}-${counter}`,
        name: `Session ${role} ${counter}`,
        email: `sl-${role}-${counter}-${Date.now()}@laboura.local`,
        passwordHash: await bcrypt.hash(password, 4),
        role,
        status: 'active',
        teamLeadId: (extra.teamLeadId as string) ?? null,
        totpSecret: (extra.totpSecret as string) ?? null,
        totpEnabled: (extra.totpEnabled as boolean) ?? false,
      },
    });
    createdIds.push(staff.id);
    return staff;
  }

  function tokenFor(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      code: staff.code,
    });
  }

  async function loginManager() {
    const secret = authenticator.generateSecret();
    const manager = await makeStaff('manager', { totpSecret: secret, totpEnabled: true });
    // A Manager's device is approved by the CEO before the Manager logs in on it.
    await approveDevice(manager.id, `mgr-${manager.id}`);
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: manager.code,
        password,
        deviceId: `mgr-${manager.id}`,
        totpCode: await stableTotpCode(secret),
      });
    if (res.status !== 200) {
      throw new Error(`manager login failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return {
      manager,
      token: res.body.accessToken as string,
      sessionId: res.body.sessionId as string,
    };
  }

  async function approveDevice(staffId: string, deviceId: string) {
    await prisma.staffDevice.create({
      data: {
        staffId,
        deviceId,
        label: 'Handset',
        platform: 'android',
        status: 'approved',
        approvedAt: now,
      },
    });
  }

  async function openAgentSession(
    agent: { id: string; code: string },
    deviceId: string,
    revealerToken: string,
  ) {
    const waiting = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ staffCode: agent.code, password, deviceId });
    expect(waiting.status).toBe(200);
    expect(waiting.body.status).toBe('awaiting_code');
    const shown = await request(app.getHttpServer())
      .post(`/login-codes/${waiting.body.loginRequestId}/reveal`)
      .set('Authorization', `Bearer ${revealerToken}`)
      .expect(200);
    expect(shown.body.code).toBe(loginCodeFor(waiting.body.loginRequestId));
    const verified = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .send({ loginRequestId: waiting.body.loginRequestId, code: shown.body.code, deviceId: deviceId, loginRequestProof: waiting.body.loginRequestProof });
    expect(verified.status).toBe(200);
    return {
      token: verified.body.accessToken as string,
      sessionId: verified.body.sessionId as string,
    };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await prisma.staff.updateMany({
      where: { id: { in: createdIds } },
      data: { lockedByStaffId: null },
    });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await app.close();
  });

  it('ends the first session when the same account logs in again', async () => {
    const first = await loginManager();
    const again = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        staffCode: first.manager.code,
        password,
        deviceId: `mgr-${first.manager.id}`,
        totpCode: await stableTotpCode(first.manager.totpSecret!),
      });
    expect(again.status).toBe(200);
    expect(again.body.sessionId).not.toBe(first.sessionId);

    const ended = await prisma.staffSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect(ended.endedReason).toBe('replaced');
    expect(ended.revokedAt).toBeTruthy();

    const stale = await request(app.getHttpServer())
      .get('/staff/sessions')
      .set('Authorization', `Bearer ${first.token}`);
    expect(stale.status).toBe(401);

    const live = await request(app.getHttpServer())
      .get('/staff/sessions')
      .set('Authorization', `Bearer ${again.body.accessToken}`);
    expect(live.status).toBe(200);
  });

  it('refuses a session idle for longer than idleLogoutMinutes', async () => {
    const rules = await policy();
    const { token, sessionId } = await loginManager();
    now = new Date(now.getTime() + rules.idleLogoutMinutes * 60 * 1000 + 1);

    const refused = await request(app.getHttpServer())
      .get('/staff/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(refused.status).toBe(401);
    expect(refused.body.message).toBe('Session ended after being idle');

    const ended = await prisma.staffSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(ended.endedReason).toBe('idle');
    expect(ended.revokedAt).toBeTruthy();
  });

  it('refuses a session past maxSessionMinutes even when it is still active, and refresh does not extend that limit', async () => {
    const rules = await policy();
    const { token, sessionId } = await loginManager();
    const before = await prisma.staffSession.findUniqueOrThrow({ where: { id: sessionId } });

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(refreshed.body.sessionId).toBe(sessionId);
    expect(refreshed.body.accessToken).toBeDefined();

    const afterRefresh = await prisma.staffSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(afterRefresh.absoluteExpiresAt.getTime()).toBe(before.absoluteExpiresAt.getTime());
    expect(afterRefresh.endedReason).toBeNull();

    now = new Date(before.absoluteExpiresAt.getTime() + 1);
    await prisma.staffSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: now },
    });

    const refused = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(refused.status).toBe(401);
    expect(refused.body.message).toBe('Session has reached its maximum length');

    const ended = await prisma.staffSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(ended.endedReason).toBe('max_length');
    expect(ended.absoluteExpiresAt.getTime()).toBe(before.absoluteExpiresAt.getTime());
    expect(rules.maxSessionMinutes).toBeGreaterThan(0);
  });

  it('logout ends the current session', async () => {
    const { token, sessionId } = await loginManager();
    const out = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(out.body.success).toBe(true);

    const ended = await prisma.staffSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(ended.endedReason).toBe('logout');

    const again = await request(app.getHttpServer())
      .get('/staff/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(401);
  });

  it('locks the account after failedLoginLimit wrong passwords and refuses the right password until unlock', async () => {
    const rules = await policy();
    const lead = await makeStaff('team_lead');
    const otherLead = await makeStaff('team_lead');
    const agent = await makeStaff('call_agent', { teamLeadId: lead.id });
    const outsider = await makeStaff('call_agent', { teamLeadId: otherLead.id });
    await approveDevice(agent.id, 'agent-phone');

    for (let attempt = 0; attempt < rules.failedLoginLimit; attempt += 1) {
      const wrong = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `198.51.100.${attempt + 1}`)
        .send({ staffCode: agent.code, password: 'not-the-password', deviceId: 'agent-phone' });
      expect(wrong.status).toBe(401);
    }

    const locked = await prisma.staff.findUniqueOrThrow({ where: { id: agent.id } });
    expect(locked.failedLoginCount).toBe(rules.failedLoginLimit);
    expect(locked.lockedUntil).toBeTruthy();
    expect(locked.lockedUntil!.getTime() - now.getTime()).toBe(rules.lockoutMinutes * 60 * 1000);

    const sixth = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.20')
      .send({ staffCode: agent.code, password, deviceId: 'agent-phone' });
    expect(sixth.status).toBe(401);
    expect(sixth.body.message).toBe(`Account is locked until ${locked.lockedUntil!.toISOString()}`);
    expect(sixth.body.accessToken).toBeUndefined();

    const otherTeam = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/unlock`)
      .set('Authorization', `Bearer ${tokenFor(otherLead)}`);
    expect(otherTeam.status).toBe(403);

    const unlocked = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/unlock`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`)
      .expect(200);
    expect(unlocked.body.success).toBe(true);

    const row = await prisma.staff.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(row.lockedByStaffId).toBeNull();

    const back = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.21')
      .send({ staffCode: agent.code, password, deviceId: 'agent-phone' });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('awaiting_code');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.unlocked', entityCode: agent.code },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(lead.id);

    await prisma.staff.update({
      where: { id: outsider.id },
      data: { lockedUntil: new Date(now.getTime() + rules.lockoutMinutes * 60 * 1000), failedLoginCount: rules.failedLoginLimit },
    });
    const stillOtherTeam = await request(app.getHttpServer())
      .post(`/staff/${outsider.id}/unlock`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`);
    expect(stillOtherTeam.status).toBe(403);
  });

  it('a one-tap lock ends live sessions immediately and only unlock reverses it', async () => {
    const manager = await makeStaff('manager');
    const lead = await makeStaff('team_lead');
    await prisma.staff.update({ where: { id: lead.id }, data: { reportsToId: manager.id } });
    const agent = await makeStaff('call_agent', { teamLeadId: lead.id });
    await prisma.staff.update({ where: { id: agent.id }, data: { reportsToId: lead.id } });
    const finance = await makeStaff('finance');
    await approveDevice(agent.id, 'live-phone');
    const session = await openAgentSession(agent, 'live-phone', tokenFor(manager));

    const missingReason = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/lock`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({});
    expect(missingReason.status).toBe(400);

    const leadLocked = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/lock`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`)
      .send({ reason: 'not allowed' });
    expect(leadLocked.status).toBe(403);

    const locked = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/lock`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'left the building' })
      .expect(200);
    expect(locked.body.sessionsEnded).toBeGreaterThanOrEqual(1);

    const ended = await prisma.staffSession.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(ended.endedReason).toBe('locked');
    expect(ended.revokedAt).toBeTruthy();

    const dead = await request(app.getHttpServer())
      .get('/staff/sessions')
      .set('Authorization', `Bearer ${session.token}`);
    expect(dead.status).toBe(401);

    const stillOut = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.30')
      .send({ staffCode: agent.code, password, deviceId: 'live-phone' });
    expect(stillOut.status).toBe(401);
    expect(stillOut.body.message).toBe(
      'Account is locked until a Team Lead, Manager or the CEO unlocks it',
    );

    const agentUnlock = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/unlock`)
      .set('Authorization', `Bearer ${tokenFor(agent)}`);
    expect(agentUnlock.status).toBe(403);
    const financeUnlock = await request(app.getHttpServer())
      .post(`/staff/${agent.id}/unlock`)
      .set('Authorization', `Bearer ${tokenFor(finance)}`);
    expect(financeUnlock.status).toBe(403);

    await request(app.getHttpServer())
      .post(`/staff/${agent.id}/unlock`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`)
      .expect(200);

    const back = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.31')
      .send({ staffCode: agent.code, password, deviceId: 'live-phone' });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('awaiting_code');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.locked', entityCode: agent.code },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(manager.id);
    expect(audit!.reason).toBe('left the building');
  });
});
