import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('Phase 19 Task 4: The final clean-up — removing the old columns', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const createdStaffIds: string[] = [];
  const createdSeekerIds: string[] = [];
  const createdBizIds: string[] = [];
  const createdVacancyIds: string[] = [];
  const createdPlacementIds: string[] = [];
  const createdPaymentIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        if (createdPaymentIds.length) {
          await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } }).catch(() => {});
        }
        if (createdPlacementIds.length) {
          await prisma.placement.deleteMany({ where: { id: { in: createdPlacementIds } } }).catch(() => {});
        }
        if (createdVacancyIds.length) {
          await prisma.vacancy.deleteMany({ where: { id: { in: createdVacancyIds } } }).catch(() => {});
        }
        if (createdBizIds.length) {
          await prisma.business.deleteMany({ where: { id: { in: createdBizIds } } }).catch(() => {});
        }
        if (createdSeekerIds.length) {
          await prisma.jobSeeker.deleteMany({ where: { id: { in: createdSeekerIds } } }).catch(() => {});
        }
        if (createdStaffIds.length) {
          await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } }).catch(() => {});
        }
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('1. Schema Verification — Dropped Columns Are Gone', () => {
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    const schemaContent = readFileSync(schemaPath, 'utf8');

    // Extract models
    const getModelBlock = (modelName: string): string => {
      const regex = new RegExp(`model\\s+${modelName}\\s+\\{([^}]+)\\}`, 'm');
      const match = schemaContent.match(regex);
      if (!match) throw new Error(`Model ${modelName} not found in schema`);
      return match[1];
    };

    it('JobSeeker does not contain tradeSkill, kycStatus, kycReference, or erasedAt', () => {
      const block = getModelBlock('JobSeeker');
      expect(block).not.toMatch(/^\s*tradeSkill\s+/m);
      expect(block).not.toMatch(/^\s*kycStatus\s+/m);
      expect(block).not.toMatch(/^\s*kycReference\s+/m);
      expect(block).not.toMatch(/^\s*erasedAt\s+/m);
      expect(block).not.toMatch(/@@index\(\[tradeSkill\]\)/);
    });

    it('Business does not contain area, contactName, selfieUrl, selfieHash, or erasedAt', () => {
      const block = getModelBlock('Business');
      expect(block).not.toMatch(/^\s*area\s+/m);
      expect(block).not.toMatch(/^\s*contactName\s+/m);
      expect(block).not.toMatch(/^\s*selfieUrl\s+/m);
      expect(block).not.toMatch(/^\s*selfieHash\s+/m);
      expect(block).not.toMatch(/^\s*erasedAt\s+/m);
      expect(block).not.toMatch(/@@index\(\[city,\s*area\]\)/);
    });

    it('Staff does not contain area or registeredDeviceId', () => {
      const block = getModelBlock('Staff');
      expect(block).not.toMatch(/^\s*area\s+/m);
      expect(block).not.toMatch(/^\s*registeredDeviceId\s+/m);
    });

    it('Placement does not contain clockPaused, clockPausedAt, replacementRejectionCount, or eligibility', () => {
      const block = getModelBlock('Placement');
      expect(block).not.toMatch(/^\s*clockPaused\s+/m);
      expect(block).not.toMatch(/^\s*clockPausedAt\s+/m);
      expect(block).not.toMatch(/^\s*replacementRejectionCount\s+/m);
      expect(block).not.toMatch(/^\s*eligibility\s+/m);
      expect(block).not.toMatch(/@@index\(\[status,\s*eligibility\]\)/);
    });

    it('Vacancy does not contain offeredSalary', () => {
      const block = getModelBlock('Vacancy');
      expect(block).not.toMatch(/^\s*offeredSalary\s+/m);
    });

    it('Payment does not contain payoutAttempts', () => {
      const block = getModelBlock('Payment');
      expect(block).not.toMatch(/^\s*payoutAttempts\s+/m);
    });
  });

  describe('2. Schema Verification — Kept Columns Are Intact', () => {
    const schemaPath = join(process.cwd(), 'prisma/schema.prisma');
    const schemaContent = readFileSync(schemaPath, 'utf8');

    const getModelBlock = (modelName: string): string => {
      const regex = new RegExp(`model\\s+${modelName}\\s+\\{([^}]+)\\}`, 'm');
      const match = schemaContent.match(regex);
      if (!match) throw new Error(`Model ${modelName} not found in schema`);
      return match[1];
    };

    it('Vacancy keeps tradeSkill', () => {
      const block = getModelBlock('Vacancy');
      expect(block).toMatch(/^\s*tradeSkill\s+String/m);
      expect(block).toMatch(/@@index\(\[tradeSkill\]\)/);
    });

    it('Placement keeps dropoutReportedAt and dropoutDateCallerSupplied', () => {
      const block = getModelBlock('Placement');
      expect(block).toMatch(/^\s*dropoutReportedAt\s+DateTime\?/m);
      expect(block).toMatch(/^\s*dropoutDateCallerSupplied\s+Boolean/m);
    });

    it('Payment keeps gatewayReference', () => {
      const block = getModelBlock('Payment');
      expect(block).toMatch(/^\s*gatewayReference\s+String\?/m);
    });
  });

  describe('3. Migration File Verification', () => {
    const migrationPath = join(
      process.cwd(),
      'prisma/migrations/20261112110000_final_cleanup/migration.sql',
    );

    it('migration file exists and drops all 17 columns and indexes', () => {
      const content = readFileSync(migrationPath, 'utf8');

      // JobSeeker drops
      expect(content).toContain('DROP COLUMN IF EXISTS "tradeSkill"');
      expect(content).toContain('DROP COLUMN IF EXISTS "kycStatus"');
      expect(content).toContain('DROP COLUMN IF EXISTS "kycReference"');
      expect(content).toContain('DROP COLUMN IF EXISTS "erasedAt"');
      expect(content).toContain('DROP INDEX IF EXISTS "JobSeeker_tradeSkill_idx"');

      // Business drops
      expect(content).toContain('DROP COLUMN IF EXISTS "area"');
      expect(content).toContain('DROP COLUMN IF EXISTS "contactName"');
      expect(content).toContain('DROP COLUMN IF EXISTS "selfieUrl"');
      expect(content).toContain('DROP COLUMN IF EXISTS "selfieHash"');
      expect(content).toContain('DROP INDEX IF EXISTS "Business_city_area_idx"');

      // Staff drops
      expect(content).toContain('DROP COLUMN IF EXISTS "registeredDeviceId"');

      // Placement drops
      expect(content).toContain('DROP COLUMN IF EXISTS "clockPaused"');
      expect(content).toContain('DROP COLUMN IF EXISTS "clockPausedAt"');
      expect(content).toContain('DROP COLUMN IF EXISTS "replacementRejectionCount"');
      expect(content).toContain('DROP COLUMN IF EXISTS "eligibility"');
      expect(content).toContain('DROP INDEX IF EXISTS "Placement_status_eligibility_idx"');

      // Vacancy drop
      expect(content).toContain('DROP COLUMN IF EXISTS "offeredSalary"');

      // Payment drop
      expect(content).toContain('DROP COLUMN IF EXISTS "payoutAttempts"');
    });
  });

  describe('4. Grep Test — No Dropped Columns Referenced in Application Source Code', () => {
    function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
      const files = readdirSync(dir);
      for (const file of files) {
        const fullPath = join(dir, file);
        if (statSync(fullPath).isDirectory()) {
          getAllSourceFiles(fullPath, fileList);
        } else if (
          file.endsWith('.ts') &&
          !file.endsWith('.d.ts') &&
          !fullPath.includes('/cleanup/phase-19-task-4-final-cleanup.spec.ts')
        ) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    }

    const srcFiles = getAllSourceFiles(join(process.cwd(), 'src'));

    it('no application source references unique dropped column names', () => {
      const uniqueDropped = [
        'clockPaused',
        'clockPausedAt',
        'replacementRejectionCount',
        'offeredSalary',
        'payoutAttempts',
        'registeredDeviceId',
      ];

      const violations: string[] = [];

      for (const filePath of srcFiles) {
        // Exclude test specs that test historic migration files
        if (filePath.endsWith('.spec.ts')) continue;

        const content = readFileSync(filePath, 'utf8');
        for (const col of uniqueDropped) {
          const regex = new RegExp(`\\b${col}\\b`, 'g');
          if (regex.test(content)) {
            violations.push(`${filePath} references dropped column "${col}"`);
          }
        }
      }

      expect(violations).toEqual([]);
    });

    it('no application source reads or writes JobSeeker.tradeSkill, Business.contactName, or Business.selfieUrl', () => {
      const violations: string[] = [];

      for (const filePath of srcFiles) {
        if (filePath.endsWith('.spec.ts')) continue;

        const content = readFileSync(filePath, 'utf8');

        // Check JobSeeker.tradeSkill usage
        if (
          content.includes('jobSeeker.tradeSkill') ||
          content.includes('seeker.tradeSkill') ||
          /jobSeeker\s*\.\s*(?:find|create|update)[^(]+\([^)]*\btradeSkill\s*:/s.test(content)
        ) {
          violations.push(`${filePath} references JobSeeker.tradeSkill`);
        }

        // Check Business.contactName usage
        if (
          content.includes('business.contactName') ||
          /business\s*\.\s*(?:find|create|update)[^(]+\([^)]*\bcontactName\s*:/s.test(content)
        ) {
          violations.push(`${filePath} references Business.contactName`);
        }

        // Check Business.selfieUrl usage
        if (
          content.includes('business.selfieUrl') ||
          /business\s*\.\s*(?:find|create|update)[^(]+\([^)]*\bselfieUrl\s*:/s.test(content)
        ) {
          violations.push(`${filePath} references Business.selfieUrl`);
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('5. Database Operations Without Dropped Columns', () => {
    it('creates and reads JobSeeker, Business, Vacancy, Placement, Payment without dropped columns', async () => {
      const ts = Date.now();

      // Create Staff without area or registeredDeviceId
      const staff = await prisma.staff.create({
        data: {
          code: `FA-T4-${ts}`,
          name: 'Task 4 Agent',
          email: `fa_t4_${ts}@laboura.local`,
          passwordHash: 'dummyhash',
          role: 'field_agent',
          city: 'Bengaluru',
        },
      });
      createdStaffIds.push(staff.id);

      // Create Business without area, contactName, selfieUrl, selfieHash, erasedAt
      const business = await prisma.business.create({
        data: {
          code: `BZ-T4-${ts}`,
          name: 'Task 4 Clean Business',
          phone: `+9180${String(ts).slice(-8)}`,
          phoneVerified: true,
          locality: 'Koramangala',
          ownerName: 'Owner Name',
          additionalContactName: 'Manager Contact',
          city: 'Bengaluru',
        },
      });
      createdBizIds.push(business.id);

      // Create JobSeeker without tradeSkill, kycStatus, kycReference, erasedAt
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-T4-${ts}`,
          name: 'Task 4 Clean Seeker',
          phone: `+9199${String(ts).slice(-8)}`,
          phoneVerified: true,
          minSalary: 1500000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '18:00',
          status: 'active',
          city: 'Bengaluru',
          trades: {
            create: {
              trade: 'Electrician',
              isPrimary: true,
            },
          },
        },
        include: { trades: true },
      });
      createdSeekerIds.push(seeker.id);

      // Create Vacancy keeping tradeSkill, without offeredSalary
      const vacancy = await prisma.vacancy.create({
        data: {
          code: `VC-T4-${ts}`,
          businessId: business.id,
          capturedByStaffId: staff.id,
          tradeSkill: 'Electrician',
          salaryMinPaise: 2000000,
          status: 'open',
          city: 'Bengaluru',
        },
      });
      createdVacancyIds.push(vacancy.id);

      // Create Placement keeping dropoutReportedAt, dropoutDateCallerSupplied, without clockPaused, replacementRejectionCount, eligibility
      const placement = await prisma.placement.create({
        data: {
          code: `PL-T4-${ts}`,
          vacancyId: vacancy.id,
          jobSeekerId: seeker.id,
          businessId: business.id,
          createdByStaffId: staff.id,
          placementFee: 1000000,
          gstAmount: 180000,
          agreedSalary: 2000000,
          joinedDate: new Date(),
          dropoutReportedAt: new Date(),
          dropoutDateCallerSupplied: true,
          status: 'dropped_out',
          city: 'Bengaluru',
        },
      });
      createdPlacementIds.push(placement.id);

      // Create Payment keeping gatewayReference, without payoutAttempts
      const payment = await prisma.payment.create({
        data: {
          code: `PAY-T4-${ts}`,
          type: 'activation',
          amount: 49900,
          status: 'succeeded',
          gatewayReference: `gw_t4_${ts}`,
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          jobSeekerId: seeker.id,
          city: 'Bengaluru',
        },
      });
      createdPaymentIds.push(payment.id);

      // Verify records in DB
      const readPlacement = await prisma.placement.findUniqueOrThrow({
        where: { id: placement.id },
      });
      expect(readPlacement.dropoutReportedAt).toBeDefined();
      expect(readPlacement.dropoutDateCallerSupplied).toBe(true);

      const readPayment = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(readPayment.gatewayReference).toBe(`gw_t4_${ts}`);

      const readVacancy = await prisma.vacancy.findUniqueOrThrow({
        where: { id: vacancy.id },
      });
      expect(readVacancy.tradeSkill).toBe('Electrician');
    });
  });
});
