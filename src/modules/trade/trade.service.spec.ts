import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TradeService } from './trade.service';
import { PricingService } from '../pricing/pricing.service';

const pricing = { current: jest.fn().mockResolvedValue({ salaryDaysPerMonth: 26 }) } as unknown as PricingService;

describe('TradeService', () => {
  it('queues one normalized suggestion and associates later subjects', async () => {
    const upsertSuggestion = jest.fn().mockResolvedValue({ id: 'suggestion-1' });
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      trade: { findUnique: jest.fn().mockResolvedValue(null) },
      tradeSuggestion: { upsert: upsertSuggestion },
      tradeSuggestionSubject: { upsert },
    };
    const service = new TradeService({} as PrismaService, {} as AuditService, pricing);

    await service.recordSuggestion(tx as never, '  Special   Cook ', 'staff-1', 'job_seeker', 'seeker-1');
    await service.recordSuggestion(tx as never, 'special cook', 'staff-2', 'vacancy', 'vacancy-1');

    expect(upsertSuggestion).toHaveBeenCalledTimes(2);
    expect(upsertSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      where: { typedNameKey: 'special cook' },
      create: expect.objectContaining({ typedName: 'Special Cook', typedByStaffId: 'staff-1' }),
      update: {},
    }));
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('maps a suggestion by rewriting both entity types in one transaction and audit logs the change', async () => {
    const suggestion = { id: 'suggestion-1', typedName: 'Special Cook', status: 'waiting' };
    const trade = { id: 'trade-1', name: 'Cook', salaryMaxPaise: 2300000, active: true };
    const updateManySeekers = jest.fn().mockResolvedValue({ count: 2 });
    const updateManyVacancies = jest.fn().mockResolvedValue({ count: 1 });
    const updateSuggestion = jest.fn().mockResolvedValue({ ...suggestion, status: 'mapped' });
    const updateSeeker = jest.fn().mockResolvedValue({});
    const tx = {
      jobSeekerTrade: { updateMany: updateManySeekers },
      jobSeeker: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'seeker-1', code: 'JS-00001', city: 'Bengaluru', minSalary: 2500000,
          salaryPeriod: 'monthly', guaranteeFloorPaise: 2500000,
        }]),
        update: updateSeeker,
      },
      vacancy: { updateMany: updateManyVacancies },
      tradeSuggestion: { update: updateSuggestion },
    };
    const prisma = {
      tradeSuggestion: { findUnique: jest.fn().mockResolvedValue(suggestion) },
      trade: { findUnique: jest.fn().mockResolvedValue(trade) },
      $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaService;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new TradeService(prisma, audit, pricing);

    const result = await service.mapSuggestion('suggestion-1', 'trade-1', 'manager-1');

    expect(updateManySeekers).toHaveBeenCalledWith({
      where: { trade: { equals: 'Special Cook', mode: 'insensitive' } }, data: { trade: 'Cook' },
    });
    expect(updateManyVacancies).toHaveBeenCalledWith({
      where: { tradeSkill: { equals: 'Special Cook', mode: 'insensitive' } }, data: { tradeSkill: 'Cook' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updateSeeker).toHaveBeenCalledWith({ where: { id: 'seeker-1' }, data: { guaranteeFloorPaise: 2300000 } });
    expect(result).toMatchObject({ seekerTradesRewritten: 2, vacanciesRewritten: 1 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'manager-1', action: 'trade.suggestion_mapped', entityCode: 'suggestion-1',
    }));
  });

  it('recalculates a daily-salary candidate floor when their Other trade is added', async () => {
    const createdTrade = {
      id: 'trade-special', name: 'Special Cook', nameKey: 'special cook',
      salaryMinPaise: 1800000, salaryMaxPaise: 2300000, minimumWageLevel: 'unskilled',
      active: true, sortOrder: 17,
    };
    const updateSeeker = jest.fn().mockResolvedValue({});
    const tx = {
      trade: { create: jest.fn().mockResolvedValue(createdTrade) },
      jobSeeker: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'seeker-1', code: 'JS-00002', city: 'Bengaluru', minSalary: 100000,
          salaryPeriod: 'daily', guaranteeFloorPaise: 2600000,
        }]),
        update: updateSeeker,
      },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaService;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new TradeService(prisma, audit, pricing);

    await service.createTrade({
      name: 'Special Cook', salaryMinPaise: 1800000, salaryMaxPaise: 2300000,
    }, 'manager-1');

    expect(updateSeeker).toHaveBeenCalledWith({ where: { id: 'seeker-1' }, data: { guaranteeFloorPaise: 2300000 } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'job_seeker.guarantee_floor_recalculated', entityCode: 'JS-00002',
    }));
  });
});
