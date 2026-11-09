import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TradeService } from './trade.service';

describe('TradeService', () => {
  it('queues one normalized suggestion and associates later subjects', async () => {
    const upsertSuggestion = jest.fn().mockResolvedValue({ id: 'suggestion-1' });
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      trade: { findUnique: jest.fn().mockResolvedValue(null) },
      tradeSuggestion: { upsert: upsertSuggestion },
      tradeSuggestionSubject: { upsert },
    };
    const service = new TradeService({} as PrismaService, {} as AuditService);

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
    const trade = { id: 'trade-1', name: 'Cook', active: true };
    const updateManySeekers = jest.fn().mockResolvedValue({ count: 2 });
    const updateManyVacancies = jest.fn().mockResolvedValue({ count: 1 });
    const updateSuggestion = jest.fn().mockResolvedValue({ ...suggestion, status: 'mapped' });
    const tx = {
      jobSeekerTrade: { updateMany: updateManySeekers },
      vacancy: { updateMany: updateManyVacancies },
      tradeSuggestion: { update: updateSuggestion },
    };
    const prisma = {
      tradeSuggestion: { findUnique: jest.fn().mockResolvedValue(suggestion) },
      trade: { findUnique: jest.fn().mockResolvedValue(trade) },
      $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaService;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const service = new TradeService(prisma, audit);

    const result = await service.mapSuggestion('suggestion-1', 'trade-1', 'manager-1');

    expect(updateManySeekers).toHaveBeenCalledWith({
      where: { trade: { equals: 'Special Cook', mode: 'insensitive' } }, data: { trade: 'Cook' },
    });
    expect(updateManyVacancies).toHaveBeenCalledWith({
      where: { tradeSkill: { equals: 'Special Cook', mode: 'insensitive' } }, data: { tradeSkill: 'Cook' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ seekerTradesRewritten: 2, vacanciesRewritten: 1 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'manager-1', action: 'trade.suggestion_mapped', entityCode: 'suggestion-1',
    }));
  });
});
