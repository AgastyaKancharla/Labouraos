import { assertSeedAllowed } from '../prisma/seed';

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
