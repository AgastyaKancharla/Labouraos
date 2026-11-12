import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReferralService } from './referral.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { CreateReferralDto } from './dto/create-referral.dto';
import { SearchService } from '../screens-call-agent/search.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

/**
 * A Team Lead reads only referral partners registered by their team. The registering
 * agent is kept on the partner; partners registered before that (none kept) are seen
 * by the CEO and Managers only.
 */
describe('Referral partners: Team Lead reads only their team\'s', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let referrals: ReferralService;
  let search: SearchService;
  const stamp = String(Date.now());
  const staff: Record<string, { id: string; role: string }> = {};
  const referralIds: string[] = [];
  const byName: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    referrals = app.get(ReferralService);
    search = app.get(SearchService);
    const make = async (key: string, role: string, teamLeadId: string | null = null) => {
      const row = await prisma.staff.create({
        data: { code: `RTS-${key}-${stamp}`, name: `Ref ${key}`, email: `rts-${key.toLowerCase()}-${stamp}@laboura.local`, passwordHash: 'x', role, city: 'Bengaluru', teamLeadId },
      });
      staff[key] = { id: row.id, role };
    };
    await make('CEO', 'ceo');
    await make('MGR', 'manager');
    await make('TL', 'team_lead');
    await make('OTHERTL', 'team_lead');
    await make('MINE', 'call_agent', staff.TL.id);
    await make('THEIRS', 'field_agent', staff.OTHERTL.id);

    let n = 0;
    const partner = async (name: string, registeredByStaffId: string | null) => {
      n += 1;
      const row = await prisma.referral.create({
        data: { code: `RF-RTS-${stamp}-${n}`, name: `Quokka ${name}`, phone: `+9191${stamp.slice(-6)}${String(n).padStart(2, '0')}`, city: 'Bengaluru', registeredByStaffId },
      });
      referralIds.push(row.id);
      byName[name] = row.id;
    };
    await partner('mine', staff.MINE.id);
    await partner('byLead', staff.TL.id);
    await partner('theirs', staff.THEIRS.id);
    await partner('old', null);
  }, 60000);

  afterAll(async () => {
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    const ids = Object.values(staff).map((s) => s.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  const as = (key: string) => ({ id: staff[key].id, role: staff[key].role });
  const listed = async (key: string) => {
    const rows = await referrals.findAll(as(key));
    return Object.entries(byName).filter(([, id]) => rows.some((r) => r.id === id)).map(([name]) => name).sort();
  };

  it('lists for a Team Lead only partners their team registered, never older unattributed ones', async () => {
    expect(await listed('TL')).toEqual(['byLead', 'mine']);
    expect(await listed('OTHERTL')).toEqual(['theirs']);
  });

  it('opens one only inside the team (404 otherwise)', async () => {
    await expect(referrals.findById(byName.mine, as('TL'))).resolves.toMatchObject({ id: byName.mine });
    await expect(referrals.findById(byName.theirs, as('TL'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(referrals.findById(byName.old, as('TL'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('leaves the CEO and Managers every partner, old ones included', async () => {
    for (const who of ['CEO', 'MGR']) {
      expect(await listed(who)).toEqual(['byLead', 'mine', 'old', 'theirs']);
      await expect(referrals.findById(byName.old, as(who))).resolves.toMatchObject({ id: byName.old });
    }
  });

  it('applies the same scope to the search bar', async () => {
    const found = async (key: string) => {
      const res = await search.search({ sub: staff[key].id, role: staff[key].role, code: key, email: null } as JwtPayload, 'quokka', 'referral');
      return Object.entries(byName).filter(([, id]) => res.results.some((r) => r.id === id)).map(([name]) => name).sort();
    };
    expect(await found('TL')).toEqual(['byLead', 'mine']);
    expect(await found('CEO')).toEqual(['byLead', 'mine', 'old', 'theirs']);
  });

  it('records the agent who registers a partner', async () => {
    const phone = `+9190${stamp.slice(-6)}77`;
    const created = await referrals.create(
      {
        name: 'New Partner',
        phone,
        type: 'individual',
        whatsappPhone: phone,
        language: 'en',
        individualRole: 'shop_staff',
        locality: 'Indiranagar',
        pincode: '560038',
        heardFrom: 'field_visit',
        otpRequestId: await verifiedOtpFor(app, phone),
        city: 'Bengaluru',
      } as CreateReferralDto,
      staff.MINE.id,
    );
    referralIds.push(created.id);
    expect(created.registeredByStaffId).toBe(staff.MINE.id);
    await expect(referrals.findById(created.id, as('TL'))).resolves.toMatchObject({ id: created.id });
  });
});
