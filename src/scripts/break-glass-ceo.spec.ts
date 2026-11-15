import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { applyTrustProxy } from '../common/http/trust-proxy';
import { BREAK_GLASS_ACTOR, issueBreakGlassTempPassword } from './break-glass-ceo';

const SECRET = 'break_glass_secret_for_tests_only_32_chars_min';

/**
 * Break-glass for a locked-out CEO when there is only one CEO (Master Guide
 * rev 174–175, rule 11): a server command guarded by a secret env var, never
 * an HTTP route; it gives that CEO a temporary password like "Reset sign-in
 * completely" and writes an audit row.
 */
describe('Break-glass: a temporary password for a single locked-out CEO (server command only)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  const ts = Date.now();
  const ids: string[] = [];
  let restoreCeos: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    if (restoreCeos.length) await prisma.staff.updateMany({ where: { id: { in: restoreCeos } }, data: { status: 'active' } });
    const codes = (await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((s) => s.code);
    await prisma.staffPasswordReset.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'staff', subjectId: { in: ids } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entityType: 'staff', entityCode: { in: codes } } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  const make = async (key: string) => {
    const staff = await prisma.staff.create({
      data: {
        code: `BG-${key}-${ts}`,
        name: `Break glass ${key}`,
        role: 'ceo',
        status: 'active',
        passwordHash: await bcrypt.hash('Forgotten-Pass-1', 4),
        totpEnabled: true,
        totpSecret: 'JBSWY3DPEHPK3PXP',
      },
    });
    ids.push(staff.id);
    return staff;
  };

  it('is not an HTTP route', async () => {
    for (const path of ['/break-glass', '/staff/break-glass', '/auth/break-glass']) {
      expect((await request(app.getHttpServer()).post(path).send({})).status).toBe(404);
    }
  });

  it('refuses without the secret, with a wrong confirmation, for a non-CEO, and while another active CEO exists', async () => {
    const ceo = await make('one');
    await expect(issueBreakGlassTempPassword(prisma, audit, { staffCode: ceo.code, env: {} })).rejects.toThrow('BREAK_GLASS_SECRET is not set');
    await expect(issueBreakGlassTempPassword(prisma, audit, { staffCode: ceo.code, env: { BREAK_GLASS_SECRET: 'short' } })).rejects.toThrow('BREAK_GLASS_SECRET is not set');
    await expect(
      issueBreakGlassTempPassword(prisma, audit, { staffCode: ceo.code, env: { BREAK_GLASS_SECRET: SECRET, BREAK_GLASS_CONFIRM: `${SECRET}x` } }),
    ).rejects.toThrow('does not match');
    await expect(
      issueBreakGlassTempPassword(prisma, audit, { staffCode: `NOPE-${ts}`, env: { BREAK_GLASS_SECRET: SECRET, BREAK_GLASS_CONFIRM: SECRET } }),
    ).rejects.toThrow('is not a CEO account');
    const other = await make('two');
    await expect(
      issueBreakGlassTempPassword(prisma, audit, { staffCode: ceo.code, env: { BREAK_GLASS_SECRET: SECRET, BREAK_GLASS_CONFIRM: SECRET } }),
    ).rejects.toThrow('Another active CEO exists');
    await prisma.staff.update({ where: { id: other.id }, data: { status: 'deactivated' } });
    const untouched = await prisma.staff.findUniqueOrThrow({ where: { id: ceo.id } });
    expect(untouched).toMatchObject({ status: 'active', totpEnabled: true, tempPasswordHash: null });
  });

  it('gives the only CEO a temporary password: authenticator removed, sessions ended, "Not signed in yet", audited; the temporary password opens set-up', async () => {
    const ceo = await make('only');
    // Every other active CEO (the seed's, the earlier test's) steps aside for this test.
    const others = await prisma.staff.findMany({ where: { role: 'ceo', status: 'active', id: { not: ceo.id } }, select: { id: true } });
    restoreCeos = others.map((o) => o.id).filter((id) => !ids.includes(id));
    await prisma.staff.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'deactivated' } });
    await prisma.staffSession.create({
      data: { staffId: ceo.id, expiresAt: new Date(Date.now() + 900_000), absoluteExpiresAt: new Date(Date.now() + 7_200_000), lastActivityAt: new Date() },
    });
    const result = await issueBreakGlassTempPassword(prisma, audit, { staffCode: ceo.code.toLowerCase(), env: { BREAK_GLASS_SECRET: SECRET, BREAK_GLASS_CONFIRM: SECRET } });
    if (restoreCeos.length) await prisma.staff.updateMany({ where: { id: { in: restoreCeos } }, data: { status: 'active' } });
    restoreCeos = [];
    expect(result.code).toBe(ceo.code);
    expect(result.tempPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: ceo.id } });
    expect(row).toMatchObject({ status: 'pending_invite', totpEnabled: false, totpSecret: null, tempPasswordIssuedByStaffId: null });
    expect(await prisma.staffSession.count({ where: { staffId: ceo.id, revokedAt: null } })).toBe(0);
    const history = await prisma.staffPasswordReset.findFirstOrThrow({ where: { staffId: ceo.id } });
    expect(history).toMatchObject({ kind: 'break_glass', issuedByStaffId: null });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'staff.break_glass_temp_password', entityCode: ceo.code } });
    expect(log.actorId).toBe(BREAK_GLASS_ACTOR);
    expect(JSON.stringify(log)).not.toContain(result.tempPassword);
    const start = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.71.0.1')
      .send({ staffCode: ceo.code, password: result.tempPassword, deviceId: `bg-${ts}` });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ status: 'setup_required', authenticatorSetupRequired: true });
  });
});
