import { readFileSync } from 'fs';
import { join } from 'path';
import {
  legalMinimumByZone,
  legalMinimumFor,
  MinimumWagePolicy,
  minimumWageTable,
  NOTIFICATION_22_MAY_2026,
  ZONE_1_CITY_NAMES,
  ZONE_2_CITY_NAMES,
  zoneForAddress,
  zoneForBusiness,
} from './minimum-wage';

/** A policy holding exactly the notification's figures. */
const policy: MinimumWagePolicy = {
  legalMinimumWageUnskilledPaise: 2337643,
  legalMinimumWageSemiSkilledPaise: 2571407,
  legalMinimumWageSkilledPaise: 2828547,
  legalMinimumWageHighlySkilledPaise: 3111402,
  legalMinimumWageZone2UnskilledPaise: 2125130,
  legalMinimumWageZone2SemiSkilledPaise: 2337643,
  legalMinimumWageZone2SkilledPaise: 2571407,
  legalMinimumWageZone2HighlySkilledPaise: 2828547,
  legalMinimumWageZone3UnskilledPaise: 1931936,
  legalMinimumWageZone3SemiSkilledPaise: 2125130,
  legalMinimumWageZone3SkilledPaise: 2337643,
  legalMinimumWageZone3HighlySkilledPaise: 2571407,
};

const migration = readFileSync(join(__dirname, '../../../prisma/migrations/20261203100000_minimum_wage_zones/migration.sql'), 'utf8');
const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');

