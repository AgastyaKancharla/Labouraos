import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage } from '../business/storefront-photo.storage';
import { RetentionService } from './retention.service';

jest.setTimeout(120000);

const MONTH = 30 * 24 * 3600 * 1000;

/**
 * Guide, retention (11 Nov): visits to shops that never registered are kept
 * 23 months after the last visit to that shop; then the shop phone and the
 * photos (name board, proof selfie) are removed and the visit itself stays,
 * so visit counts in reports do not change.
 */
describe('Retention: visits to shops that never registered', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: RetentionService;
  let photos: MemoryBusinessPhotoStorage;
  const stamp = `${Date.now()}`;
  const visitIds: string[] = [];
  const businessIds: string[] = [];
  const now = new Date();

  async function visit(key: string, monthsAgo: number, extra: { revisitOf?: string; businessId?: string } = {}) {
    const board = `visits/ret-${stamp}-${key}/board.jpg`;
    const selfie = `visits/ret-${stamp}-${key}/selfie.jpg`;
    await photos.put(board, Buffer.from(`board-${key}`), 'image/jpeg');
    await photos.put(selfie, Buffer.from(`selfie-${key}`), 'image/jpeg');
    const row = await prisma.businessVisit.create({
      data: {
        latitude: 12.93,
        longitude: 77.62,
        shopName: `Shop ${key}`,
        contactPhone: '9900054321',
        boardPhotoPath: board,
        selfieUrl: selfie,
        visitedAt: new Date(now.getTime() - monthsAgo * MONTH),
        revisitOfVisitId: extra.revisitOf ?? null,
        businessId: extra.businessId ?? null,
      },
    });
    visitIds.push(row.id);
    return row;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    retention = app.get(RetentionService);
    photos = app.get(BUSINESS_PHOTO_STORAGE) as MemoryBusinessPhotoStorage;
  });

  afterAll(async () => {
    await prisma.businessVisit.updateMany({ where: { id: { in: visitIds } }, data: { revisitOfVisitId: null } });
    await prisma.businessVisit.deleteMany({ where: { id: { in: visitIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await app.close();
  });

  it('removes the shop phone and photos 23 months after the last visit, keeps the visits, and leaves shops visited since or registered alone', async () => {
    const oldShop = await visit('a', 25);
    const oldRevisit = await visit('b', 24, { revisitOf: oldShop.id });
    const recentShop = await visit('c', 25);
    const recentRevisit = await visit('d', 1, { revisitOf: recentShop.id });
    const business = await prisma.business.create({ data: { code: `BZ-RET-${stamp}`, name: 'Signed later', phone: `+9193${stamp.slice(-8)}` } });
    businessIds.push(business.id);
    const signedShop = await visit('e', 25);
    await visit('f', 24, { revisitOf: signedShop.id, businessId: business.id });

    // A dry run counts and changes nothing.
    const dry = { shopVisitsCleaned: 0 };
    await retention.cleanupUnregisteredShopVisits(now, true, dry);
    expect(dry.shopVisitsCleaned).toBeGreaterThanOrEqual(2);
    expect((await prisma.businessVisit.findUniqueOrThrow({ where: { id: oldShop.id } })).contactPhone).toBe('9900054321');

    const run = { shopVisitsCleaned: 0 };
    await retention.cleanupUnregisteredShopVisits(now, false, run);
    expect(run.shopVisitsCleaned).toBeGreaterThanOrEqual(2);
    for (const id of [oldShop.id, oldRevisit.id]) {
      const row = await prisma.businessVisit.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ contactPhone: null, boardPhotoPath: null, selfieUrl: null });
      expect(row.shopName).toMatch(/^Shop /);
    }
    expect(photos.has(`visits/ret-${stamp}-a/board.jpg`)).toBe(false);
    expect(photos.has(`visits/ret-${stamp}-b/selfie.jpg`)).toBe(false);
    for (const id of [recentShop.id, recentRevisit.id, signedShop.id]) {
      expect((await prisma.businessVisit.findUniqueOrThrow({ where: { id } })).contactPhone).toBe('9900054321');
    }
    expect(photos.has(`visits/ret-${stamp}-c/board.jpg`)).toBe(true);
    // The visits themselves stay for the counts.
    expect(await prisma.businessVisit.count({ where: { id: { in: visitIds } } })).toBe(visitIds.length);

    // Safe to repeat.
    const again = { shopVisitsCleaned: 0 };
    await retention.cleanupUnregisteredShopVisits(now, false, again);
    expect(await prisma.businessVisit.count({ where: { id: { in: [oldShop.id, oldRevisit.id] }, contactPhone: { not: null } } })).toBe(0);
  });

  it('is part of the daily keeping-data run summary', async () => {
    const summary = await retention.runRetentionCleanup({ dryRun: true, now });
    expect(typeof summary.shopVisitsCleaned).toBe('number');
  });
});
