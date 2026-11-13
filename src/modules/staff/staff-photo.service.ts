import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CandidatePhotoStorage } from '../job-seeker/photo-storage';

/** The same private photo bucket as job seeker and partner selfies; never public. */
export const STAFF_PHOTO_STORAGE = 'STAFF_PHOTO_STORAGE';
export const STAFF_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Signed links to a staff photo last as long as a candidate photo link. */
export const STAFF_PHOTO_LINK_TTL_SECONDS = CANDIDATE_PHOTO_LINK_TTL_SECONDS;

export type StaffPhotoReason = 'missing' | 'retake';

/** Who needs a photo before going on: nobody has one yet, or the CEO asked for a new one. */
export function staffPhotoNeeded(staff: { photoStoragePath: string | null; photoRetakeRequestedAt: Date | null }): StaffPhotoReason | null {
  if (!staff.photoStoragePath) return 'missing';
  if (staff.photoRetakeRequestedAt) return 'retake';
  return null;
}

/** Only a live camera frame: an image, marked as a live capture, not empty, at most 5 MB. */
export function assertLiveCameraPhoto(photo: { buffer: Buffer; mimetype: string } | undefined, captureSource: unknown): asserts photo is { buffer: Buffer; mimetype: string } {
  if (captureSource !== 'live_camera') throw new BadRequestException('A live camera capture is required; gallery uploads are refused');
  if (!photo?.buffer?.length || !photo.mimetype?.toLowerCase().startsWith('image/')) throw new BadRequestException('A live camera image is required');
  if (photo.buffer.length > STAFF_PHOTO_MAX_BYTES) throw new BadRequestException('The photo is too large');
}

/**
 * Staff photo (guide, "The login code screen", 14 Nov): a live camera selfie
 * taken when the person sets up their account from the invite link, so the
 * senior giving a login code can see who is asking. It also shows on staff
 * lists and profiles. Someone without one (older accounts) is asked at their
 * next login before going on; the CEO can ask anyone for a retake. Kept in
 * the private photo bucket and handed out only as short-lived signed links.
 */