describe('legal minimum wage by zone and skill level (rev 193)', () => {
  it('holds the twelve figures of the 22 May 2026 notification, in paise', () => {
    expect(minimumWageTable(policy)).toEqual(NOTIFICATION_22_MAY_2026);
    expect(NOTIFICATION_22_MAY_2026[1].unskilled).toBe(2337643); // ₹23,376.43
    expect(NOTIFICATION_22_MAY_2026[2].highly_skilled).toBe(2828547); // ₹28,285.47
    expect(NOTIFICATION_22_MAY_2026[3].unskilled).toBe(1931936); // ₹19,319.36
  });

  it('the database defaults are the same twelve figures', () => {
    for (const [column, paise] of [
      ['legalMinimumWageUnskilledPaise', 2337643], ['legalMinimumWageSemiSkilledPaise', 2571407],
      ['legalMinimumWageSkilledPaise', 2828547], ['legalMinimumWageHighlySkilledPaise', 3111402],
      ['legalMinimumWageZone2UnskilledPaise', 2125130], ['legalMinimumWageZone2SemiSkilledPaise', 2337643],
      ['legalMinimumWageZone2SkilledPaise', 2571407], ['legalMinimumWageZone2HighlySkilledPaise', 2828547],
      ['legalMinimumWageZone3UnskilledPaise', 1931936], ['legalMinimumWageZone3SemiSkilledPaise', 2125130],
      ['legalMinimumWageZone3SkilledPaise', 2337643], ['legalMinimumWageZone3HighlySkilledPaise', 2571407],
    ] as const) {
      expect(schema).toMatch(new RegExp(`${column}\\s+Int\\s+@default\\(${paise}\\)`));
      expect(migration).toMatch(new RegExp(`"${column}"[^;]*?DEFAULT ${paise}`));
    }
  });

  it('picks the figure for the zone and level; an unknown level is unskilled and an unknown zone is Zone 1', () => {
    expect(legalMinimumFor(policy, 2, 'skilled')).toBe(2571407);
    expect(legalMinimumFor(policy, 3, 'highly_skilled')).toBe(2571407);
    expect(legalMinimumFor(policy, 1, 'semi_skilled')).toBe(2571407);
    expect(legalMinimumFor(policy, 3, 'nonsense')).toBe(1931936);
    expect(legalMinimumFor(policy, null, 'unskilled')).toBe(2337643);
    expect(legalMinimumFor(policy, 7, 'skilled')).toBe(2828547);
    expect(legalMinimumByZone(policy, 'skilled')).toEqual({ '1': 2828547, '2': 2571407, '3': 2337643 });
  });

  describe('the zone rule', () => {
    it('a 560xxx pin code is Zone 1, whatever the city says', () => {
      expect(zoneForAddress({ pincode: '560078', city: 'Mysuru' })).toEqual({ zone: 1, reason: 'bengaluru_pincode' });
      expect(zoneForAddress({ pincode: ' 560 100 ' })).toEqual({ zone: 1, reason: 'bengaluru_pincode' });
    });

    it('another city corporation or a district headquarters is Zone 2 (old spellings too)', () => {
      for (const city of ['Mysuru', 'Mysore', ' belgaum ', 'Hubballi-Dharwad', 'Kalaburagi', 'Udupi', 'Karwar', 'Hosapete']) {
        expect(zoneForAddress({ pincode: '570001', city }).zone).toBe(2);
      }
      expect(zoneForAddress({ city: 'Shimoga' }).zone).toBe(2);
    });

    it('a non-Bengaluru pin code with such a city in the address is Zone 2, even when the city field kept the launch city', () => {
      expect(zoneForAddress({ pincode: '570001', city: 'Bengaluru', addressLines: ['12 Sayyaji Rao Road, Mysuru'] }))
        .toEqual({ zone: 2, reason: 'zone2_city' });
    });

    it('"Mysore Road" in a Bengaluru address is not Zone 2', () => {
      expect(zoneForAddress({ pincode: '560026', addressLines: ['Mysore Road'] }).zone).toBe(1);
      expect(zoneForAddress({ pincode: '562130', addressLines: ['Mysore Road, Bengaluru'] }).zone).toBe(1);
      expect(zoneForAddress({ addressLines: ['Mysore Road'] }).zone).toBe(1);
    });

    it('unsure is Zone 1 (the default); Zone 3 is never guessed', () => {
      expect(zoneForAddress({})).toEqual({ zone: 1, reason: 'default' });
      expect(zoneForAddress({ pincode: '571234', city: 'Some village' })).toEqual({ zone: 1, reason: 'default' });
      expect(zoneForAddress({ city: 'Bangalore' })).toEqual({ zone: 1, reason: 'bengaluru_city' });
    });

    it('reads a business row (address, street, locality, landmark)', () => {
      expect(zoneForBusiness({ pincode: '575001', city: 'Bengaluru', street: 'Hampankatta', locality: 'Mangaluru' }).zone).toBe(2);
      expect(zoneForBusiness({ pincode: null, city: 'Bengaluru', locality: 'Jayanagar' }).zone).toBe(1);
    });

    it('the migration backfills with the same city lists', () => {
      for (const name of ZONE_2_CITY_NAMES) expect(migration).toContain(`'${name}'`);
      for (const name of ZONE_2_CITY_NAMES) expect(migration).toContain(name.replace('-', '\\-'));
      for (const name of ZONE_1_CITY_NAMES) expect(migration).toContain(name);
    });
  });

  it('reviews every trade of the managed list against the notification (docs/minimum-wage.md)', () => {
    const seed = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf8');
    const expected: Record<string, string> = {
      housekeeping: 'unskilled', 'kitchen helper': 'unskilled', 'helper / loader': 'unskilled',
      waiter: 'semi_skilled', 'warehouse packer': 'semi_skilled', 'retail staff': 'semi_skilled',
      'delivery rider': 'semi_skilled', 'security guard': 'semi_skilled', 'caretaker / nanny': 'semi_skilled',
      cook: 'skilled', driver: 'skilled', electrician: 'skilled', plumber: 'skilled', carpenter: 'skilled',
      painter: 'skilled', 'ac technician': 'skilled',
    };
    for (const [nameKey, level] of Object.entries(expected)) {
      if (level !== 'unskilled') {
        const update = migration.slice(migration.indexOf(`SET "minimumWageLevel" = '${level}'`));
        expect(update.slice(0, update.indexOf(';'))).toContain(`'${nameKey}'`);
      }
      expect(seed.toLowerCase()).toMatch(new RegExp(`\\['${nameKey.replace(/[/]/g, '\\/')}', \\d+, \\d+, '${level}'\\]`));
    }
    const docs = readFileSync(join(__dirname, '../../../docs/minimum-wage.md'), 'utf8');
    expect(docs).toContain('https://futurexsolutions.com/minimum-wages-notification-dated-22-may-2026/');
  });
});
