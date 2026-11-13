import { BadRequestException } from '@nestjs/common';
import { BusinessService } from './business.service';
import { areaAutoFillMaxMeters, areaRequiredError, DEFAULT_AREA_AUTO_FILL_MAX_METERS, distanceLabel } from './area-auto-fill';
import { PricingService } from '../pricing/pricing.service';

/**
 * Guide (decided 14 Nov): a business's area is filled in automatically from
 * its GPS location — the nearest area whose centre is within 1 km. If no area
 * is that close, the agent must pick the area from the list before saving.
 */
describe('Area from GPS within 1 km', () => {
  // About 111 m per 0.001° of latitude.
  const centre = { latitude: 12.9352, longitude: 77.6245 };
  const areas = [
    { name: 'Koramangala', latitude: centre.latitude, longitude: centre.longitude },
    { name: 'HSR Layout', latitude: centre.latitude - 0.03, longitude: centre.longitude },
  ];

  function serviceWith(rows = areas) {
    const prisma = { area: { findMany: jest.fn().mockResolvedValue(rows) } };
    const service = new BusinessService(
      prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    return { service, prisma };
  }

  it('defaults to 1 km', () => {
    expect(DEFAULT_AREA_AUTO_FILL_MAX_METERS).toBe(1000);
    expect(areaAutoFillMaxMeters({ areaAutoFillMaxMeters: 1000 })).toBe(1000);
    expect(areaAutoFillMaxMeters({ areaAutoFillMaxMeters: 1500 })).toBe(1500);
    expect(areaAutoFillMaxMeters({ areaAutoFillMaxMeters: 0 })).toBe(1000);
    expect(areaAutoFillMaxMeters({})).toBe(1000);
    expect(areaAutoFillMaxMeters(null)).toBe(1000);
  });

  it('fills in the nearest area whose centre is within 1 km', async () => {
    const { service, prisma } = serviceWith();
    await expect(service.nearestAreaName(centre.latitude + 0.006, centre.longitude)).resolves.toBe('Koramangala');
    expect(prisma.area.findMany.mock.calls[0][0].where).toMatchObject({ active: true, mergedIntoId: null });
  });

  it('fills in nothing when every area centre is more than 1 km away (the old 25 km limit is gone)', async () => {
    const { service } = serviceWith();
    // ~1.3 km north of Koramangala's centre, ~4.6 km from HSR Layout's.
    await expect(service.nearestAreaName(centre.latitude + 0.012, centre.longitude)).resolves.toBeNull();
    await expect(service.nearestAreaName(centre.latitude + 0.012, centre.longitude, 1000)).resolves.toBeNull();
  });

  it('uses the distance the CEO set on C-Pricing', async () => {
    const { service } = serviceWith();
    await expect(service.nearestAreaName(centre.latitude + 0.012, centre.longitude, 1500)).resolves.toBe('Koramangala');
    await expect(service.nearestAreaName(centre.latitude + 0.006, centre.longitude, 500)).resolves.toBeNull();
  });

  it('refuses in Kannada, English and Hindi, with a code the apps translate', () => {
    const error = areaRequiredError(1000);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
    const body = error.getResponse() as { code: string; message: string; messages: Record<string, string>; maxMeters: number };
    expect(body.code).toBe('area_required');
    expect(body.maxMeters).toBe(1000);
    expect(body.message).toBe('Pick the area — no area is within 1 km of this shop');
    expect(body.messages.en).toBe(body.message);
    expect(body.messages.kn).toContain('1 ಕಿ.ಮೀ');
    expect(body.messages.hi).toContain('1 कि.मी.');
    expect(body.messages.kn).not.toBe(body.messages.en);
    expect(body.messages.hi).not.toBe(body.messages.en);
  });

  it('labels distances in km or metres', () => {
    expect(distanceLabel(1000).en).toBe('1 km');
    expect(distanceLabel(1500).en).toBe('1.5 km');
    expect(distanceLabel(800).en).toBe('800 m');
  });

  describe('C-Pricing setting', () => {
    function pricing() {
      const before = { id: 'p0', areaAutoFillMaxMeters: 1000, maxHits: 3 };
      const prisma = {
        pricingPolicy: {
          findFirst: jest.fn().mockResolvedValue(before),
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data, id: 'p1' })),
        },
        staff: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      return { service: new PricingService(prisma as never, { log: jest.fn() } as never), prisma };
    }

    it('saves a new distance as a new policy version', async () => {
      const { service } = pricing();
      const created = await service.createVersion({ areaAutoFillMaxMeters: 1500 }, 'ceo-1');
      expect(created.areaAutoFillMaxMeters).toBe(1500);
    });

    it('carries the distance forward when another setting changes', async () => {
      const { service } = pricing();
      const created = await service.createVersion({ maxHits: 4 }, 'ceo-1');
      expect(created.areaAutoFillMaxMeters).toBe(1000);
    });

    it.each([0, -5, 1.5, 25_001])('refuses %p metres', async (meters) => {
      const { service, prisma } = pricing();
      await expect(service.createVersion({ areaAutoFillMaxMeters: meters }, 'ceo-1')).rejects.toThrow(BadRequestException);
      expect(prisma.pricingPolicy.create).not.toHaveBeenCalled();
    });
  });
});
