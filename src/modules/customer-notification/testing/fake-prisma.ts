/**
 * A small in-memory stand-in for PrismaService, enough for the notification
 * module's unit tests to run without a database (the database-backed checks
 * are in customer-notification.e2e.spec.ts, run by CI). It understands the
 * filters this module uses: equality, in, not (SQL semantics: a null never
 * matches `not: x`), gt/gte/lt/lte, OR, NOT, and the `account` relation of
 * CustomerProfile.
 */
import { randomUUID } from 'crypto';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const OPS = new Set(['equals', 'in', 'notIn', 'not', 'gt', 'gte', 'lt', 'lte']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchOps(value: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, arg] of Object.entries(ops)) {
    if (op === 'equals' && !same(value, arg)) return false;
    if (op === 'in' && !(arg as unknown[]).some((x) => same(x, value))) return false;
    if (op === 'notIn' && (value == null || (arg as unknown[]).some((x) => same(x, value)))) return false;
    if (op === 'not') {
      if (arg === null) {
        if (value == null) return false;
      } else if (isPlainObject(arg)) {
        if (value == null || matchOps(value, arg)) return false;
      } else if (value == null || same(value, arg)) {
        return false;
      }
    }
    if (op === 'gt' && (value == null || cmp(value, arg) <= 0)) return false;
    if (op === 'gte' && (value == null || cmp(value, arg) < 0)) return false;
    if (op === 'lt' && (value == null || cmp(value, arg) >= 0)) return false;
    if (op === 'lte' && (value == null || cmp(value, arg) > 0)) return false;
  }
  return true;
}

export class FakePrisma {
  tables: Record<string, Row[]> = {
    customerAccount: [],
    customerProfile: [],
    customerDevice: [],
    customerInboxMessage: [],
    customerNotificationSetting: [],
    consent: [],
    messageLog: [],
    pricingPolicy: [],
    jobSeeker: [],
    placement: [],
  };

  private relation(model: string, row: Row, key: string): Row | undefined {
    if (model === 'customerProfile' && key === 'account') {
      return this.tables.customerAccount.find((a) => a.id === row.accountId);
    }
    return undefined;
  }

