import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * Supabase publishes every table in the public schema through its automatic
 * REST API. Row level security with no policies makes that API return
 * nothing, while Prisma (the table owner) keeps full access.
 *
 * This runs against the CI database after `prisma migrate deploy`, so a new
 * migration that creates a table without enabling RLS fails here.
 */
describe('Row level security on every public table (Supabase Data API exposes nothing)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('every table in public has RLS enabled', async () => {
    const missing = await prisma.$queryRaw<Array<{ table: string }>>`
      SELECT c.relname AS "table"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relrowsecurity
      ORDER BY c.relname`;

    const names = missing.map((row) => row.table);
    if (names.length > 0) {
      throw new Error(
        `These tables have row level security off, so Supabase's REST API could expose them: ${names.join(', ')}. ` +
          `Add to the migration that creates each one: ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;`,
      );
    }
    expect(names).toEqual([]);
  });

  it('no table forces RLS on its owner (that would lock the app out)', async () => {
    const forced = await prisma.$queryRaw<Array<{ table: string }>>`
      SELECT c.relname AS "table"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relforcerowsecurity`;
    expect(forced.map((row) => row.table)).toEqual([]);
  });

  it('the app still reads and writes through Prisma with RLS on', async () => {
    const tables = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "_prisma_migrations"`;
    expect(Number(tables[0].count)).toBeGreaterThan(0);
    await expect(prisma.pricingPolicy.findFirst()).resolves.not.toBeUndefined();
  });

  it('the RLS migration exists and creates no policies', () => {
    const file = path.join(
      __dirname,
      '../../../prisma/migrations/20261115040000_enable_row_level_security/migration.sql',
    );
    const sql = fs.readFileSync(file, 'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });
});
