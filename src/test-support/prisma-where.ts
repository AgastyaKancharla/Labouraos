/**
 * A small in-memory reading of Prisma `where` filters for hand-built mocks:
 * equality, `in`, `notIn`, `not`, and `OR` / `AND` / `NOT`. Enough for the
 * staff queries OwnTeam and the scope helpers make, so a mock answers the way
 * the database would instead of matching one exact query shape.
 */
type Row = Record<string, unknown>;

function fieldMatches(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (filter === null || typeof filter !== 'object' || filter instanceof Date) return value === filter;
  const f = filter as Record<string, unknown>;
  if ('in' in f && !(f.in as unknown[]).includes(value)) return false;
  if ('notIn' in f && (f.notIn as unknown[]).includes(value)) return false;
  if ('not' in f && fieldMatches(value, f.not)) return false;
  if ('equals' in f && value !== f.equals) return false;
  return true;
}

export function matchesWhere(row: Row, where?: Row | null): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, filter]) => {
    if (key === 'OR') return (filter as Row[]).some((part) => matchesWhere(row, part));
    if (key === 'AND') {
      const parts = Array.isArray(filter) ? filter : [filter];
      return (parts as Row[]).every((part) => matchesWhere(row, part));
    }
    if (key === 'NOT') {
      const parts = Array.isArray(filter) ? filter : [filter];
      return !(parts as Row[]).some((part) => matchesWhere(row, part));
    }
    return fieldMatches(row[key], filter);
  });
}

function pick(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

/** `findMany` over fixed rows, honouring `where` and `select`. */
export function findManyOver<T extends Row>(rows: T[] | (() => T[])) {
  return async (args?: { where?: Row; select?: Record<string, unknown> }) => {
    const all = typeof rows === 'function' ? rows() : rows;
    return all.filter((row) => matchesWhere(row, args?.where)).map((row) => pick(row, args?.select)) as T[];
  };
}
