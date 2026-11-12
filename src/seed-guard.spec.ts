import * as fs from 'fs';
import * as path from 'path';
import { assertSeedAllowed, assertSeedDatabaseIsLocal } from '../prisma/seed';

describe('Phase 6.5 Task 10: Seed Environment Guard (assertSeedAllowed)', () => {
  it('allows seeding when NODE_ENV is "development"', () => {
    expect(() => assertSeedAllowed('development')).not.toThrow();
  });

  it('allows seeding when NODE_ENV is "test"', () => {
    expect(() => assertSeedAllowed('test')).not.toThrow();
  });

  it('refuses seeding when NODE_ENV is unset (undefined) and names the found value', () => {
    expect(() => assertSeedAllowed(undefined)).toThrowError(
      "Refusing to seed database: NODE_ENV must be explicitly 'development' or 'test', but found undefined (unset). Seeding live or staging databases is prohibited.",
    );
  });

  it('refuses seeding when NODE_ENV is "staging" and names the found value', () => {
    expect(() => assertSeedAllowed('staging')).toThrowError(
      'Refusing to seed database: NODE_ENV must be explicitly \'development\' or \'test\', but found "staging". Seeding live or staging databases is prohibited.',
    );
  });

  it('refuses seeding when NODE_ENV is "production" and names the found value', () => {
    expect(() => assertSeedAllowed('production')).toThrowError(
      'Refusing to seed database: NODE_ENV must be explicitly \'development\' or \'test\', but found "production". Seeding live or staging databases is prohibited.',
    );
  });

  it('refuses seeding when NODE_ENV is "prod" and names the found value', () => {
    expect(() => assertSeedAllowed('prod')).toThrowError(
      'Refusing to seed database: NODE_ENV must be explicitly \'development\' or \'test\', but found "prod". Seeding live or staging databases is prohibited.',
    );
  });

  it('refuses seeding when NODE_ENV is empty string and names the found value', () => {
    expect(() => assertSeedAllowed('')).toThrowError(
      'Refusing to seed database: NODE_ENV must be explicitly \'development\' or \'test\', but found "". Seeding live or staging databases is prohibited.',
    );
  });

  it('reads process.env.NODE_ENV when no argument is passed', () => {
    const original = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      expect(() => assertSeedAllowed()).toThrow(/undefined \(unset\)/);

      process.env.NODE_ENV = 'staging';
      expect(() => assertSeedAllowed()).toThrow(/"staging"/);

      process.env.NODE_ENV = 'test';
      expect(() => assertSeedAllowed()).not.toThrow();

      process.env.NODE_ENV = 'development';
      expect(() => assertSeedAllowed()).not.toThrow();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

describe('M7: npm run seed cannot bypass its production guard', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    prisma: { seed: string };
  };

  it('the npm script and the Prisma seed command no longer force NODE_ENV=development', () => {
    expect(pkg.scripts.seed).toBe('ts-node prisma/seed.ts');
    expect(pkg.scripts.seed).not.toMatch(/NODE_ENV/);
    expect(pkg.prisma.seed).not.toMatch(/NODE_ENV/);
  });

  it('refuses any database that is not on this computer', () => {
    expect(() => assertSeedDatabaseIsLocal('postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres')).toThrow(
      /must point at a database on this computer.*aws-0-ap-south-1\.pooler\.supabase\.com/,
    );
    expect(() => assertSeedDatabaseIsLocal('postgresql://u:p@10.0.0.5:5432/laboura')).toThrow(/10\.0\.0\.5/);
    expect(() => assertSeedDatabaseIsLocal(undefined)).toThrow(/no usable address/);
    expect(() => assertSeedDatabaseIsLocal('not a url')).toThrow(/no usable address/);
  });

  it('allows a local database', () => {
    expect(() => assertSeedDatabaseIsLocal('postgresql://postgres:postgres@localhost:5432/laboura_test?schema=public')).not.toThrow();
    expect(() => assertSeedDatabaseIsLocal('postgresql://postgres:postgres@127.0.0.1:5432/laboura')).not.toThrow();
  });
});
