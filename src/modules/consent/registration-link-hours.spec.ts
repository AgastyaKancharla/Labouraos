import { ConsentLinkService } from './consent-link.service';

/** C-Pricing "Registration link valid": the job seeker's registration link lasts the Settings hours (48 by default). */
describe('registration link expiry comes from Settings', () => {
  const savedUrl = process.env.PUBLIC_APP_URL;
  beforeAll(() => {
    process.env.PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://app.laboura.in';
  });
  afterAll(() => {
    process.env.PUBLIC_APP_URL = savedUrl;
  });

  const now = new Date('2026-11-12T06:00:00Z');
  function service(hours: number) {
    const publicLinks = { revokeActive: jest.fn(), create: jest.fn().mockResolvedValue({ token: 't', id: 'l1' }) };
    const deps = {
      prisma: { jobSeeker: { findUnique: jest.fn().mockResolvedValue({ id: 'js-1', phone: '+919900000001' }) } },
      clock: { now: () => now },
      messaging: { send: jest.fn() },
      pricing: { current: jest.fn().mockResolvedValue({ registrationLinkValidHours: hours }) },
    };
    const s = new ConsentLinkService(
      deps.prisma as never,
      publicLinks as never,
      deps.clock as never,
      {} as never,
      deps.messaging as never,
      {} as never,
      deps.pricing as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { s, publicLinks };
  }

  it('uses registrationLinkValidHours', async () => {
    const { s, publicLinks } = service(24);
    const res = await s.createLink('js-1');
    expect(res.expiresAt.toISOString()).toBe('2026-11-13T06:00:00.000Z');
    expect(publicLinks.create.mock.calls[0][0].expiresAt.toISOString()).toBe('2026-11-13T06:00:00.000Z');
  });

  it('defaults to 48 hours', async () => {
    const { s } = service(48);
    expect((await s.createLink('js-1')).expiresAt.toISOString()).toBe('2026-11-14T06:00:00.000Z');
  });
});
