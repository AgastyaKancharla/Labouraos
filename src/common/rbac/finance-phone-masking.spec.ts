import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { IdService } from '../id/id.service';
import { isPhoneLikeKey } from './pii-masking.interceptor';

/**
 * H1 (security check, 12 Nov): Finance sees money records with personal details
 * masked and no phone number at all (Master Guide, People and roles; AGENTS.md §7).
 * Only a few exact keys were masked, so WhatsApp, contact-person and additional
 * numbers reached Finance in full. This seeds a job seeker, a business and a
 * referral partner with a different number in every phone field, calls the main
 * endpoints Finance uses, and walks every answer: no seeded number appears
 * anywhere, and every phone-like field is fully masked.
 */
describe('H1: Finance never receives a phone number', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let financeToken = '';
  let ceoToken = '';

  const stamp = String(Date.now());
  const DAY = 24 * 60 * 60 * 1000;
  let counter = 0;
  /** Every number seeded, as stored (+91 and ten digits). */
  const numbers: string[] = [];
  const number = () => {
    counter += 1;
    const value = `+919${stamp.slice(-7)}${String(counter).padStart(2, '0')}`;
    numbers.push(value);
    return value;
  };

  const staffIds: string[] = [];
  let seekerId = '';
  let businessId = '';
  let referralId = '';
  let placementId = '';
  let vacancyId = '';
  let refundId = '';
  const paymentIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    const jwt = app.get(JwtService);

    for (const role of ['finance', 'ceo']) {
      const staff = await prisma.staff.create({
        data: {
          code: `H1-${role.toUpperCase()}-${stamp}`,
          name: `H1 ${role}`,
          email: `h1-${role}-${stamp}@laboura.local`,
          passwordHash: 'not-used',
          role,
          city: 'Bengaluru',
          status: 'active',
        },
      });
      staffIds.push(staff.id);
      const token = jwt.sign({ sub: staff.id, email: staff.email, role: staff.role, code: staff.code, teamLeadId: null });
      if (role === 'finance') financeToken = token;
      else ceoToken = token;
    }

    const referral = await prisma.referral.create({
      data: { code: `RF-H1-${stamp}`, name: 'H1 Partner', phone: number(), whatsappPhone: number(), phoneVerified: true, city: 'Bengaluru' },
    });
    referralId = referral.id;

    const paidAt = new Date(Date.now() - 40 * DAY);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-H1-${stamp}`,
        name: 'H1 Seeker',
        phone: number(),
        whatsappPhone: number(),
        phoneVerified: true,
        status: 'active',
        city: 'Bengaluru',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        paymentReceivedAt: paidAt,
        referredById: referral.id,
      },
    });
    seekerId = seeker.id;

    const business = await prisma.business.create({
      data: {
        code: `BZ-H1-${stamp}`,
        name: 'H1 Hotel',
        phone: number(),
        additionalContactPhone: number(),
        contactWhatsAppPhone: number(),
        city: 'Bengaluru',
        verificationStatus: 'verified',
      },
    });
    businessId = business.id;
    const vacancy = await prisma.vacancy.create({
      data: { code: await idService.generateCode('vacancy'), businessId, tradeSkill: 'cook', city: 'Bengaluru' },
    });
    vacancyId = vacancy.id;
    const placement = await prisma.placement.create({
      data: {
        code: await idService.generateCode('placement'),
        vacancyId,
        businessId,
        jobSeekerId: seekerId,
        status: 'active',
        agreedSalary: 2000000,
        placementFee: 1000000,
        gstAmount: 180000,
        city: 'Bengaluru',
        paidAt: new Date(Date.now() - 10 * DAY),
        joinedDate: new Date(Date.now() - 9 * DAY),
        feePercentAtCreation: 50,
        gstPercentAtCreation: 18,
        invoiceCode: `INV-H1-${stamp}`,
      },
    });
    placementId = placement.id;

    const pay = async (data: Record<string, unknown>) => {
      const p = await prisma.payment.create({
        data: { code: await idService.generateCode('payment'), city: 'Bengaluru', ...data } as never,
      });
      paymentIds.push(p.id);
      return p;
    };
    const activation = await pay({ type: 'activation', amount: 49900, status: 'succeeded', subjectType: 'job_seeker', subjectId: seekerId, jobSeekerId: seekerId, confirmedAt: paidAt, createdAt: paidAt });
    const refund = await pay({ type: 'refund', amount: 49900, status: 'approved', approvedAt: new Date(), subjectType: 'job_seeker', subjectId: seekerId, jobSeekerId: seekerId, refundsPaymentId: activation.id });
    refundId = refund.id;
    await pay({ type: 'placement_fee', amount: 1180000, status: 'succeeded', subjectType: 'placement', subjectId: placementId, placementId, businessId, confirmedAt: new Date(Date.now() - 10 * DAY) });
    await pay({ type: 'referral_payout', amount: 20000, status: 'pending', subjectType: 'referral', subjectId: referralId, referralId, placementId, jobSeekerId: seekerId, businessId });
    await pay({ type: 'joining_reward', amount: 20000, status: 'pending', subjectType: 'job_seeker', subjectId: seekerId, jobSeekerId: seekerId, placementId });
  }, 60000);

  afterAll(async () => {
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: [...paymentIds, seekerId, placementId] } } });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.placement.deleteMany({ where: { id: placementId } });
    await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    await prisma.jobSeeker.deleteMany({ where: { id: seekerId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.referral.deleteMany({ where: { id: referralId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  /** Every phone-like key that holds digits, anywhere in an answer, with its path. */
  const phoneFields = (data: unknown, path = '$', out: { path: string; value: unknown }[] = []) => {
    if (Array.isArray(data)) {
      data.forEach((item, i) => phoneFields(item, `${path}[${i}]`, out));
    } else if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (isPhoneLikeKey(key) && (typeof value === 'string' || typeof value === 'number') && /\d/.test(String(value))) {
          out.push({ path: `${path}.${key}`, value });
        } else {
          phoneFields(value, `${path}.${key}`, out);
        }
      }
    }
    return out;
  };

  const endpoints = () => [
    '/finance/home',
    '/finance/refunds',
    `/finance/refunds/pay-${refundId}`,
    '/finance/payouts',
    '/finance/money-in',
    '/finance/invoices',
    '/payments',
    `/payments/${refundId}`,
    '/payments/refunds/with-ceo',
    '/refunds/due',
    '/growth/money-under-guarantee',
    `/job-seekers/${seekerId}`,
    '/businesses',
    `/businesses/${businessId}`,
    `/referrals/${referralId}`,
    `/placements/${placementId}`,
  ];

  it('masks every phone-like field, and no seeded number appears, on the main Finance endpoints', async () => {
    const leaks: string[] = [];
    let checked = 0;
    for (const path of endpoints()) {
      const res = await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${financeToken}`);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      checked += 1;
      const text = JSON.stringify(res.body);
      for (const n of numbers) {
        if (text.includes(n) || text.includes(n.slice(3))) leaks.push(`${path}: contains ${n.slice(0, 5)}…`);
      }
      for (const field of phoneFields(res.body)) {
        if (field.value !== '********') leaks.push(`${path} ${field.path} = ${String(field.value).slice(0, 4)}…`);
      }
    }
    expect(checked).toBe(endpoints().length);
    expect(leaks).toEqual([]);
  });

  it('still shows the WhatsApp and contact numbers the tests seeded, so the masking check above is real', async () => {
    const seeker = await request(app.getHttpServer()).get(`/job-seekers/${seekerId}`).set('Authorization', `Bearer ${ceoToken}`).expect(200);
    expect(JSON.stringify(seeker.body)).toContain(numbers[3]); // the job seeker's WhatsApp number
    const business = await request(app.getHttpServer()).get(`/businesses/${businessId}`).set('Authorization', `Bearer ${ceoToken}`).expect(200);
    expect(JSON.stringify(business.body)).toContain(numbers[5]); // the business's additional contact
  });
});
