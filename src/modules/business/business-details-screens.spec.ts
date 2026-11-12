import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CallWorkService } from '../screens-call-agent/call-work.service';
import { SearchService } from '../screens-call-agent/search.service';
import { ScreensCallRegistrationService } from '../screens-call-registration/screens-call-registration.service';
import { ScreensFieldService } from '../screens-field/screens-field.service';
import { FieldSellingScreensService } from '../field-selling/field-selling-screens.service';

/**
 * M2 on the screens: an agent sees a business's owner name, legal name, agreement
 * names and registration, tax, licence and billing details only for businesses they
 * hold (account agent, lead creator, open verification visit) — the same rule as the
 * businesses API (business-agent-view.ts). A name search can't reveal hidden names.
 */
describe('Business details on the agent screens follow the M2 rule', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = String(Date.now());
  const staff: Record<string, { id: string; role: string; code: string }> = {};
  let businessId = '';
  let businessCode = '';
  // Letters only, so the search bar reads them as a name.
  const tag = stamp.slice(-6).split('').map((d) => 'abcdefghij'[Number(d)]).join('');
  const OWNER = `Venkataramana${tag}`;
  const LEGAL = `Sriranga Enterprises ${tag}`;

  const jwt = (key: string): JwtPayload => ({ sub: staff[key].id, role: staff[key].role, code: staff[key].code, email: null } as JwtPayload);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    for (const [key, role] of [['HOLDER', 'field_agent'], ['OTHERFA', 'field_agent'], ['CA', 'call_agent'], ['CEO', 'ceo']] as const) {
      const row = await prisma.staff.create({
        data: { code: `BDS-${key}-${stamp}`, name: `Biz ${key}`, email: `bds-${key.toLowerCase()}-${stamp}@laboura.local`, passwordHash: 'x', role, city: 'Bengaluru' },
      });
      staff[key] = { id: row.id, role, code: row.code };
    }
    const business = await prisma.business.create({
      data: {
        code: `BZ-BDS-${stamp}`, name: `Biz Details ${stamp}`, phone: `+9193${stamp.slice(-8)}`, city: 'Bengaluru', verificationStatus: 'verified',
        accountAgentId: staff.HOLDER.id, ownerName: OWNER, legalName: LEGAL, gstNumber: '29ABCDE1234F1Z5', pan: 'ABCDE1234F',
        billingEmail: 'accounts@example.com', contactRole: 'owner',
      },
    });
    businessId = business.id;
    businessCode = business.code;
  }, 60000);

  afterAll(async () => {
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.staff.deleteMany({ where: { id: { in: Object.values(staff).map((s) => s.id) } } });
    await app.close();
  });

  const leaks = (body: unknown) => {
    const text = JSON.stringify(body);
    return ['29ABCDE1234F1Z5', 'ABCDE1234F', 'accounts@example.com', OWNER, LEGAL].filter((secret) => text.includes(secret));
  };

  it('call agent profile: no owner name or registration details for a business they do not hold', async () => {
    const calls = app.get(CallWorkService);
    const notHeld = await calls['businessProfile'](businessId, jwt('CA'));
    expect(leaks(notHeld)).toEqual([]);
    expect(notHeld.detailsLimited).toBe(true);
    const held = await calls['businessProfile'](businessId, jwt('HOLDER'));
    expect(held.contactName).toBe(OWNER);
  });

  it('search bar: the owner name finds the business only for the agent who holds it', async () => {
    const search = app.get(SearchService);
    const ids = async (key: string) => (await search.search(jwt(key), OWNER, 'business')).results.map((r) => r.id);
    expect(await ids('CA')).not.toContain(businessId);
    expect(await ids('HOLDER')).toContain(businessId);
    expect(await ids('CEO')).toContain(businessId);
  });

  it('call agent business screen (CA13b): no owner name for a business they do not hold', async () => {
    const screen = await app.get(ScreensCallRegistrationService).business(businessCode, jwt('CA'));
    expect(leaks(screen)).toEqual([]);
    const own = await app.get(ScreensCallRegistrationService).business(businessCode, jwt('HOLDER'));
    expect(own.contactName).toBe(OWNER);
  });

  it('field agent business screen (FA08): full details only for the account agent', async () => {
    const fields = app.get(ScreensFieldService);
    const other = await fields.business({ sub: staff.OTHERFA.id, role: 'field_agent' }, businessId);
    expect(leaks(other)).toEqual([]);
    expect(other.contact).toBeNull();
    const mine = await fields.business({ sub: staff.HOLDER.id, role: 'field_agent' }, businessId);
    expect(mine.contact?.name).toBe(OWNER);
  });

  it('field selling: no owner name for another agent, and the legal name searches only their own businesses', async () => {
    const selling = app.get(FieldSellingScreensService);
    const other = await selling.business({ id: staff.OTHERFA.id, role: 'field_agent' }, businessCode);
    expect(leaks(other)).toEqual([]);
    const mine = await selling.business({ id: staff.HOLDER.id, role: 'field_agent' }, businessCode);
    expect(mine.contactName).toBe(OWNER);
    const found = async (key: string) => (await selling.businesses({ id: staff[key].id, role: 'field_agent' }, LEGAL)).results.map((r) => r.id);
    expect(await found('OTHERFA')).not.toContain(businessId);
    expect(await found('HOLDER')).toContain(businessId);
  });
});
