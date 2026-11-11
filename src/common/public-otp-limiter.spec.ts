import { PublicOtpLimiter, PublicOtpLimitError, publicOtpPhoneHash } from './public-otp-limiter.service';

/** An in-memory stand-in for the PublicOtpSend table inside a transaction. */
function fakePrisma() {
  const rows: { linkKey: string; phoneHash: string; sentAt: Date }[] = [];
  const matches = (row: (typeof rows)[number], where: Record<string, unknown>) =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key as keyof typeof row];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { gt?: Date; lt?: Date };
        return (!c.gt || (value as Date) > c.gt) && (!c.lt || (value as Date) < c.lt);
      }
      return value === cond;
    });
  const table = {
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, where)).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, where)).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0] ?? null),
    create: jest.fn(async ({ data }: { data: (typeof rows)[number] }) => rows.push(data)),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(1), publicOtpSend: table };
  return { rows, tx, prisma: { $transaction: jest.fn((work: (t: typeof tx) => unknown) => work(tx)) } };
}

const t0 = new Date('2026-11-11T06:00:00.000Z');
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

describe('Public OTP sends are limited on the server', () => {
  it('allows one code per 30 seconds per link, with a 429 that says how long to wait', async () => {
    const { prisma, tx } = fakePrisma();
    const limiter = new PublicOtpLimiter(prisma as never);
    await limiter.claimSend('link-a', '+919876512345', at(0));
    const error = await limiter.claimSend('link-a', '+919876512345', at(10)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicOtpLimitError);
    expect((error as PublicOtpLimitError).getStatus()).toBe(429);
    expect((error as PublicOtpLimitError).retryAfterSeconds).toBe(20);
    expect((error as Error).message).toMatch(/Wait 20 seconds/);
    await expect(limiter.claimSend('link-a', '+919876512345', at(30))).resolves.toBeUndefined();
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('allows one code per 30 seconds per phone, even across different links', async () => {
    const { prisma } = fakePrisma();
    const limiter = new PublicOtpLimiter(prisma as never);
    await limiter.claimSend('link-a', '9876512345', at(0));
    await expect(limiter.claimSend('link-b', '+91 98765 12345', at(5))).rejects.toThrow(/Wait 25 seconds/);
    await expect(limiter.claimSend('link-c', '+919811100000', at(5))).resolves.toBeUndefined();
  });

  it('allows the first code and 3 resends per link in 24 hours, then refuses until the oldest is a day old', async () => {
    const { prisma, rows } = fakePrisma();
    const limiter = new PublicOtpLimiter(prisma as never);
    for (const s of [0, 30, 60, 90]) await limiter.claimSend('link-a', '+919876512345', at(s));
    expect(rows).toHaveLength(4);
    const error = await limiter.claimSend('link-a', '+919876512345', at(3600)).catch((e: unknown) => e);
    expect((error as PublicOtpLimitError).getStatus()).toBe(429);
    expect((error as Error).message).toMatch(/at most 4 in 24 hours/);
    expect(rows).toHaveLength(4);
    await expect(limiter.claimSend('link-a', '+919876512345', at(24 * 3600 + 1))).resolves.toBeUndefined();
  });

  it('stores only a hash of the number', async () => {
    const { prisma, rows } = fakePrisma();
    await new PublicOtpLimiter(prisma as never).claimSend('link-a', '+919876512345', at(0));
    expect(JSON.stringify(rows)).not.toContain('9876512345');
    expect(rows[0]!.phoneHash).toBe(publicOtpPhoneHash('9876512345'));
  });
});
