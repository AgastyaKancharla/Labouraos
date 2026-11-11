import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/rbac/roles.decorator';
import { BENGALURU_AREAS } from '../screens-call-registration/bengaluru-areas';
import { AreaController } from './area.controller';
import { AreaService, areaNameKey } from './area.service';

const actor = { id: 'ceo-1', role: 'ceo' };

function area(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    name: 'BTM Layout',
    nameKey: 'btm layout',
    pincode: '560076',
    latitude: 12.9166,
    longitude: 77.6101,
    active: true,
    mergedIntoId: null,
    createdByStaffId: null,
    updatedByStaffId: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...over,
  };
}

function makePrisma(over: Record<string, unknown> = {}) {
  const updateMany = () => jest.fn().mockResolvedValue({ count: 2 });
  return {
    area: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(area({ id: 'new', ...data }))),
      update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve(area({ id: where.id, ...data }))),
    },
    business: { groupBy: jest.fn().mockResolvedValue([]), updateMany: updateMany() },
    jobSeeker: { groupBy: jest.fn().mockResolvedValue([]), updateMany: updateMany() },
    vacancy: { groupBy: jest.fn().mockResolvedValue([]), updateMany: updateMany() },
    businessBranch: { updateMany: updateMany() },
    referral: { updateMany: updateMany() },
    $executeRaw: jest.fn().mockResolvedValue(1),
    ...over,
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new AreaService(prisma as never, audit as never), audit };
}

