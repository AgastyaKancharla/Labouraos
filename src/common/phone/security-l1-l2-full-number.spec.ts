import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { FULL_NUMBER_SEARCH_ACTION, FULL_NUMBER_SEARCHES_PER_HOUR, recordFullNumberSearch } from './full-number-search';

/**
 * Security follow-ups L1 and L2. L1: an "Already registered" answer from
 * POST /otp/send or a create route tells a staff member the number is ours, so
 * it is audited and counted with the full-number searches (30 an hour). L2: the
 * count and the insert are one step under a per-staff lock, so parallel
 * requests cannot all slip under the limit.
 */
describe('Security L1/L2: "Already registered" answers count as full-number searches, atomically', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now().toString().slice(-7);
  const d = suffix.slice(-5);
  const staff: { id: string; token: string }[] = [];
  const ids = { seeker: '', referral: '' };
  const phones = { seeker: `+9191${d}001`, referral: `+9191${d}002`, unknown: `+9191${d}009` };

  const otpSend = (token: string, phone: string) =>
    request(app.getHttpServer()).post('/otp/send').set('Authorization', `Bearer ${token}`).send({ phone, purpose: 'job_seeker' });
  const searches = (actorId: string, entityCode?: string) =>
    prisma.auditLog.count({ where: { actorId, action: FULL_NUMBER_SEARCH_ACTION, ...(entityCode ? { entityCode } : {}) } });
  async function useUp(actorId: string, n: number) {
    for (let i = 0; i < n; i += 1) {
      await prisma.auditLog.create({ data: { code: `AU-L1-${suffix}-${actorId.slice(0, 6)}-${i}`, actorId, action: FULL_NUMBER_SEARCH_ACTION, entityType: 'search', entityCode: 'seed', changedFields: [] } });
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    for (let i = 0; i < 4; i += 1) {
      const s = await prisma.staff.create({ data: { code: `L1M-${suffix}-${i}`, name: `L1 Manager ${i}`, email: `l1_${suffix}_${i}@laboura.local`, passwordHash: 'h', role: 'manager', city: 'Bengaluru' } });
      staff.push({ id: s.id, token: await app.get(JwtService).signAsync({ sub: s.id, role: 'manager', email: s.email, code: s.code }) });
    }
    ids.seeker = (await prisma.jobSeeker.create({ data: { code: `JS-L1-${suffix}`, name: 'L1 Seeker', phone: phones.seeker, city: 'Bengaluru', minSalary: 1, maxSalary: 2, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' } })).id;
    ids.referral = (await prisma.referral.create({ data: { code: `RF-L1-${suffix}`, name: 'L1 Partner', phone: phones.referral, city: 'Bengaluru' } })).id;
  });

  afterAll(async () => {
    try {
      await prisma.jobSeeker.deleteMany({ where: { id: ids.seeker } }).catch(() => undefined);
      await prisma.referral.deleteMany({ where: { id: ids.referral } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: { in: staff.map((s) => s.id) } } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: { in: staff.map((s) => s.id) } } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  it('POST /otp/send: "Already registered" is recorded as a full-number search; a fresh number is not', async () => {
    const [m] = staff;
    const hit = await otpSend(m.token, phones.seeker);
    expect(hit.status).toBe(201);
    expect(hit.body.alreadyRegistered).toBe(true);
    expect(await searches(m.id, 'otp_send')).toBe(1);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { actorId: m.id, action: FULL_NUMBER_SEARCH_ACTION } });
    expect(JSON.stringify(row.after)).toContain(phones.seeker.slice(-4));
    expect(JSON.stringify(row.after)).not.toContain(phones.seeker.slice(3));
    expect((await otpSend(m.token, phones.unknown)).status).toBe(201);
    expect(await searches(m.id)).toBe(1);
  });

  it('POST /otp/send at the limit: refused with 429 for a number that is ours and for one that is not', async () => {
    const m = staff[1];
    await useUp(m.id, FULL_NUMBER_SEARCHES_PER_HOUR);
    expect((await otpSend(m.token, phones.seeker)).status).toBe(429);
    expect((await otpSend(m.token, phones.unknown)).status).toBe(429);
    expect(await searches(m.id)).toBe(FULL_NUMBER_SEARCHES_PER_HOUR);
  });

  it('a create route\'s "Already registered" 409 is recorded, and refused with 429 at the limit', async () => {
    const m = staff[2];
    const body = async () => ({
      name: 'Someone', phone: phones.referral, whatsappPhone: phones.referral, language: 'en', type: 'individual', individualRole: 'shop_staff',
      locality: 'Jayanagar', pincode: '560041', heardFrom: 'field_visit', otpRequestId: await verifiedOtpFor(app, phones.referral),
    });
    const post = async () => request(app.getHttpServer()).post('/referrals').set('Authorization', `Bearer ${m.token}`).send(await body());
    const dup = await post();
    expect(dup.status).toBe(409);
    expect(await searches(m.id, 'referral_create')).toBe(1);
    await useUp(m.id, FULL_NUMBER_SEARCHES_PER_HOUR - 1);
    expect((await post()).status).toBe(429);
    expect(await searches(m.id)).toBe(FULL_NUMBER_SEARCHES_PER_HOUR);
  });

  it('L2: parallel searches cannot pass the limit together (count and insert are one locked step)', async () => {
    const m = staff[3];
    await useUp(m.id, FULL_NUMBER_SEARCHES_PER_HOUR - 3);
    const audit = app.get(AuditService);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => recordFullNumberSearch(prisma, audit, { id: m.id, role: 'manager' }, 'search', phones.unknown)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(5);
    for (const r of refused) expect(r.reason.getStatus?.()).toBe(429);
    expect(await searches(m.id)).toBe(FULL_NUMBER_SEARCHES_PER_HOUR);
  });
});
