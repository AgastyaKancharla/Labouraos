/**
 * A tiny in-memory stand-in for the Prisma tables the Aadhaar QR services use,
 * so their rules are tested without a database. Supports the filters those
 * services use: equality, { not: null }, { gt }, { lte }, { in }.
 */
type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('not' in c && c.not === null && (value === null || value === undefined)) return false;
      if ('gt' in c && !(value instanceof Date && value.getTime() > (c.gt as Date).getTime())) return false;
      if ('lte' in c && !(value instanceof Date && value.getTime() <= (c.lte as Date).getTime())) return false;
      if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
      return true;
    }
    return value === cond;
  });
}

function table(rows: Row[] = []) {
  return {
    rows,
    async create({ data }: { data: Row }) {
      const row = { id: (data.id as string) ?? `id-${rows.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async findUnique({ where }: { where: Row }) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findFirst({ where, orderBy }: { where?: Row; orderBy?: Record<string, 'asc' | 'desc'> } = {}) {
      const found = rows.filter((r) => matches(r, where));
      if (orderBy) {
        const [[key, dir]] = Object.entries(orderBy);
        found.sort((a, b) => ((a[key!] as Date).getTime() - (b[key!] as Date).getTime()) * (dir === 'desc' ? -1 : 1));
      }
      return found[0] ?? null;
    },
    async findMany({ where }: { where?: Row } = {}) {
      return rows.filter((r) => matches(r, where));
    },
    async count({ where }: { where?: Row } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const found = rows.filter((r) => matches(r, where));
      for (const r of found) Object.assign(r, data);
      return { count: found.length };
    },
  };
}

export function fakePrisma(seed: { jobSeekers?: Row[]; referrals?: Row[]; consents?: Row[] } = {}) {
  const db = {
    jobSeeker: table(seed.jobSeekers),
    referral: table(seed.referrals),
    consent: table(seed.consents),
    identityVerification: table(),
    referralIdentityVerification: table(),
    aadhaarQrDetail: table(),
    aadhaarQrAttempt: table(),
    reviewFlag: table(),
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };
  return db;
}

export type FakePrisma = ReturnType<typeof fakePrisma>;
