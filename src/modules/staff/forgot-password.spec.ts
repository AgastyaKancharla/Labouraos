import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EMAIL_PROVIDER, MockEmailProvider } from '../../common/email/email.provider';
import { FORGOT_PASSWORD_ANSWER, FORGOT_PASSWORD_PER_HOUR, ForgotPasswordService } from './forgot-password.service';

jest.setTimeout(120000);

/**
 * "Forgot password" for the CEO, Managers and Finance by company email (guide,
 * Passwords and email): one-time, expiring link to the invite page; the same
 * answer for every address; agents and Team Leads are never sent one; at most
 * 3 links an hour per account; throttled per address.
 */
describe('Forgot password by company email (CEO, Managers, Finance)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ForgotPasswordService;
  let mail: MockEmailProvider;
  const ts = Date.now();
  const ids: string[] = [];
  const emails: Record<string, string> = {};
  let ip = 0;
  const freshIp = () => `10.62.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
  const post = (body: Record<string, unknown>, from = freshIp()) =>
    request(app.getHttpServer()).post('/staff/forgot-password').set('X-Forwarded-For', from).send(body);

  async function mk(key: string, role: string, status = 'active') {
    const email = `fpw_${key}_${ts}@laboura.local`;
    const staff = await prisma.staff.create({
      data: { code: `FPW-${key}-${ts}`, name: `Forgot ${key}`, email, role, status, passwordHash: await bcrypt.hash('Old-Password-1', 4) },
    });
    ids.push(staff.id);
    emails[key] = email;
    return staff;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(ForgotPasswordService);
    mail = app.get(EMAIL_PROVIDER) as MockEmailProvider;
    await mk('ceo', 'ceo');
    await mk('mgr', 'manager');
    await mk('fin', 'finance');
    await mk('tl', 'team_lead');
    await mk('agent', 'call_agent');
    await mk('gone', 'manager', 'deactivated');
  });

  afterAll(async () => {
    const codes = (await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((s) => s.code);
    await prisma.staffPasswordReset.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityType: 'staff', entityCode: { in: codes } }] } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('answers every address the same way, and only a management account gets a link', async () => {
    const answers = [];
    for (const body of [{ email: emails.mgr }, { email: emails.agent }, { email: emails.tl }, { email: `nobody_${ts}@laboura.local` }, { email: 'not an email' }, {}]) {
      answers.push(await post(body));
    }
    for (const res of answers) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: FORGOT_PASSWORD_ANSWER });
    }
    for (const key of ['agent', 'tl', 'gone']) {
      expect(await service.request(emails[key]).done).toBe('skipped');
    }
    expect(await service.request(`support@laboura.local`).done).toBe('skipped');
    const agentIds = ids.slice(3);
    expect(await prisma.staffPasswordReset.count({ where: { staffId: { in: agentIds } } })).toBe(0);
    // The HTTP ask for the Manager is handled after the reply: wait for its link.
    for (let i = 0; i < 50 && !(await prisma.staffPasswordReset.count({ where: { staffId: ids[1] } })); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(await prisma.staffPasswordReset.count({ where: { staffId: ids[1] } })).toBe(1);
  });

  it('emails a one-time, expiring link to the invite page that sets a new password once (any letter case)', async () => {
    const toFin = () => mail.sent.filter((m) => m.to === emails.fin);
    const before = toFin().length;
    expect(await service.request(emails.fin.toUpperCase()).done).toBe('sent');
    const message = toFin()[toFin().length - 1];
    expect(toFin().length).toBe(before + 1);
    expect(message.to).toBe(emails.fin);
    expect(message.link).toMatch(/\/app\/p\/invite\//);
    const token = decodeURIComponent(message.link!.split('/p/invite/')[1]);
    const reset = await prisma.staffPasswordReset.findFirstOrThrow({ where: { staffId: ids[2] }, orderBy: { createdAt: 'desc' } });
    expect(reset.expiresAt.getTime() - reset.createdAt.getTime()).toBe(60 * 60 * 1000);
    const emailed = await prisma.auditLog.findFirst({ where: { action: 'staff.password_reset_emailed', entityCode: `FPW-fin-${ts}` } });
    // F1: the pretend sender is recorded as such, never as "sent".
    expect((emailed?.after as { emailStatus?: string } | null)?.emailStatus).toBe('mock');

    const preview = await request(app.getHttpServer()).post('/staff/accept-invite/preview').set('X-Forwarded-For', freshIp()).send({ token });
    expect(preview.status).toBe(200);
    expect(preview.body.purpose).toBe('reset');
    const used = await request(app.getHttpServer()).post('/staff/accept-invite').set('X-Forwarded-For', freshIp()).send({ token, password: 'New-Password-Battery-2' });
    expect(used.status).toBe(200);
    const again = await request(app.getHttpServer()).post('/staff/accept-invite').set('X-Forwarded-For', freshIp()).send({ token, password: 'Another-Password-3' });
    expect(again.status).toBe(400);
  });

  it('expires: an old link no longer opens', async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(await service.request(emails.ceo, past).done).toBe('sent');
    const toCeo = mail.sent.filter((m) => m.to === emails.ceo);
    const token = decodeURIComponent(toCeo[toCeo.length - 1].link!.split('/p/invite/')[1]);
    const preview = await request(app.getHttpServer()).post('/staff/accept-invite/preview').set('X-Forwarded-For', freshIp()).send({ token });
    expect(preview.status).toBe(410);
  });

  it(`sends at most ${FORGOT_PASSWORD_PER_HOUR} links an hour per account, and throttles one address`, async () => {
    const results: string[] = [];
    for (let i = 0; i < FORGOT_PASSWORD_PER_HOUR + 2; i += 1) results.push(await service.request(emails.mgr).done);
    // The first test may already have sent the Manager one link.
    expect(results.filter((r) => r === 'sent').length).toBeLessThanOrEqual(FORGOT_PASSWORD_PER_HOUR);
    expect(results[results.length - 1]).toBe('skipped');
    expect(await prisma.staffPasswordReset.count({ where: { staffId: ids[1], issuedByStaffId: ids[1] } })).toBe(FORGOT_PASSWORD_PER_HOUR);

    const from = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await post({ email: `same_${ts}@laboura.local` }, from)).status);
    expect(statuses).toContain(429);
  });

  it('F2: the limit follows the email address, not the IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await post({ email: `spread_${ts}@laboura.local` }, freshIp())).status);
    expect(statuses).toContain(429);
    // Another address from the same IPs is not held back.
    expect((await post({ email: `fresh_${ts}@laboura.local` })).status).toBe(200);
  });
});
