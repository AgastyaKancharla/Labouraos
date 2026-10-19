import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';

describe('Seed Data Script', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('npm run seed creates one staff member of each role, plus businesses and job seekers in different cities and areas', async () => {
    // Run seed
    await seed(prisma);

    // Assert all 6 staff roles are seeded
    const roles = ['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance'];
    for (const role of roles) {
      const staffMember = await prisma.staff.findFirst({
        where: { role },
      });
      expect(staffMember).toBeDefined();
      expect(staffMember?.role).toBe(role);
    }

    // Assert businesses in different cities and areas
    const businesses = await prisma.business.findMany({
      where: {
        code: { in: ['BZ-00001', 'BZ-00002', 'BZ-00003'] },
      },
    });
    expect(businesses.length).toBeGreaterThanOrEqual(3);

    const businessCities = new Set(businesses.map((b) => b.city));
    const businessAreas = new Set(businesses.map((b) => b.area));
    expect(businessCities.size).toBeGreaterThanOrEqual(2); // Bengaluru, Mysuru
    expect(businessAreas.size).toBeGreaterThanOrEqual(3); // Koramangala, Indiranagar, Hebbal

    // Assert job seekers in different cities and statuses
    const jobSeekers = await prisma.jobSeeker.findMany({
      where: {
        code: { in: ['JS-00001', 'JS-00002', 'JS-00003'] },
      },
    });
    expect(jobSeekers.length).toBeGreaterThanOrEqual(3);

    const jsCities = new Set(jobSeekers.map((j) => j.city));
    expect(jsCities.size).toBeGreaterThanOrEqual(2); // Bengaluru, Mysuru

    const jsStatuses = new Set(jobSeekers.map((j) => j.status));
    expect(jsStatuses.has('pending_payment')).toBe(true);
    expect(jsStatuses.has('active')).toBe(true);

    // Assert Phase 3 seeded job seekers: 1 hit, 2 hits, deactivated, reactivated
    const js1Hit = await prisma.jobSeeker.findUnique({
      where: { code: 'JS-00004' },
      include: { hits: true },
    });
    expect(js1Hit).toBeDefined();
    expect(js1Hit?.hitCount).toBe(1);
    expect(js1Hit?.status).toBe('active');
    expect(js1Hit?.hits).toHaveLength(1);

    const js2Hits = await prisma.jobSeeker.findUnique({
      where: { code: 'JS-00005' },
      include: { hits: true },
    });
    expect(js2Hits).toBeDefined();
    expect(js2Hits?.hitCount).toBe(2);
    expect(js2Hits?.status).toBe('active');
    expect(js2Hits?.hits).toHaveLength(2);

    const jsDeactivated = await prisma.jobSeeker.findUnique({
      where: { code: 'JS-00006' },
      include: { hits: true },
    });
    expect(jsDeactivated).toBeDefined();
    expect(jsDeactivated?.hitCount).toBe(3);
    expect(jsDeactivated?.status).toBe('deactivated');
    expect(jsDeactivated?.hits).toHaveLength(3);

    const jsReactivated = await prisma.jobSeeker.findUnique({
      where: { code: 'JS-00007' },
      include: { payments: true },
    });
    expect(jsReactivated).toBeDefined();
    expect(jsReactivated?.hitCount).toBe(0);
    expect(jsReactivated?.status).toBe('active');
    const reactPayment = jsReactivated?.payments.find((p) => p.reactivation);
    expect(reactPayment).toBeDefined();
    expect(reactPayment?.status).toBe('succeeded');
    expect(reactPayment?.amount).toBe(49900);

    // Assert at least one referral is seeded
    const referral = await prisma.referral.findUnique({
      where: { code: 'RF-00001' },
    });
    expect(referral).toBeDefined();
    expect(referral?.type).toBe('individual');

    // Assert Phase 4 seeded businesses have vacancies (1-2 each) and geofenceFlag
    const seededVacancies = await prisma.vacancy.findMany({
      where: {
        code: { in: ['VC-00001', 'VC-00002', 'VC-00003', 'VC-00004', 'VC-00005', 'VC-00006'] },
      },
    });
    expect(seededVacancies.length).toBe(6);
    for (const v of seededVacancies) {
      expect(v.status).toBe('open');
      expect(typeof v.offeredSalary).toBe('number');
      expect(v.offeredSalary).toBeGreaterThan(0);
    }

    // Assert replacement vacancies: at least one inside 15-day window and one outside it
    const fixedNow = new Date('2026-07-01T10:00:00.000Z');
    const inWindowRepl = seededVacancies.find((v) => v.code === 'VC-00005');
    const outWindowRepl = seededVacancies.find((v) => v.code === 'VC-00006');
    expect(inWindowRepl).toBeDefined();
    expect(outWindowRepl).toBeDefined();
    expect(inWindowRepl?.replacementForPlacementId).not.toBeNull();
    expect(outWindowRepl?.replacementForPlacementId).not.toBeNull();

    const daysOpenIn = Math.floor((fixedNow.getTime() - inWindowRepl!.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const daysOpenOut = Math.floor((fixedNow.getTime() - outWindowRepl!.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysOpenIn).toBeLessThanOrEqual(15);
    expect(daysOpenOut).toBeGreaterThan(15);

    // Assert job seekers spread across refund-clock days remaining (some ≤7, some >24)
    const allActive = await prisma.jobSeeker.findMany({
      where: {
        code: { in: ['JS-00001', 'JS-00003', 'JS-00004', 'JS-00005', 'JS-00007'] },
      },
    });
    const daysRemainingList = allActive
      .filter((j) => j.paymentReceivedAt)
      .map((j) => {
        const deadline = new Date(j.paymentReceivedAt!.getTime() + 30 * 24 * 60 * 60 * 1000);
        return Math.ceil((deadline.getTime() - fixedNow.getTime()) / (1000 * 60 * 60 * 24));
      });
    expect(daysRemainingList.some((d) => d <= 7)).toBe(true);
    expect(daysRemainingList.some((d) => d > 24)).toBe(true);

    // Assert at least one candidate sitting on exactly 2 hits
    expect(allActive.some((j) => j.hitCount === 2)).toBe(true);

    // At least one business is flagged for geofence mismatch
    const flaggedBiz = await prisma.business.findUnique({
      where: { code: 'BZ-00003' },
      include: { visits: true },
    });
    expect(flaggedBiz).toBeDefined();
    expect(flaggedBiz?.geofenceFlag).toBe(true);
    expect(flaggedBiz?.visits.some((v) => v.geofenceFlag)).toBe(true);
    // Assert Phase 5 seeded placements
    const pl1 = await prisma.placement.findUnique({ where: { code: 'PL-00001' } });
    expect(pl1?.status).toBe('dropped_out');
    expect(pl1?.dropoutReportedAt).toBeDefined();

    const pl2 = await prisma.placement.findUnique({ where: { code: 'PL-00002' } });
    expect(pl2?.status).toBe('active');
    expect(pl2?.joinedDate).toBeDefined();

    const pl3 = await prisma.placement.findUnique({ where: { code: 'PL-00003' } });
    expect(pl3?.status).toBe('dropped_out');
    const pl3Days = Math.floor((fixedNow.getTime() - pl3!.dropoutReportedAt!.getTime()) / (1000 * 60 * 60 * 24));
    expect(pl3Days).toBeGreaterThan(60);

    const pl4 = await prisma.placement.findUnique({
      where: { code: 'PL-00004' },
      include: { replacementCandidates: true },
    });
    expect(pl4?.status).toBe('dropped_out');
    expect(pl4?.replacementRejectionCount).toBe(3);
    expect(pl4?.clockPaused).toBe(true);
    expect(pl4?.replacementCandidates).toHaveLength(3);
  });

  it('is safe to run repeatedly without duplicating or erroring (idempotency)', async () => {
    const seededStaffEmails = [
      'ceo@laboura.local',
      'manager@laboura.local',
      'lead.koramangala@laboura.local',
      'call.agent@laboura.local',
      'field.agent@laboura.local',
      'finance@laboura.local',
    ];
    const seededBusinessCodes = ['BZ-00001', 'BZ-00002', 'BZ-00003'];
    const seededVacancyCodes = ['VC-00001', 'VC-00002', 'VC-00003', 'VC-00004', 'VC-00005', 'VC-00006'];
    const seededPlacementCodes = ['PL-00001', 'PL-00002', 'PL-00003', 'PL-00004'];
    const seededJobSeekerCodes = [
      'JS-00001',
      'JS-00002',
      'JS-00003',
      'JS-00004',
      'JS-00005',
      'JS-00006',
      'JS-00007',
      'JS-00008',
      'JS-00009',
      'JS-00010',
    ];
    const seededReferralCodes = ['RF-00001'];

    const staffBefore = await prisma.staff.count({ where: { email: { in: seededStaffEmails } } });
    const businessBefore = await prisma.business.count({ where: { code: { in: seededBusinessCodes } } });
    const vacancyBefore = await prisma.vacancy.count({ where: { code: { in: seededVacancyCodes } } });
    const placementBefore = await prisma.placement.count({ where: { code: { in: seededPlacementCodes } } });
    const jsBefore = await prisma.jobSeeker.count({ where: { code: { in: seededJobSeekerCodes } } });
    const refBefore = await prisma.referral.count({ where: { code: { in: seededReferralCodes } } });

    // Run seed again
    await seed(prisma);

    const staffAfter = await prisma.staff.count({ where: { email: { in: seededStaffEmails } } });
    const businessAfter = await prisma.business.count({ where: { code: { in: seededBusinessCodes } } });
    const vacancyAfter = await prisma.vacancy.count({ where: { code: { in: seededVacancyCodes } } });
    const placementAfter = await prisma.placement.count({ where: { code: { in: seededPlacementCodes } } });
    const jsAfter = await prisma.jobSeeker.count({ where: { code: { in: seededJobSeekerCodes } } });
    const refAfter = await prisma.referral.count({ where: { code: { in: seededReferralCodes } } });

    expect(staffAfter).toBe(staffBefore);
    expect(businessAfter).toBe(businessBefore);
    expect(vacancyAfter).toBe(vacancyBefore);
    expect(placementAfter).toBe(placementBefore);
    expect(jsAfter).toBe(jsBefore);
    expect(refAfter).toBe(refBefore);
    expect(staffAfter).toBe(6);
    expect(businessAfter).toBe(3);
    expect(vacancyAfter).toBe(6);
    expect(placementAfter).toBe(4);
    expect(jsAfter).toBe(10);
    expect(refAfter).toBe(1);
  });

  it('refuses to run if NODE_ENV=production', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(seed(prisma)).rejects.toThrow(
        /Refusing to seed database when NODE_ENV is "production"!/,
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
