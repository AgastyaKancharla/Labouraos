import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { applyTrustProxy } from '../http/trust-proxy';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { JwtStrategy } from '../auth/jwt.strategy';
import { requestContext, runWithRequestId } from '../observability/request-context';
import { RequestIdMiddleware } from '../observability/request-id.middleware';
import { AuditService, maskPhoneLike } from './audit.service';

/**
 * C-Audit's Device column: every audit row written during a request records
 * the device (StaffDevice id and label, from the session or the device a
 * login names) and the network (an office network by its label, or outside
 * the office). Rows written outside a request (jobs) have none. A phone
 * number never lands in these columns.
 */
describe('Audit rows record the device and the network', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  const password = 'Audit-Device-Password-1';
  const createdIds: string[] = [];
  const officeIds: string[] = [];
  let counter = 0;
  const OFFICE_RANGE = '10.91.0.0/16';
  const OFFICE_LABEL = `Audit office ${Date.now()}`;

  async function makeAgent(label = 'Phone', platform = 'android') {
    counter += 1;
    const staff = await prisma.staff.create({
      data: {
        code: `AD-FA-${Date.now()}-${counter}`,
        name: `Audit device ${counter}`,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'field_agent',
        status: 'active',
      },
    });
    createdIds.push(staff.id);
    const deviceId = `ad-phone-${staff.id}`;
    await prisma.staffDevice.create({
      data: { staffId: staff.id, deviceId, label, platform, status: 'approved', approvedAt: new Date() },
    });
    return { staff, deviceId };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
    const office = await prisma.officeNetwork.create({ data: { label: OFFICE_LABEL, cidr: OFFICE_RANGE, active: true } });
    officeIds.push(office.id);
  });

  afterAll(async () => {
    await prisma.staffSession.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: createdIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.officeNetwork.deleteMany({ where: { id: { in: officeIds } } });
    await app.close();
  });

  it('a login from the office records the phone and the office network on its audit row', async () => {
    const { staff, deviceId } = await makeAgent();
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '10.91.4.20')
      .send({ staffCode: staff.code, password, deviceId });
    expect(res.body.status).toBe('awaiting_code');
    const row = await prisma.auditLog.findFirstOrThrow({ where: { actorId: staff.id, action: 'login_code.created' } });
    expect(row.deviceId).toBe(deviceId);
    expect(row.deviceName).toBe('Phone (android)');
    expect(row.network).toBe(`office:${OFFICE_LABEL}`);

    // The verified login's session carries the device to every later request.
    const verified = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .set('X-Forwarded-For', '10.91.4.20')
      .send({ loginRequestId: res.body.loginRequestId, code: loginCodeFor(res.body.loginRequestId) });
    expect(verified.status).toBe(200);
  });

  it('a signed-in request records the session’s device, and outside_office away from the office', async () => {
    const { staff, deviceId } = await makeAgent('Kiran’s phone', 'ios');
    const session = await prisma.staffSession.create({
      data: {
        staffId: staff.id,
        deviceId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        absoluteExpiresAt: new Date(Date.now() + 120 * 60_000),
      },
    });
    const strategy = app.get(JwtStrategy);
    const row = await runWithRequestId(
      'req-audit-device',
      async () => {
        await strategy.validate({ sub: staff.id, role: 'field_agent', email: null, code: staff.code, sid: session.id });
        return audit.log({ actorId: staff.id, action: 'test.audit_device', entityType: 'staff', entityCode: staff.code, after: { status: 'ok' } });
      },
      { ip: '203.0.113.9' },
    );
    expect(row.deviceId).toBe(deviceId);
    expect(row.deviceName).toBe('Kiran’s phone (ios)');
    expect(row.network).toBe('outside_office');
  });

  it('every row of one request gets the same device (resolved once)', async () => {
    const { staff, deviceId } = await makeAgent();
    const [a, b] = await runWithRequestId(
      'req-audit-twice',
      async () => [
        await audit.log({ actorId: staff.id, action: 'test.one', entityType: 'staff', entityCode: staff.code }),
        await audit.log({ actorId: staff.id, action: 'test.two', entityType: 'staff', entityCode: staff.code }),
      ],
      { ip: '10.91.200.1', staffId: staff.id, deviceId },
    );
    expect([a.deviceId, b.deviceId]).toEqual([deviceId, deviceId]);
    expect([a.network, b.network]).toEqual([`office:${OFFICE_LABEL}`, `office:${OFFICE_LABEL}`]);
  });

  it('never stores a full phone number, even when a device was named after one', async () => {
    const { staff, deviceId } = await makeAgent('Ravi 98450 12345', 'android');
    const row = await runWithRequestId(
      'req-audit-phone',
      () => audit.log({ actorId: staff.id, action: 'test.phone', entityType: 'staff', entityCode: staff.code }),
      { ip: '203.0.113.10', staffId: staff.id, deviceId },
    );
    expect(row.deviceName).toBe('Ravi ******2345 (android)');
    expect(JSON.stringify(row)).not.toContain('9845012345');
    expect(JSON.stringify(row)).not.toContain('98450 12345');
  });

  it('a device id that is itself a phone number keeps only its last 4 digits; a random id is kept as it is', async () => {
    const { staff } = await makeAgent();
    const phoneId = await runWithRequestId(
      'req-audit-phone-id',
      () => audit.log({ actorId: staff.id, action: 'test.phone_id', entityType: 'staff', entityCode: staff.code }),
      { staffId: staff.id, deviceId: '+91 98450 12345' },
    );
    expect(phoneId.deviceId).toBe('******2345');
    const uuid = '12345678-1234-4234-8234-123456789012';
    const randomId = await runWithRequestId(
      'req-audit-uuid',
      () => audit.log({ actorId: staff.id, action: 'test.uuid', entityType: 'staff', entityCode: staff.code }),
      { staffId: staff.id, deviceId: uuid },
    );
    expect(randomId.deviceId).toBe(uuid);
  });

  it('rows written outside a request (background jobs) have no device or network', async () => {
    const { staff } = await makeAgent();
    const row = await audit.log({ actorId: staff.id, action: 'test.job', entityType: 'staff', entityCode: staff.code });
    expect([row.deviceId, row.deviceName, row.network]).toEqual([null, null, null]);
  });

  it('the request-id middleware keeps the request address for the network column', () => {
    let seen: string | undefined;
    new RequestIdMiddleware().use(
      { headers: {}, ip: '10.91.1.1', socket: {} } as never,
      { setHeader: () => undefined } as never,
      () => {
        seen = requestContext.getStore()?.ip;
      },
    );
    expect(seen).toBe('10.91.1.1');
  });

  it('masks any run of 10 or more digits to its last 4', () => {
    expect(maskPhoneLike('+91 98450 12345')).toBe('******2345');
    expect(maskPhoneLike('9845012345')).toBe('******2345');
    expect(maskPhoneLike('Office PC 3')).toBe('Office PC 3');
    expect(maskPhoneLike('ad-phone-1f2e')).toBe('ad-phone-1f2e');
  });
});
