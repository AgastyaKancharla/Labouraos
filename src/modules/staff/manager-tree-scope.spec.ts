import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { StaffService } from './staff.service';
import { StatusHistoryService } from '../status-history/status-history.service';

/**
 * Security check L6 and L7: a Manager reads only their own reporting tree, and a
 * Team Lead only their team, on the staff list, a staff record and status history.
 */
describe('Staff and status history are scoped to the reader\'s tree', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffService: StaffService;
  let history: StatusHistoryService;
  const stamp = String(Date.now());
  const people: Record<string, { id: string; role: string; code: string }> = {};
  const subjectIds: string[] = [];

  const jwt = (key: string): JwtPayload => ({ sub: people[key].id, role: people[key].role, code: people[key].code, email: null } as JwtPayload);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    staffService = app.get(StaffService);
    history = app.get(StatusHistoryService);
    const make = async (key: string, role: string, line: { reportsToId?: string; teamLeadId?: string } = {}) => {
      const row = await prisma.staff.create({
        data: { code: `MTS-${key}-${stamp}`, name: `Tree ${key}`, email: `mts-${key.toLowerCase()}-${stamp}@laboura.local`, passwordHash: 'x', role, city: 'Bengaluru', ...line },
      });
      people[key] = { id: row.id, role, code: row.code };
    };
    await make('CEO', 'ceo');
    await make('MGA', 'manager', { reportsToId: people.CEO.id });
    await make('MGB', 'manager', { reportsToId: people.CEO.id });
    await make('TLA', 'team_lead', { reportsToId: people.MGA.id });
    await make('TLB', 'team_lead', { reportsToId: people.MGB.id });
    await make('CAA', 'call_agent', { teamLeadId: people.TLA.id });
    await make('CAB', 'call_agent', { teamLeadId: people.TLB.id });
  }, 60000);

  afterAll(async () => {
    const ids = Object.values(people).map((p) => p.id);
    await prisma.statusHistory.deleteMany({ where: { subjectId: { in: [...subjectIds, ...ids] } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  const listed = async (key: string) => (await staffService.listStaff({}, jwt(key))).map((s) => s.id);

  it('lists for a Manager only their own tree', async () => {
    const mine = await listed('MGA');
    expect(mine).toEqual(expect.arrayContaining([people.TLA.id, people.CAA.id]));
    for (const other of ['MGB', 'TLB', 'CAB', 'CEO']) expect(mine).not.toContain(people[other].id);
    const ceo = await listed('CEO');
    expect(ceo).toEqual(expect.arrayContaining([people.CAA.id, people.CAB.id, people.MGB.id]));
  });

  it('opens a staff record only inside the tree or team', async () => {
    await expect(staffService.getStaffById(people.CAA.id, jwt('MGA'))).resolves.toMatchObject({ id: people.CAA.id });
    await expect(staffService.getStaffById(people.CAB.id, jwt('MGA'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(staffService.getStaffById(people.TLB.id, jwt('MGA'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(staffService.getStaffById(people.CAA.id, jwt('TLA'))).resolves.toMatchObject({ id: people.CAA.id });
    await expect(staffService.getStaffById(people.CAB.id, jwt('TLA'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(staffService.getStaffById(people.MGA.id, jwt('MGA'))).resolves.toMatchObject({ id: people.MGA.id });
    await expect(staffService.getStaffById(people.CAB.id, jwt('CEO'))).resolves.toMatchObject({ id: people.CAB.id });
  });

  it('shows a status trail only when it is about, or was changed by, someone in the tree', async () => {
    const trail = async (subjectType: string, subjectId: string, changedBy: string | null) => {
      subjectIds.push(subjectId);
      await prisma.statusHistory.create({ data: { subjectType, subjectId, fromStatus: null, toStatus: 'active', changedByStaffId: changedBy } });
    };
    const ours = `pl-ours-${stamp}`;
    const theirs = `pl-theirs-${stamp}`;
    const payment = `pay-${stamp}`;
    await trail('placement', ours, people.CAA.id);
    await trail('placement', theirs, people.CAB.id);
    await trail('payment', payment, null);
    await trail('staff', people.CAA.id, people.CEO.id);

    const as = (key: string) => ({ id: people[key].id, role: people[key].role });
    expect(await history.getHistory('placement', ours, as('MGA'))).toHaveLength(1);
    expect(await history.getHistory('placement', ours, as('TLA'))).toHaveLength(1);
    expect(await history.getHistory('placement', theirs, as('MGA'))).toEqual([]);
    expect(await history.getHistory('placement', theirs, as('TLA'))).toEqual([]);
    expect(await history.getHistory('payment', payment, as('TLA'))).toEqual([]);
    expect(await history.getHistory('staff', people.CAA.id, as('TLA'))).toHaveLength(1);
    expect(await history.getHistory('staff', people.CAA.id, as('MGB'))).toEqual([]);
    expect(await history.getHistory('placement', theirs, as('CEO'))).toHaveLength(1);
  });
});
