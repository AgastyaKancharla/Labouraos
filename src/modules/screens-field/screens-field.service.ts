import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessVisit, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculateHaversineDistanceMeters } from '../../common/geo/geo.util';
import { getCalendarPartsInTimezone, getPeriodBoundaries } from '../../common/time/period-boundary';
import { PricingService } from '../pricing/pricing.service';
import { REVISIT_OUTCOMES } from '../field-visit/field-visit.constants';
import { DAY_MS, FieldVisitClock, istDateKey, istDayStart, keyFromDate } from '../field-visit/field-visit-clock';

/** Map statuses (FA13 legend): onboarded, revisit due, interested, not interested; plus lead. */
export type ShopStatus = 'onboarded' | 'revisit_due' | 'interested' | 'not_interested' | 'lead';

/** How far around the agent the map and "Near you" look by default. */
export const MAP_DEFAULT_RADIUS_M = 3000;
export const MAP_MAX_RADIUS_M = 10000;
/** Alerts look back this far. */
const ALERT_WINDOW_MS = 2 * DAY_MS;

type Actor = { sub: string; role: string };

export interface ShopPoint {
  kind: 'business' | 'prospect';
  id: string;
  /** For a prospect: the latest visit; for a business: its id. */
  businessId: string | null;
  visitId: string | null;
  code: string | null;
  name: string;
  latitude: number;
  longitude: number;
  status: ShopStatus;
  revisitOn: string | null;
  lastVisitAt: string | null;
  isMine: boolean;
  distanceMeters?: number;
}

/**
 * Reads for Laboura Field's screens (FA03 Home, FA05 Visits, FA08 Business,
 * FA12 Targets, FA13 Map, FA20 nearby shops). Every number is counted from
 * records the system holds; nothing is typed by the agent. Phone numbers are
 * masked by PiiMaskingInterceptor; field agents see no rupee totals here.
 */
