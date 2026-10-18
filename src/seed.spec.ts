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
    const seededJobSeekerCodes = [
      'JS-00001',
      'JS-00002',
      'JS-00003',
      'JS-00004',
      'JS-00005',
      'JS-00006',
      'JS-00007',
    ];
    const seededReferralCodes = ['RF-00001'];

    const staffBefore = await prisma.staff.count({ where: { email: { in: seededStaffEmails } } });
    const businessBefore = await prisma.business.count({ where: { code: { in: seededBusinessCodes } } });
    const jsBefore = await prisma.jobSeeker.count({ where: { code: { in: seededJobSeekerCodes } } });
    const refBefore = await prisma.referral.count({ where: { code: { in: seededReferralCodes } } });

    // Run seed again
    await seed(prisma);

    const staffAfter = await prisma.staff.count({ where: { email: { in: seededStaffEmails } } });
    const businessAfter = await prisma.business.count({ where: { code: { in: seededBusinessCodes } } });
    const jsAfter = await prisma.jobSeeker.count({ where: { code: { in: seededJobSeekerCodes } } });
    const refAfter = await prisma.referral.count({ where: { code: { in: seededReferralCodes } } });

    expect(staffAfter).toBe(staffBefore);
    expect(businessAfter).toBe(businessBefore);
    expect(jsAfter).toBe(jsBefore);
    expect(refAfter).toBe(refBefore);
    expect(staffAfter).toBe(6);
    expect(businessAfter).toBe(3);
    expect(jsAfter).toBe(7);
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
