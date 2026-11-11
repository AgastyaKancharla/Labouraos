import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessVisit, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { calculateHaversineDistanceMeters, DEFAULT_GEOFENCE_RADIUS_METERS } from '../../common/geo/geo.util';
import { optionalIndianMobile } from '../../common/phone/indian-mobile';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { ReviewFlagKind } from '../review-flag/review-flag.constants';
import { AttendanceService } from '../attendance/attendance.service';
import { BusinessVerificationService } from '../business/business-verification.service';
import { BUSINESS_PHOTO_STORAGE, BusinessPhotoStorage } from '../business/storefront-photo.storage';
import {
  CLOCK_SKEW_MS,
  LIVE_WINDOW_MS,
  MAX_PHOTO_BYTES,
  MAX_QUEUE_AGE_MS,
  NOT_INTERESTED_REASONS,
  ONBOARD_NOW,
  PHOTO_TYPES,
  REVISIT_OUTCOMES,
  SPOKE_TO,
  VISIT_OUTCOMES,
} from './field-visit.constants';
import { dateFromKey, DAY_MS, FieldVisitClock, istDateKey, keyFromDate } from './field-visit-clock';
import { gpsSuspicions, isShortVisit, noOnboardingPattern, Reading, travelCheck } from './visit-fraud';

export interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size?: number;
}

/** Multipart text fields sent with a live photo (field app: stampFormFields + the visit's own fields). */
export type PhotoFields = Record<string, string | undefined>;

export interface OutcomeBody {
  outcome?: string;
  shopName?: string;
  spokeTo?: string;
  contactPhone?: string;
  reason?: string;
  revisitOn?: string;
  note?: string;
  endedAt?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

type VisitWithBusiness = BusinessVisit & {
  business: { id: string; code: string; name: string; latitude: number | null; longitude: number | null } | null;
};

/**
 * Shop visits "built so the data can't be faked" (Master Guide, field agent
 * app, decided 9 Nov):
 * 1. outside: GPS + a live photo of the shop with its name board (camera
 *    only, stamped; a photo used before is refused);
 * 2. inside: the visit timer runs;
 * 3. the outcome (not interested + reason, owner not there + revisit date,
 *    interested + come-back date, or onboard now);
 * 4. for interested shops and verification visits: a selfie with the board
 *    and a second GPS check at the same spot.
 * The Team Lead's checks are raised as review flags, which ring their bell.
 * The visit id is made by the phone so a queued visit and its later steps can
 * be sent in order without signal.
 */
@Injectable()
export class FieldVisitService {
  private readonly logger = new Logger(FieldVisitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    private readonly pricing: PricingService,
    private readonly flags: ReviewFlagService,
    private readonly attendance: AttendanceService,
    private readonly verification: BusinessVerificationService,
    private readonly clock: FieldVisitClock,
    @Inject(BUSINESS_PHOTO_STORAGE) private readonly storage: BusinessPhotoStorage,
  ) {}

  // ------------------------------------------------------------ 1. outside

