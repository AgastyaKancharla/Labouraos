import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BUSINESS_PHOTO_LINK_TTL_SECONDS, BUSINESS_PHOTO_STORAGE, BusinessPhotoStorage } from '../business/storefront-photo.storage';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';

export interface PhotoViewer {
  id: string;
  role: string;
}

/** One photo for a profile: a short-lived private link, or kept: false when the picture is gone. */
export interface ProfilePhoto {
  kept: boolean;
  url: string | null;
  expiresInSeconds: number;
}

/**
 * Real photos on the CEO, Manager and Team Lead profiles (Master Guide rev 194,
 * "Team Lead portal, decided 17 Nov"): the job seeker's live selfie on
 * C-JobSeeker, and per visit the shop's name-board photo and the agent's
 * selfie on C-Business. The same storage and short-lived signed links as the
 * Team Lead's registration and visit checks (TeamLeadChecksService.selfie and
 * visitPhotos); never a public bucket. Every request is checked against the
 * viewer's own record filter first (the CEO passes none; a Manager his tree
 * and unowned records; a Team Lead his team and unowned records in his city),
 * and every view is audited. Aadhaar QR and ID card photos are never served
 * here (they live elsewhere and are deleted after the check).
 */
@Injectable()
export class RecordPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(BUSINESS_PHOTO_STORAGE) private readonly businessPhotos: BusinessPhotoStorage,
    @Optional() @Inject(CANDIDATE_PHOTO_STORAGE) private readonly candidatePhotos?: CandidatePhotoStorage,
  ) {}

  /** The job seeker's live selfie (taken during registration), or kept: false. */
  async seekerSelfie(viewer: PhotoViewer, scope: Prisma.JobSeekerWhereInput | null, id: string): Promise<ProfilePhoto> {
    const where: Prisma.JobSeekerWhereInput = { AND: [{ OR: [{ id }, { code: id }] }, ...(scope ? [scope] : [])] };
    const seeker = await this.prisma.jobSeeker.findFirst({ where, select: { id: true, code: true, city: true, photoStoragePath: true } });
    if (!seeker) throw new NotFoundException(`Job seeker '${id}' not found`);
    if (!seeker.photoStoragePath || !this.candidatePhotos) return { kept: false, url: null, expiresInSeconds: 0 };
    const url = await this.candidatePhotos.signedUrl(seeker.photoStoragePath, CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    await this.audit.log({ actorId: viewer.id, action: 'record.selfie_viewed', entityType: 'job_seeker', entityCode: seeker.code, changedFields: [], city: seeker.city });
    return { kept: Boolean(url), url: url ?? null, expiresInSeconds: url ? CANDIDATE_PHOTO_LINK_TTL_SECONDS : 0 };
  }

  /** The referral partner's own photo (taken at registration), or kept: false (rev 198). */
  async partnerPhoto(viewer: PhotoViewer, scope: Prisma.ReferralWhereInput | null, id: string): Promise<ProfilePhoto> {
    const where: Prisma.ReferralWhereInput = { AND: [{ OR: [{ id }, { code: id }] }, ...(scope ? [scope] : [])] };
    const partner = await this.prisma.referral.findFirst({ where, select: { id: true, code: true, city: true, photoStoragePath: true } });
    if (!partner) throw new NotFoundException(`Referral partner '${id}' not found`);
    if (!partner.photoStoragePath || !this.candidatePhotos) return { kept: false, url: null, expiresInSeconds: 0 };
    const url = await this.candidatePhotos.signedUrl(partner.photoStoragePath, CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    await this.audit.log({ actorId: viewer.id, action: 'record.partner_photo_viewed', entityType: 'referral', entityCode: partner.code, changedFields: [], city: partner.city });
    return { kept: Boolean(url), url: url ?? null, expiresInSeconds: url ? CANDIDATE_PHOTO_LINK_TTL_SECONDS : 0 };
  }

  /** A visit to the business: its name-board photo and the agent's selfie. */
  async visitPhotos(viewer: PhotoViewer, scope: Prisma.BusinessWhereInput | null, businessId: string, visitId: string) {
    const where: Prisma.BusinessWhereInput = { AND: [{ OR: [{ id: businessId }, { code: businessId }] }, ...(scope ? [scope] : [])] };
    const business = await this.prisma.business.findFirst({ where, select: { id: true, city: true } });
    if (!business) throw new NotFoundException(`Business '${businessId}' not found`);
    const visit = await this.prisma.businessVisit.findFirst({ where: { id: visitId, businessId: business.id }, select: { id: true, boardPhotoPath: true, selfieUrl: true } });
    if (!visit) throw new NotFoundException(`Visit '${visitId}' not found`);
    const sign = async (path: string | null): Promise<ProfilePhoto> => {
      if (!path || !this.businessPhotos.signedUrl) return { kept: false, url: null, expiresInSeconds: 0 };
      const url = await this.businessPhotos.signedUrl(path, BUSINESS_PHOTO_LINK_TTL_SECONDS);
      return { kept: Boolean(url), url: url ?? null, expiresInSeconds: url ? BUSINESS_PHOTO_LINK_TTL_SECONDS : 0 };
    };
    const result = { boardPhoto: await sign(visit.boardPhotoPath), selfie: await sign(visit.selfieUrl), expiresInSeconds: BUSINESS_PHOTO_LINK_TTL_SECONDS };
    await this.audit.log({ actorId: viewer.id, action: 'record.visit_photos_viewed', entityType: 'business_visit', entityCode: visit.id, changedFields: [], city: business.city });
    return result;
  }
}
