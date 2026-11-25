import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { detectSelfieImageType } from '../../common/image-type';
import { BusinessClock } from './business-clock';
import { BUSINESS_PHOTO_LINK_TTL_SECONDS, BUSINESS_PHOTO_STORAGE, BusinessPhotoStorage } from './storefront-photo.storage';

/**
 * The owner's live photos before he signs the agreement (Master Guide rev 211, B1):
 * a selfie, and the shop's name board — for a home business (Business.runsFromHome) the
 * owner holding his FSSAI licence with his face visible. Camera only (the page and the
 * app send captureSource=live_camera; anything else is refused). The phone's location
 * is recorded with the shop photo; a refused location still takes the photo (the
 * automatic check's location test then fails and the Team Lead looks).
 *
 * Stored like the other business verification photos: the private business-photos
 * bucket, served only through 5-minute signed links to the CEO, Managers and Team Leads
 * who may open the business. Kept like the business profile (23 months after the last
 * activity, then removed by anonymisation), the same rule the guide uses for visit photos.
 */
export const OWNER_PHOTO_KINDS = ['owner_selfie', 'shop_board', 'fssai_with_owner'] as const;
export type OwnerPhotoKind = (typeof OWNER_PHOTO_KINDS)[number];
/** What the page or app sends: the selfie, or "the shop photo" (board or FSSAI, decided by the business). */
export type OwnerPhotoSlot = 'selfie' | 'shop';

export interface OwnerPhotoLocation {
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  /** refused or unavailable when the phone gave no location. */
  status?: string | null;
}

export interface OwnerPhotoInput {
  slot: OwnerPhotoSlot;
  photo: Buffer;
  captureSource: string | undefined;
  location?: OwnerPhotoLocation;
  takenVia: 'agreement_link' | 'field_app';
  takenByStaffId?: string | null;
  /** Who the audit row names: the staff member, or the link's sender. */
  auditActorId: string;
}

/** Which kind the shop photo is for this business. */
export function shopPhotoKind(runsFromHome: boolean): OwnerPhotoKind {
  return runsFromHome ? 'fssai_with_owner' : 'shop_board';
}

export interface OwnerPhotoState {
  selfie: boolean;
  shop: boolean;
  shopKind: 'shop_board' | 'fssai_with_owner';
}

/** Parses a coordinate the page sent as text or a number. */
function coordinate(value: unknown, limit: number): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export function parseOwnerPhotoLocation(body: Record<string, unknown>): OwnerPhotoLocation {
  const latitude = coordinate(body.latitude, 90);
  const longitude = coordinate(body.longitude, 180);
  const accuracy = coordinate(body.accuracyMeters, 100000);
  const status = typeof body.locationStatus === 'string' ? body.locationStatus : null;
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) {
    return { latitude: null, longitude: null, accuracyMeters: null, status: status === 'unavailable' ? 'unavailable' : 'refused' };
  }
  return { latitude, longitude, accuracyMeters: accuracy !== null && accuracy >= 0 ? accuracy : null, status: 'recorded' };
}

export function parseOwnerPhotoSlot(value: unknown): OwnerPhotoSlot {
  if (value === 'selfie' || value === 'shop') return value;
  throw new BadRequestException('kind must be selfie or shop');
}

