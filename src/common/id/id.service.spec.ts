import { IdService, formatCode, ENTITY_PREFIXES, EntityType } from './id.service';
import { PrismaService } from '../prisma/prisma.service';

describe('IdService & Unique ID Generation', () => {
  let prisma: PrismaService;
  let idService: IdService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    idService = new IdService(prisma);
    await idService.onModuleInit();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('formatCode', () => {
    it('pads sequence to 5 digits with leading zeros', () => {
      expect(formatCode('JS', 1)).toBe('JS-00001');
      expect(formatCode('BZ', 42)).toBe('BZ-00042');
      expect(formatCode('RF', 999)).toBe('RF-00999');
      expect(formatCode('VC-', 15)).toBe('VC-00015');
    });

    it('rolls over cleanly past 99999 without truncation', () => {
      expect(formatCode('JS', 99999)).toBe('JS-99999');
      expect(formatCode('JS', 100000)).toBe('JS-100000');
      expect(formatCode('JS', 100001)).toBe('JS-100001');
      expect(formatCode('JS', 250000)).toBe('JS-250000');
    });

    it('rejects invalid or non-integer sequences', () => {
      expect(() => formatCode('JS', 0)).toThrow(TypeError);
      expect(() => formatCode('JS', -5)).toThrow(TypeError);
      expect(() => formatCode('JS', 1.5)).toThrow(TypeError);
    });
  });

  describe('Prefix mapping', () => {
    it('uses correct prefixes per entity type', async () => {
      const types: EntityType[] = [
        'job_seeker',
        'referral',
        'business',
        'vacancy',
        'placement',
        'field_agent',
        'call_agent',
        'staff',
        'payment',
        'audit_log',
      ];

      for (const type of types) {
        const code = await idService.generateCode(type);
        const expectedPrefix = ENTITY_PREFIXES[type];
        expect(code.startsWith(`${expectedPrefix}-`)).toBe(true);
        expect(code).toMatch(new RegExp(`^${expectedPrefix}-\\d{5,}$`));
      }
    });
  });

  describe('Concurrency & Collision Safety', () => {
    it('creates 50 codes concurrently and asserts 50 distinct codes without collision', async () => {
      const prefix = `CONCUR_${Date.now()}`;
      await idService.ensureSequenceExists(prefix);

      const promises = Array.from({ length: 50 }, () =>
        idService.generateCode(prefix),
      );
      const codes = await Promise.all(promises);

      expect(codes).toHaveLength(50);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(50);

      // Verify each follows format
      codes.forEach((code) => {
        expect(code).toMatch(new RegExp(`^${prefix}-\\d{5,}$`));
      });
    });

    it('creates 50 database records concurrently with generated codes without collision', async () => {
      const testTimestamp = Date.now();
      const createdBusinessIds: string[] = [];

      try {
        const createPromises = Array.from({ length: 50 }, async (_, index) => {
          const code = await idService.generateCode('business');
          const business = await prisma.business.create({
            data: {
              code,
              name: `Concurrent Business ${index}`,
              phone: `+9170${String(testTimestamp).slice(-6)}${String(index).padStart(2, '0')}`,
              area: 'Koramangala',
              city: 'Bengaluru',
            },
          });
          return business;
        });

        const results = await Promise.all(createPromises);
        expect(results).toHaveLength(50);

        results.forEach((b) => createdBusinessIds.push(b.id));

        const uniqueCodes = new Set(results.map((b) => b.code));
        expect(uniqueCodes.size).toBe(50);
      } finally {
        if (createdBusinessIds.length > 0) {
          await prisma.business.deleteMany({
            where: { id: { in: createdBusinessIds } },
          });
        }
      }
    });
  });
});