describe('AreaService', () => {
  it('normalises names so capitalisation and spaces do not make a second area', () => {
    expect(areaNameKey('  HSR   layout ')).toBe('hsr layout');
  });

  it('serves the active managed areas to the forms, A–Z, in the same shape as before', async () => {
    const prisma = makePrisma();
    prisma.area.findMany.mockResolvedValue([area(), area({ id: 'a2', name: 'HSR Layout', nameKey: 'hsr layout', pincode: '560102' })]);
    const { service } = makeService(prisma);
    const out = await service.options();
    expect(prisma.area.findMany).toHaveBeenCalledWith({ where: { active: true }, orderBy: { name: 'asc' } });
    expect(out).toEqual([
      { name: 'BTM Layout', pincode: '560076', latitude: 12.9166, longitude: 77.6101 },
      { name: 'HSR Layout', pincode: '560102', latitude: 12.9166, longitude: 77.6101 },
    ]);
  });

  it('falls back to the starting list only while the table has never been filled', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    expect(await service.options()).toEqual(BENGALURU_AREAS);
    prisma.area.count.mockResolvedValue(3);
    expect(await service.options()).toEqual([]);
  });

  it('counts businesses, job seekers and open vacancies per area, whatever the capitalisation', async () => {
    const prisma = makePrisma();
    prisma.area.findMany.mockResolvedValue([area()]);
    prisma.business.groupBy.mockResolvedValue([
      { locality: 'BTM Layout', _count: { _all: 3 } },
      { locality: 'btm  layout', _count: { _all: 1 } },
      { locality: null, _count: { _all: 9 } },
    ]);
    prisma.jobSeeker.groupBy.mockResolvedValue([{ locality: 'BTM LAYOUT', _count: { _all: 7 } }]);
    prisma.vacancy.groupBy.mockResolvedValue([{ locality: 'BTM Layout', _count: { _all: 2 } }]);
    const { service } = makeService(prisma);
    const out = await service.manage({ search: 'btm', status: 'active' });
    expect(prisma.area.findMany.mock.calls[0][0].where).toMatchObject({ active: true });
    expect(prisma.vacancy.groupBy.mock.calls[0][0].where).toEqual({ status: 'open' });
    expect(out.rows[0]).toMatchObject({ name: 'BTM Layout', businesses: 4, jobSeekers: 7, openVacancies: 2, active: true });
  });

  it('adds an area with a Bengaluru pincode and centre point, and logs it', async () => {
    const prisma = makePrisma();
    const { service, audit } = makeService(prisma);
    const created = await service.create(actor, { name: ' Begur  Road ', pincode: '560068', latitude: 12.88, longitude: 77.62 });
    expect(prisma.area.create.mock.calls[0][0].data).toMatchObject({ name: 'Begur Road', nameKey: 'begur road', pincode: '560068', createdByStaffId: 'ceo-1' });
    expect(created.name).toBe('Begur Road');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'area.created', entityType: 'area' }));
  });

  it('refuses a missing name, a pincode outside Bengaluru, a pin outside the city and a duplicate', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);
    await expect(service.create(actor, { name: '', pincode: '560068', latitude: 12.9, longitude: 77.6 })).rejects.toThrow(BadRequestException);
    await expect(service.create(actor, { name: 'Begur', pincode: '600001', latitude: 12.9, longitude: 77.6 })).rejects.toThrow(/Bengaluru pincode/);
    await expect(service.create(actor, { name: 'Begur', pincode: '560068', latitude: 19.07, longitude: 72.87 })).rejects.toThrow(/inside Bengaluru/);
    prisma.area.findUnique.mockResolvedValue(area({ name: 'Begur', nameKey: 'begur' }));
    await expect(service.create(actor, { name: 'BEGUR', pincode: '560068', latitude: 12.9, longitude: 77.6 })).rejects.toThrow(ConflictException);
  });

  it('renames an area and moves every record that names it', async () => {
    const prisma = makePrisma();
    prisma.area.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 'a1' ? area() : null));
    const { service, audit } = makeService(prisma);
    await service.update(actor, 'a1', { name: 'BTM Layout 1st Stage' });
    expect(prisma.business.updateMany).toHaveBeenCalledWith({
      where: { locality: { equals: 'BTM Layout', mode: 'insensitive' } },
      data: { locality: 'BTM Layout 1st Stage' },
    });
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'area.updated' }));
  });

  it('switches an area off without touching records, and never back on once merged', async () => {
    const prisma = makePrisma();
    prisma.area.findUnique.mockResolvedValue(area({ active: false, mergedIntoId: 'a2' }));
    const { service } = makeService(prisma);
    await expect(service.update(actor, 'a1', { active: true })).rejects.toThrow(/merged/);
    prisma.area.findUnique.mockResolvedValue(area());
    await service.update(actor, 'a1', { active: false });
    expect(prisma.business.updateMany).not.toHaveBeenCalled();
    await expect(service.update(actor, 'a1', {})).rejects.toThrow(/Nothing to change/);
  });

  it('merges a duplicate into another area: records move, the duplicate is switched off for good', async () => {
    const prisma = makePrisma();
    const dup = area({ id: 'dup', name: 'BTM 2nd Stage', nameKey: 'btm 2nd stage' });
    const main = area({ id: 'main' });
    prisma.area.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 'dup' ? dup : where.id === 'main' ? main : null));
    const { service, audit } = makeService(prisma);
    const out = await service.merge(actor, 'dup', { intoId: 'main' });
    for (const table of ['jobSeeker', 'business', 'businessBranch', 'referral', 'vacancy'] as const) {
      expect(prisma[table].updateMany).toHaveBeenCalledWith({
        where: { locality: { equals: 'BTM 2nd Stage', mode: 'insensitive' } },
        data: { locality: 'BTM Layout' },
      });
    }
    expect(prisma.area.update).toHaveBeenCalledWith({ where: { id: 'dup' }, data: { active: false, mergedIntoId: 'main', updatedByStaffId: 'ceo-1' } });
    expect(out.moved).toMatchObject({ business: 2, preferredAreas: 1 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'area.merged', entityCode: 'dup' }));
  });

  it('refuses to merge into itself, into a switched-off area or without a target', async () => {
    const prisma = makePrisma();
    prisma.area.findUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 'off' ? area({ id: 'off', active: false }) : area({ id: where.id })));
    const { service } = makeService(prisma);
    await expect(service.merge(actor, 'a1', {})).rejects.toThrow(/Pick the area/);
    await expect(service.merge(actor, 'a1', { intoId: 'a1' })).rejects.toThrow(/itself/);
    await expect(service.merge(actor, 'a1', { intoId: 'off' })).rejects.toThrow(/switched off/);
  });
});

describe('Areas routes', () => {
  const roles = (name: keyof AreaController) => Reflect.getMetadata(ROLES_METADATA_KEY, AreaController.prototype[name] as object);
  it('lets the CEO and Managers manage the list, and every form role read it; never Finance', () => {
    for (const name of ['manage', 'create', 'update', 'merge'] as const) {
      expect(roles(name)).toEqual(['ceo', 'manager']);
    }
    expect(roles('list')).toEqual(['ceo', 'manager', 'team_lead', 'call_agent', 'field_agent']);
    expect(roles('list')).not.toContain('finance');
  });
});
