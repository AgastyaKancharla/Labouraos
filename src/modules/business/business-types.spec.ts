import { readFileSync } from 'fs';
import { join } from 'path';
import { ALL_BUSINESS_TYPES, BUSINESS_TYPE_GROUPS, businessTypeLabel, LEGACY_BUSINESS_TYPES, PICKABLE_BUSINESS_TYPES } from './business-types';
import { BUSINESS_TYPES } from './business.constants';

const root = join(__dirname, '..', '..', '..');

/**
 * Types of business (Master Guide rev 207, 22 Nov): one full list, grouped by
 * sector, used everywhere. The web consoles and Laboura Field carry the same
 * list; this fails when any copy drifts.
 */
describe('Business types (22 Nov): one grouped list everywhere', () => {
  it('the eleven groups, snake_case values, no value twice, Other last', () => {
    expect(BUSINESS_TYPE_GROUPS.map((g) => g.label)).toEqual([
      'Food & hospitality', 'Retail', 'Services', 'Health', 'Education & stay', 'Residential', 'Offices',
      'Industry & construction', 'Facility & security', 'Agriculture', 'Other',
    ]);
    expect(new Set(PICKABLE_BUSINESS_TYPES).size).toBe(PICKABLE_BUSINESS_TYPES.length);
    for (const v of ALL_BUSINESS_TYPES) expect(v).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(PICKABLE_BUSINESS_TYPES.at(-1)).toBe('other');
    expect(PICKABLE_BUSINESS_TYPES).toHaveLength(13 + 15 + 14 + 5 + 4 + 3 + 5 + 4 + 3 + 3 + 1);
  });

  it('every value used before stays valid and keeps its name', () => {
    for (const old of ['restaurant_hotel', 'bakery', 'retail_shop', 'supermarket', 'apartment_society', 'restaurant', 'retail', 'factory', 'office', 'warehouse', 'hospital_clinic', 'construction', 'security_agency', 'salon', 'household', 'other']) {
      expect(BUSINESS_TYPES).toContain(old);
    }
    expect(businessTypeLabel('restaurant_hotel')).toBe('Restaurant / hotel');
    expect(businessTypeLabel('tea_coffee_stall')).toBe('Tea / coffee stall');
    expect(businessTypeLabel('other', 'Flower shop')).toBe('Flower shop');
    expect(businessTypeLabel('other')).toBe('Other (type it)');
    expect(LEGACY_BUSINESS_TYPES.every((t) => !PICKABLE_BUSINESS_TYPES.includes(t.value))).toBe(true);
  });

  it('the web consoles and Laboura Field carry exactly the same list', () => {
    const server = readFileSync(join(__dirname, 'business-types.ts'), 'utf8');
    for (const copy of ['web/src/screens/call-agent/_registration/businessTypes.ts', 'field/src/lib/businessTypes.ts']) {
      expect([copy, readFileSync(join(root, copy), 'utf8')]).toEqual([copy, server]);
    }
  });
});
