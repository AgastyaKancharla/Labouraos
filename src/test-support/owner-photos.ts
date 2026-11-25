import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

/**
 * 25 Nov (rev 211, B1): signing a business agreement needs the owner's live selfie and the shop
 * photo first. Tests that sign through the agreement link add both rows here (no storage).
 * `at` places the shop photo (default: no location, as when the phone refused it).
 */
export async function seedOwnerPhotos(
  prisma: Pick<PrismaClient, 'businessOwnerPhoto'>,
  businessId: string,
  options: { at?: { latitude: number; longitude: number }; runsFromHome?: boolean } = {},
): Promise<void> {
  const takenAt = new Date();
  await prisma.businessOwnerPhoto.create({
    data: { businessId, kind: 'owner_selfie', storagePath: `businesses/${businessId}/owner/test-selfie.jpg`, photoHash: randomUUID(), takenVia: 'agreement_link', takenAt },
  });
  await prisma.businessOwnerPhoto.create({
    data: {
      businessId,
      kind: options.runsFromHome ? 'fssai_with_owner' : 'shop_board',
      storagePath: `businesses/${businessId}/owner/test-shop.jpg`,
      photoHash: randomUUID(),
      latitude: options.at?.latitude ?? null,
      longitude: options.at?.longitude ?? null,
      locationStatus: options.at ? 'recorded' : 'refused',
      takenVia: 'agreement_link',
      takenAt,
    },
  });
}