  async start(staffId: string, fields: PhotoFields, photo: UploadedPhoto | undefined) {
    const now = this.clock.now();
    const id = (fields.id ?? '').trim();
    if (!UUID.test(id)) throw new BadRequestException('A visit id (UUID made by the app) is required');
    const existing = await this.prisma.businessVisit.findUnique({ where: { id } });
    if (existing) {
      if (existing.staffId !== staffId) throw new ConflictException('This visit id belongs to another visit');
      return this.present(await this.load(id));
    }
    const reading = this.readingFrom(fields, now, 'the shop photo');
    const file = this.requireLivePhoto(fields, photo);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    await this.refuseUsedPhoto(staffId, hash, id, 'name_board');

    let businessId: string | null = null;
    let shopName = fields.shopName?.trim() || null;
    let purpose = 'shop_visit';
    let assignmentId: string | null = null;
    let revisitOfVisitId: string | null = null;

    if (fields.revisitOfVisitId?.trim()) {
      const earlier = await this.prisma.businessVisit.findUnique({ where: { id: fields.revisitOfVisitId.trim() } });
      if (!earlier) throw new NotFoundException('The earlier visit was not found');
      if (earlier.businessId) businessId = earlier.businessId;
      else {
        revisitOfVisitId = earlier.id;
        shopName = shopName ?? earlier.shopName;
      }
    }
    if (fields.businessId?.trim()) businessId = fields.businessId.trim();
    if (fields.assignmentId?.trim()) {
      const assignment = await this.prisma.visitAssignment.findUnique({ where: { id: fields.assignmentId.trim() } });
      if (!assignment) throw new NotFoundException('Visit assignment not found');
      if (assignment.assignedStaffId !== staffId || assignment.status !== 'assigned') {
        throw new ForbiddenException('Only the assigned field agent can start this visit');
      }
      if (businessId && assignment.businessId !== businessId) throw new BadRequestException('The assignment is for another business');
      businessId = assignment.businessId;
      assignmentId = assignment.id;
      purpose = assignment.purpose;
    }
    const business = businessId ? await this.prisma.business.findUnique({ where: { id: businessId } }) : null;
    if (businessId && !business) throw new NotFoundException('Business not found');

    const geofenceFlag = this.outsideGeofence(business, reading);
    const startedAt = reading.at;
    const extension = PHOTO_TYPES[file.mimetype];
    const boardPhotoPath = `visits/${id}/board/${hash}.${extension}`;
    await this.storage.put(boardPhotoPath, file.buffer, file.mimetype);

    const created = await this.prisma.businessVisit.create({
      data: {
        id,
        businessId,
        staffId,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracyMeters: reading.accuracyMeters,
        geofenceFlag,
        purpose,
        assignmentId,
        shopName,
        revisitOfVisitId,
        boardPhotoPath,
        boardPhotoHash: hash,
        boardPhotoTakenAt: startedAt,
        photoLive: true,
        startedAt,
        visitedAt: startedAt,
      },
    });
    await this.audit.log({
      actorId: staffId,
      action: 'field_visit.started',
      entityType: 'business_visit',
      entityCode: created.id,
      after: { businessId, purpose, assignmentId, revisitOfVisitId, geofenceFlag, startedAt: startedAt.toISOString() },
      changedFields: ['latitude', 'longitude', 'boardPhotoHash', 'startedAt'],
      reason: 'Shop visit started outside with GPS and the name-board photo',
      city: business?.city,
    });
    if (now.getTime() - startedAt.getTime() <= LIVE_WINDOW_MS) {
      await this.attendance.noteBusinessCheckIn(staffId).catch((e: unknown) => this.logger.warn(`On visit not set: ${String(e)}`));
    }

    const policy = await this.pricing.current();
    const gps = gpsSuspicions(reading, { stamp: this.stampFrom(fields), sameSpotMeters: policy.visitSameSpotMeters });
    if (gps.length) await this.markGpsSuspect(created, gps);
    const previous = await this.prisma.businessVisit.findFirst({
      where: { staffId, id: { not: id }, visitedAt: { lt: startedAt, gte: new Date(startedAt.getTime() - DAY_MS / 2) } },
      orderBy: { visitedAt: 'desc' },
    });
    if (previous) {
      const travel = travelCheck(
        { latitude: previous.latitude, longitude: previous.longitude, accuracyMeters: previous.accuracyMeters, at: previous.visitedAt },
        reading,
        { maxKmh: policy.visitMaxTravelKmh, sameSpotMeters: policy.visitSameSpotMeters },
      );
      if (travel.tooFar) {
        await this.raise('visits_too_far_apart', created, {
          previousVisitId: previous.id,
          distanceMeters: Math.round(travel.distanceMeters),
          minutesBetween: Math.round(travel.minutes),
          kmh: travel.kmh,
          maxKmh: policy.visitMaxTravelKmh,
        });
      }
    }
    return this.present(await this.load(id));
  }

  // ------------------------------------------------------ 2–3. inside, outcome

