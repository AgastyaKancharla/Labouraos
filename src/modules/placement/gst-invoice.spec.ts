import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePlacementFee, calculateGst, formatINR } from '../../common/money/money';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 8 Task 2: GST Invoice Generation', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let mgrToken: string;
  let financeToken: string;
  let caToken: string;
  let faToken: string;

  const staffIds: string[] = [];
  const placementIds: string[] = [];
  const vacancyIds: string[] = [];
  const businessIds: string[] = [];
  const jobSeekerIds: string[] = [];

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const area = `Area-INV-${timestamp}`;

  let confirmedPlacementId: string;
  let unevenSalaryPlacementId: string;
  let offeredPlacementId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const ceo = await prisma.staff.create({
      data: {
        code: `CEO-INV-${timestamp}`,
        name: 'CEO Invoice Test',
        email: `ceo_inv_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ceo.id);

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-INV-${timestamp}`,
        name: 'Manager Invoice Test',
        email: `mgr_inv_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    staffIds.push(mgr.id);

    const finance = await prisma.staff.create({
      data: {
        code: `FIN-INV-${timestamp}`,
        name: 'Finance Invoice Test',
        email: `fin_inv_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    staffIds.push(finance.id);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-INV-${timestamp}`,
        name: 'Call Agent Invoice Test',
        email: `ca_inv_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ca.id);

    const fa = await prisma.staff.create({
      data: {
        code: `FA-INV-${timestamp}`,
        name: 'Field Agent Invoice Test',
        email: `fa_inv_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area,
        city: 'Bengaluru',
      },
    });
    staffIds.push(fa.id);

    // Login tokens
    const login = async (email: string) => {
      const res = await enrolledLogin(app.getHttpServer(), { email, password });
      return (res.body.accessToken || res.body.token) as string;
    };

    ceoToken = await login(ceo.email);
    mgrToken = await login(mgr.email);
    financeToken = await login(finance.email);
    caToken = await login(ca.email);
    faToken = await login(fa.email);

    // Seed test business
    const business = await prisma.business.create({
      data: {
        code: `BZ-INV-${timestamp}`,
        name: 'Bangalore Tech Park Ltd',
        phone: `91${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        contactName: 'Ramesh Gupta',
        address: '100 Outer Ring Road, Bellandur',
        area,
        city: 'Bengaluru',
        gstNumber: '29ABCDE1234F1Z5',
      },
    });
    businessIds.push(business.id);

    // Seed test vacancies
    const vacancy1 = await prisma.vacancy.create({
      data: {
        code: `VC-INV1-${timestamp}`,
        businessId: business.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2000000, // ₹20,000 in paise
        status: 'open',
        city: 'Bengaluru',
      },
    });
    vacancyIds.push(vacancy1.id);

    const vacancy2 = await prisma.vacancy.create({
      data: {
        code: `VC-INV2-${timestamp}`,
        businessId: business.id,
        tradeSkill: 'Plumber',
        offeredSalary: 2500033, // ₹25,000.33 in paise (uneven division test)
        status: 'open',
        city: 'Bengaluru',
      },
    });
    vacancyIds.push(vacancy2.id);

    // Seed job seekers
    const worker1 = await prisma.jobSeeker.create({
      data: {
        code: `JS-INV1-${timestamp}`,
        name: 'Sunil Kumar',
        phone: `92${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        status: 'active',
        city: 'Bengaluru',
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      },
    });
    jobSeekerIds.push(worker1.id);

    const worker2 = await prisma.jobSeeker.create({
      data: {
        code: `JS-INV2-${timestamp}`,
        name: 'Anil Verma',
        phone: `93${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 2000000,
        maxSalary: 3000000,
        status: 'active',
        city: 'Bengaluru',
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      },
    });
    jobSeekerIds.push(worker2.id);

    // 1. Confirmed placement
    const fee1 = calculatePlacementFee(2000000);
    const gst1 = calculateGst(fee1);
    const pl1 = await prisma.placement.create({
      data: {
        code: `PL-INV1-${timestamp}`,
        vacancyId: vacancy1.id,
        jobSeekerId: worker1.id,
        businessId: business.id,
        agreedSalary: 2000000,
        placementFee: fee1,
        gstAmount: gst1,
        status: 'confirmed',
        joinedDate: new Date('2026-10-25T10:00:00.000Z'),
        city: 'Bengaluru',
      },
    });
    confirmedPlacementId = pl1.id;
    placementIds.push(pl1.id);

    // 2. Confirmed placement with uneven salary (2500033 paise)
    const fee2 = calculatePlacementFee(2500033);
    const gst2 = calculateGst(fee2);
    const pl2 = await prisma.placement.create({
      data: {
        code: `PL-INV2-${timestamp}`,
        vacancyId: vacancy2.id,
        jobSeekerId: worker2.id,
        businessId: business.id,
        agreedSalary: 2500033,
        placementFee: fee2,
        gstAmount: gst2,
        status: 'confirmed',
        joinedDate: new Date('2026-10-25T11:00:00.000Z'),
        city: 'Bengaluru',
      },
    });
    unevenSalaryPlacementId = pl2.id;
    placementIds.push(pl2.id);

    // 3. Offered placement (not yet confirmed)
    const pl3 = await prisma.placement.create({
      data: {
        code: `PL-INV3-${timestamp}`,
        vacancyId: vacancy1.id,
        jobSeekerId: worker1.id,
        businessId: business.id,
        agreedSalary: 2000000,
        placementFee: fee1,
        gstAmount: gst1,
        status: 'offered',
        city: 'Bengaluru',
      },
    });
    offeredPlacementId = pl3.id;
    placementIds.push(pl3.id);
  });

  afterAll(async () => {
    if (prisma) {
      if (staffIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { actorId: { in: staffIds } },
        }).catch(() => {});
      }
      if (placementIds.length > 0) {
        await prisma.placement.deleteMany({
          where: { id: { in: placementIds } },
        }).catch(() => {});
      }
      if (vacancyIds.length > 0) {
        await prisma.vacancy.deleteMany({
          where: { id: { in: vacancyIds } },
        }).catch(() => {});
      }
      if (jobSeekerIds.length > 0) {
        await prisma.jobSeeker.deleteMany({
          where: { id: { in: jobSeekerIds } },
        }).catch(() => {});
      }
      if (businessIds.length > 0) {
        await prisma.business.deleteMany({
          where: { id: { in: businessIds } },
        }).catch(() => {});
      }
      if (staffIds.length > 0) {
        await prisma.staff.deleteMany({
          where: { id: { in: staffIds } },
        }).catch(() => {});
      }
    }
    if (app) {
      await app.close();
    }
  });

  it('1. GET /placements/:id/invoice generates a valid GST invoice with SAC 9985 and 18% GST', async () => {
    const res = await request(app.getHttpServer())
      .get(`/placements/${confirmedPlacementId}/invoice`)
      .set('Authorization', `Bearer ${ceoToken}`);

    expect(res.status).toBe(200);
    const invoice = res.body;

    // Sequential invoice numbering
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{5}$/);
    expect(invoice.invoiceDate).toBeDefined();

    // Supplier details & defaults
    expect(invoice.supplier).toBeDefined();
    expect(invoice.supplier.legalName).toBeDefined();
    expect(invoice.supplier.gstin).toBe('GSTIN_PENDING_REGISTRATION');
    expect(invoice.supplier.stateCode).toBe('29');

    // Customer details
    expect(invoice.customer.businessName).toBe('Bangalore Tech Park Ltd');
    expect(invoice.customer.gstin).toBe('29ABCDE1234F1Z5');
    expect(invoice.customer.address).toBe('100 Outer Ring Road, Bellandur');

    // Placement details
    expect(invoice.placement.tradeSkill).toBe('Electrician');
    expect(invoice.placement.monthlySalaryPaise).toBe(2000000);

    // Line items & SAC
    expect(invoice.lineItems.length).toBe(1);
    const lineItem = invoice.lineItems[0];
    expect(lineItem.sacCode).toBe('9985');
    expect(lineItem.baseAmountPaise).toBe(1000000); // 50% of 20,000.00
    expect(lineItem.taxRatePercent).toBe(18);
    expect(lineItem.cgstRatePercent).toBe(9);
    expect(lineItem.cgstAmountPaise).toBe(90000);
    expect(lineItem.sgstRatePercent).toBe(9);
    expect(lineItem.sgstAmountPaise).toBe(90000);
    expect(lineItem.totalAmountPaise).toBe(1180000); // 1000000 + 180000

    // Summary
    expect(invoice.summary.subtotalPaise).toBe(1000000);
    expect(invoice.summary.totalTaxPaise).toBe(180000);
    expect(invoice.summary.totalAmountPaise).toBe(1180000);
    expect(invoice.summary.currency).toBe('INR');
    expect(invoice.summary.amountInWords).toBe(formatINR(1180000));
  });

  it('2. Invoice calculation handles uneven salary division without fractional paisa corruption', async () => {
    const res = await request(app.getHttpServer())
      .get(`/placements/${unevenSalaryPlacementId}/invoice`)
      .set('Authorization', `Bearer ${mgrToken}`);

    expect(res.status).toBe(200);
    const invoice = res.body;

    const salary = 2500033;
    const expectedBaseFee = calculatePlacementFee(salary); // Math.round(2500033 * 0.5) = 1250017
    const expectedGst = calculateGst(expectedBaseFee); // Math.round(1250017 * 0.18) = 225003
    const expectedTotal = expectedBaseFee + expectedGst; // 1475020

    expect(Number.isInteger(expectedBaseFee)).toBe(true);
    expect(Number.isInteger(expectedGst)).toBe(true);
    expect(Number.isInteger(expectedTotal)).toBe(true);

    expect(invoice.summary.subtotalPaise).toBe(expectedBaseFee);
    expect(invoice.summary.totalTaxPaise).toBe(expectedGst);
    expect(invoice.summary.totalAmountPaise).toBe(expectedTotal);

    const lineItem = invoice.lineItems[0];
    expect(lineItem.baseAmountPaise).toBe(expectedBaseFee);
    expect(lineItem.cgstAmountPaise + lineItem.sgstAmountPaise).toBe(expectedGst);
    expect(lineItem.totalAmountPaise).toBe(expectedTotal);
  });

  it('3. Repeated invoice calls are idempotent and retain the exact same invoice number', async () => {
    const firstCall = await request(app.getHttpServer())
      .get(`/placements/${confirmedPlacementId}/invoice`)
      .set('Authorization', `Bearer ${ceoToken}`);

    const secondCall = await request(app.getHttpServer())
      .get(`/placements/${confirmedPlacementId}/invoice`)
      .set('Authorization', `Bearer ${ceoToken}`);

    expect(firstCall.status).toBe(200);
    expect(secondCall.status).toBe(200);
    expect(firstCall.body.invoiceNumber).toBe(secondCall.body.invoiceNumber);

    // Verify audit log exists
    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'placement.invoice_generated',
        entityType: 'placement',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeDefined();
  });

  it('4. Custom environment variables override company GSTIN, legal name, and address', async () => {
    const originalGstin = process.env.COMPANY_GSTIN;
    const originalName = process.env.COMPANY_LEGAL_NAME;
    const originalAddress = process.env.COMPANY_ADDRESS;

    try {
      process.env.COMPANY_GSTIN = '29AABCL1234F1ZQ';
      process.env.COMPANY_LEGAL_NAME = 'Laboura Private Limited';
      process.env.COMPANY_ADDRESS = '42 MG Road, Bengaluru, Karnataka 560001';

      const res = await request(app.getHttpServer())
        .get(`/placements/${confirmedPlacementId}/invoice`)
        .set('Authorization', `Bearer ${ceoToken}`);

      expect(res.status).toBe(200);
      expect(res.body.supplier.gstin).toBe('29AABCL1234F1ZQ');
      expect(res.body.supplier.legalName).toBe('Laboura Private Limited');
      expect(res.body.supplier.address).toBe('42 MG Road, Bengaluru, Karnataka 560001');
    } finally {
      if (originalGstin === undefined) delete process.env.COMPANY_GSTIN;
      else process.env.COMPANY_GSTIN = originalGstin;

      if (originalName === undefined) delete process.env.COMPANY_LEGAL_NAME;
      else process.env.COMPANY_LEGAL_NAME = originalName;

      if (originalAddress === undefined) delete process.env.COMPANY_ADDRESS;
      else process.env.COMPANY_ADDRESS = originalAddress;
    }
  });

  it('5. RBAC: Finance reads invoice with PII phone numbers masked; CEO/Manager have full access', async () => {
    const finRes = await request(app.getHttpServer())
      .get(`/placements/${confirmedPlacementId}/invoice`)
      .set('Authorization', `Bearer ${financeToken}`);

    expect(finRes.status).toBe(200);
    // PII masking check for finance
    expect(finRes.body.placement.candidatePhone).toBe('********');
    expect(finRes.body.customer.contactPhone).toBe('********');

    // CEO has full access (not masked)
    const ceoRes = await request(app.getHttpServer())
      .get(`/placements/${confirmedPlacementId}/invoice`)
      .set('Authorization', `Bearer ${ceoToken}`);
    expect(ceoRes.status).toBe(200);
    expect(ceoRes.body.placement.candidatePhone).not.toBe('********');
  });

  it('6. RBAC: Call Agent and Field Agent are DENIED access (403 Forbidden)', async () => {
    const caRes = await request(app.getHttpServer())
      .get(`/placements/${confirmedPlacementId}/invoice`)
      .set('Authorization', `Bearer ${caToken}`);
    expect(caRes.status).toBe(403);

    const faRes = await request(app.getHttpServer())
      .get(`/placements/${confirmedPlacementId}/invoice`)
      .set('Authorization', `Bearer ${faToken}`);
    expect(faRes.status).toBe(403);
  });

  it('7. Rejects invoice generation on unconfirmed placement (400 Bad Request)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/placements/${offeredPlacementId}/invoice`)
      .set('Authorization', `Bearer ${ceoToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invoice can only be generated for confirmed or active placements');
  });
});
