import { findFieldVisitProof } from './business-field-proof';
import { BadRequestException, ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { codedError } from '../../common/http/coded-error';
import { detectSelfieImageType } from '../../common/image-type';
import { getCalendarPartsInTimezone } from '../../common/time/period-boundary';
import { AadhaarQrService } from '../aadhaar-qr/aadhaar-qr.service';
import { BusinessClock } from './business-clock';
import { validProofCount } from './business-proofs';
import { allowedShopKinds, verificationPathOf } from './business-paths';
import { BUSINESS_PHOTO_STORAGE, BusinessPhotoStorage } from './storefront-photo.storage';

/**
 * Small businesses with little paperwork (Master Guide rev 212, "decided 25 Nov, same day",
 * B9). A business that can't give 2 proofs is not turned away: Laboura verifies the owner as a
 * person and the place he works from — (a) the owner's government ID: Aadhaar QR (the in-house
 * UIDAI check) or a live photo of PAN / driving licence / voter ID checked by the Team Lead;
 * (b) the owner's live selfie and a live workspace photo with its location (B1 photos);
 * (c) one business proof; (d) one address proof photo; (e) a short video call with the Team
 * Lead showing the workspace, instead of a field visit. The Team Lead then approves or rejects.
 *
 * Kept: the ID type, its last 4 characters, the name on it and the result; that the address
 * proof was checked, its type and the address as matched; the business proof; the video call.
 * The ID card photo and the address proof image are deleted the moment the Team Lead decides,
 * and in any case after 30 days (retention job).
 */
export const OWNER_CHECK_PHOTO_MAX_DAYS = 30;
export const OWNER_QR_ATTEMPTS_PER_DAY = 10;
export const OTHER_ID_TYPES = ['pan', 'driving_licence', 'voter_id'] as const;
export const ADDRESS_DOC_TYPES = ['bank_statement', 'electricity_bill', 'rent_agreement', 'other'] as const;
export const BUSINESS_PROOF_KINDS = ['gst', 'udyam', 'fssai', 'licence', 'other_registration', 'bank_upi', 'website_listing'] as const;

const ID_SHAPES: Record<(typeof OTHER_ID_TYPES)[number], RegExp> = {
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  driving_licence: /^[A-Z0-9-]{8,20}$/,
  voter_id: /^[A-Z]{3}\d{7}$/,
};

export interface SmallBusinessState {
  /** Fewer than 2 proofs (and not a household): these checks apply. */
  required: boolean;
  ownerId: { method: string | null; type: string | null; result: string | null; last4: string | null; failureReason: string | null };
  businessProof: { given: boolean; kind: string | null; fromProofs: boolean };
  addressProof: { submitted: boolean; docType: string | null; result: string | null };
  videoCall: { done: boolean; at: string | null };
  /** Rev 213: onboarded in person by a field agent — no video call needed, the visit photos count. */
  fieldVisit?: boolean;
  photos: { selfie: boolean; workspace: boolean };
  /** What is still missing before the Team Lead may approve (in words). */
  missing: string[];
}

function dayKey(at: Date): string {
  const p = getCalendarPartsInTimezone(at, 'Asia/Kolkata');
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** What the Team Lead still needs before approving a small business (pure, for tests and the gate). */
export function smallBusinessMissing(s: Omit<SmallBusinessState, 'missing' | 'required'>): string[] {
  const missing: string[] = [];
  if (!s.photos.selfie) missing.push("the owner's live selfie");
  if (!s.photos.workspace) missing.push('a live photo of the workspace');
  if (s.ownerId.result !== 'verified') missing.push(s.ownerId.result === 'pending' ? "the Team Lead's check of the owner's ID" : "the owner's government ID");
  if (!s.businessProof.given) missing.push('one business proof');
  if (s.addressProof.result !== 'checked') missing.push(s.addressProof.submitted ? "the Team Lead's check of the address proof" : 'an address proof');
  if (!s.videoCall.done && !s.fieldVisit) missing.push('the video call with the Team Lead');
  return missing;
}

@Injectable()
export class BusinessOwnerCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: BusinessClock,
    private readonly aadhaar: AadhaarQrService,
    @Inject(BUSINESS_PHOTO_STORAGE) private readonly storage: BusinessPhotoStorage,
  ) {}

  private async business(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: { ownerCheck: true, ownerPhotos: { select: { kind: true } } },
    });
    if (!business || business.anonymisedAt) throw new NotFoundException('Business not found');
    return business;
  }

  async state(businessId: string): Promise<SmallBusinessState> {
    const b = await this.business(businessId);
    const c = b.ownerCheck;
    const shopKinds: string[] = allowedShopKinds(b);
    const visit = await findFieldVisitProof(this.prisma, businessId);
    const base = {
      ownerId: { method: c?.idMethod ?? null, type: c?.idType ?? null, result: c?.idResult ?? null, last4: c?.idLast4 ?? null, failureReason: c?.idFailureReason ?? null },
      businessProof: { given: Boolean(c?.businessProofKind) || validProofCount(b) >= 1, kind: c?.businessProofKind ?? null, fromProofs: validProofCount(b) >= 1 },
      addressProof: { submitted: Boolean(c?.addressSubmittedAt), docType: c?.addressDocType ?? null, result: c?.addressResult ?? null },
      videoCall: { done: Boolean(c?.videoCallDoneAt), at: c?.videoCallDoneAt?.toISOString() ?? null },
      fieldVisit: Boolean(visit),
      photos: {
        selfie: Boolean(visit) || b.ownerPhotos.some((p) => p.kind === 'owner_selfie'),
        workspace: Boolean(visit) || b.ownerPhotos.some((p) => shopKinds.includes(p.kind)),
      },
    };
    return { required: verificationPathOf(b) === 'small_business' || b.verificationPath === 'small_business', ...base, missing: smallBusinessMissing(base) };
  }

  private async ensureRow(businessId: string) {
    const existing = await this.prisma.businessOwnerCheck.findUnique({ where: { businessId } });
    if (existing) return existing;
    return this.prisma.businessOwnerCheck.upsert({ where: { businessId }, create: { businessId }, update: {} });
  }

  private storePhoto = async (businessId: string, folder: string, photo: Buffer, captureSource: string | undefined) => {
    if (captureSource !== 'live_camera') throw new BadRequestException('A live camera photo is required; gallery uploads are refused');
    if (!photo?.length) throw new BadRequestException('A live camera photo is required');
    const contentType = detectSelfieImageType(photo);
    if (!contentType) throw new BadRequestException('The photo must be a JPEG, PNG or WebP image');
    const hash = createHash('sha256').update(photo).digest('hex');
    const path = `businesses/${businessId}/${folder}/${hash}.${contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'}`;
    await this.storage.put(path, photo, contentType);
    return path;
  };

  private async deletePath(path: string | null | undefined) {
    if (path && this.storage.delete) await this.storage.delete(path);
  }

  /** (a) The owner's Aadhaar Secure QR, read on his phone: only the result, last 4 and name are kept. */
  async submitAadhaar(businessId: string, qrText: unknown, auditActorId: string) {
    const b = await this.business(businessId);
    const row = await this.ensureRow(businessId);
    if (row.idResult === 'verified') throw new BadRequestException("The owner's ID is already verified");
    const now = this.clock.now();
    const today = dayKey(now);
    const attempts = row.idAttemptsDay === today ? row.idAttempts : 0;
    if (attempts >= OWNER_QR_ATTEMPTS_PER_DAY) throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY', 'Too many tries today. Try again tomorrow or use another ID.');
    await this.prisma.businessOwnerCheck.update({ where: { businessId }, data: { idAttempts: attempts + 1, idAttemptsDay: today } });
    const ownerName = b.ownerName?.trim() || b.additionalContactName?.trim() || '';
    const outcome = await this.aadhaar.checkBusinessOwner(ownerName, qrText, now);
    await this.prisma.businessOwnerCheck.update({
      where: { businessId },
      data: {
        idMethod: 'aadhaar_qr',
        idType: 'aadhaar',
        idResult: outcome.verified ? 'verified' : 'failed',
        idLast4: outcome.last4,
        idName: outcome.nameOnId,
        idFailureReason: outcome.failureReason,
        idSubmittedAt: now,
        idCheckedAt: outcome.verified ? now : null,
        idCheckedByStaffId: null,
      },
    });
    await this.audit.log({
      actorId: auditActorId,
      action: 'business.owner_id_checked',
      entityType: 'business',
      entityCode: b.code,
      after: { method: 'aadhaar_qr', result: outcome.result },
      changedFields: ['idMethod', 'idResult'],
      reason: 'Small business: the owner checked his Aadhaar QR on the agreement page',
      city: b.city,
    });
    return { result: outcome.result, verified: outcome.verified, failureReason: outcome.failureReason, offerOtherId: !outcome.verified };
  }

  /** (a) A live photo of PAN, driving licence or voter ID with the number typed: the Team Lead checks it. */
  async submitOtherId(businessId: string, input: { idType: unknown; idNumber: unknown; nameOnId: unknown; photo: Buffer; captureSource: string | undefined }, auditActorId: string) {
    const b = await this.business(businessId);
    const row = await this.ensureRow(businessId);
    if (row.idResult === 'verified') throw new BadRequestException("The owner's ID is already verified");
    const idType = String(input.idType ?? '') as (typeof OTHER_ID_TYPES)[number];
    if (!(OTHER_ID_TYPES as readonly string[]).includes(idType)) throw new BadRequestException('idType must be pan, driving_licence or voter_id');
    const number = String(input.idNumber ?? '').replace(/\s+/g, '').toUpperCase();
    if (!ID_SHAPES[idType].test(number)) throw new BadRequestException('The ID number does not look right for this card: check it was typed correctly');
    const nameOnId = String(input.nameOnId ?? '').trim().slice(0, 120);
    if (nameOnId.length < 2) throw new BadRequestException('Type the name as it is on the card');
    const path = await this.storePhoto(businessId, 'owner-id', input.photo, input.captureSource);
    const now = this.clock.now();
    await this.deletePath(row.idPhotoPath);
    await this.prisma.businessOwnerCheck.update({
      where: { businessId },
      data: {
        idMethod: 'other_id', idType, idLast4: number.slice(-4), idName: nameOnId, idResult: 'pending', idFailureReason: null,
        idPhotoPath: path, idSubmittedAt: now, idCheckedAt: null, idCheckedByStaffId: null, idPhotoDeletedAt: null,
      },
    });
    await this.audit.log({
      actorId: auditActorId,
      action: 'business.owner_id_submitted',
      entityType: 'business',
      entityCode: b.code,
      after: { method: 'other_id', idType, result: 'pending' },
      changedFields: ['idMethod', 'idType', 'idResult'],
      reason: 'Small business: the owner sent a live photo of his ID for the Team Lead',
      city: b.city,
    });
    return { result: 'pending' };
  }

  /** (c) One business proof (a registration, a business bank / UPI account, a website or listing page). */
  async setBusinessProof(businessId: string, input: { kind: unknown; value: unknown }, auditActorId: string) {
    const b = await this.business(businessId);
    await this.ensureRow(businessId);
    const kind = String(input.kind ?? '');
    if (!(BUSINESS_PROOF_KINDS as readonly string[]).includes(kind)) throw new BadRequestException(`kind must be one of ${BUSINESS_PROOF_KINDS.join(', ')}`);
    let value = String(input.value ?? '').trim().slice(0, 300);
    if (value.length < 3) throw new BadRequestException('Type the proof (the number, UPI ID or link)');
    if (kind === 'website_listing' && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(value)) throw new BadRequestException('Paste the full link (https://…)');
    // A bank account number is kept as its last 4 digits only; a UPI ID is kept as typed.
    if (kind === 'bank_upi' && /^\d{6,20}$/.test(value.replace(/\s+/g, ''))) value = `Account ending ${value.replace(/\s+/g, '').slice(-4)}`;
    const now = this.clock.now();
    await this.prisma.businessOwnerCheck.update({ where: { businessId }, data: { businessProofKind: kind, businessProofValue: value, businessProofAt: now } });
    await this.audit.log({
      actorId: auditActorId,
      action: 'business.small_business_proof_added',
      entityType: 'business',
      entityCode: b.code,
      after: { businessProofKind: kind },
      changedFields: ['businessProofKind', 'businessProofValue'],
      reason: 'Small business: one business proof given',
      city: b.city,
    });
    return { kind };
  }

  /** (d) One address proof photo (bank statement, electricity bill, rent agreement or similar). */
  async submitAddressProof(businessId: string, input: { docType: unknown; photo: Buffer; captureSource: string | undefined }, auditActorId: string) {
    const b = await this.business(businessId);
    const row = await this.ensureRow(businessId);
    const docType = String(input.docType ?? '');
    if (!(ADDRESS_DOC_TYPES as readonly string[]).includes(docType)) throw new BadRequestException('docType must be bank_statement, electricity_bill, rent_agreement or other');
    if (row.addressResult === 'checked') throw new BadRequestException('The address proof is already checked');
    const path = await this.storePhoto(businessId, 'address-proof', input.photo, input.captureSource);
    const now = this.clock.now();
    await this.deletePath(row.addressPhotoPath);
    await this.prisma.businessOwnerCheck.update({
      where: { businessId },
      data: { addressDocType: docType, addressPhotoPath: path, addressSubmittedAt: now, addressResult: 'pending', addressMatched: null, addressCheckedAt: null, addressCheckedByStaffId: null, addressPhotoDeletedAt: null },
    });
    await this.audit.log({
      actorId: auditActorId,
      action: 'business.address_proof_submitted',
      entityType: 'business',
      entityCode: b.code,
      after: { addressDocType: docType, addressResult: 'pending' },
      changedFields: ['addressDocType', 'addressResult'],
      reason: 'Small business: the owner sent an address proof photo for the Team Lead',
      city: b.city,
    });
    return { result: 'pending' };
  }

  private assertChecker(actor: { id: string; role: string }) {
    if (!['team_lead', 'manager', 'ceo'].includes(actor.role)) throw new ForbiddenException('Only a Team Lead, Manager or the CEO checks these');
  }

  /** The Team Lead decides the owner's ID card photo; the photo is deleted at once. */
  async decideOwnerId(businessId: string, actor: { id: string; role: string }, decision: unknown, reason: unknown) {
    this.assertChecker(actor);
    const b = await this.business(businessId);
    const row = b.ownerCheck;
    if (!row || row.idMethod !== 'other_id' || row.idResult !== 'pending') throw new BadRequestException("No ID card photo is waiting for the check");
    if (decision !== 'approve' && decision !== 'reject') throw new BadRequestException('decision must be approve or reject');
    const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
    if (decision === 'reject' && !why) throw new BadRequestException('A reason is required to reject the ID');
    const now = this.clock.now();
    await this.deletePath(row.idPhotoPath);
    await this.prisma.businessOwnerCheck.update({
      where: { businessId },
      data: {
        idResult: decision === 'approve' ? 'verified' : 'rejected', idFailureReason: decision === 'reject' ? why : null,
        idCheckedAt: now, idCheckedByStaffId: actor.id, idPhotoPath: null, idPhotoDeletedAt: now,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: decision === 'approve' ? 'business.owner_id_approved' : 'business.owner_id_rejected',
      entityType: 'business',
      entityCode: b.code,
      before: { idResult: 'pending' },
      after: { idResult: decision === 'approve' ? 'verified' : 'rejected', idPhotoDeleted: true },
      changedFields: ['idResult', 'idPhotoPath'],
      reason: why || "Team Lead checked the owner's ID card photo",
      city: b.city,
    });
    return this.state(businessId);
  }

  /** The Team Lead checks the address proof: the address as matched is kept, the image deleted. */
  async decideAddress(businessId: string, actor: { id: string; role: string }, decision: unknown, addressMatched: unknown, reason: unknown) {
    this.assertChecker(actor);
    const b = await this.business(businessId);
    const row = b.ownerCheck;
    if (!row || row.addressResult !== 'pending') throw new BadRequestException('No address proof is waiting for the check');
    if (decision !== 'approve' && decision !== 'reject') throw new BadRequestException('decision must be approve or reject');
    const matched = typeof addressMatched === 'string' ? addressMatched.trim().slice(0, 300) : '';
    const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
    if (decision === 'approve' && matched.length < 5) throw new BadRequestException('Type the address as it is on the document');
    if (decision === 'reject' && !why) throw new BadRequestException('A reason is required to reject the address proof');
    const now = this.clock.now();
    await this.deletePath(row.addressPhotoPath);
    await this.prisma.businessOwnerCheck.update({
      where: { businessId },
      data: {
        addressResult: decision === 'approve' ? 'checked' : 'rejected', addressMatched: decision === 'approve' ? matched : null,
        addressCheckedAt: now, addressCheckedByStaffId: actor.id, addressPhotoPath: null, addressPhotoDeletedAt: now,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: decision === 'approve' ? 'business.address_proof_checked' : 'business.address_proof_rejected',
      entityType: 'business',
      entityCode: b.code,
      before: { addressResult: 'pending' },
      after: { addressResult: decision === 'approve' ? 'checked' : 'rejected', imageDeleted: true },
      changedFields: ['addressResult', 'addressMatched', 'addressPhotoPath'],
      reason: why || 'Team Lead checked the address proof',
      city: b.city,
    });
    return this.state(businessId);
  }

  /** (e) "Video call done": the Team Lead saw the workspace on a short video call through Laboura. */
  async recordVideoCall(businessId: string, actor: { id: string; role: string }, note: unknown) {
    this.assertChecker(actor);
    const b = await this.business(businessId);
    const text = typeof note === 'string' ? note.trim().slice(0, 500) : '';
    if (text.length < 5) throw new BadRequestException('Write what the video call showed (a short note)');
    await this.ensureRow(businessId);
    const now = this.clock.now();
    await this.prisma.businessOwnerCheck.update({ where: { businessId }, data: { videoCallDoneAt: now, videoCallByStaffId: actor.id, videoCallNote: text } });
    await this.audit.log({
      actorId: actor.id,
      action: 'business.video_call_done',
      entityType: 'business',
      entityCode: b.code,
      after: { videoCallDone: true },
      changedFields: ['videoCallDoneAt', 'videoCallNote'],
      reason: 'Team Lead saw the workspace on a video call',
      city: b.city,
    });
    return this.state(businessId);
  }
}

/**
 * Daily (retention job): ID card photos and address proof images older than 30 days that the
 * Team Lead never checked are deleted; their pending check is closed as expired.
 */
export async function deleteExpiredOwnerCheckPhotos(
  prisma: PrismaService,
  storage: BusinessPhotoStorage | undefined,
  now: Date,
  dryRun = false,
): Promise<number> {
  const cutoff = new Date(now.getTime() - OWNER_CHECK_PHOTO_MAX_DAYS * 24 * 3600 * 1000);
  const rows = await prisma.businessOwnerCheck.findMany({
    where: { OR: [{ idPhotoPath: { not: null }, idSubmittedAt: { lt: cutoff } }, { addressPhotoPath: { not: null }, addressSubmittedAt: { lt: cutoff } }] },
    select: { id: true, idPhotoPath: true, idSubmittedAt: true, idResult: true, addressPhotoPath: true, addressSubmittedAt: true, addressResult: true },
    take: 500,
  });
  if (dryRun) return rows.length;
  let deleted = 0;
  for (const row of rows) {
    const idExpired = Boolean(row.idPhotoPath && row.idSubmittedAt && row.idSubmittedAt < cutoff);
    const addressExpired = Boolean(row.addressPhotoPath && row.addressSubmittedAt && row.addressSubmittedAt < cutoff);
    try {
      if (idExpired && storage?.delete) await storage.delete(row.idPhotoPath!);
      if (addressExpired && storage?.delete) await storage.delete(row.addressPhotoPath!);
    } catch {
      continue; // tried again tomorrow
    }
    await prisma.businessOwnerCheck.update({
      where: { id: row.id },
      data: {
        idPhotoPath: idExpired ? null : undefined,
        idPhotoDeletedAt: idExpired ? now : undefined,
        idResult: idExpired && row.idResult === 'pending' ? 'expired' : undefined,
        addressPhotoPath: addressExpired ? null : undefined,
        addressPhotoDeletedAt: addressExpired ? now : undefined,
        addressResult: addressExpired && row.addressResult === 'pending' ? 'expired' : undefined,
      },
    });
    deleted += (idExpired ? 1 : 0) + (addressExpired ? 1 : 0);
  }
  return deleted;
}