  async recordOutcome(staffId: string, id: string, body: OutcomeBody) {
    const now = this.clock.now();
    const visit = await this.ownVisit(staffId, id);
    const choice = (body.outcome ?? '').trim();
    const onboardNow = choice === ONBOARD_NOW;
    if (!onboardNow && !(VISIT_OUTCOMES as readonly string[]).includes(choice)) {
      throw new BadRequestException('Pick how the visit went: onboarded, interested — come back later, not interested or owner not there');
    }
    if (choice === 'onboarded' && !visit.businessId) {
      throw new BadRequestException('Onboarded needs the business registered from this visit');
    }
    const shopName = body.shopName?.trim() || visit.shopName;
    if (!visit.businessId && !shopName) throw new BadRequestException('The shop name is required');
    const spokeTo = body.spokeTo?.trim() || null;
    if (spokeTo && !(SPOKE_TO as readonly string[]).includes(spokeTo)) {
      throw new BadRequestException('Who did you speak to: owner, manager, staff or no one');
    }
    const contactPhone = optionalIndianMobile(body.contactPhone, 'contactPhone') ?? null;
    let reason: string | null = null;
    if (choice === 'not_interested') {
      reason = body.reason?.trim() || '';
      if (!(NOT_INTERESTED_REASONS as readonly string[]).includes(reason)) {
        throw new BadRequestException('Say why they are not interested');
      }
    }
    let revisitOn: Date | null = null;
    if (REVISIT_OUTCOMES.includes(choice)) {
      const key = body.revisitOn?.trim() ?? '';
      if (!DATE_KEY.test(key) || Number.isNaN(dateFromKey(key).getTime())) {
        throw new BadRequestException('Pick the date to come back');
      }
      if (key < istDateKey(visit.startedAt ?? visit.visitedAt)) throw new BadRequestException('The come-back date cannot be in the past');
      revisitOn = dateFromKey(key);
    }
    const note = body.note?.trim() ? body.note.trim().slice(0, 1000) : null;

    const startedAt = visit.startedAt ?? visit.visitedAt;
    const endedAt = visit.endedAt ?? this.clampTime(body.endedAt, startedAt, now);
    const durationSeconds = visit.durationSeconds ?? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);

    const data: Prisma.BusinessVisitUpdateInput = {
      shopName,
      endedAt,
      durationSeconds,
      ...(spokeTo ? { spokeTo } : {}),
      ...(contactPhone ? { contactPhone } : {}),
      ...(onboardNow
        ? {}
        : { outcome: choice, outcomeReason: reason, revisitOn, note, outcomeRecordedAt: now }),
    };
    await this.prisma.businessVisit.update({ where: { id }, data });
    await this.audit.log({
      actorId: staffId,
      action: onboardNow ? 'field_visit.onboarding_started' : 'field_visit.outcome_recorded',
      entityType: 'business_visit',
      entityCode: id,
      before: { outcome: visit.outcome, outcomeReason: visit.outcomeReason, revisitOn: keyFromDate(visit.revisitOn) },
      after: onboardNow
        ? { endedAt: endedAt.toISOString(), durationSeconds }
        : { outcome: choice, outcomeReason: reason, revisitOn: keyFromDate(revisitOn), durationSeconds },
      changedFields: ['outcome', 'outcomeReason', 'revisitOn', 'note', 'spokeTo', 'contactPhone', 'endedAt'],
      reason: visit.outcome ? 'Visit outcome changed' : 'Visit outcome recorded',
    });
    if (!visit.endedAt && now.getTime() - endedAt.getTime() <= LIVE_WINDOW_MS && !onboardNow) {
      await this.attendance.noteBusinessCheckOut(staffId).catch((e: unknown) => this.logger.warn(`Travelling not set: ${String(e)}`));
    }
    const policy = await this.pricing.current();
    if (!visit.endedAt && isShortVisit(durationSeconds, policy.visitShortMinutes)) {
      await this.raise('visit_short', visit, { durationSeconds, shortMinutes: policy.visitShortMinutes });
    }
    if (!onboardNow) await this.checkNoOnboarding(staffId, now, policy);
    return this.present(await this.load(id));
  }

  // ------------------------------------------------------ 4. proof outside