@Injectable()
export class BusinessOwnerPhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: BusinessClock,
    @Inject(BUSINESS_PHOTO_STORAGE) private readonly storage: BusinessPhotoStorage,
  ) {}

  /** Which of the two photos the business has (the latest of each kind counts). */
  async state(businessId: string): Promise<OwnerPhotoState> {
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { runsFromHome: true } });
    if (!business) throw new NotFoundException('Business not found');
    const shopKind = shopPhotoKind(business.runsFromHome) as OwnerPhotoState['shopKind'];
    const rows = await this.prisma.businessOwnerPhoto.findMany({
      where: { businessId, kind: { in: ['owner_selfie', shopKind] } },
      select: { kind: true },
    });
    return { selfie: rows.some((r) => r.kind === 'owner_selfie'), shop: rows.some((r) => r.kind === shopKind), shopKind };
  }

  async save(businessId: string, input: OwnerPhotoInput) {
    if (input.captureSource !== 'live_camera') throw new BadRequestException('A live camera photo is required; gallery uploads are refused');
    if (!input.photo?.length) throw new BadRequestException('A live camera photo is required');
    const contentType = detectSelfieImageType(input.photo);
    if (!contentType) throw new BadRequestException('The photo must be a JPEG, PNG or WebP image');
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { id: true, code: true, city: true, runsFromHome: true, anonymisedAt: true } });
    if (!business || business.anonymisedAt) throw new NotFoundException('Business not found');
    const kind: OwnerPhotoKind = input.slot === 'selfie' ? 'owner_selfie' : shopPhotoKind(business.runsFromHome);
    const photoHash = createHash('sha256').update(input.photo).digest('hex');
    // The same picture sent for another business (or reused from a visit) is refused.
    const reused = await this.prisma.businessOwnerPhoto.findFirst({ where: { photoHash, businessId: { not: businessId } }, select: { id: true } });
    const reusedVisit = reused ? null : await this.prisma.businessVisit.findFirst({ where: { OR: [{ selfieHash: photoHash }, { boardPhotoHash: photoHash }] }, select: { id: true } });
    if (reused || reusedVisit) throw new BadRequestException('This photo was already used: take a new live photo');
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const storagePath = `businesses/${business.id}/owner/${kind}/${photoHash}.${extension}`;
    await this.storage.put(storagePath, input.photo, contentType);
    const location = kind === 'owner_selfie' ? null : (input.location ?? { status: 'refused' });
    const takenAt = this.clock.now();
    const row = await this.prisma.businessOwnerPhoto.create({
      data: {
        businessId: business.id,
        kind,
        storagePath,
        photoHash,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracyMeters: location?.accuracyMeters ?? null,
        locationStatus: location ? (location.status ?? 'refused') : null,
        takenVia: input.takenVia,
        takenByStaffId: input.takenByStaffId ?? null,
        takenAt,
      },
    });
    await this.audit.log({
      actorId: input.auditActorId,
      action: 'business.owner_photo_taken',
      entityType: 'business',
      entityCode: business.code,
      after: { kind, takenVia: input.takenVia, locationStatus: row.locationStatus, photoId: row.id },
      changedFields: ['ownerPhoto'],
      reason: input.takenVia === 'agreement_link' ? 'Owner took a live photo on the agreement link before signing' : 'Field agent took the owner photo in Laboura Field before the owner signed',
      city: business.city,
    });
    return { id: row.id, kind, takenAt, locationStatus: row.locationStatus };
  }

  /** The latest selfie and shop photo as short-lived private links (the caller checks who may see them). */
  async signedPhotos(businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { runsFromHome: true } });
    if (!business) throw new NotFoundException('Business not found');
    const rows = await this.prisma.businessOwnerPhoto.findMany({ where: { businessId }, orderBy: { takenAt: 'desc' } });
    const latest = (kind: OwnerPhotoKind) => rows.find((r) => r.kind === kind) ?? null;
    const sign = async (row: (typeof rows)[number] | null) => {
      if (!row) return null;
      const url = this.storage.signedUrl ? await this.storage.signedUrl(row.storagePath, BUSINESS_PHOTO_LINK_TTL_SECONDS) : null;
      return {
        kind: row.kind,
        kept: Boolean(url),
        url: url ?? null,
        takenAt: row.takenAt.toISOString(),
        takenVia: row.takenVia,
        locationStatus: row.locationStatus,
        hasLocation: row.latitude !== null && row.longitude !== null,
      };
    };
    return {
      selfie: await sign(latest('owner_selfie')),
      shop: await sign(latest(shopPhotoKind(business.runsFromHome))),
      expiresInSeconds: BUSINESS_PHOTO_LINK_TTL_SECONDS,
    };
  }
}
