import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { normaliseTemporaryPassword } from '../../common/auth/temporary-password';
import { loginCodeFor } from '../login-code/login-code.crypto';
import { resetCodeFor, resetRequestProofFor } from '../password-reset/password-reset.crypto';
import { RESET_REQUESTED_MESSAGE } from '../password-reset/password-reset.service';
import { freshTotpWindow } from '../../test-support/enrolled-login-spec';
import { passwordResetState, resetRequestState } from './staff.service';

/** The reason a refusal gives: in `details` behind main.ts's GlobalExceptionFilter, at the top level in tests. */
function reasonOf(body: { reason?: string; details?: { reason?: string } }): string | undefined {
  return body.details?.reason ?? body.reason;
}

const TEMP_FORMAT = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

/**
 * Temporary passwords and password resets (Master Guide rev 174–175):
 *   - "New temporary password" / "Reset sign-in completely" / reactivation:
 *     who may, what happens, what is kept (rules 2, 8, 9);
 *   - Forgot password: the request answers the same for every staff code; the
 *     senior's reset code works once, 15 minutes, on the asking device only,
 *     never as a login code; who approves whose (rules 7, 8, 10);
 *   - the password reset history (S7).
 */
describe('Temporary passwords and Forgot password by a senior reset code', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const ts = Date.now();
  const oldPassword = 'Old-Password-1';
  const newPassword = 'New-Password-2';
  const ids: string[] = [];
  let ip = 0;
  const freshIp = () => `10.62.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
  const secrets: Record<string, string> = {};

  const people: Record<string, { id: string; code: string; token: string }> = {};

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const authenticatorRole = ['ceo', 'manager', 'finance', 'team_lead'].includes(role);
    if (authenticatorRole && extra.totpEnabled !== false) secrets[key] = authenticator.generateSecret();
    const staff = await prisma.staff.create({
      data: {
        code: `PWR-${key}-${ts}`,
        name: `Reset ${key}`,
        role,
        passwordHash: await bcrypt.hash(oldPassword, 4),
        status: 'active',
        ...(secrets[key] ? { totpEnabled: true, totpSecret: secrets[key] } : {}),
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
    const payload: JwtPayload = { sub: staff.id, role, email: staff.email, code: staff.code, teamLeadId: staff.teamLeadId, sid: session.id };
    people[key] = { id: staff.id, code: staff.code, token: jwt.sign(payload, { expiresIn: '15m' }) };
    return staff;
  }

  const as = (by: string, method: 'get' | 'post', path: string, body: Record<string, unknown> = {}) => {
    const r = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${people[by].token}`).set('X-Forwarded-For', freshIp());
    return method === 'post' ? r.send(body) : r;
  };
  const post = (path: string, body: Record<string, unknown>) => request(app.getHttpServer()).post(path).set('X-Forwarded-For', freshIp()).send(body);
  const login = (key: string, password: string, deviceId: string, extra: Record<string, unknown> = {}) =>
    post('/auth/login', { staffCode: people[key].code, password, deviceId, ...extra });
  const passwordIs = async (key: string, password: string) => {
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: people[key].id } });
    return bcrypt.compare(password, row.passwordHash);
  };
  const totpFor = async (key: string) => {
    await freshTotpWindow(secrets[key]);
    return authenticator.generate(secrets[key]);
  };
  const openSessions = (key: string) => prisma.staffSession.count({ where: { staffId: people[key].id, revokedAt: null } });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const ceo = await mk('ceo', 'ceo');
    await mk('ceo2', 'ceo');
    const mgrA = await mk('mgrA', 'manager', { reportsToId: ceo.id });
    const mgrB = await mk('mgrB', 'manager', { reportsToId: ceo.id });
    const tlA = await mk('tlA', 'team_lead', { reportsToId: mgrA.id });
    const tlB = await mk('tlB', 'team_lead', { reportsToId: mgrB.id });
    // Another team's Team Lead whose sign-in is never reset in this spec.
    await mk('tlC', 'team_lead', { reportsToId: mgrB.id });
    await mk('agentA', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('agentA2', 'field_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('agentA3', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id });
    await mk('agentB', 'call_agent', { teamLeadId: tlB.id, reportsToId: tlB.id });
    await mk('fin', 'finance', { reportsToId: ceo.id });
    await mk('pending', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id, status: 'pending_invite' });
    await mk('gone', 'call_agent', { teamLeadId: tlA.id, reportsToId: tlA.id, status: 'deactivated', deactivatedAt: new Date() });
    await prisma.staffDevice.create({ data: { staffId: people.agentA.id, deviceId: `usual-${ts}`, label: 'Phone', platform: 'web', status: 'approved', approvedAt: new Date() } });
  });

  afterAll(async () => {
    const codes = (await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((s) => s.code);
    await prisma.passwordResetRequest.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffPasswordReset.deleteMany({ where: { OR: [{ staffId: { in: ids } }, { issuedByStaffId: { in: ids } }] } });
    await prisma.notification.deleteMany({ where: { recipientStaffId: { in: ids } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityType: 'staff', entityCode: { in: codes } }] } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  // ------------------------------------------------------------------ New temporary password

  it('New temporary password: shown once (no-store), bcrypt only, never in the audit log; the old password keeps working until set-up', async () => {
    const res = await as('tlA', 'post', `/staff/${people.agentA3.id}/temp-password`).expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.tempPassword).toMatch(TEMP_FORMAT);
    expect(new Date(res.body.tempPasswordExpiresAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: people.agentA3.id } });
    expect(row.tempPasswordHash).not.toContain(res.body.tempPassword);
    expect(await bcrypt.compare(normaliseTemporaryPassword(res.body.tempPassword)!, row.tempPasswordHash!)).toBe(true);
    expect(row.tempPasswordIssuedByStaffId).toBe(people.tlA.id);
    const audits = await prisma.auditLog.findMany({ where: { entityCode: people.agentA3.code } });
    expect(JSON.stringify(audits)).not.toContain(res.body.tempPassword);
    expect(JSON.stringify(audits)).not.toContain(normaliseTemporaryPassword(res.body.tempPassword));
    expect(audits.map((a) => a.action)).toContain('staff.temp_password_issued');
    // Old password still opens a normal sign-in (a login code request for the agent).
    await prisma.staffDevice.create({ data: { staffId: people.agentA3.id, deviceId: `d-a3-${ts}`, label: 'x', platform: 'web', status: 'approved', approvedAt: new Date() } });
    const ok = await login('agentA3', oldPassword, `d-a3-${ts}`).expect(200);
    expect(ok.body.status).toBe('awaiting_code');
    expect(await passwordIs('agentA3', oldPassword)).toBe(true);
  });

  it('a newer temporary password kills the earlier one at once', async () => {
    const first = await as('mgrA', 'post', `/staff/${people.pending.id}/temp-password`).expect(200);
    const second = await as('mgrA', 'post', `/staff/${people.pending.id}/temp-password`).expect(200);
    expect(second.body.tempPassword).not.toBe(first.body.tempPassword);
    const dead = await login('pending', first.body.tempPassword, `d-p-${ts}`);
    expect(dead.status).toBe(401);
    const live = await login('pending', second.body.tempPassword, `d-p-${ts}`).expect(200);
    expect(live.body.status).toBe('setup_required');
  });

  it('who may give one: never oneself; a Team Lead only their own agents; a Manager below Manager in their tree; Finance and Managers only by a CEO; a CEO only by the other CEO', async () => {
    expect((await as('tlA', 'post', `/staff/${people.agentB.id}/temp-password`)).status).toBe(403);
    expect((await as('tlA', 'post', `/staff/${people.tlB.id}/temp-password`)).status).toBe(403);
    expect((await as('mgrA', 'post', `/staff/${people.agentB.id}/temp-password`)).status).toBe(403);
    expect((await as('mgrA', 'post', `/staff/${people.fin.id}/temp-password`)).status).toBe(403);
    expect((await as('mgrA', 'post', `/staff/${people.mgrB.id}/temp-password`)).status).toBe(403);
    expect((await as('mgrA', 'post', `/staff/${people.mgrA.id}/temp-password`)).status).toBe(403);
    expect((await as('ceo', 'post', `/staff/${people.ceo.id}/temp-password`)).status).toBe(403);
    expect((await as('mgrA', 'post', `/staff/${people.ceo2.id}/temp-password`)).status).toBe(403);
    expect((await as('agentA', 'post', `/staff/${people.agentA2.id}/temp-password`)).status).toBe(403);
    expect((await as('ceo', 'post', `/staff/${people.gone.id}/temp-password`)).status).toBe(400);
    expect((await as('ceo', 'post', `/staff/${people.fin.id}/temp-password`)).status).toBe(200);
    expect((await as('ceo2', 'post', `/staff/${people.ceo.id}/temp-password`)).status).toBe(200);
  });

  it('Reset sign-in completely: authenticator removed, every session ends, back to "Not signed in yet", approved devices stay; Manager or CEO for a Team Lead', async () => {
    await prisma.staffDevice.create({ data: { staffId: people.tlB.id, deviceId: `d-tlb-${ts}`, label: 'x', platform: 'web', status: 'approved', approvedAt: new Date() } });
    expect((await as('tlA', 'post', `/staff/${people.tlB.id}/reset-sign-in`)).status).toBe(403);
    const res = await as('mgrB', 'post', `/staff/${people.tlB.id}/reset-sign-in`).expect(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.tempPassword).toMatch(TEMP_FORMAT);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: people.tlB.id } });
    expect(row).toMatchObject({ status: 'pending_invite', totpEnabled: false, totpSecret: null });
    expect(await openSessions('tlB')).toBe(0);
    expect(await prisma.staffDevice.count({ where: { staffId: people.tlB.id, status: 'approved' } })).toBe(1);
    expect(await passwordIs('tlB', oldPassword)).toBe(false);
  });

  // ------------------------------------------------------------------ Forgot password

  const requestReset = (staffCode: string, deviceId: string) => post('/auth/password-reset/request', { staffCode, deviceId });

  it('the request answers the same whether the staff code exists or not (and for a deactivated account)', async () => {
    const real = await requestReset(people.agentA2.code, `d-a2-${ts}`).expect(200);
    const ghost = await requestReset(`NOPE-${ts}`, `d-a2-${ts}`).expect(200);
    const gone = await requestReset(people.gone.code, `d-a2-${ts}`).expect(200);
    for (const r of [real, ghost, gone]) {
      expect(Object.keys(r.body).sort()).toEqual(['expiresAt', 'message', 'resetRequestId', 'resetRequestProof', 'status']);
      expect(r.body.message).toBe(RESET_REQUESTED_MESSAGE);
      expect(r.body.status).toBe('requested');
    }
    expect(await prisma.passwordResetRequest.count({ where: { staffId: people.gone.id } })).toBe(0);
    // The ghost id leads nowhere: the same "not valid" as a wrong code.
    const nowhere = await post('/auth/password-reset/complete', {
      resetRequestId: ghost.body.resetRequestId,
      resetRequestProof: ghost.body.resetRequestProof,
      deviceId: `d-a2-${ts}`,
      code: '123456',
      newPassword,
    });
    expect(nowhere.status).toBe(401);
    expect(reasonOf(nowhere.body)).toBe('code_invalid');
  });

  it('one open request per account (the same device gets the same one back); 3 an hour per staff code', async () => {
    const a = await requestReset(people.agentA2.code, `d-a2-${ts}`).expect(200);
    const b = await requestReset(people.agentA2.code, `d-a2-${ts}`).expect(200);
    expect(b.body.resetRequestId).toBe(a.body.resetRequestId);
    const other = await requestReset(people.agentA2.code, `other-${ts}`).expect(200);
    expect(other.body.resetRequestId).not.toBe(a.body.resetRequestId);
    expect(await prisma.passwordResetRequest.count({ where: { staffId: people.agentA2.id } })).toBe(1);
    // Two more (after the open one ends) reach the hourly limit; a fourth makes nothing.
    for (let i = 0; i < 3; i += 1) {
      await prisma.passwordResetRequest.updateMany({ where: { staffId: people.agentA2.id, status: 'pending' }, data: { status: 'expired' } });
      await requestReset(people.agentA2.code, `d-a2-${ts}`).expect(200);
    }
    expect(await prisma.passwordResetRequest.count({ where: { staffId: people.agentA2.id } })).toBe(3);
    await prisma.passwordResetRequest.deleteMany({ where: { staffId: people.agentA2.id } });
  });

  it('the red card: their Team Lead sees it (usual vs NEW phone); the code is revealed once recorded; works once, on that device only; never as a login code; old password works until done; sessions end; bell and notice', async () => {
    const asked = await requestReset(people.agentA.code, `usual-${ts}`).expect(200);
    const cards = await as('tlA', 'get', '/password-resets/pending').expect(200);
    const card = cards.body.find((c: { id: string }) => c.id === asked.body.resetRequestId);
    expect(card).toMatchObject({ kind: 'password_reset', knownDevice: true, staff: { code: people.agentA.code } });
    // Another team's Team Lead does not see it and cannot reveal it.
    const other = await as('tlC', 'get', '/password-resets/pending').expect(200);
    expect(other.body.map((c: { id: string }) => c.id)).not.toContain(asked.body.resetRequestId);
    // POST /password-resets/:id/reveal: another team's Team Lead is refused (403)
    expect((await as('tlC', 'post', `/password-resets/${asked.body.resetRequestId}/reveal`)).status).toBe(403);
    // Before the reveal nothing works, even the right code.
    const early = await post('/auth/password-reset/complete', { resetRequestId: asked.body.resetRequestId, resetRequestProof: asked.body.resetRequestProof, deviceId: `usual-${ts}`, code: resetCodeFor(asked.body.resetRequestId), newPassword });
    expect(reasonOf(early.body)).toBe('not_revealed');

    const revealed = await as('tlA', 'post', `/password-resets/${asked.body.resetRequestId}/reveal`).expect(200);
    expect(revealed.body.code).toBe(resetCodeFor(asked.body.resetRequestId));
    const code = revealed.body.code as string;
    // The reset code is never a login code: verify-code does not know the id, and the login code of that id differs.
    expect(code).not.toBe(loginCodeFor(asked.body.resetRequestId));
    const asLogin = await post('/auth/login/verify-code', { loginRequestId: asked.body.resetRequestId, code, deviceId: `usual-${ts}`, loginRequestProof: asked.body.resetRequestProof });
    expect(asLogin.status).toBeGreaterThanOrEqual(400);
    expect(asLogin.body.accessToken).toBeUndefined();
    // Another device (or the right device without this sign-in's proof) is refused without using up a try.
    const elsewhere = await post('/auth/password-reset/complete', { resetRequestId: asked.body.resetRequestId, resetRequestProof: asked.body.resetRequestProof, deviceId: `thief-${ts}`, code, newPassword });
    expect(elsewhere.status).toBe(401);
    expect(reasonOf(elsewhere.body)).toBe('other_device');
    const noProof = await post('/auth/password-reset/complete', { resetRequestId: asked.body.resetRequestId, resetRequestProof: resetRequestProofFor(asked.body.resetRequestId, `thief-${ts}`), deviceId: `usual-${ts}`, code, newPassword });
    expect(reasonOf(noProof.body)).toBe('other_device');
    expect((await prisma.passwordResetRequest.findUniqueOrThrow({ where: { id: asked.body.resetRequestId } })).failedAttempts).toBe(0);
    // Old password still works up to now.
    expect(await passwordIs('agentA', oldPassword)).toBe(true);
    const done = await post('/auth/password-reset/complete', { resetRequestId: asked.body.resetRequestId, resetRequestProof: asked.body.resetRequestProof, deviceId: `usual-${ts}`, code, newPassword, confirmPassword: newPassword }).expect(200);
    expect(done.body).toMatchObject({ success: true, code: people.agentA.code });
    expect(await passwordIs('agentA', newPassword)).toBe(true);
    expect(await openSessions('agentA')).toBe(0);
    // Single use.
    const again = await post('/auth/password-reset/complete', { resetRequestId: asked.body.resetRequestId, resetRequestProof: asked.body.resetRequestProof, deviceId: `usual-${ts}`, code, newPassword: 'Another-Pass-3' });
    expect(reasonOf(again.body)).toBe('used');
    // A bell to their boss (the Team Lead) and every CEO; the notice waits for the next sign-in.
    const bells = await prisma.notification.findMany({ where: { kind: 'password_reset', subjectId: asked.body.resetRequestId } });
    const recipients = bells.map((b) => b.recipientStaffId);
    expect(recipients).toEqual(expect.arrayContaining([people.tlA.id, people.ceo.id, people.ceo2.id]));
    expect(recipients).not.toContain(people.agentA.id);
    // Nobody else but the boss and the CEOs.
    const roles = await prisma.staff.findMany({ where: { id: { in: recipients } }, select: { id: true, role: true } });
    expect(roles.every((r) => r.role === 'ceo' || r.id === people.tlA.id)).toBe(true);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: people.agentA.id } });
    expect(row.passwordResetNotice).toMatchObject({ byName: 'Reset tlA', how: 'senior_code' });
    const audits = await prisma.auditLog.findMany({ where: { OR: [{ entityCode: asked.body.resetRequestId }, { entityCode: people.agentA.code, action: 'staff.password_reset_completed' }] } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['password_reset.requested', 'password_reset.revealed', 'staff.password_reset_completed']));
    // The notice shows once at the next sign-in, then is gone.
    const code2 = await login('agentA', newPassword, `usual-${ts}`).expect(200);
    const signedIn = await post('/auth/login/verify-code', { loginRequestId: code2.body.loginRequestId, code: loginCodeFor(code2.body.loginRequestId), deviceId: `usual-${ts}`, loginRequestProof: code2.body.loginRequestProof }).expect(200);
    expect(signedIn.body.passwordResetNotice).toMatchObject({ byName: 'Reset tlA', how: 'senior_code' });
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: people.agentA.id } })).passwordResetNotice).toBeNull();
  });

  it('5 wrong reset codes end the request', async () => {
    const asked = await requestReset(people.agentA2.code, `d-a2b-${ts}`).expect(200);
    await as('tlA', 'post', `/password-resets/${asked.body.resetRequestId}/reveal`).expect(200);
    const right = resetCodeFor(asked.body.resetRequestId);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const r = await post('/auth/password-reset/complete', { resetRequestId: asked.body.resetRequestId, resetRequestProof: asked.body.resetRequestProof, deviceId: `d-a2b-${ts}`, code: wrong, newPassword });
      expect(r.status).toBe(401);
    }
    const dead = await post('/auth/password-reset/complete', { resetRequestId: asked.body.resetRequestId, resetRequestProof: asked.body.resetRequestProof, deviceId: `d-a2b-${ts}`, code: right, newPassword });
    expect(reasonOf(dead.body)).toBe('refused');
    expect((await prisma.passwordResetRequest.findUniqueOrThrow({ where: { id: asked.body.resetRequestId } })).refusedReason).toBe('too_many_wrong_codes');
  });

  it('a refused request (with a reason) ends; refusing needs a reason', async () => {
    const asked = await requestReset(people.agentA2.code, `d-a2c-${ts}`).expect(200);
    expect((await as('tlA', 'post', `/password-resets/${asked.body.resetRequestId}/refuse`, {})).status).toBe(400);
    // POST /password-resets/:id/refuse: another team's Team Lead is refused (403)
    expect((await as('tlC', 'post', `/password-resets/${asked.body.resetRequestId}/refuse`, { reason: 'no' })).status).toBe(403);
    await as('tlA', 'post', `/password-resets/${asked.body.resetRequestId}/refuse`, { reason: 'Could not reach her' }).expect(200);
    const row = await prisma.passwordResetRequest.findUniqueOrThrow({ where: { id: asked.body.resetRequestId } });
    expect(row).toMatchObject({ status: 'refused', refusedByStaffId: people.tlA.id, refusedReason: 'Could not reach her' });
  });

  it('approvers: nobody their own; a CEO\'s reset only by the other CEO; Finance only by a CEO; a Manager below Manager in their tree', async () => {
    const ceoAsk = await requestReset(people.ceo.code, `d-ceo-${ts}`).expect(200);
    expect((await as('ceo', 'post', `/password-resets/${ceoAsk.body.resetRequestId}/reveal`)).status).toBe(403);
    expect((await as('mgrA', 'post', `/password-resets/${ceoAsk.body.resetRequestId}/reveal`)).status).toBe(403);
    expect((await as('ceo2', 'post', `/password-resets/${ceoAsk.body.resetRequestId}/reveal`)).status).toBe(200);
    const finAsk = await requestReset(people.fin.code, `d-fin-${ts}`).expect(200);
    expect((await as('mgrA', 'post', `/password-resets/${finAsk.body.resetRequestId}/reveal`)).status).toBe(403);
    const mgrAsk = await requestReset(people.mgrA.code, `d-mgr-${ts}`).expect(200);
    expect((await as('mgrB', 'post', `/password-resets/${mgrAsk.body.resetRequestId}/reveal`)).status).toBe(403);
    const tlAsk = await requestReset(people.tlA.code, `d-tla-${ts}`).expect(200);
    expect((await as('mgrB', 'post', `/password-resets/${tlAsk.body.resetRequestId}/reveal`)).status).toBe(403);
    expect((await as('mgrA', 'post', `/password-resets/${tlAsk.body.resetRequestId}/reveal`)).status).toBe(200);
    expect((await as('agentA2', 'get', '/password-resets/pending')).status).toBe(403);
  });

  it('authenticator roles also type a code from the authenticator they keep; a lock a senior placed stays', async () => {
    const asked = await requestReset(people.tlA.code, `d-tla-${ts}`).expect(200);
    const code = resetCodeFor(asked.body.resetRequestId);
    const base = { resetRequestId: asked.body.resetRequestId, resetRequestProof: asked.body.resetRequestProof, deviceId: `d-tla-${ts}`, code, newPassword };
    const missing = await post('/auth/password-reset/complete', base);
    expect(reasonOf(missing.body)).toBe('totp_required');
    await prisma.staff.update({ where: { id: people.tlA.id }, data: { lockedByStaffId: people.mgrA.id, lockedReason: 'check' } });
    const locked = await post('/auth/password-reset/complete', { ...base, totpCode: await totpFor('tlA') });
    expect(reasonOf(locked.body)).toBe('locked');
    await prisma.staff.update({ where: { id: people.tlA.id }, data: { lockedByStaffId: null, lockedReason: null } });
    await post('/auth/password-reset/complete', { ...base, totpCode: await totpFor('tlA') }).expect(200);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: people.tlA.id } });
    expect(row.totpEnabled).toBe(true);
    expect(row.totpSecret).toBe(secrets.tlA);
    expect(await passwordIs('tlA', newPassword)).toBe(true);
  });

  // ------------------------------------------------------------------ history

  it('GET /staff/password-resets: requests, refusals and temporary passwords; the CEO sees all, a Manager their tree; others are refused', async () => {
    const all = await as('ceo', 'get', '/staff/password-resets').expect(200);
    const kinds = new Set(all.body.map((r: { kind: string }) => r.kind));
    expect(kinds.has('senior_code')).toBe(true);
    expect(kinds.has('full_reset')).toBe(true);
    const refused = all.body.find((r: { state: string; refusedReason: string | null }) => r.state === 'refused' && r.refusedReason === 'Could not reach her');
    expect(refused).toMatchObject({ kind: 'senior_code', refusedBy: { id: people.tlA.id } });
    const mine = await as('mgrA', 'get', '/staff/password-resets').expect(200);
    const staffIds = new Set(mine.body.map((r: { staff: { id: string } }) => r.staff.id));
    expect(staffIds.has(people.tlB.id)).toBe(false);
    expect(staffIds.has(people.agentA.id)).toBe(true);
    expect((await as('tlC', 'get', '/staff/password-resets')).status).toBe(403);
  });

  it('passwordResetState and resetRequestState', () => {
    const now = new Date('2026-11-15T10:00:00Z');
    const later = new Date('2026-11-16T10:00:00Z');
    const before = new Date('2026-11-14T10:00:00Z');
    expect(passwordResetState({ usedAt: now, cancelledAt: null, expiresAt: later }, now)).toBe('used');
    expect(passwordResetState({ usedAt: null, cancelledAt: now, expiresAt: later }, now)).toBe('replaced');
    expect(passwordResetState({ usedAt: null, cancelledAt: null, expiresAt: before }, now)).toBe('expired');
    expect(passwordResetState({ usedAt: null, cancelledAt: null, expiresAt: later }, now)).toBe('waiting');
    expect(resetRequestState({ status: 'pending', expiresAt: later }, now)).toBe('asked');
    expect(resetRequestState({ status: 'revealed', expiresAt: later }, now)).toBe('code_given');
    expect(resetRequestState({ status: 'revealed', expiresAt: before }, now)).toBe('expired');
    expect(resetRequestState({ status: 'refused', expiresAt: later }, now)).toBe('refused');
    expect(resetRequestState({ status: 'used', expiresAt: before }, now)).toBe('used');
  });
});