  async recordProof(staffId: string, id: string, fields: PhotoFields, photo: UploadedPhoto | undefined) {
    const now = this.clock.now();
    const visit = await this.ownVisit(staffId, id);
    if (visit.selfieHash) return this.present(await this.load(id));
    const reading = this.readingFrom(fields, now, 'the selfie');
    const file = this.requireLivePhoto(fields, photo);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    await this.refuseUsedPhoto(staffId, hash, id, 'selfie');
    const policy = await this.pricing.current();
    const distance = calculateHaversineDistanceMeters(visit.latitude, visit.longitude, reading.latitude, reading.longitude);
    if (distance > policy.visitSameSpotMeters) {
      throw new BadRequestException(
        `You are ${Math.round(distance)} m from where you took the shop photo. Take the selfie at the shop (within ${policy.visitSameSpotMeters} m).`,
      );
    }
    const path = `visits/${id}/selfie/${hash}.${PHOTO_TYPES[file.mimetype]}`;
    await this.storage.put(path, file.buffer, file.mimetype);
    const startedAt = visit.startedAt ?? visit.visitedAt;
    const proofAt = this.clampTime(fields.takenAt, startedAt, now);
    const geofenceFlag = visit.geofenceFlag || this.outsideGeofence(visit.business, reading);
    await this.prisma.businessVisit.update({
      where: { id },
      data: {
        selfieUrl: path,
        selfieHash: hash,
        proofLatitude: reading.latitude,
        proofLongitude: reading.longitude,
        proofAccuracyMeters: reading.accuracyMeters,
        proofAt,
        proofDistanceMeters: Math.round(distance),
        geofenceFlag,
        ...(visit.endedAt ? {} : { endedAt: proofAt, durationSeconds: Math.round((proofAt.getTime() - startedAt.getTime()) / 1000) }),
      },
    });
    await this.audit.log({
      actorId: staffId,
      action: 'field_visit.proof_recorded',
      entityType: 'business_visit',
      entityCode: id,
      after: { proofDistanceMeters: Math.round(distance), geofenceFlag },
      changedFields: ['selfieHash', 'proofLatitude', 'proofLongitude', 'proofAt'],
      reason: 'Selfie with the shop board and a second GPS check',
    });
    const gps = gpsSuspicions(
      { ...reading, at: proofAt },
      {
        stamp: this.stampFrom(fields),
        earlier: { latitude: visit.latitude, longitude: visit.longitude, accuracyMeters: visit.accuracyMeters, at: startedAt },
        sameSpotMeters: policy.visitSameSpotMeters,
      },
    );
    if (gps.length) await this.markGpsSuspect(visit, gps);
    if (now.getTime() - proofAt.getTime() <= LIVE_WINDOW_MS) {
      await this.attendance.noteBusinessCheckOut(staffId).catch((e: unknown) => this.logger.warn(`Travelling not set: ${String(e)}`));
    }
    return this.present(await this.load(id));
  }