@Injectable()
export class ScreensFieldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly clock: FieldVisitClock,
  ) {}

  // ------------------------------------------------------------- FA03 Home

  async home(actor: Actor) {
    const now = this.clock.now();
    const staffId = actor.sub;
    const dayStart = istDayStart(now);
    const today = { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) };
    const todayKey = istDateKey(now);
    const tomorrowKey = istDateKey(new Date(now.getTime() + DAY_MS));

    const [shopsVisited, onboardedRows, vacanciesAdded, candidatesShown, interviewsBooked] = await Promise.all([
      // "A visit counts towards shops visited only with the photo and GPS."
      this.prisma.businessVisit.count({
        where: { staffId, visitedAt: today, OR: [{ boardPhotoHash: { not: null } }, { selfieHash: { not: null } }] },
      }),
      this.prisma.businessVisit.findMany({
        where: { staffId, outcome: 'onboarded', outcomeRecordedAt: today, businessId: { not: null } },
        select: { businessId: true },
        distinct: ['businessId'],
      }),
      this.prisma.vacancy.count({ where: { capturedByStaffId: staffId, createdAt: today, status: { not: 'draft' } } }),
      this.prisma.candidateIntroduction.count({ where: { shownByStaffId: staffId, shownAt: today } }),
      this.prisma.interview.count({ where: { proposedByStaffId: staffId, createdAt: today } }),
    ]);

    const mine: Prisma.BusinessWhereInput = { OR: [{ accountAgentId: staffId }, { leadCreatedByStaffId: staffId }] };
    const since = new Date(now.getTime() - ALERT_WINDOW_MS);
    const [agreements, results] = await Promise.all([
      this.prisma.businessAgreement.findMany({
        where: { signedAt: { gte: since }, business: mine },
        orderBy: { signedAt: 'desc' },
        take: 10,
        include: { business: { select: { id: true, code: true, name: true, verificationStatus: true, inPersonOnboardedAt: true, pausedAt: true } } },
      }),
      this.prisma.interview.findMany({
        where: {
          resultRecordedAt: { gte: since },
          result: { not: null },
          OR: [{ proposedByStaffId: staffId }, { business: { accountAgentId: staffId } }],
        },
        orderBy: { resultRecordedAt: 'desc' },
        take: 10,
        select: { id: true, code: true, result: true, resultRecordedAt: true, business: { select: { id: true, code: true, name: true } } },
      }),
    ]);
    const alerts = [
      ...agreements.map((a) => ({
        kind: 'agreement_signed' as const,
        at: a.signedAt.toISOString(),
        business: { id: a.business.id, code: a.business.code, name: a.business.name },
        canShowCandidates:
          !a.business.pausedAt &&
          (a.business.verificationStatus === 'verified' ||
            (a.business.verificationStatus === 'pending_tl_check' && Boolean(a.business.inPersonOnboardedAt))),
      })),
      ...results.map((r) => ({
        kind: 'interview_result' as const,
        at: r.resultRecordedAt!.toISOString(),
        business: r.business,
        interviewId: r.id,
        result: r.result,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const revisits = (await this.revisitsDue(staffId, tomorrowKey)).map((r) => ({
      kind: 'revisit' as const,
      due: r.revisitOn!,
      when: r.revisitOn! < todayKey ? ('overdue' as const) : r.revisitOn === todayKey ? ('today' as const) : ('tomorrow' as const),
      visitId: r.visitId,
      businessId: r.businessId,
      name: r.name,
      outcome: r.outcome,
    }));

    const tomorrowEnd = new Date(dayStart.getTime() + 2 * DAY_MS);
    const joinings = await this.prisma.placement.findMany({
      where: {
        joinedDate: null,
        joiningDate: { lt: tomorrowEnd },
        status: { in: ['confirmed', 'active'] },
        OR: [{ createdByStaffId: staffId }, { business: { accountAgentId: staffId } }],
      },
      select: {
        id: true,
        code: true,
        joiningDate: true,
        jobSeeker: { select: { name: true } },
        business: { select: { id: true, name: true } },
      },
      take: 20,
    });
    const checkIns = await this.prisma.followUpTask.findMany({
      where: { assignedStaffId: staffId, status: 'pending', dueAt: { lt: tomorrowEnd } },
      orderBy: { dueAt: 'asc' },
      take: 20,
      select: { id: true, code: true, kind: true, dueAt: true, subjectType: true, subjectId: true, relatedType: true, relatedId: true },
    });
    const seekerIds = checkIns.filter((c) => c.subjectType === 'job_seeker').map((c) => c.subjectId);
    const seekers = seekerIds.length
      ? await this.prisma.jobSeeker.findMany({ where: { id: { in: seekerIds } }, select: { id: true, name: true } })
      : [];
    const businessIds = checkIns.filter((c) => c.subjectType === 'business').map((c) => c.subjectId);
    const businesses = businessIds.length
      ? await this.prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map<string, string>([...seekers, ...businesses].map((x) => [x.id, x.name]));
    const whenOf = (at: Date) => {
      const key = istDateKey(at);
      return key < todayKey ? ('overdue' as const) : key === todayKey ? ('today' as const) : ('tomorrow' as const);
    };

    const todos = [
      ...revisits,
      ...joinings.map((p) => ({
        kind: 'joining' as const,
        due: istDateKey(p.joiningDate!),
        when: whenOf(p.joiningDate!),
        placementId: p.id,
        code: p.code,
        candidateFirstName: firstName(p.jobSeeker.name),
        businessId: p.business.id,
        name: p.business.name,
      })),
      ...checkIns.map((c) => ({
        kind: 'check_in' as const,
        due: istDateKey(c.dueAt),
        when: whenOf(c.dueAt),
        taskId: c.id,
        code: c.code,
        taskKind: c.kind,
        name: c.subjectType === 'job_seeker' ? firstName(names.get(c.subjectId) ?? '') : names.get(c.subjectId) ?? '',
        // Where the row opens in Laboura Field: the placement, the interview or the business.
        subjectType: c.subjectType,
        subjectId: c.subjectId,
        relatedType: c.relatedType,
        relatedId: c.relatedId,
      })),
    ].sort((a, b) => a.due.localeCompare(b.due));

    const checkIn = await this.prisma.fieldCheckIn.findFirst({
      where: { staffId, checkedInAt: today },
      orderBy: { checkedInAt: 'desc' },
    });

    return {
      now: now.toISOString(),
      today: {
        shopsVisited,
        onboarded: onboardedRows.length,
        vacanciesAdded,
        candidatesShown,
        interviewsBooked,
      },
      alerts,
      todos,
      checkIn: checkIn
        ? { latitude: checkIn.latitude, longitude: checkIn.longitude, accuracyMeters: checkIn.accuracyMeters, at: checkIn.checkedInAt.toISOString() }
        : null,
    };
  }

  // ------------------------------------------------------------ FA05 Visits

  async visits(actor: Actor) {
    const now = this.clock.now();
    const staffId = actor.sub;
    const dayStart = istDayStart(now);
    const todayKey = istDateKey(now);

    const assignments = await this.prisma.visitAssignment.findMany({
      where: { assignedStaffId: staffId, status: 'assigned' },
      orderBy: { createdAt: 'asc' },
      include: { business: { select: { id: true, code: true, name: true, locality: true, latitude: true, longitude: true } } },
    });
    const interviewIds = assignments.filter((a) => a.relatedType === 'interview' && a.relatedId).map((a) => a.relatedId!);
    const interviews = interviewIds.length
      ? await this.prisma.interview.findMany({
          where: { id: { in: interviewIds } },
          select: { id: true, slotStartsAt: true, candidateArrivedAt: true, jobSeeker: { select: { name: true } } },
        })
      : [];
    const byInterview = new Map(interviews.map((i) => [i.id, i]));
    const planned = assignments.map((a) => {
      const interview = a.relatedId ? byInterview.get(a.relatedId) : undefined;
      return {
        assignmentId: a.id,
        purpose: a.purpose,
        business: a.business,
        interview: interview
          ? {
              id: interview.id,
              startsAt: interview.slotStartsAt.toISOString(),
              candidateName: shortName(interview.jobSeeker.name),
              candidateArrivedAt: interview.candidateArrivedAt?.toISOString() ?? null,
            }
          : null,
      };
    });

    const revisitsDue = (await this.revisitsDue(staffId, todayKey)).map((r) => ({
      ...r,
      when: r.revisitOn! < todayKey ? 'overdue' : 'today',
    }));

    const done = await this.prisma.businessVisit.findMany({
      where: { staffId, visitedAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) } },
      orderBy: { visitedAt: 'asc' },
      include: { business: { select: { id: true, code: true, name: true } } },
    });
    return {
      now: now.toISOString(),
      planned,
      revisitsDue,
      doneToday: done.map((v) => ({
        id: v.id,
        name: v.business?.name ?? v.shopName ?? null,
        business: v.business,
        purpose: v.purpose,
        startedAt: (v.startedAt ?? v.visitedAt).toISOString(),
        durationSeconds: v.durationSeconds,
        hasBoardPhoto: Boolean(v.boardPhotoHash),
        hasSelfie: Boolean(v.selfieHash),
        outcome: v.outcome,
        needsOutcome: !v.outcome,
        needsProof: !v.outcome && Boolean(v.endedAt) && !v.selfieHash && v.purpose === 'shop_visit',
      })),
    };
  }

  // --------------------------------------------------------------- FA13 Map

  async map(actor: Actor, latValue?: string, lngValue?: string, radiusValue?: string) {
    const now = this.clock.now();
    const latitude = Number(latValue);
    const longitude = Number(lngValue);
    if (!latValue || !lngValue || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new BadRequestException('lat and lng are required');
    }
    const radius = Math.min(MAP_MAX_RADIUS_M, Math.max(20, Number(radiusValue) || MAP_DEFAULT_RADIUS_M));
    const dLat = radius / 111_320;
    const dLng = radius / (111_320 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
    const box = { gte: latitude - dLat, lte: latitude + dLat };
    const boxLng = { gte: longitude - dLng, lte: longitude + dLng };
    const todayKey = istDateKey(now);

    const businesses = await this.prisma.business.findMany({
      where: { anonymisedAt: null, latitude: box, longitude: boxLng },
      select: {
        id: true, code: true, name: true, latitude: true, longitude: true, verificationStatus: true,
        inPersonOnboardedAt: true, accountAgentId: true, leadCreatedByStaffId: true,
      },
      take: 500,
    });
    const latestByBusiness = new Map<string, BusinessVisit>();
    if (businesses.length) {
      const visits = await this.prisma.businessVisit.findMany({
        where: { businessId: { in: businesses.map((b) => b.id) } },
        orderBy: { visitedAt: 'desc' },
      });
      for (const v of visits) if (v.businessId && !latestByBusiness.has(v.businessId)) latestByBusiness.set(v.businessId, v);
    }
    const points: ShopPoint[] = businesses.map((b) => {
      const last = latestByBusiness.get(b.id);
      const onboarded = b.verificationStatus === 'verified' || Boolean(b.inPersonOnboardedAt) || b.verificationStatus === 'pending_tl_check';
      return {
        kind: 'business',
        id: b.id,
        businessId: b.id,
        visitId: last?.id ?? null,
        code: b.code,
        name: b.name,
        latitude: b.latitude!,
        longitude: b.longitude!,
        status: onboarded && !(last && REVISIT_OUTCOMES.includes(last.outcome ?? '') && dueBy(last, todayKey)) ? 'onboarded' : statusFromVisit(last, todayKey),
        revisitOn: last ? keyFromDate(last.revisitOn) : null,
        lastVisitAt: last ? last.visitedAt.toISOString() : null,
        isMine: b.accountAgentId === actor.sub || b.leadCreatedByStaffId === actor.sub,
      };
    });
    const prospects = await this.prospectTips({ latitude: box, longitude: boxLng });
    for (const v of prospects) {
      points.push({
        kind: 'prospect',
        id: v.id,
        businessId: null,
        visitId: v.id,
        code: null,
        name: v.shopName ?? '',
        latitude: v.latitude,
        longitude: v.longitude,
        status: statusFromVisit(v, todayKey),
        revisitOn: keyFromDate(v.revisitOn),
        lastVisitAt: v.visitedAt.toISOString(),
        isMine: v.staffId === actor.sub,
      });
    }
    for (const p of points) p.distanceMeters = Math.round(calculateHaversineDistanceMeters(latitude, longitude, p.latitude, p.longitude));
    const inRange = points.filter((p) => (p.distanceMeters ?? 0) <= radius).sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
    const policy = await this.pricing.current();
    return {
      me: { latitude, longitude },
      radiusMeters: radius,
      duplicateRadiusMeters: policy.duplicateBusinessRadiusMeters,
      shops: inRange,
      revisitsDue: inRange.filter((p) => p.status === 'revisit_due'),
    };
  }

  // ---------------------------------------------------------- FA08 Business

  async business(actor: Actor, ref: string) {
    const business = await this.prisma.business.findFirst({
      where: { OR: [{ id: ref }, { code: ref }], anonymisedAt: null },
      include: {
        branches: { select: { id: true, name: true, locality: true, contactPersonName: true, contactPersonRole: true } },
        vacancies: {
          where: { status: { in: ['open', 'awaiting_confirmation', 'draft'] } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, code: true, tradeSkill: true, headcount: true, status: true, salaryMinPaise: true, salaryMaxPaise: true,
            salaryPeriod: true, confirmedAt: true,
          },
        },
      },
    });
    if (!business) throw new NotFoundException('Business not found');
    if (actor.role === 'team_lead') {
      const team = await this.prisma.staff.findMany({ where: { teamLeadId: actor.sub }, select: { id: true } });
      const ids = new Set(team.map((t) => t.id));
      if (!ids.has(business.accountAgentId ?? '') && !ids.has(business.leadCreatedByStaffId ?? '')) {
        throw new ForbiddenException("A Team Lead sees their own team's businesses");
      }
    }
    const isMine = business.accountAgentId === actor.sub || (!business.accountAgentId && business.leadCreatedByStaffId === actor.sub);
    // Field agents see every business on the map, and full details of their own (guide, People and roles).
    const full = actor.role !== 'field_agent' || isMine;
    const [shown, interviews, placements, inGuarantee, visits, agreement] = await Promise.all([
      this.prisma.candidateIntroduction.count({ where: { businessId: business.id } }),
      this.prisma.interview.count({ where: { businessId: business.id } }),
      this.prisma.placement.count({ where: { businessId: business.id, joinedDate: { not: null } } }),
      this.prisma.placement.count({ where: { businessId: business.id, status: 'active' } }),
      this.prisma.businessVisit.findMany({
        where: { businessId: business.id },
        orderBy: { visitedAt: 'desc' },
        take: 20,
        include: { staff: { select: { name: true, code: true } } },
      }),
      this.prisma.businessAgreement.findFirst({
        where: { businessId: business.id },
        orderBy: { signedAt: 'desc' },
        select: { signedAt: true, signedName: true, signedRole: true },
      }),
    ]);
    return {
      id: business.id,
      code: business.code,
      name: business.name,
      businessType: business.businessType,
      locality: business.locality,
      latitude: business.latitude,
      longitude: business.longitude,
      verificationStatus: business.verificationStatus,
      documentsStatus: business.documentsStatus,
      paused: Boolean(business.pausedAt),
      inPersonOnboardedAt: business.inPersonOnboardedAt?.toISOString() ?? null,
      canShowCandidates:
        !business.pausedAt &&
        (business.verificationStatus === 'verified' ||
          (business.verificationStatus === 'pending_tl_check' && Boolean(business.inPersonOnboardedAt))),
      isMine,
      agreement: agreement ? { signedAt: agreement.signedAt.toISOString(), signedName: full ? agreement.signedName : null } : null,
      contact: full
        ? { name: business.additionalContactName ?? business.ownerName, role: business.contactRole, phone: business.phone }
        : null,
      branches: full ? business.branches : [],
      vacancies: business.vacancies.map((v) => ({
        id: v.id,
        code: v.code,
        trade: v.tradeSkill,
        headcount: v.headcount,
        status: v.status,
        salaryMinPaise: v.salaryMinPaise,
        salaryMaxPaise: v.salaryMaxPaise,
        salaryPeriod: v.salaryPeriod,
        otpConfirmed: Boolean(v.confirmedAt),
      })),
      stats: { candidatesShown: shown, interviews, placements, inGuarantee },
      visits: visits.map((v) => ({
        id: v.id,
        at: (v.startedAt ?? v.visitedAt).toISOString(),
        durationSeconds: v.durationSeconds,
        purpose: v.purpose,
        hasBoardPhoto: Boolean(v.boardPhotoHash),
        hasSelfie: Boolean(v.selfieHash),
        outcome: v.outcome,
        staffName: v.staff?.name ?? null,
        mine: v.staffId === actor.sub,
      })),
    };
  }

  // ----------------------------------------------------------- FA12 Targets

  /** "Job seekers you activated" (decided 11 Nov: shown under placements closed, no target). */
  async targets(actor: Actor) {
    const now = this.clock.now();
    const parts = getCalendarPartsInTimezone(now, 'Asia/Kolkata');
    const period = getPeriodBoundaries(parts.year, parts.month);
    const activated = await this.prisma.jobSeeker.count({
      where: { registeredByStaffId: actor.sub, paymentReceivedAt: { not: null, gte: period.startUtc, lte: period.endUtc } },
    });
    return { year: parts.year, month: parts.month, candidatesActivated: activated };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Revisits due by `byKey` (inclusive) for this agent: the latest visit of
   * each shop (business, or chain of visits to an unregistered shop) whose
   * outcome brings them back on a date.
   */
  private async revisitsDue(staffId: string, byKey: string) {
    const rows = await this.prisma.businessVisit.findMany({
      where: { staffId, outcome: { in: [...REVISIT_OUTCOMES] }, revisitOn: { lte: new Date(`${byKey}T00:00:00.000Z`) } },
      orderBy: { visitedAt: 'desc' },
      include: { business: { select: { id: true, code: true, name: true, locality: true, latitude: true, longitude: true } } },
      take: 200,
    });
    const result: Array<{
      visitId: string; businessId: string | null; name: string; locality: string | null; outcome: string | null;
      revisitOn: string | null; note: string | null; latitude: number; longitude: number; lastVisitAt: string;
    }> = [];
    for (const v of rows) {
      const later = v.businessId
        ? await this.prisma.businessVisit.findFirst({ where: { businessId: v.businessId, visitedAt: { gt: v.visitedAt } }, select: { id: true } })
        : await this.prisma.businessVisit.findFirst({ where: { revisitOfVisitId: v.id }, select: { id: true } });
      if (later) continue;
      result.push({
        visitId: v.id,
        businessId: v.businessId,
        name: v.business?.name ?? v.shopName ?? '',
        locality: v.business?.locality ?? null,
        outcome: v.outcome,
        revisitOn: keyFromDate(v.revisitOn),
        note: v.note,
        latitude: v.business?.latitude ?? v.latitude,
        longitude: v.business?.longitude ?? v.longitude,
        lastVisitAt: v.visitedAt.toISOString(),
      });
    }
    return result.sort((a, b) => (a.revisitOn ?? '').localeCompare(b.revisitOn ?? ''));
  }

  /** Unregistered shops in the box: the latest visit of each chain. */
  private async prospectTips(where: { latitude: Prisma.FloatFilter; longitude: Prisma.FloatFilter }) {
    const visits = await this.prisma.businessVisit.findMany({
      where: { businessId: null, shopName: { not: null }, latitude: where.latitude, longitude: where.longitude },
      orderBy: { visitedAt: 'desc' },
      take: 500,
    });
    if (!visits.length) return [];
    const followed = await this.prisma.businessVisit.findMany({
      where: { revisitOfVisitId: { in: visits.map((v) => v.id) } },
      select: { revisitOfVisitId: true },
    });
    const replaced = new Set(followed.map((f) => f.revisitOfVisitId));
    return visits.filter((v) => !replaced.has(v.id));
  }
}

function dueBy(visit: BusinessVisit, todayKey: string): boolean {
  const key = keyFromDate(visit.revisitOn);
  return key !== null && key <= todayKey;
}

function statusFromVisit(visit: BusinessVisit | undefined, todayKey: string): ShopStatus {
  if (!visit || !visit.outcome) return 'lead';
  if (visit.outcome === 'onboarded') return 'onboarded';
  if (visit.outcome === 'not_interested') return 'not_interested';
  if (REVISIT_OUTCOMES.includes(visit.outcome)) return dueBy(visit, todayKey) ? 'revisit_due' : 'interested';
  return 'lead';
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** "Ramesh G." — first name and initial, never the full name (businesses see first names only). */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] ?? '';
}
