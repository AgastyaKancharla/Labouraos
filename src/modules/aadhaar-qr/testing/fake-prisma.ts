/**
 * A tiny in-memory stand-in for the Prisma tables the ID-check services use,
 * so their rules are tested without a database. Supports the filters those
 * services use: equality, { not: null }, { not: value }, { gt }, { gte },
 * { lte }, { in }, { equals, mode: 'insensitive' }, NOT, orderBy, take, and a
 * no-op $executeRaw for the advisory locks.
 */
type Row = Record<string, unknown>;

function timeOf(value: unknown): number | null {
  return value instanceof Date ? value.getTime() : null;
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'NOT') return !matches(row, cond as Row);
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w));
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('not' in c) {
        if (c.not === null) {
          if (value === null || value === undefined) return false;
        } else if (value === c.not) return false;
      }
      if ('gt' in c && !(timeOf(value) !== null && timeOf(value)! > (c.gt as Date).getTime())) return false;
      if ('gte' in c && !(timeOf(value) !== null && timeOf(value)! >= (c.gte as Date).getTime())) return false;
      if ('lte' in c && !(timeOf(value) !== null && timeOf(value)! <= (c.lte as Date).getTime())) return false;
      if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
      if ('equals' in c) {
        if (c.mode === 'insensitive') {
          if (typeof value !== 'string' || value.toLowerCase() !== String(c.equals).toLowerCase()) return false;
        } else if (value !== c.equals) return false;
      }
      return true;
    }
    if (cond instanceof Date) return timeOf(value) === cond.getTime();
    // A column never written is null in the database.
    if (cond === null) return value === null || value === undefined;
    return value === cond;
  });
}

function sortRows(rows: Row[], orderBy?: Record<string, 'asc' | 'desc'>): Row[] {
  if (!orderBy) return rows;
  const [[key, dir]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => ((timeOf(a[key!]) ?? 0) - (timeOf(b[key!]) ?? 0)) * (dir === 'desc' ? -1 : 1));
}

export interface FakeTableOptions {
  /** Makes the next update / updateMany throw, once (a database write that fails). */
  failNextUpdate?: boolean;
}

function table(rows: Row[] = [], defaults: () => Row = () => ({})) {
  const options: FakeTableOptions = {};
  return {
    rows,
    options,
    async create({ data }: { data: Row }) {
      const row = { id: (data.id as string) ?? `id-${rows.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...data };
      rows.push(row);
      return row;
    },
    async findUnique({ where }: { where: Row }) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findUniqueOrThrow({ where }: { where: Row }) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('Not found');
      return row;
    },
    async findFirst({ where, orderBy }: { where?: Row; orderBy?: Record<string, 'asc' | 'desc'> } = {}) {
      return sortRows(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null;
    },
    async findMany({ where, orderBy, take }: { where?: Row; orderBy?: Record<string, 'asc' | 'desc'>; take?: number } = {}) {
      const found = sortRows(rows.filter((r) => matches(r, where)), orderBy);
      return take === undefined ? found : found.slice(0, take);
    },
    async count({ where }: { where?: Row } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      if (options.failNextUpdate) {
        options.failNextUpdate = false;
        throw new Error('database write failed');
      }
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('Record to update not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      if (options.failNextUpdate) {
        options.failNextUpdate = false;
        throw new Error('database write failed');
      }
      const found = rows.filter((r) => matches(r, where));
      for (const r of found) Object.assign(r, data);
      return { count: found.length };
    },
    async delete({ where }: { where: Row }) {
      const index = rows.findIndex((r) => matches(r, where));
      if (index < 0) throw new Error('Record to delete not found');
      return rows.splice(index, 1)[0];
    },
    async deleteMany({ where }: { where?: Row } = {}) {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i]!, where)) {
          rows.splice(i, 1);
          count += 1;
        }
      }
      return { count };
    },
  };
}

export function fakePrisma(seed: { jobSeekers?: Row[]; referrals?: Row[]; consents?: Row[]; teamLeadChecks?: Row[] } = {}) {
  const locks: string[] = [];
  const db = {
    jobSeeker: table(seed.jobSeekers),
    referral: table(seed.referrals),
    consent: table(seed.consents),
    identityVerification: table(),
    referralIdentityVerification: table(),
    idCheckDetail: table([], () => ({ photoPath: null, photoExpiresAt: null, photoDeletedAt: null, photoDeletedReason: null })),
    aadhaarQrAttempt: table(),
    reviewFlag: table([], () => ({ raisedAt: new Date() })),
    teamLeadCheck: table(seed.teamLeadChecks),
    /** The advisory-lock keys taken (pg_advisory_xact_lock), in order. */
    locks,
    async $executeRaw(query: { values?: unknown[] } | TemplateStringsArray, ...values: unknown[]) {
      const key = (query as { values?: unknown[] }).values?.[0] ?? values[0];
      locks.push(String(key));
      return 1;
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };
  return db;
}

export type FakePrisma = ReturnType<typeof fakePrisma>;
