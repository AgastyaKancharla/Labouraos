import { Prisma } from '@prisma/client';
import { PricingService } from './pricing.service';

/**
 * Every save of Settings creates a new PricingPolicy version. A setting the
 * save does not mention must carry forward from the current version, never
 * fall back to its database default. This walks every scalar field Prisma
 * knows for PricingPolicy, so a field added later without a carry-forward line
 * fails here.
 */
describe('PricingService.createVersion carries every setting forward', () => {
  const skip = new Set(['id', 'createdAt', 'effectiveFrom', 'setByStaffId']);
  const fields = Prisma.dmmf.datamodel.models
    .find((m) => m.name === 'PricingPolicy')!
    .fields.filter((f) => f.kind === 'scalar' && !skip.has(f.name));

  function distinctValue(type: string, index: number): unknown {
    switch (type) {
      case 'Int':
        return 7000 + index;
      case 'Float':
      case 'Decimal':
        return 70 + index;
      case 'Boolean':
        return true;
      case 'DateTime':
        return new Date(Date.UTC(2031, 0, 1 + index));
      case 'Json':
        return { carried: index };
      default:
        return `carried-${index}`;
    }
  }

  it('copies every field the update does not change', async () => {
    const before: Record<string, unknown> = {
      id: 'policy-before',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      setByStaffId: null,
    };
    fields.forEach((field, index) => {
      before[field.name] = field.isList ? [index] : distinctValue(field.type, index);
    });

    let createdData: Record<string, unknown> = {};
    const prisma = {
      pricingPolicy: {
        findFirst: jest.fn().mockResolvedValue(before),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return Promise.resolve({ ...data, id: 'policy-after', createdAt: new Date() });
        }),
      },
      staff: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn() };
    const service = new PricingService(prisma as never, audit as never);

    await service.createVersion({ maxHits: 4 }, 'ceo-1');

    expect(createdData.maxHits).toBe(4);
    const notCarried = fields
      .filter((field) => field.name !== 'maxHits')
      .filter((field) => {
        const was = before[field.name];
        const now = createdData[field.name];
        return JSON.stringify(now) !== JSON.stringify(was);
      })
      .map((field) => field.name);
    expect(notCarried).toEqual([]);
  });
});