@Injectable()
export class StaffPhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STAFF_PHOTO_STORAGE) private readonly storage: CandidatePhotoStorage,
  ) {}

  private pathFor(staffId: string) {
    return `staff/${staffId}/profile-photo`;
  }

  /** Saves a new photo for a staff member and clears any retake request. Audited. */
  async save(staffId: string, photo: { buffer: Buffer; mimetype: string }, actorId: string, how: 'invite' | 'login', now: Date = new Date()) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, code: true, city: true, photoStoragePath: true, photoTakenAt: true, photoRetakeRequestedAt: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    const path = this.pathFor(staff.id);
    await this.storage.put(path, photo.buffer, photo.mimetype);
    await this.prisma.staff.update({ where: { id: staff.id }, data: { photoStoragePath: path, photoTakenAt: now, photoRetakeRequestedAt: null } });
    await this.audit.log({
      actorId,
      action: 'staff.photo_taken',
      entityType: 'staff',
      entityCode: staff.code,
      before: { hadPhoto: Boolean(staff.photoStoragePath), photoTakenAt: staff.photoTakenAt?.toISOString() ?? null, retakeRequested: Boolean(staff.photoRetakeRequestedAt) },
      after: { hadPhoto: true, photoTakenAt: now.toISOString(), retakeRequested: false },
      changedFields: ['photoStoragePath', 'photoTakenAt', 'photoRetakeRequestedAt'],
      reason: how === 'invite' ? 'Live camera selfie taken while setting up the account from the invite link' : 'Live camera selfie taken at login',
      city: staff.city,
    });
    return { photoTakenAt: now, photoUrl: await this.signed(path) };
  }

  /** Does this person have to take a photo before going on (GET /staff/me/photo)? */
  async status(staffId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { photoStoragePath: true, photoTakenAt: true, photoRetakeRequestedAt: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    const reason = staffPhotoNeeded(staff);
    return {
      required: reason !== null,
      reason,
      photoTakenAt: staff.photoTakenAt,
      photoUrl: staff.photoStoragePath ? await this.signed(staff.photoStoragePath) : null,
    };
  }

  /**
   * "Ask for a new photo": only the CEO (guide). The person retakes it at their
   * next login; the old photo stays shown until then. Audited with the reason.
   */
  async requestRetake(staffId: string, actor: { id: string; role: string }, reason: unknown, now: Date = new Date()) {
    if (actor.role !== 'ceo') throw new ForbiddenException('Only the CEO can ask for a new staff photo');
    const staff = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, code: true, name: true, city: true, status: true, photoRetakeRequestedAt: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    if (staff.id === actor.id) throw new BadRequestException('Take your own new photo at your next login');
    const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
    await this.prisma.staff.update({ where: { id: staff.id }, data: { photoRetakeRequestedAt: now } });
    await this.audit.log({
      actorId: actor.id,
      action: 'staff.photo_retake_requested',
      entityType: 'staff',
      entityCode: staff.code,
      before: { retakeRequested: Boolean(staff.photoRetakeRequestedAt) },
      after: { retakeRequested: true, requestedAt: now.toISOString() },
      changedFields: ['photoRetakeRequestedAt'],
      reason: why ?? 'CEO asked for a new staff photo',
      city: staff.city,
    });
    return { id: staff.id, photoRetakeRequestedAt: now };
  }

  /** Signed links (and whether a retake is asked) for many staff at once: lists, profiles, login code cards. */
  async photosFor(staffIds: readonly string[]): Promise<Map<string, { photoUrl: string | null; photoRetakeRequested: boolean }>> {
    const ids = [...new Set(staffIds.filter(Boolean))];
    const out = new Map<string, { photoUrl: string | null; photoRetakeRequested: boolean }>();
    if (!ids.length) return out;
    const rows = await this.prisma.staff.findMany({ where: { id: { in: ids } }, select: { id: true, photoStoragePath: true, photoRetakeRequestedAt: true } });
    await Promise.all(
      rows.map(async (r) => {
        out.set(r.id, { photoUrl: r.photoStoragePath ? await this.signed(r.photoStoragePath) : null, photoRetakeRequested: Boolean(r.photoRetakeRequestedAt) });
      }),
    );
    return out;
  }

  /** Adds `photoUrl` and `photoRetakeRequested` to each row whose staff id `idOf` gives. */
  async withPhotos<T extends object>(rows: readonly T[], idOf: (row: T) => string | null | undefined): Promise<(T & { photoUrl: string | null; photoRetakeRequested: boolean })[]> {
    const photos = await this.photosFor(rows.map(idOf).filter((id): id is string => Boolean(id)));
    return rows.map((row) => {
      const id = idOf(row);
      const p = id ? photos.get(id) : undefined;
      return { ...row, photoUrl: p?.photoUrl ?? null, photoRetakeRequested: p?.photoRetakeRequested ?? false };
    });
  }

  /** The same for rows that carry the person as `staff` ({ staff: { id, … } }): the photo goes on `staff`. */
  async withStaffPhotos<T extends { staff: { id: string } }>(rows: readonly T[]): Promise<(T & { staff: T['staff'] & { photoUrl: string | null } })[]> {
    const photos = await this.photosFor(rows.map((r) => r.staff.id));
    return rows.map((row) => ({ ...row, staff: { ...row.staff, photoUrl: photos.get(row.staff.id)?.photoUrl ?? null } }));
  }

  private async signed(path: string): Promise<string | null> {
    try {
      return await this.storage.signedUrl(path, STAFF_PHOTO_LINK_TTL_SECONDS);
    } catch {
      // The photo store being unreachable must not break a list: the screen shows initials.
      return null;
    }
  }
}
