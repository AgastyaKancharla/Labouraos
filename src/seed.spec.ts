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

    // Assert job seekers in different cities
    const jobSeekers = await prisma.jobSeeker.findMany({
      where: {
        code: { in: ['JS-00001', 'JS-00002', 'JS-00003'] },
      },
    });
    expect(jobSeekers.length).toBeGreaterThanOrEqual(3);

    const jsCities = new Set(jobSeekers.map((j) => j.city));
    expect(jsCities.size).toBeGreaterThanOrEqual(2); // Bengaluru, Mysuru
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
    const seededJobSeekerCodes = ['JS-00001', 'JS-00002', 'JS-00003'];

    const staffBefore = await prisma.staff.count({ where: { email: { in: seededStaffEmails } } });
    const businessBefore = await prisma.business.count({ where: { code: { in: seededBusinessCodes } } });
    const jsBefore = await prisma.jobSeeker.count({ where: { code: { in: seededJobSeekerCodes } } });

    // Run seed again
    await seed(prisma);

    const staffAfter = await prisma.staff.count({ where: { email: { in: seededStaffEmails } } });
    const businessAfter = await prisma.business.count({ where: { code: { in: seededBusinessCodes } } });
    const jsAfter = await prisma.jobSeeker.count({ where: { code: { in: seededJobSeekerCodes } } });

    expect(staffAfter).toBe(staffBefore);
    expect(businessAfter).toBe(businessBefore);
    expect(jsAfter).toBe(jsBefore);
    expect(staffAfter).toBe(6);
    expect(businessAfter).toBe(3);
    expect(jsAfter).toBe(3);
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
