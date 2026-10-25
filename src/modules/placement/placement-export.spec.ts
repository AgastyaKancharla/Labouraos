import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RegulatoryPlacementExportRow } from './dto/export-placements.dto';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 8 Task 4: Regulatory Placement-Data Export', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let mgrToken: string;
  let finToken: string;
  let caToken: string;
  let faToken: string;

  const staffIds: string[] = [];
  const placementIds: string[] = [];
  const vacancyIds: string[] = [];
  const businessIds: string[] = [];
  const jobSeekerIds: string[] = [];

  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const area1 = `Area-EXP1-${timestamp}`;
  const area2 = `Area-EXP2-${timestamp}`;

  let pl1Code: string;
  let pl2Code: string;

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
        code: `CEO-EXP-${timestamp}`,
        name: 'CEO Export Test',
        email: `ceo_exp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ceo.id);

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-EXP-${timestamp}`,
        name: 'Manager Export Test',
        email: `mgr_exp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    staffIds.push(mgr.id);

    const fin = await prisma.staff.create({
      data: {
        code: `FIN-EXP-${timestamp}`,
        name: 'Finance Export Test',
        email: `fin_exp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });
    staffIds.push(fin.id);

    const ca = await prisma.staff.create({
      data: {
        code: `CA-EXP-${timestamp}`,
        name: 'Call Agent Export Test',
        email: `ca_exp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    staffIds.push(ca.id);

    const fa = await prisma.staff.create({
      data: {
        code: `FA-EXP-${timestamp}`,
        name: 'Field Agent Export Test',
        email: `fa_exp_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: area1,
        city: 'Bengaluru',
      },
    });
    staffIds.push(fa.id);

    const login = async (email: string) => {
      const res = await enrolledLogin(app.getHttpServer(), { email, password });
      return (res.body.accessToken || res.body.token) as string;
    };

    ceoToken = await login(ceo.email);
    mgrToken = await login(mgr.email);
    finToken = await login(fin.email);
    caToken = await login(ca.email);
    faToken = await login(fa.email);

    // Business 1 in Area 1
    const bz1 = await prisma.business.create({
      data: {
        code: `BZ-EXP1-${timestamp}`,
        name: 'Apex Manufacturing Ltd',
        phone: `96${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        area: area1,
        city: 'Bengaluru',
      },
    });
    businessIds.push(bz1.id);

    // Business 2 in Area 2
    const bz2 = await prisma.business.create({
      data: {
        code: `BZ-EXP2-${timestamp}`,
        name: 'Global Logistics Hub',
        phone: `97${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        area: area2,
        city: 'Bengaluru',
      },
    });
    businessIds.push(bz2.id);

    // Vacancies
    const vac1 = await prisma.vacancy.create({
      data: {
        code: `VC-EXP1-${timestamp}`,
        businessId: bz1.id,
        tradeSkill: 'Welder',
        offeredSalary: 2400000,
        city: 'Bengaluru',
      },
    });
    vacancyIds.push(vac1.id);

    const vac2 = await prisma.vacancy.create({
      data: {
        code: `VC-EXP2-${timestamp}`,
        businessId: bz2.id,
        tradeSkill: 'Forklift Operator',
        offeredSalary: 2800000,
        city: 'Bengaluru',
      },
    });
    vacancyIds.push(vac2.id);

    // Candidates
    const js1 = await prisma.jobSeeker.create({
      data: {
        code: `JS-EXP1-${timestamp}`,
        name: 'Gopal Krishnan',
        phone: `98${String(timestamp).slice(-8)}`,
        tradeSkill: 'Welder',
        minSalary: 2000000,
        maxSalary: 2600000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
      },
    });
    jobSeekerIds.push(js1.id);

    const js2 = await prisma.jobSeeker.create({
      data: {
        code: `JS-EXP2-${timestamp}`,
        name: 'Manoj Tiwari',
        phone: `99${String(timestamp).slice(-8)}`,
        tradeSkill: 'Forklift Operator',
        minSalary: 2200000,
        maxSalary: 3000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        city: 'Bengaluru',
      },
    });
    jobSeekerIds.push(js2.id);

    // Placement 1: Joined 2026-10-01
    const pl1 = await prisma.placement.create({
      data: {
        code: `PL-EXP1-${timestamp}`,
        vacancyId: vac1.id,
        jobSeekerId: js1.id,
        businessId: bz1.id,
        agreedSalary: 2400000,
        placementFee: 1200000,
        gstAmount: 216000,
        status: 'confirmed',
        joinedDate: new Date('2026-10-01T00:00:00.000Z'),
        city: 'Bengaluru',
      },
    });
    pl1Code = pl1.code;
    placementIds.push(pl1.id);

    // Placement 2: Joined 2026-10-20, Dropped out 2026-10-22
    const pl2 = await prisma.placement.create({
      data: {
        code: `PL-EXP2-${timestamp}`,
        vacancyId: vac2.id,
        jobSeekerId: js2.id,
        businessId: bz2.id,
        agreedSalary: 2800000,
        placementFee: 1400000,
        gstAmount: 252000,
        status: 'dropped_out',
        joinedDate: new Date('2026-10-20T00:00:00.000Z'),
        dropoutReportedAt: new Date('2026-10-22T00:00:00.000Z'),
        city: 'Bengaluru',
      },
    });
    pl2Code = pl2.code;
    placementIds.push(pl2.id);
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

  it('1. GET /placements/export returns CSV by default with Content-Disposition header and expected columns', async () => {
    const res = await request(app.getHttpServer())
      .get('/placements/export')
      .set('Authorization', `Bearer ${finToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment;\s*filename="placements-export-\d{4}-\d{2}-\d{2}\.csv"/);

    const csvContent = res.text;
    expect(csvContent).toContain('Placement Code,Joined Date,Dropout Date,Trade Skill,Candidate Code,Employer Code,Employer Name,Monthly Salary (INR),Placement Fee (INR),Status,Area,City');
    expect(csvContent).toContain(pl1Code);
    expect(csvContent).toContain('Apex Manufacturing Ltd');
    expect(csvContent).toContain('Welder');
    expect(csvContent).toContain('24000'); // ₹24,000 converted to rupees
    expect(csvContent).toContain('12000'); // ₹12,000 placement fee
  });

  it('2. GET /placements/export returns JSON when Accept: application/json is specified', async () => {
    const res = await request(app.getHttpServer())
      .get('/placements/export')
      .set('Authorization', `Bearer ${ceoToken}`)
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(Array.isArray(res.body)).toBe(true);

    const pl1Row = res.body.find((r: RegulatoryPlacementExportRow) => r.placementCode === pl1Code);
    expect(pl1Row).toBeDefined();
    expect(pl1Row.employerName).toBe('Apex Manufacturing Ltd');
    expect(pl1Row.tradeSkill).toBe('Welder');
    expect(pl1Row.monthlySalaryINR).toBe(24000);
    expect(pl1Row.placementFeeINR).toBe(12000);
    expect(pl1Row.status).toBe('confirmed');
    expect(pl1Row.joinedDate).toBe('2026-10-01');
    expect(pl1Row.dropoutDate).toBe('');

    const pl2Row = res.body.find((r: RegulatoryPlacementExportRow) => r.placementCode === pl2Code);
    expect(pl2Row).toBeDefined();
    expect(pl2Row.tradeSkill).toBe('Forklift Operator');
    expect(pl2Row.monthlySalaryINR).toBe(28000);
    expect(pl2Row.placementFeeINR).toBe(14000);
    expect(pl2Row.status).toBe('dropped_out');
    expect(pl2Row.joinedDate).toBe('2026-10-20');
    expect(pl2Row.dropoutDate).toBe('2026-10-22');
  });

  it('3. Filters export by date range, status, and area', async () => {
    // Filter by area1: should contain pl1 but not pl2
    const areaRes = await request(app.getHttpServer())
      .get(`/placements/export?area=${encodeURIComponent(area1)}`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .set('Accept', 'application/json');

    expect(areaRes.status).toBe(200);
    const areaRows = areaRes.body;
    expect(areaRows.some((r: RegulatoryPlacementExportRow) => r.placementCode === pl1Code)).toBe(true);
    expect(areaRows.some((r: RegulatoryPlacementExportRow) => r.placementCode === pl2Code)).toBe(false);

    // Filter by status=dropped_out: should contain pl2 but not pl1
    const statusRes = await request(app.getHttpServer())
      .get('/placements/export?status=dropped_out')
      .set('Authorization', `Bearer ${ceoToken}`)
      .set('Accept', 'application/json');

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.some((r: RegulatoryPlacementExportRow) => r.placementCode === pl2Code)).toBe(true);
    expect(statusRes.body.some((r: RegulatoryPlacementExportRow) => r.placementCode === pl1Code)).toBe(false);

    // Filter by date range (from 2026-10-15 to 2026-10-25): pl2 joined on Oct 20, pl1 on Oct 1
    const dateRes = await request(app.getHttpServer())
      .get('/placements/export?from=2026-10-15T00:00:00.000Z&to=2026-10-25T23:59:59.999Z')
      .set('Authorization', `Bearer ${finToken}`)
      .set('Accept', 'application/json');

    expect(dateRes.status).toBe(200);
    expect(dateRes.body.some((r: RegulatoryPlacementExportRow) => r.placementCode === pl2Code)).toBe(true);
    expect(dateRes.body.some((r: RegulatoryPlacementExportRow) => r.placementCode === pl1Code)).toBe(false);
  });

  it('4. RBAC: Call Agent and Field Agent are DENIED export access (403 Forbidden)', async () => {
    const caRes = await request(app.getHttpServer())
      .get('/placements/export')
      .set('Authorization', `Bearer ${caToken}`);
    expect(caRes.status).toBe(403);

    const faRes = await request(app.getHttpServer())
      .get('/placements/export')
      .set('Authorization', `Bearer ${faToken}`);
    expect(faRes.status).toBe(403);
  });
});
