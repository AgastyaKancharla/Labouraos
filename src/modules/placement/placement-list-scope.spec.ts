import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { PlacementService } from './placement.service';

/**
 * GET /placements gave Team Leads and call and field agents every placement with its
 * fee and GST. Now an agent lists only the placements they are involved in (account
 * agent, registered or introduced the candidate, proposed the interview, created it),
 * a Team Lead their team's, and only the CEO and Finance see company money. A field
 * agent selling in the shop works the fee out with the fee calculator (Master Guide).
 */
describe('Placements list: scoped to the people involved, company money only for the CEO and Finance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let idService: IdService;
  let placements: PlacementService;
  const stamp = String(Date.now());
  let seq = 0;
  const staff: Record<string, { id: string; role: string }> = {};
  const ids = { business: [] as string[], seeker: [] as string[], vacancy: [] as string[], placement: [] as string[] };
  const byName: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    idService = app.get(IdService);
    placements = app.get(PlacementService);

    const make = async (key: string, role: string, teamLeadId: string | null = null) => {
      const row = await prisma.staff.create({
        data: { code: `PLS-${key}-${stamp}`, name: `Scope ${key}`, email: `pls-${key.toLowerCase()}-${stamp}@laboura.local`, passwordHash: 'x', role, city: 'Bengaluru', teamLeadId },
      });
      staff[key] = { id: row.id, role };
    };
    await make('CEO', 'ceo');
    await make('FIN', 'finance');
    await make('MGR', 'manager');
    await make('TL', 'team_lead');
    await make('CA', 'call_agent', staff.TL.id);
    await make('FA', 'field_agent');
    await make('OTHER', 'call_agent');

    const placement = async (name: string, opts: { accountAgentId?: string; registeredBy?: string; introducedBy?: string }) => {
      seq += 1;
      const tail = `${stamp.slice(-6)}${String(seq).padStart(2, '0')}`;
      const business = await prisma.business.create({
        data: { code: `BZ-PLS-${stamp}-${seq}`, name: `Scope Hotel ${seq}`, phone: `+9193${tail}`, city: 'Bengaluru', verificationStatus: 'verified', accountAgentId: opts.accountAgentId ?? null },
      });
      ids.business.push(business.id);
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-PLS-${stamp}-${seq}`, name: `Scope Seeker ${seq}`, phone: `+9194${tail}`, status: 'placed', city: 'Bengaluru',
          minSalary: 1500000, maxSalary: 2500000, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', registeredByStaffId: opts.registeredBy ?? null,
        },
      });
      ids.seeker.push(seeker.id);
      const vacancy = await prisma.vacancy.create({ data: { code: await idService.generateCode('vacancy'), businessId: business.id, tradeSkill: 'cook', city: 'Bengaluru' } });
      ids.vacancy.push(vacancy.id);
      if (opts.introducedBy) {
        await prisma.candidateIntroduction.create({
          data: { businessId: business.id, vacancyId: vacancy.id, jobSeekerId: seeker.id, shownByStaffId: opts.introducedBy, rank: 1, score: 1, matchReasons: {}, channel: 'in_person' },
        });
      }
      const p = await prisma.placement.create({
        data: {
          code: await idService.generateCode('placement'), vacancyId: vacancy.id, businessId: business.id, jobSeekerId: seeker.id, status: 'active',
          agreedSalary: 2000000, placementFee: 1000000, gstAmount: 180000, city: 'Bengaluru', feePercentAtCreation: 50, gstPercentAtCreation: 18,
        },
      });
      ids.placement.push(p.id);
      byName[name] = p.id;
    };
    await placement('registeredByCA', { registeredBy: staff.CA.id });
    await placement('accountAgentFA', { accountAgentId: staff.FA.id });
    await placement('introducedByOther', { introducedBy: staff.OTHER.id });
    await placement('nobody', {});
  }, 60000);

  afterAll(async () => {
    await prisma.placement.deleteMany({ where: { id: { in: ids.placement } } });
    await prisma.candidateIntroduction.deleteMany({ where: { vacancyId: { in: ids.vacancy } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: ids.vacancy } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: ids.seeker } } });
    await prisma.business.deleteMany({ where: { id: { in: ids.business } } });
    await prisma.staff.updateMany({ where: { id: { in: Object.values(staff).map((s) => s.id) } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: Object.values(staff).map((s) => s.id) } } });
    await app.close();
  });

  const mine = async (who: string) => {
    const rows = (await placements.findAll(staff[who].id)) as Array<Record<string, unknown>>;
    return rows.filter((r) => ids.placement.includes(r.id as string));
  };
  const names = (rows: Array<Record<string, unknown>>) =>
    Object.entries(byName).filter(([, id]) => rows.some((r) => r.id === id)).map(([name]) => name).sort();

  it('shows an agent only the placements they are involved in, with no fee or GST', async () => {
    const ca = await mine('CA');
    expect(names(ca)).toEqual(['registeredByCA']);
    expect(names(await mine('FA'))).toEqual(['accountAgentFA']);
    expect(names(await mine('OTHER'))).toEqual(['introducedByOther']);
    for (const row of ca) {
      expect(row).not.toHaveProperty('placementFee');
      expect(row).not.toHaveProperty('gstAmount');
      // The job salary is a work detail, not company money.
      expect(row.agreedSalary).toBe(2000000);
    }
  });

  it("shows a Team Lead their team's placements, with no fee or GST", async () => {
    const tl = await mine('TL');
    expect(names(tl)).toEqual(['registeredByCA']);
    expect(tl[0]).not.toHaveProperty('placementFee');
  });

  it('shows the CEO and Finance every placement with the fee and GST', async () => {
    for (const who of ['CEO', 'FIN']) {
      const rows = await mine(who);
      expect(names(rows)).toEqual(['accountAgentFA', 'introducedByOther', 'nobody', 'registeredByCA']);
      expect(rows[0]).toMatchObject({ placementFee: 1000000, gstAmount: 180000 });
    }
  });

  it('applies the same scope to a single placement: out of scope is 404', async () => {
    await expect(placements.findById(byName.accountAgentFA, staff.CA.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(placements.findById(byName.nobody, staff.TL.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(placements.findById(byName.registeredByCA, staff.OTHER.id)).rejects.toBeInstanceOf(NotFoundException);
    // By code as well as by id.
    const code = (await prisma.placement.findUniqueOrThrow({ where: { id: byName.introducedByOther } })).code;
    expect(((await placements.findById(code, staff.OTHER.id)) as Record<string, unknown>).id).toBe(byName.introducedByOther);
    expect(((await placements.findById(byName.registeredByCA, staff.TL.id)) as Record<string, unknown>).id).toBe(byName.registeredByCA);
    for (const who of ['CEO', 'FIN']) {
      expect(((await placements.findById(byName.nobody, staff[who].id)) as Record<string, unknown>).id).toBe(byName.nobody);
    }
    // A Manager opens any placement, as before, with no money.
    const mgr = (await placements.findById(byName.nobody, staff.MGR.id)) as Record<string, unknown>;
    expect(mgr.id).toBe(byName.nobody);
    expect(mgr).not.toHaveProperty('placementFee');
  });

  it('keeps the fee off a single placement for an agent too', async () => {
    const one = (await placements.findById(byName.registeredByCA, staff.CA.id)) as Record<string, unknown>;
    expect(one).not.toHaveProperty('placementFee');
    const ceo = (await placements.findById(byName.registeredByCA, staff.CEO.id)) as Record<string, unknown>;
    expect(ceo.placementFee).toBe(1000000);
  });
});
