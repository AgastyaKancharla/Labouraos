import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../../modules/message/messaging.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { PHONE_CHANGED_SMS_TEMPLATE } from './phone-change-notice';

/**
 * Security follow-up M3 part 1 (proved): a job seeker's phone change took a
 * verified code of any purpose. Each record's phone change now needs a code
 * sent for that kind of record, and the OLD number is told by SMS.
 */
describe('Security M3: phone changes need a code of the right purpose and the old number is told', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let send: jest.SpyInstance;
  let token = '';
  const suffix = Date.now().toString().slice(-7);
  const d = suffix.slice(-5);
  const ids = { staff: '', seeker: '', business: '', referral: '' };
  const phones = {
    seeker: `+9192${d}001`, business: `+9192${d}002`, referral: `+9192${d}003`,
    newSeeker: `+9192${d}011`, newBusiness: `+9192${d}012`, newReferral: `+9192${d}013`,
  };
  const patch = (path: string, body: object) => request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    send = jest.spyOn(app.get(MessagingService), 'send');
    const ceo = await prisma.staff.create({ data: { code: `M3CEO-${suffix}`, name: 'M3 CEO', email: `m3_${suffix}@laboura.local`, passwordHash: 'h', role: 'ceo', city: 'Bengaluru' } });
    ids.staff = ceo.id;
    token = await app.get(JwtService).signAsync({ sub: ceo.id, role: 'ceo', email: ceo.email, code: ceo.code });
    ids.seeker = (await prisma.jobSeeker.create({ data: { code: `JS-M3-${suffix}`, name: 'M3 Seeker', phone: phones.seeker, city: 'Bengaluru', minSalary: 1, maxSalary: 2, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00' } })).id;
    ids.business = (await prisma.business.create({ data: { code: `BZ-M3-${suffix}`, name: `M3 Shop ${suffix}`, phone: phones.business, city: 'Bengaluru' } })).id;
    ids.referral = (await prisma.referral.create({ data: { code: `RF-M3-${suffix}`, name: 'M3 Partner', phone: phones.referral, city: 'Bengaluru' } })).id;
  });

  afterAll(async () => {
    try {
      await prisma.messageLog.deleteMany({ where: { subjectId: { in: [ids.seeker, ids.business, ids.referral] } } }).catch(() => undefined);
      await prisma.jobSeeker.deleteMany({ where: { id: ids.seeker } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { id: ids.business } }).catch(() => undefined);
      await prisma.referral.deleteMany({ where: { id: ids.referral } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: ids.staff } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: ids.staff } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  const noticeTo = (phone: string) =>
    send.mock.calls.map(([input]) => input).filter((input) => input.template === PHONE_CHANGED_SMS_TEMPLATE && input.recipientPhone === phone);

  it.each([
    ['job seeker', () => `/job-seekers/${ids.seeker}`, 'seeker', 'newSeeker', 'job_seeker', 'business_contact'],
    ['business', () => `/businesses/${ids.business}`, 'business', 'newBusiness', 'business_contact', 'job_seeker'],
    ['referral partner', () => `/referrals/${ids.referral}`, 'referral', 'newReferral', 'referral', 'job_seeker'],
  ] as const)('%s: a code for another purpose is refused; the right one saves and the old number gets an SMS', async (_label, path, oldKey, newKey, purpose, wrongPurpose) => {
    const wrong = await verifiedOtpFor(app, phones[newKey], wrongPurpose);
    expect((await patch(path(), { phone: phones[newKey], phoneOtpRequestId: wrong, reason: 'new number' })).status).toBe(400);
    expect(noticeTo(phones[oldKey])).toHaveLength(0);

    const right = await verifiedOtpFor(app, phones[newKey], purpose);
    expect((await patch(path(), { phone: phones[newKey], phoneOtpRequestId: right, reason: 'new number' })).status).toBe(200);
    const notices = noticeTo(phones[oldKey]);
    expect(notices).toHaveLength(1);
    expect(notices[0].variables).toEqual(expect.objectContaining({ newLast4: phones[newKey].slice(-4) }));
    expect(JSON.stringify(notices[0].variables)).not.toContain(phones[newKey].slice(3));
  });
});
