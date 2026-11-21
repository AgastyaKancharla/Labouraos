import { Prisma } from '@prisma/client';
import { CustomerReferralLeadsService, indianMobile, REFERRAL_LEADS_PER_DAY } from './customer-referral-leads.service';

/**
 * A referral partner's "Send a lead": switched on by CUSTOMER_REFERRAL_LEADS,
 * only the caller's own partner profile, a real area, the person's agreement,
 * one lead per number per partner, a daily limit, and never the phone or
 * whether Laboura already knew the number in the answer.
 */
describe('CustomerReferralLeadsService (send a lead)', () => {
  const NOW = new Date('2026-11-21T06:00:00.000Z'); // 11:30 IST
  const saved = process.env.CUSTOMER_REFERRAL_LEADS;
  const good = { kind: 'job_seeker', name: '  Manju   Nath ', phone: '98765 43210', area: 'BTM Layout', personAgreed: true };

  afterEach(() => {
    process.env.CUSTOMER_REFERRAL_LEADS = saved;
  });

  function setup(opts: { paused?: boolean; existing?: unknown; today?: number; unfinished?: boolean } = {}) {
    const prisma: Record<string, unknown> & { customerReferralLead: Record<string, jest.Mock>; $executeRaw: jest.Mock } = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      referral: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ref-1', code: 'RF-00042', phone: '+919000000001', pausedAt: opts.paused ? NOW : null }) },
      area: { findFirst: jest.fn(async ({ where }: { where: { name: string } }) => (where.name === 'BTM Layout' ? { name: 'BTM Layout' } : null)) },
      customerReferralLead: {
        findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
        findMany: jest.fn().mockResolvedValue([
          { id: 'l-1', name: 'Manju Nath', kind: 'job_seeker', status: 'new', createdAt: NOW },
          { id: 'l-2', name: 'Sri Sai Bakery', kind: 'business', status: 'registered', createdAt: NOW },
          { id: 'l-3', name: 'Kiran', kind: 'job_seeker', status: 'closed', createdAt: NOW },
        ]),
        count: jest.fn().mockResolvedValue(opts.today ?? 0),
        create: jest.fn().mockResolvedValue({ id: 'l-new', status: 'new' }),
      },
    };
    prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
    const homes = { referralHome: jest.fn().mockResolvedValue({ steps: { terms: true, selfie: true, idCheck: true, upi: !opts.unfinished } }) };
    const scope = { profile: jest.fn().mockResolvedValue({ id: 'prof-ref', accountId: 'acc-1', kind: 'referral', role: 'self', jobSeekerId: null, businessId: null, branchId: null, referralId: 'ref-1' }) };
    const service = new CustomerReferralLeadsService(prisma as never, { now: () => NOW } as never, scope as never, homes as never);
    return { service, prisma, scope };
  }

  it('reads Indian mobile numbers only', () => {
    expect(indianMobile('9876543210')).toBe('+919876543210');
    expect(indianMobile('+91 98765-43210')).toBe('+919876543210');
    expect(indianMobile('09876543210')).toBe('+919876543210');
    expect(indianMobile('5876543210')).toBeNull();
    expect(indianMobile('98765')).toBeNull();
    expect(indianMobile(9876543210)).toBeNull();
  });

  it('is refused while switched off (the office cannot pick leads up yet)', async () => {
    delete process.env.CUSTOMER_REFERRAL_LEADS;
    const { service, prisma } = setup();
    await expect(service.send('acc-1', 'prof-ref', good)).rejects.toMatchObject({ status: 501 });
    expect(prisma.customerReferralLead.create).not.toHaveBeenCalled();
    expect((await service.list('acc-1', 'prof-ref')).open).toBe(false);
  });

  it('saves the lead for this partner, with the RF- code for "referred by"', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma, scope } = setup();
    const result = await service.send('acc-1', 'prof-ref', good);
    expect(scope.profile).toHaveBeenCalledWith('acc-1', 'prof-ref', 'referral');
    expect(result).toEqual({ created: true, body: { leadId: 'l-new', stage: 'with_team' } });
    expect(prisma.customerReferralLead.create.mock.calls[0][0].data).toEqual({
      accountId: 'acc-1',
      profileId: 'prof-ref',
      referralId: 'ref-1',
      referralCode: 'RF-00042',
      kind: 'job_seeker',
      name: 'Manju Nath',
      phone: '+919876543210',
      area: 'BTM Layout',
      personAgreed: true,
    });
  });

  it('the same number again gives back the same lead (one answer either way)', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup({ existing: { id: 'l-1', status: 'contacted' } });
    expect(await service.send('acc-1', 'prof-ref', good)).toEqual({ created: false, body: { leadId: 'l-1', stage: 'with_team' } });
    expect(prisma.customerReferralLead.create).not.toHaveBeenCalled();
  });

  it('two sends at once: the unique (partner, phone) keeps one', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup();
    prisma.customerReferralLead.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    prisma.customerReferralLead.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'l-first', status: 'new' });
    expect(await service.send('acc-1', 'prof-ref', good)).toEqual({ created: false, body: { leadId: 'l-first', stage: 'with_team' } });
  });

  it.each([
    [{ ...good, kind: 'cousin' }, 'kind'],
    [{ ...good, name: 'M' }, 'name'],
    [{ ...good, name: 'Manju 98765' }, 'name'], // a person's name has no digits
    [{ ...good, phone: '12345' }, 'phone'],
    [{ ...good, phone: '9000000001' }, 'phone'], // the partner's own number
    [{ ...good, area: 'Mars' }, 'area'],
    [{ ...good, personAgreed: false }, 'personAgreed'],
    [{ ...good, personAgreed: 'yes' }, 'personAgreed'],
  ])('refuses %j (%s)', async (body, field) => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup();
    await expect(service.send('acc-1', 'prof-ref', body)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_FAILED', field }) });
    expect(prisma.customerReferralLead.create).not.toHaveBeenCalled();
  });

  it(`at most ${REFERRAL_LEADS_PER_DAY} a day, counted from 00:00 IST`, async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup({ today: REFERRAL_LEADS_PER_DAY });
    await expect(service.send('acc-1', 'prof-ref', good)).rejects.toMatchObject({ status: 429 });
    expect(prisma.customerReferralLead.count.mock.calls[0][0].where).toEqual({ referralId: 'ref-1', createdAt: { gte: new Date('2026-11-20T18:30:00.000Z') } });
  });

  it('a shop’s name may have digits', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup();
    await service.send('acc-1', 'prof-ref', { ...good, kind: 'business', name: '24/7 Mart' });
    expect(prisma.customerReferralLead.create.mock.calls[0][0].data.name).toBe('24/7 Mart');
  });

  it('only a partner who finished registering can send (checked on the server)', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup({ unfinished: true });
    await expect(service.send('acc-1', 'prof-ref', good)).rejects.toMatchObject({ status: 403, response: expect.objectContaining({ reason: 'registration_unfinished' }) });
    expect(prisma.customerReferralLead.create).not.toHaveBeenCalled();
  });

  it('counts the day’s leads under a lock per partner', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup();
    await service.send('acc-1', 'prof-ref', good);
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['referral-leads:ref-1']);
  });

  it('a paused partner cannot send', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service } = setup({ paused: true });
    await expect(service.send('acc-1', 'prof-ref', good)).rejects.toMatchObject({ status: 403 });
  });

  it('the list shows first name, kind and a stage only — never the phone, never "already known"', async () => {
    process.env.CUSTOMER_REFERRAL_LEADS = 'on';
    const { service, prisma } = setup();
    const answer = await service.list('acc-1', 'prof-ref');
    expect(prisma.customerReferralLead.findMany.mock.calls[0][0].where).toEqual({ referralId: 'ref-1' });
    expect(answer).toEqual({
      open: true,
      perDay: REFERRAL_LEADS_PER_DAY,
      leads: [
        { id: 'l-1', firstName: 'Manju', kind: 'job_seeker', stage: 'with_team', sentAt: NOW },
        { id: 'l-2', firstName: 'Sri Sai Bakery', kind: 'business', stage: 'registered', sentAt: NOW },
        { id: 'l-3', firstName: 'Kiran', kind: 'job_seeker', stage: 'closed', sentAt: NOW },
      ],
    });
    expect(JSON.stringify(answer)).not.toMatch(/\+91|phone|Nath/);
  });
});
