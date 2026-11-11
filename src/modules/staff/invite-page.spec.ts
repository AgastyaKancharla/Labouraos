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
import {
  INVITE_PROBLEM_MESSAGE,
  INVITE_TTL_MS,
  StaffService,
  staffInvitePath,
} from './staff.service';


/** The reason a refusal gives: in `details` behind main.ts's GlobalExceptionFilter, at the top level in tests. */
function reasonOf(body: { reason?: string; details?: { reason?: string } }): string | undefined {
  return body.details?.reason ?? body.reason;
}

/**
 * The invite page (web: /app/p/invite/:token). A new hire sees whose invite
 * it is, sets a password that meets the API's rules, sets up the
 * authenticator when their role needs one, and is told plainly when the link
 * is not valid, has expired or was already used.
 */
describe('Invite page API: preview, authenticator set-up, accept', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let staffService: StaffService;

  const ts = Date.now();
  const goodPassword = 'Correct-Horse-Battery-9';
  const createdStaffIds: string[] = [];
  let ipCounter = 0;
  const freshIp = () => `10.19.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  let ceoId = '';
  let ceoToken = '';
  let teamLeadId = '';

  async function mkStaff(role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `INV-${role.toUpperCase()}-${ts}-${createdStaffIds.length}`,
        name: `Invite ${role}`,
        email: `inv_${role}_${ts}_${createdStaffIds.length}@laboura.local`,
        role,
        passwordHash: await bcrypt.hash(goodPassword, 4),
        ...extra,
      },
    });
    createdStaffIds.push(staff.id);
    return staff;
  }

  async function hire(role: string) {
    const line =
      role === 'call_agent' || role === 'field_agent'
        ? { teamLeadId }
        : role === 'manager' || role === 'finance'
          ? { reportsToId: ceoId }
          : {};
    const res = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        name: `Hire ${role}`,
        email: `inv_hire_${role}_${ts}_${ipCounter++}@laboura.local`,
        role,
        ...line,
      });
    expect(res.status).toBe(201);
    createdStaffIds.push(res.body.staff.id);
    return {
      id: res.body.staff.id as string,
      code: res.body.staff.code as string,
      token: res.body.inviteToken as string,
      body: res.body,
    };
  }

  const post = (path: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(path).set('X-Forwarded-For', freshIp()).send(body);

  const preview = (token: string) => post('/staff/accept-invite/preview', { token });
  const setupAuthenticator = (token: string) => post('/staff/accept-invite/authenticator', { token });
  const accept = (body: Record<string, unknown>) => post('/staff/accept-invite', body);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    staffService = app.get(StaffService);

    const ceo = await mkStaff('ceo');
    ceoId = ceo.id;
    const tl = await mkStaff('team_lead');
    teamLeadId = tl.id;
    const session = await prisma.staffSession.create({
      data: {
        staffId: ceo.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });
    const payload: JwtPayload = {
      sub: ceo.id,
      role: 'ceo',
      email: ceo.email,
      code: ceo.code,
      teamLeadId: null,
      sid: session.id,
    };
    ceoToken = jwt.sign(payload, { expiresIn: '15m' });
  });

  afterAll(async () => {
    const ids = createdStaffIds.filter(Boolean);
    const codes = (
      await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })
    ).map((s) => s.code);
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { entityType: 'staff', entityCode: { in: codes } }] },
    });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('the create response carries the invite page link with the token', async () => {
    const h = await hire('call_agent');
    expect(h.body.inviteUrl).toBe(`https://app.laboura.in${staffInvitePath(h.token)}`);
    expect(h.body.inviteUrl).toBe(`https://app.laboura.in/app/p/invite/${h.token}`);
  });

  it('preview shows who the invite is for, their role and the password rules', async () => {
    const h = await hire('call_agent');
    const res = await preview(h.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Hire call_agent',
      code: h.code,
      role: 'call_agent',
      authenticatorRequired: false,
      passwordRules: { minLength: 12, maxBytes: 72 },
      signInAt: 'web',
    });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(res.body)).not.toContain('inviteTokenHash');
    expect(res.body).not.toHaveProperty('email');
  });

  it('a field agent is sent to Laboura Field; management must set up the authenticator', async () => {
    const fa = await hire('field_agent');
    expect((await preview(fa.token)).body).toMatchObject({ signInAt: 'field_app', authenticatorRequired: false });
    const fin = await hire('finance');
    expect((await preview(fin.token)).body).toMatchObject({ role: 'finance', authenticatorRequired: true });
  });

  it('an unknown or empty token: 404 "not valid"', async () => {
    for (const token of ['f'.repeat(64), '', '  ']) {
      const res = await preview(token);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe(INVITE_PROBLEM_MESSAGE.invalid);
      expect(reasonOf(res.body)).toBe('invalid');
    }
  });

  it('an expired invite: 410 "expired" (clock injected past the TTL)', async () => {
    const h = await hire('call_agent');
    await expect(
      staffService.previewInvite({ token: h.token }, new Date(Date.now() + INVITE_TTL_MS + 60_000)),
    ).rejects.toMatchObject({ status: 410, response: { reason: 'expired' } });

    await prisma.staff.update({ where: { id: h.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    const res = await preview(h.token);
    expect(res.status).toBe(410);
    expect(res.body.message).toBe(INVITE_PROBLEM_MESSAGE.expired);
    const acc = await accept({ token: h.token, password: goodPassword });
    expect(acc.status).toBe(400);
    expect(reasonOf(acc.body)).toBe('expired');
  });

  it('a used invite: 410 "already used", and a second accept says used', async () => {
    const h = await hire('call_agent');
    expect((await accept({ token: h.token, password: goodPassword })).status).toBe(200);

    const res = await preview(h.token);
    expect(res.status).toBe(410);
    expect(res.body.message).toBe(INVITE_PROBLEM_MESSAGE.used);
    expect(reasonOf(res.body)).toBe('used');

    const again = await accept({ token: h.token, password: 'Another-Password-22' });
    expect(again.status).toBe(400);
    expect(again.body.message).toBe('Invalid or expired invite token');
    expect(reasonOf(again.body)).toBe('used');
  });

  it('management: set up the authenticator on the invite page, a wrong code changes nothing, the right one turns it on', async () => {
    const h = await hire('manager');
    const setup = await setupAuthenticator(h.token);
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    const pending = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
    expect(pending.totpSecret).toBe(setup.body.secret);
    expect(pending.totpEnabled).toBe(false);

    const wrongCode = authenticator.generate(setup.body.secret) === '000000' ? '111111' : '000000';
    const wrong = await accept({ token: h.token, password: goodPassword, totpCode: wrongCode });
    expect(wrong.status).toBe(400);
    expect(reasonOf(wrong.body)).toBe('totp_invalid');
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: h.id } })).status).toBe('pending_invite');

    const ok = await accept({
      token: h.token,
      password: goodPassword,
      totpCode: authenticator.generate(setup.body.secret),
    });
    expect(ok.status).toBe(200);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
    expect(row.status).toBe('active');
    expect(row.totpEnabled).toBe(true);
    expect(await bcrypt.compare(goodPassword, row.passwordHash)).toBe(true);

    const log = await prisma.auditLog.findFirst({
      where: { action: 'staff.invite_accepted', entityCode: h.code },
    });
    expect(log!.after).toEqual({ status: 'active', totpEnabled: true });
  });

  it('management may still finish without the authenticator (set up at first sign-in instead)', async () => {
    const h = await hire('finance');
    expect((await accept({ token: h.token, password: goodPassword })).status).toBe(200);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: h.id } });
    expect(row.status).toBe('active');
    expect(row.totpEnabled).toBe(false);
  });

  it('agents do not use an authenticator: set-up and a totpCode are refused', async () => {
    const h = await hire('call_agent');
    expect((await setupAuthenticator(h.token)).status).toBe(400);
    const res = await accept({ token: h.token, password: goodPassword, totpCode: '123456' });
    expect(res.status).toBe(400);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: h.id } })).status).toBe('pending_invite');
  });

  it('the authenticator set-up refuses an unknown token', async () => {
    const res = await setupAuthenticator('a'.repeat(64));
    expect(res.status).toBe(404);
    expect(reasonOf(res.body)).toBe('invalid');
  });

  it('a re-issued invite gives a fresh link; the old token is then not valid', async () => {
    const h = await hire('call_agent');
    const re = await request(app.getHttpServer())
      .post(`/staff/${h.id}/reissue-invite`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .set('X-Forwarded-For', freshIp());
    expect(re.status).toBe(200);
    expect(re.body.inviteUrl).toBe(`https://app.laboura.in/app/p/invite/${re.body.inviteToken}`);
    expect((await preview(h.token)).status).toBe(404);
    expect((await preview(re.body.inviteToken)).status).toBe(200);
  });
});