  matches(model: string, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'OR') {
        if (!(cond as Where[]).some((w) => this.matches(model, row, w))) return false;
        continue;
      }
      if (key === 'AND') {
        if (!(cond as Where[]).every((w) => this.matches(model, row, w))) return false;
        continue;
      }
      if (key === 'NOT') {
        const list = Array.isArray(cond) ? (cond as Where[]) : [cond as Where];
        if (list.some((w) => this.matches(model, row, w))) return false;
        continue;
      }
      const related = this.relation(model, row, key);
      if (related !== undefined || (model === 'customerProfile' && key === 'account')) {
        if (!related || !this.matches('customerAccount', related, cond as Where)) return false;
        continue;
      }
      if (isPlainObject(cond) && Object.keys(cond).every((k) => OPS.has(k))) {
        if (!matchOps(row[key], cond)) return false;
        continue;
      }
      if (cond === null ? row[key] != null : !same(row[key], cond)) return false;
    }
    return true;
  }

  private withRelations(model: string, row: Row): Row {
    if (model === 'customerProfile') return { ...row, account: this.relation(model, row, 'account') };
    return { ...row };
  }

  private order(rows: Row[], orderBy: unknown): Row[] {
    const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    if (list.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const o of list as Record<string, 'asc' | 'desc'>[]) {
        const [field, dir] = Object.entries(o)[0];
        const c = cmp(a[field], b[field]);
        if (c !== 0) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }

  private uniqueClash(model: string, data: Row, ignore?: Row): boolean {
    const uniques: Record<string, string[][]> = {
      customerInboxMessage: [['dedupeKey']],
      customerNotificationSetting: [['accountId']],
      customerDevice: [['pushToken'], ['accountId', 'installationId']],
      consent: [['subjectType', 'subjectId', 'purpose', 'noticeVersion']],
      messageLog: [['providerMessageId']],
    };
    return (uniques[model] ?? []).some((fields) =>
      this.tables[model].some(
        (r) => r !== ignore && fields.every((f) => data[f] != null && same(r[f], data[f])),
      ),
    );
  }

  private delegate(model: string) {
    const table = () => this.tables[model];
    const defaults = (data: Row): Row => {
      const now = new Date();
      const base: Row = { id: randomUUID(), createdAt: now, updatedAt: now };
      if (model === 'customerInboxMessage') Object.assign(base, { readAt: null, pushedAt: null, scheduledFor: null, profileId: null, messageLogId: null, dedupeKey: null, data: null });
      if (model === 'customerNotificationSetting') Object.assign(base, { service: true, jobUpdates: false, promotions: false, quietStart: '21:00', quietEnd: '09:00', dailyCap: 3 });
      if (model === 'customerDevice') Object.assign(base, { pushToken: null, pushPermission: null, revokedAt: null, lastSeenAt: now });
      if (model === 'messageLog') Object.assign(base, { providerMessageId: null, sentAt: null, deliveredAt: null, failedAt: null, relatedType: null, relatedId: null });
      if (model === 'consent') Object.assign(base, { withdrawnAt: null, withdrawnByStaffId: null, withdrawnMethod: null, grantedAt: null });
      return { ...base, ...data };
    };
    const create = async ({ data }: { data: Row }) => {
      const row = defaults(data);
      if (this.uniqueClash(model, row)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      table().push(row);
      return { ...row };
    };
    const uniqueWhere = (where: Where): Where => {
      // Compound unique inputs (accountId_installationId: {...}) flatten to their fields.
      const out: Where = {};
      for (const [k, v] of Object.entries(where)) {
        if (k.includes('_') && isPlainObject(v)) Object.assign(out, v);
        else out[k] = v;
      }
      return out;
    };
    return {
      findMany: async (args: { where?: Where; orderBy?: unknown; take?: number } = {}) => {
        let rows = table().filter((r) => this.matches(model, r, args.where));
        rows = this.order(rows, args.orderBy);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((r) => this.withRelations(model, r));
      },
      findFirst: async (args: { where?: Where; orderBy?: unknown } = {}) => {
        const rows = this.order(table().filter((r) => this.matches(model, r, args.where)), args.orderBy);
        return rows[0] ? this.withRelations(model, rows[0]) : null;
      },
      findUnique: async ({ where }: { where: Where }) => {
        const row = table().find((r) => this.matches(model, r, uniqueWhere(where)));
        return row ? this.withRelations(model, row) : null;
      },
      findUniqueOrThrow: async ({ where }: { where: Where }) => {
        const row = table().find((r) => this.matches(model, r, uniqueWhere(where)));
        if (!row) throw new Error('not found');
        return this.withRelations(model, row);
      },
      count: async ({ where }: { where?: Where } = {}) => table().filter((r) => this.matches(model, r, where)).length,
      create,
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const row = table().find((r) => this.matches(model, r, uniqueWhere(where)));
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      updateMany: async ({ where, data }: { where?: Where; data: Row }) => {
        const rows = table().filter((r) => this.matches(model, r, where));
        for (const row of rows) {
          if (this.uniqueClash(model, { ...row, ...data }, row)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return { count: rows.length };
      },
      upsert: async ({ where, create: createData, update }: { where: Where; create: Row; update: Row }) => {
        const row = table().find((r) => this.matches(model, r, uniqueWhere(where)));
        if (row) {
          Object.assign(row, update, { updatedAt: new Date() });
          return { ...row };
        }
        return create({ data: createData });
      },
    };
  }

  get customerAccount() { return this.delegate('customerAccount'); }
  get customerProfile() { return this.delegate('customerProfile'); }
  get customerDevice() { return this.delegate('customerDevice'); }
  get customerInboxMessage() { return this.delegate('customerInboxMessage'); }
  get customerNotificationSetting() { return this.delegate('customerNotificationSetting'); }
  get consent() { return this.delegate('consent'); }
  get messageLog() { return this.delegate('messageLog'); }
  get pricingPolicy() { return this.delegate('pricingPolicy'); }
  get jobSeeker() { return this.delegate('jobSeeker'); }
  get placement() { return this.delegate('placement'); }

  async $transaction<T>(work: (tx: this) => Promise<T>): Promise<T> {
    return work(this);
  }
}
