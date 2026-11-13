import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { INVITE_TTL_MS, StaffService, hashInviteToken, passwordResetState } from './staff.service';

/** The reason a refusal gives: in `details` behind main.ts's GlobalExceptionFilter, at the top level in tests. */
function reasonOf(body: { reason?: string; details?: { reason?: string } }): string | undefined {
  return body.details?.reason ?? body.reason;
}

/**
 * Reset password (Master Guide, Passwords and email; Manager portal MG-Staff):
 * a Manager (own tree), a Team Lead (own agents) or the CEO issues a reset
 * that works like a new invite link on /p/invite/:token. The old password
 * works until the link is used; then it stops and every session ends. Each
 * reset is stored with who issued it and audit-logged.
 */
describe('Password reset: issue, use on the invite page, scope, audit', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let staffService: StaffService;

  const ts = Date.now();
  const oldPassword = 'Old-Password-Horse-1';
  const newPassword = 'New-Password-Battery-2';
  const ids: string[] = [];
  let ip = 0;
  const freshIp = () => `10.61.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;

  const people: Record<string, { id: string; code: string; token: string }> = {};

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `PWR-${key}-${ts}`,
        name: `Reset ${key}`,
        email: `pwr_${key}_${ts}@laboura.local`,
        role,
        passwordHash: await bcrypt.hash(oldPassword, 4),
        status: 'active',
        ...extra,
      },
    });
    ids.push(staff.id);
    const session = await prisma.staffSession.create({
      data: {
        staffId: staff.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });
    const payload: JwtPayload = {
      sub: staff.id,
      role,
      email: staff.email,
      code: staff.code,
      teamLeadId: staff.teamLeadId,
      sid: session.id,
    };
    people[key] = { id: staff.id, code: staff.code, token: jwt.sign(payload, { expiresIn: '15m' }) };
    return staff;
  }

  const issue = (by: string, target: string) =>
    request(app.getHttpServer())
      .post(`/staff/${people[target].id}/reset-password`)
      .set('Authorization', `Bearer ${people[by].token}`)
      .set('X-Forwarded-For', freshIp())
      .send({});
  const post = (path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(path).set('X-Forwarded-For', freshIp()).send(body);
  const tokenOf = (url: string) => decodeURIComponent(url.split('/p/invite/')[1]);
  const passwordIs = async (key: string, password: string) => {
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: people[key].id } });
    return bcrypt.compare(password, row.passwordHash);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    staffService = app.get(StaffService);

    const ceo = await mk('ceo', 'ceo');
    const mgrA = await mk('mgrA', 'manager', { reportsToId: ceo.id });
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id, totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgrA.id });
    const tlB = await mk('tlB', 'team_lead', { reportsToId: mgrB.id });
    await mk('agentA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('agentA2', 'field_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('agentB', 'call_agent', { teamLeadId: tlB.id, reportsToId: tlB.id });
    await mk('fin', 'finance', { reportsToId: ceo.id });
    await mk('pending', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id, status: 'pending_invite' });
  });

  afterAll(async () => {
    const codes = (await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((s) => s.code);
    await prisma.staffPasswordReset.deleteMany({ where: { OR: [{ staffId: { in: ids } }, { issuedByStaffId: { in: ids } }] } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { entityType: 'staff', entityCode: { in: codes } }] },
    });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('a Manager resets an agent in their tree: link on the invite page, record stored, audit-logged', async () => {
    const res = await issue('mgrA', 'agentA');
    expect(res.status).toBe(200);
    expect(res.body.resetUrl).toMatch(/\/app\/p\/invite\/[0-9a-f]{64}$/);
    expect(res.body.resetToken).toHaveLength(64);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const token = tokenOf(res.body.resetUrl);
    const stored = await prisma.staffPasswordReset.findUniqueOrThrow({ where: { tokenHash: hashInviteToken(token) } });
    expect(stored).toMatchObject({ staffId: people.agentA.id, issuedByStaffId: people.mgrA.id, usedAt: null, cancelledAt: null });
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(INVITE_TTL_MS);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'staff.password_reset_issued', entityCode: people.agentA.code, actorId: people.mgrA.id },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain(token);

    const preview = await post('/staff/accept-invite/preview', { token });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ purpose: 'reset', code: people.agentA.code, authenticatorRequired: false });
  });

  it('the old password keeps working until the link is used; then it stops and sessions end', async () => {
    const res = await issue('mgrA', 'agentA2');
    const token = tokenOf(res.body.resetUrl);
    expect(await passwordIs('agentA2', oldPassword)).toBe(true);
    const account = await prisma.staff.findUniqueOrThrow({ where: { id: people.agentA2.id } });
    expect(account.status).toBe('active');

    await prisma.staff.update({ where: { id: people.agentA2.id }, data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 600_000) } });
    const accepted = await post('/staff/accept-invite', { token, password: newPassword });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ success: true, code: people.agentA2.code });

    expect(await passwordIs('agentA2', oldPassword)).toBe(false);
    expect(await passwordIs('agentA2', newPassword)).toBe(true);
    const after = await prisma.staff.findUniqueOrThrow({ where: { id: people.agentA2.id } });
    expect(after).toMatchObject({ status: 'active', failedLoginCount: 0, lockedUntil: null });
    const open = await prisma.staffSession.count({ where: { staffId: people.agentA2.id, revokedAt: null } });
    expect(open).toBe(0);
    const record = await prisma.staffPasswordReset.findUniqueOrThrow({ where: { tokenHash: hashInviteToken(token) } });
    expect(record.usedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'staff.password_reset_completed', entityCode: people.agentA2.code } })).toBe(1);

    const again = await post('/staff/accept-invite', { token, password: 'Another-Password-3x' });
    expect(again.status).toBe(400);
    expect(reasonOf(again.body)).toBe('used');
    expect((await post('/staff/accept-invite/preview', { token })).status).toBe(410);
  });

  it('a newer reset replaces the older unused one', async () => {
    const first = tokenOf((await issue('mgrA', 'tlA')).body.resetUrl);
    const second = tokenOf((await issue('ceo', 'tlA')).body.resetUrl);
    const old = await post('/staff/accept-invite/preview', { token: first });
    expect(old.status).toBe(404);
    expect(reasonOf(old.body)).toBe('invalid');
    expect((await post('/staff/accept-invite/preview', { token: second })).status).toBe(200);
  });

  it('an expired reset link is refused and the old password stays', async () => {
    const token = tokenOf((await issue('ceo', 'agentB')).body.resetUrl);
    await expect(
      staffService.previewInvite({ token }, new Date(Date.now() + INVITE_TTL_MS + 60_000)),
    ).rejects.toMatchObject({ status: 410, response: { reason: 'expired' } });
    await expect(
      staffService.acceptInvite({ token, password: newPassword }, new Date(Date.now() + INVITE_TTL_MS + 60_000)),
    ).rejects.toMatchObject({ status: 400 });
    expect(await passwordIs('agentB', oldPassword)).toBe(true);
  });

  it('the CEO resets a Manager: the authenticator is kept and not set up again', async () => {
    const token = tokenOf((await issue('ceo', 'mgrB')).body.resetUrl);
    const preview = await post('/staff/accept-invite/preview', { token });
    expect(preview.body).toMatchObject({ purpose: 'reset', role: 'manager', authenticatorRequired: false });
    expect((await post('/staff/accept-invite/authenticator', { token })).status).toBe(400);
    expect((await post('/staff/accept-invite', { token, password: newPassword })).status).toBe(200);
    const mgr = await prisma.staff.findUniqueOrThrow({ where: { id: people.mgrB.id } });
    expect(mgr).toMatchObject({ totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' });
  });

  it('a Manager is refused outside their tree, for a Manager, for Finance and for themself', async () => {
    expect((await issue('mgrA', 'agentB')).status).toBe(403);
    expect((await issue('mgrA', 'tlB')).status).toBe(403);
    expect((await issue('mgrA', 'mgrB')).status).toBe(403);
    expect((await issue('mgrA', 'fin')).status).toBe(403);
    expect((await issue('mgrA', 'mgrA')).status).toBe(400);
  });

  it('a Team Lead resets only their own agents; agents and Finance cannot reset', async () => {
    expect((await issue('tlA', 'agentA')).status).toBe(200);
    expect((await issue('tlA', 'agentB')).status).toBe(403);
    expect((await issue('tlA', 'mgrA')).status).toBe(403);
    expect((await issue('agentA', 'agentA2')).status).toBe(403);
    expect((await issue('fin', 'agentA')).status).toBe(403);
  });

  it('an account still waiting for its first password is told to send a new invite', async () => {
    const res = await issue('mgrA', 'pending');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/new invite/);
  });

  it('deactivating the account voids an unused reset link', async () => {
    const victim = await mk('gone', 'call_agent', { teamLeadId: people.tlA.id, reportsToId: people.tlA.id });
    const token = tokenOf((await issue('mgrA', 'gone')).body.resetUrl);
    const off = await request(app.getHttpServer())
      .post(`/staff/${victim.id}/deactivate`)
      .set('Authorization', `Bearer ${people.mgrA.token}`)
      .send({});
    expect(off.status).toBe(200);
    expect((await post('/staff/accept-invite/preview', { token })).status).toBe(404);
  });

  it('GET /staff/password-resets: the CEO sees who reset whom; a Manager only their tree', async () => {
    const ceo = await request(app.getHttpServer()).get('/staff/password-resets').set('Authorization', `Bearer ${people.ceo.token}`);
    expect(ceo.status).toBe(200);
    const mine = (ceo.body as { staff: { id: string }; issuedBy: { id: string }; state: string }[]).filter((r) => ids.includes(r.staff.id));
    expect(mine.some((r) => r.staff.id === people.agentA.id && r.issuedBy.id === people.mgrA.id)).toBe(true);
    expect(mine.some((r) => r.staff.id === people.agentB.id)).toBe(true);
    expect(JSON.stringify(ceo.body)).not.toContain('tokenHash');

    const mgr = await request(app.getHttpServer()).get('/staff/password-resets').set('Authorization', `Bearer ${people.mgrA.token}`);
    expect(mgr.status).toBe(200);
    expect((mgr.body as { staff: { id: string } }[]).some((r) => r.staff.id === people.agentB.id)).toBe(false);

    const tl = await request(app.getHttpServer()).get('/staff/password-resets').set('Authorization', `Bearer ${people.tlA.token}`);
    expect(tl.status).toBe(403);
  });

  it('passwordResetState: used, replaced, expired, waiting', () => {
    const now = new Date('2026-11-16T10:00:00Z');
    const later = new Date('2026-11-17T10:00:00Z');
    const earlier = new Date('2026-11-15T10:00:00Z');
    expect(passwordResetState({ usedAt: earlier, cancelledAt: null, expiresAt: later }, now)).toBe('used');
    expect(passwordResetState({ usedAt: null, cancelledAt: earlier, expiresAt: later }, now)).toBe('replaced');
    expect(passwordResetState({ usedAt: null, cancelledAt: null, expiresAt: earlier }, now)).toBe('expired');
    expect(passwordResetState({ usedAt: null, cancelledAt: null, expiresAt: later }, now)).toBe('waiting');
  });
});