  /** FA06 step 3: the owner's code completes a verification visit (live, never queued). */
  async completeVerification(staffId: string, id: string, body: { ownerOtpRequestId?: string; ownerOtpCode?: string }) {
    const visit = await this.ownVisit(staffId, id);
    if (visit.purpose !== 'verification' || !visit.assignmentId || !visit.businessId) {
      throw new BadRequestException('This is not a verification visit');
    }
    if (!visit.boardPhotoHash || !visit.selfieHash) {
      throw new BadRequestException('Take the shop photo and the selfie with the shop first');
    }
    if (!body.ownerOtpRequestId || !body.ownerOtpCode) throw new BadRequestException("Enter the owner's code");
    const business = await this.prisma.business.findUniqueOrThrow({ where: { id: visit.businessId } });
    const valid = await this.otp.verifyOtp(body.ownerOtpRequestId, body.ownerOtpCode);
    const owners = valid ? await this.otp.isVerified(body.ownerOtpRequestId, business.phone) : false;
    if (!owners) throw new BadRequestException("Wrong code. Ask the owner to read the latest code again.");
    await this.prisma.$transaction(async (tx) => {
      await tx.businessVisit.update({ where: { id }, data: { ownerOtpRequestId: body.ownerOtpRequestId } });
      const done = await tx.visitAssignment.updateMany({
        where: { id: visit.assignmentId!, assignedStaffId: staffId, status: 'assigned' },
        data: { status: 'done', visitId: id },
      });
      if (done.count !== 1) throw new ForbiddenException('Only the assigned field agent can complete this visit');
    });
    await this.audit.log({
      actorId: staffId,
      action: 'business.visit_recorded',
      entityType: 'business_visit',
      entityCode: id,
      after: { businessId: business.id, purpose: 'verification', assignmentId: visit.assignmentId, geofenceFlag: visit.geofenceFlag },
      changedFields: ['ownerOtpRequestId', 'assignmentStatus'],
      reason: 'Verification visit completed with GPS, live photos and the owner’s OTP',
      city: business.city,
    });
    await this.verification.advanceToPendingTlCheckIfReady(business.id, staffId);
    const after = await this.prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { verificationStatus: true } });
    return { ...this.present(await this.load(id)), businessVerificationStatus: after.verificationStatus };
  }

  /**
   * Called by BusinessService.create when the business is registered from a
   * shop visit: the visit becomes "onboarded", its name-board photo becomes
   * the live storefront photo, and in-person onboarding can complete.
   */
  async assertCanRegisterFrom(staffId: string, id: string): Promise<BusinessVisit> {
    const visit = await this.prisma.businessVisit.findUnique({ where: { id } });
    if (!visit || visit.staffId !== staffId) throw new NotFoundException('Visit not found');
    if (visit.businessId) throw new ConflictException('A business was already registered from this visit');
    if (!visit.boardPhotoHash || !visit.selfieHash) {
      throw new BadRequestException('Registration opens after the shop photo and the selfie with the shop');
    }
    return visit;
  }

  async linkRegisteredBusiness(staffId: string, id: string, businessId: string): Promise<void> {
    const now = this.clock.now();
    const visit = await this.assertCanRegisterFrom(staffId, id);
    const business = await this.prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    const geofenceFlag = this.outsideGeofence(business, {
      latitude: visit.proofLatitude ?? visit.latitude,
      longitude: visit.proofLongitude ?? visit.longitude,
    });
    await this.prisma.$transaction([
      this.prisma.businessVisit.update({
        where: { id },
        data: { businessId, outcome: 'onboarded', outcomeRecordedAt: now, geofenceFlag, shopName: visit.shopName ?? business.name },
      }),
      this.prisma.business.update({
        where: { id: businessId },
        data: {
          storefrontPhotoPath: visit.boardPhotoPath,
          storefrontPhotoHash: visit.boardPhotoHash,
          storefrontPhotoLive: true,
          ...(geofenceFlag ? { geofenceFlag: true } : {}),
        },
      }),
    ]);
    await this.audit.log({
      actorId: staffId,
      action: 'field_visit.business_registered',
      entityType: 'business_visit',
      entityCode: id,
      after: { businessId, outcome: 'onboarded', geofenceFlag },
      changedFields: ['businessId', 'outcome', 'storefrontPhotoHash'],
      reason: 'Business registered from the shop visit',
      city: business.city,
    });
    await this.verification.advanceToPendingTlCheckIfReady(businessId, staffId);
  }

  // --------------------------------------------------------- interview day

  /** Interview day: the field agent at the shop marks "candidate arrived", with GPS. */
  async candidateArrived(staffId: string, interviewId: string, body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown }) {
    const now = this.clock.now();
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: { business: { select: { id: true, code: true, city: true, latitude: true, longitude: true, accountAgentId: true } } },
    });
    if (!interview) throw new NotFoundException('Interview not found');
    const assigned = await this.prisma.visitAssignment.findFirst({
      where: { relatedType: 'interview', relatedId: interviewId, assignedStaffId: staffId },
      select: { id: true },
    });
    if (interview.business.accountAgentId !== staffId && interview.proposedByStaffId !== staffId && !assigned) {
      throw new ForbiddenException('Only the field agent attending this interview can mark the candidate arrived');
    }
    if (['cancelled', 'declined', 'no_reply'].includes(interview.status)) {
      throw new BadRequestException('This interview is not going ahead');
    }
    if (interview.candidateArrivedAt) return this.presentArrival(interview);
    const reading = this.readingFrom(
      { latitude: String(body.latitude ?? ''), longitude: String(body.longitude ?? ''), accuracy: body.accuracy === undefined ? undefined : String(body.accuracy) },
      now,
      'your location',
    );
    const policy = await this.pricing.current();
    let distance: number | null = null;
    if (typeof interview.business.latitude === 'number' && typeof interview.business.longitude === 'number') {
      distance = Math.round(calculateHaversineDistanceMeters(interview.business.latitude, interview.business.longitude, reading.latitude, reading.longitude));
      if (distance > policy.visitSameSpotMeters) {
        throw new BadRequestException(`You are ${distance} m from the shop. Mark the arrival at the shop.`);
      }
    }
    const updated = await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        candidateArrivedAt: now,
        candidateArrivedByStaffId: staffId,
        candidateArrivedLatitude: reading.latitude,
        candidateArrivedLongitude: reading.longitude,
        candidateArrivedAccuracyMeters: reading.accuracyMeters,
        candidateArrivedDistanceMeters: distance,
      },
    });
    await this.audit.log({
      actorId: staffId,
      action: 'interview.candidate_arrived',
      entityType: 'interview',
      entityCode: interview.code,
      after: { candidateArrivedAt: now.toISOString(), distanceMeters: distance },
      changedFields: ['candidateArrivedAt', 'candidateArrivedLatitude', 'candidateArrivedLongitude'],
      reason: 'Candidate arrived for the interview (marked at the shop with GPS)',
      city: interview.business.city,
    });
    return this.presentArrival(updated);
  }

  async get(staffId: string, id: string) {
    await this.ownVisit(staffId, id);
    return this.present(await this.load(id));
  }

  // ---------------------------------------------------------------- helpers

  private presentArrival(interview: { id: string; code: string; candidateArrivedAt: Date | null; candidateArrivedDistanceMeters: number | null }) {
    return {
      interviewId: interview.id,
      code: interview.code,
      candidateArrivedAt: interview.candidateArrivedAt?.toISOString() ?? null,
      distanceMeters: interview.candidateArrivedDistanceMeters,
    };
  }

  private async ownVisit(staffId: string, id: string): Promise<VisitWithBusiness> {
    const visit = await this.load(id).catch(() => null);
    if (!visit || visit.staffId !== staffId) throw new NotFoundException('Visit not found');
    return visit;
  }

  private load(id: string): Promise<VisitWithBusiness> {
    return this.prisma.businessVisit.findUniqueOrThrow({
      where: { id },
      include: { business: { select: { id: true, code: true, name: true, latitude: true, longitude: true } } },
    });
  }

  /** What the app shows about a visit. contactPhone is masked by PiiMaskingInterceptor. */
  present(visit: VisitWithBusiness) {
    return {
      id: visit.id,
      purpose: visit.purpose,
      business: visit.business ? { id: visit.business.id, code: visit.business.code, name: visit.business.name } : null,
      shopName: visit.shopName ?? visit.business?.name ?? null,
      assignmentId: visit.assignmentId,
      revisitOfVisitId: visit.revisitOfVisitId,
      latitude: visit.latitude,
      longitude: visit.longitude,
      accuracyMeters: visit.accuracyMeters,
      startedAt: (visit.startedAt ?? visit.visitedAt).toISOString(),
      endedAt: visit.endedAt?.toISOString() ?? null,
      durationSeconds: visit.durationSeconds,
      hasBoardPhoto: Boolean(visit.boardPhotoHash),
      hasSelfie: Boolean(visit.selfieHash),
      proofDistanceMeters: visit.proofDistanceMeters,
      geofenceFlag: visit.geofenceFlag,
      spokeTo: visit.spokeTo,
      contactPhone: visit.contactPhone,
      outcome: visit.outcome,
      outcomeReason: visit.outcomeReason,
      revisitOn: keyFromDate(visit.revisitOn),
      note: visit.note,
      ownerOtpDone: Boolean(visit.ownerOtpRequestId),
    };
  }

  private readingFrom(fields: PhotoFields, now: Date, what: string): Reading {
    const latitude = Number(fields.latitude);
    const longitude = Number(fields.longitude);
    if (
      fields.latitude === undefined || fields.longitude === undefined || fields.latitude === '' || fields.longitude === '' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)
    ) {
      throw new BadRequestException(`GPS is required with ${what}. Turn on location and try again.`);
    }
    const accuracy = fields.accuracy === undefined || fields.accuracy === '' ? null : Number(fields.accuracy);
    return {
      latitude,
      longitude,
      accuracyMeters: accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
      at: this.clampTime(fields.takenAt, new Date(now.getTime() - MAX_QUEUE_AGE_MS), now),
    };
  }

  /** A phone time inside [notBefore, now + skew], otherwise the server's now. */
  private clampTime(value: string | undefined, notBefore: Date, now: Date): Date {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return now;
    if (parsed.getTime() > now.getTime() + CLOCK_SKEW_MS || parsed.getTime() < notBefore.getTime()) return now;
    return parsed.getTime() > now.getTime() ? now : parsed;
  }

  private stampFrom(fields: PhotoFields): { latitude: number; longitude: number } | null {
    const latitude = Number(fields.stampLatitude);
    const longitude = Number(fields.stampLongitude);
    if (!fields.stampLatitude || !fields.stampLongitude || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  }

  private requireLivePhoto(fields: PhotoFields, photo: UploadedPhoto | undefined): UploadedPhoto {
    if (fields.source !== 'live_camera') {
      throw new BadRequestException("Only a photo taken with the app's own camera is accepted");
    }
    if (!photo || !photo.buffer?.length) throw new BadRequestException('The photo is missing');
    if (!PHOTO_TYPES[photo.mimetype]) throw new BadRequestException('The photo must be a JPEG, PNG or WebP image');
    if (photo.buffer.length > MAX_PHOTO_BYTES) throw new BadRequestException('The photo is too large');
    return photo;
  }

  /** "A photo already used before is rejected" — and the Team Lead hears about it. */
  private async refuseUsedPhoto(staffId: string, hash: string, visitId: string, kind: 'name_board' | 'selfie') {
    const [visit, business] = await Promise.all([
      this.prisma.businessVisit.findFirst({
        where: { id: { not: visitId }, OR: [{ boardPhotoHash: hash }, { selfieHash: hash }] },
        select: { id: true, staffId: true },
      }),
      this.prisma.business.findFirst({ where: { storefrontPhotoHash: hash }, select: { id: true, code: true } }),
    ]);
    if (!visit && !business) return;
    await this.flags.raise({
      kind: 'visit_photo_reused',
      subjectType: 'staff',
      subjectId: staffId,
      raisedForStaffId: staffId,
      details: { visitId, photo: kind, earlierVisitId: visit?.id ?? null, businessCode: business?.code ?? null },
    });
    throw new ConflictException('This photo was already used. Take a new photo with the app camera.');
  }

  private outsideGeofence(
    business: { latitude: number | null; longitude: number | null } | null,
    reading: { latitude: number; longitude: number },
  ): boolean {
    if (!business || typeof business.latitude !== 'number' || typeof business.longitude !== 'number') return false;
    const radius = Number(process.env.GEOFENCE_RADIUS_METERS) || DEFAULT_GEOFENCE_RADIUS_METERS;
    return calculateHaversineDistanceMeters(business.latitude, business.longitude, reading.latitude, reading.longitude) > radius;
  }

  private async markGpsSuspect(visit: BusinessVisit, reasons: string[]) {
    if (!visit.gpsSuspect) await this.prisma.businessVisit.update({ where: { id: visit.id }, data: { gpsSuspect: true } });
    await this.raise('visit_gps_suspect', visit, { reasons });
  }

  private async raise(kind: ReviewFlagKind, visit: BusinessVisit, details: Record<string, unknown>) {
    const business = visit.businessId
      ? await this.prisma.business.findUnique({ where: { id: visit.businessId }, select: { code: true } })
      : null;
    await this.flags.raise({
      kind,
      subjectType: 'business_visit',
      subjectId: visit.id,
      raisedForStaffId: visit.staffId,
      details: { visitId: visit.id, ...(business ? { businessCode: business.code } : {}), ...details },
    });
  }

  private async checkNoOnboarding(staffId: string, now: Date, policy: { visitNoOnboardingCount: number; visitNoOnboardingDays: number }) {
    const since = new Date(now.getTime() - policy.visitNoOnboardingDays * DAY_MS);
    const open = await this.prisma.reviewFlag.findFirst({
      where: { kind: 'visits_no_onboarding', subjectType: 'staff', subjectId: staffId, status: 'open' },
      select: { id: true },
    });
    if (open) return;
    const rows = await this.prisma.businessVisit.findMany({
      where: { staffId, outcome: { not: null }, visitedAt: { gte: since } },
      select: { outcome: true },
    });
    const outcomes = rows.map((r) => r.outcome as string);
    if (!noOnboardingPattern(outcomes, policy.visitNoOnboardingCount)) return;
    await this.flags.raise({
      kind: 'visits_no_onboarding',
      subjectType: 'staff',
      subjectId: staffId,
      raisedForStaffId: staffId,
      details: { visits: outcomes.length, days: policy.visitNoOnboardingDays, threshold: policy.visitNoOnboardingCount },
    });
  }
}
