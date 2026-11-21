import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { calculateHaversineDistanceMeters } from '../../common/geo/geo.util';
import { phoneLast4 } from '../../common/phone/indian-mobile';
import { decryptCallRoutingPhone } from '../staff/call-routing-key';
import { isVerificationVisitPurpose, VERIFICATION_VISIT_PURPOSES } from '../business/business.constants';
import { REPEAT_BUSINESS_ANSWERS, FOLLOW_UP_ANSWERS, isRepeatBusinessKind } from '../follow-up/follow-up.constants';
import { NotificationService } from '../notification/notification.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { DAY_MS, FieldVisitClock, istDateKey, istDayStart, keyFromDate } from '../field-visit/field-visit-clock';
import { handedTo } from '../field-visit/field-handover.service';

type Actor = { sub: string; role: string };

/** Field notifications look back this far when they catch up (assignments, signed agreements, handovers). */
const NOTIFY_LOOKBACK_MS = 7 * DAY_MS;
/** The similar-shop check looks only this close to where the agent was last seen today. */
export const SIMILAR_SHOP_NEAR_ME_METERS = 1000;
/** "Update the pin": a reason of at least this many characters. */
export const PIN_REASON_MIN_LENGTH = 5;
/** Moving a pin further than this needs the Team Lead, not the agent. */
export const PIN_MOVE_MAX_METERS = 2000;

/** Visit purposes never listed as revisits (an interview attendance has no come-back). */
export const FIELD_REVISIT_EXCLUDE: ReadonlySet<string> = new Set(['interview_attendance']);

/** Kind labels for follow-up tasks ("Repeat business — day 30"). */
export const FOLLOW_UP_KIND_LABELS: Record<string, string> = {
  not_selected_day_7: 'Not selected — day 7',
  not_selected_day_30: 'Not selected — day 30',
  not_selected_day_90: 'Not selected — day 90',
  placement_check_in_day_7: 'Placement check-in — day 7',
  placement_check_in_day_30: 'Placement check-in — day 30',
  refund_check: 'Refund check',
  exit_call: 'Exit call',
  repeat_business_day_30: 'Repeat business — day 30',
  repeat_business_day_61: 'Repeat business — day 61',
  refund_priority_call: 'Priority call (close to a refund)',
};

/** One open verification visit as a job card (21 Nov): where, who, and how to reach the owner. */
export interface VerificationJobCard {
  assignmentId: string;
  purpose: string;
  requestedFor: string | null;
  business: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    locality: string | null;
    ownerName: string | null;
    contactName: string | null;
    phoneLast4: string;
    latitude: number | null;
    longitude: number | null;
  };
  /** The last try at this visit (owner not there → come back on a date and time). */
  lastAttempt: { visitId: string; outcome: string | null; at: string; revisitOn: string | null; revisitTime: string | null } | null;
  /** A started visit (shop photo taken) still waiting for the owner's code: Verify resumes it. */
  unfinishedVisitId: string | null;
}

/**
 * Laboura Field extras (21 Nov fixes): verification job cards, the calling
 * phone, follow-up tasks, "Update the pin", the similar-shop warning and the
 * notifications list. Field agents only, their own work only; phone numbers
 * leave as their last 4 digits.
 */
@Injectable()
export class FieldWorkExtrasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: FieldVisitClock,
    private readonly notifications: NotificationService,
    private readonly pricing: PricingService,
    private readonly flags: ReviewFlagService,
  ) {}

  // --------------------------------------------------- verification job cards

  /** The agent's open verification visits (customer-app sign-ups and call-agent leads) as job cards. */
  async verificationJobCards(staffId: string): Promise<VerificationJobCard[]> {
    const assignments = await this.prisma.visitAssignment.findMany({
      where: { assignedStaffId: staffId, status: 'assigned', purpose: { in: [...VERIFICATION_VISIT_PURPOSES] } },
      orderBy: { createdAt: 'asc' },
      include: {
        business: {
          select: {
            id: true, code: true, name: true, address: true, locality: true, ownerName: true, additionalContactName: true,
            phone: true, latitude: true, longitude: true,
          },
        },
        businessVisits: {
          orderBy: { visitedAt: 'desc' },
          take: 5,
          select: { id: true, staffId: true, outcome: true, visitedAt: true, revisitOn: true, revisitTime: true, ownerOtpRequestId: true },
        },
      },
    });
    return assignments.map((a) => {
      const mine = a.businessVisits.filter((v) => v.staffId === staffId);
      const last = mine.find((v) => v.outcome) ?? null;
      const unfinished = mine.find((v) => !v.outcome && !v.ownerOtpRequestId) ?? null;
      return {
        assignmentId: a.id,
        purpose: a.purpose,
        requestedFor: a.requestedFor?.toISOString() ?? null,
        business: {
          id: a.business.id,
          code: a.business.code,
          name: a.business.name,
          address: a.business.address,
          locality: a.business.locality,
          ownerName: a.business.ownerName,
          contactName: a.business.additionalContactName,
          phoneLast4: phoneLast4(a.business.phone),
          latitude: a.business.latitude,
          longitude: a.business.longitude,
        },
        lastAttempt: last
          ? { visitId: last.id, outcome: last.outcome, at: last.visitedAt.toISOString(), revisitOn: keyFromDate(last.revisitOn), revisitTime: last.revisitTime }
          : null,
        unfinishedVisitId: unfinished && (!last || unfinished.visitedAt > last.visitedAt) ? unfinished.id : null,
      };
    });
  }

  /** Visit ids that belong to a verification visit still open (assigned or waiting): they are not ordinary revisits. */
  async openVerificationVisitIds(visitIds: Array<{ id: string; assignmentId: string | null; purpose: string | null }>): Promise<Set<string>> {
    const withAssignment = visitIds.filter((v) => v.assignmentId && isVerificationVisitPurpose(v.purpose));
    if (!withAssignment.length) return new Set();
    const open = await this.prisma.visitAssignment.findMany({
      where: { id: { in: withAssignment.map((v) => v.assignmentId!) }, status: { in: ['pending', 'assigned'] } },
      select: { id: true },
    });
    const openIds = new Set(open.map((o) => o.id));
    return new Set(withAssignment.filter((v) => openIds.has(v.assignmentId!)).map((v) => v.id));
  }

  /**
   * "Update the pin" (21 Nov): at a verification visit the GPS is far from the
   * business's map pin because the pin is wrong. The assigned agent moves the
   * pin to where he stands, with a reason; the old and new pin are audited.
   * Never more than PIN_MOVE_MAX_METERS (further needs the Team Lead).
   */
  async updatePin(actor: Actor, assignmentId: string, body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown; reason?: unknown }) {
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < PIN_REASON_MIN_LENGTH) throw new BadRequestException('Say why the pin is wrong');
    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);
    // 21 Nov review: the GPS accuracy is required (a reading without it could be anything).
    const accuracy = body?.accuracy === undefined || body?.accuracy === null || body?.accuracy === '' ? NaN : Number(body.accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new BadRequestException('Your GPS location is needed to move the pin');
    }
    if (!Number.isFinite(accuracy) || accuracy < 0) throw new BadRequestException('The GPS accuracy is needed to move the pin');
    const policy = await this.pricing.current();
    if (accuracy > Math.max(50, policy.visitSameSpotMeters)) {
      throw new BadRequestException('The GPS reading is not precise enough. Step outside and try again.');
    }
    const assignment = await this.prisma.visitAssignment.findUnique({
      where: { id: assignmentId },
      include: { business: { select: { id: true, code: true, city: true, latitude: true, longitude: true } } },
    });
    if (!assignment || assignment.assignedStaffId !== actor.sub) throw new NotFoundException('Visit not found');
    if (assignment.status !== 'assigned' || !isVerificationVisitPurpose(assignment.purpose)) {
      throw new BadRequestException('The pin can be moved only during an open verification visit');
    }
    // One agent move per business until a Team Lead has checked it (the pin-move flag is resolved):
    // a second move would let the pin walk away from where it was, visit after visit.
    const unchecked = await this.prisma.reviewFlag.findFirst({
      where: { kind: 'gps_mismatch', subjectType: 'business', subjectId: assignment.business.id, status: 'open' },
      select: { id: true },
    });
    if (unchecked) throw new BadRequestException('The pin was already moved and waits for your Team Lead to check it. Ask your Team Lead.');
    const before = { latitude: assignment.business.latitude, longitude: assignment.business.longitude };
    const moved = before.latitude !== null && before.longitude !== null
      ? Math.round(calculateHaversineDistanceMeters(before.latitude, before.longitude, latitude, longitude))
      : null;
    if (moved !== null && moved > PIN_MOVE_MAX_METERS) {
      throw new BadRequestException(`The pin would move ${moved} m. Ask your Team Lead to check the address.`);
    }
    await this.prisma.business.update({ where: { id: assignment.business.id }, data: { latitude, longitude } });
    await this.audit.log({
      actorId: actor.sub,
      action: 'business.pin_updated_at_visit',
      entityType: 'business',
      entityCode: assignment.business.code,
      before,
      after: { latitude, longitude, movedMeters: moved, assignmentId },
      changedFields: ['latitude', 'longitude'],
      reason,
      city: assignment.business.city,
    });
    // Every pin move rings the agent's Team Lead (a flag to check, with the reason and the distance).
    await this.flags.raise({
      kind: 'gps_mismatch',
      subjectType: 'business',
      subjectId: assignment.business.id,
      raisedForStaffId: actor.sub,
      details: { reason: 'pin_moved_at_visit', businessCode: assignment.business.code, movedMeters: moved, agentReason: reason, assignmentId, before, after: { latitude, longitude } },
    });
    return { businessId: assignment.business.id, latitude, longitude, movedMeters: moved };
  }

  // ------------------------------------------------------------ calling phone

  /** Field → Me → "Your calling phone": set or not, and its last 4 digits. */
  async callingPhone(actor: Actor) {
    const me = await this.prisma.staff.findUnique({ where: { id: actor.sub }, select: { callRoutingPhone: true } });
    if (!me?.callRoutingPhone) return { set: false, last4: null };
    let last4: string | null = null;
    try {
      last4 = phoneLast4(decryptCallRoutingPhone(me.callRoutingPhone));
    } catch {
      last4 = null;
    }
    return { set: true, last4 };
  }

  // ------------------------------------------------------------ follow-ups

  /** One follow-up task of the agent's (repeat business day 30/61 and the rest), for the Field screen. */
  async followUp(actor: Actor, taskId: string) {
    const task = await this.prisma.followUpTask.findUnique({ where: { id: taskId } });
    if (!task || task.assignedStaffId !== actor.sub) throw new NotFoundException('Follow-up not found');
    const business = task.subjectType === 'business'
      ? await this.prisma.business.findUnique({
          where: { id: task.subjectId },
          select: { id: true, code: true, name: true, locality: true, ownerName: true, additionalContactName: true, phone: true, accountAgentId: true },
        })
      : null;
    const seeker = task.subjectType === 'job_seeker'
      ? await this.prisma.jobSeeker.findUnique({ where: { id: task.subjectId }, select: { id: true, code: true, name: true, phone: true } })
      : null;
    const repeat = isRepeatBusinessKind(task.kind);
    return {
      id: task.id,
      code: task.code,
      kind: task.kind,
      kindLabel: FOLLOW_UP_KIND_LABELS[task.kind] ?? task.kind.replace(/_/g, ' '),
      status: task.status,
      dueAt: task.dueAt.toISOString(),
      subjectType: task.subjectType,
      subjectId: task.subjectId,
      relatedType: task.relatedType,
      relatedId: task.relatedId,
      answer: task.answer,
      completedAt: task.completedAt?.toISOString() ?? null,
      /** Answers the server accepts for this task (POST /follow-up-tasks/:id/complete). */
      answers: repeat ? [...REPEAT_BUSINESS_ANSWERS].filter((a) => a !== 'no_answer') : [...FOLLOW_UP_ANSWERS].filter((a) => a !== 'no_answer'),
      callPurpose: 'follow_up',
      business: business
        ? {
            id: business.id, code: business.code, name: business.name, locality: business.locality,
            contactName: business.additionalContactName ?? business.ownerName, phoneLast4: phoneLast4(business.phone),
            mine: business.accountAgentId === actor.sub,
          }
        : null,
      jobSeeker: seeker ? { id: seeker.id, code: seeker.code, firstName: seeker.name.trim().split(/\s+/)[0] ?? '', phoneLast4: phoneLast4(seeker.phone) } : null,
    };
  }

  // ------------------------------------------------------- similar shop nearby

  /**
   * 21 Nov: before registering a shop, businesses nearby with a similar name
   * ("Is this the same shop? Record as a revisit"). Same rule as the duplicate
   * flag the Team Lead gets (name contains the other, within the duplicate radius).
   */
  async similarShops(actor: Actor, query: { name?: string; lat?: string; lng?: string }) {
    const name = (query.name ?? '').trim();
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    // 21 Nov review: at least 4 letters, and only around where the agent himself is today (his
    // latest visit photo or check-in): never a way to search the map from anywhere.
    if (normaliseName(name).length < 4 || !Number.isFinite(lat) || !Number.isFinite(lng)) return { matches: [] };
    const here = await this.latestPositionToday(actor.sub);
    if (!here || calculateHaversineDistanceMeters(here.latitude, here.longitude, lat, lng) > SIMILAR_SHOP_NEAR_ME_METERS) return { matches: [] };
    const policy = await this.pricing.current();
    const radius = Math.max(50, policy.duplicateBusinessRadiusMeters);
    const box = radius / 111_000;
    const boxLng = box / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const candidates = await this.prisma.business.findMany({
      where: { anonymisedAt: null, latitude: { gte: lat - box, lte: lat + box }, longitude: { gte: lng - boxLng, lte: lng + boxLng } },
      select: { id: true, code: true, name: true, locality: true, latitude: true, longitude: true, accountAgentId: true },
      take: 200,
    });
    const incoming = normaliseName(name);
    const matches = candidates
      .filter((c) => {
        const existing = normaliseName(c.name);
        return existing && (existing.includes(incoming) || incoming.includes(existing));
      })
      .map((c) => ({
        id: c.id, code: c.code, name: c.name, locality: c.locality,
        distanceMeters: Math.round(calculateHaversineDistanceMeters(lat, lng, c.latitude!, c.longitude!)),
        mine: c.accountAgentId === actor.sub,
      }))
      .filter((c) => c.distanceMeters <= radius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 5);
    return { matches };
  }

  /** Where the agent was last seen today: his latest visit photo or field check-in (IST day). */
  private async latestPositionToday(staffId: string): Promise<{ latitude: number; longitude: number } | null> {
    const since = istDayStart(this.clock.now());
    const [visit, checkIn] = await Promise.all([
      this.prisma.businessVisit.findFirst({ where: { staffId, visitedAt: { gte: since } }, orderBy: { visitedAt: 'desc' }, select: { latitude: true, longitude: true, visitedAt: true } }),
      this.prisma.fieldCheckIn.findFirst({ where: { staffId, checkedInAt: { gte: since } }, orderBy: { checkedInAt: 'desc' }, select: { latitude: true, longitude: true, checkedInAt: true } }),
    ]);
    if (visit && (!checkIn || visit.visitedAt >= checkIn.checkedInAt)) return visit;
    return checkIn;
  }

  // ------------------------------------------------------------ notifications

  /**
   * The Field bell (owner approved 17 Nov): the agent's notifications, newest
   * first, each with where it opens in Laboura Field. Before reading, it
   * catches up on field events that have no bell of their own yet: a visit
   * assigned to him, an agreement signed on his business, work handed over to
   * him. Each is sent once (reading it clears it).
   */
  async notificationsList(actor: Actor, query: { limit?: string } = {}) {
    await this.catchUp(actor.sub);
    const list = await this.notifications.list(actor.sub, { status: 'all', limit: query.limit ?? '50' });
    const items = list.items.map((item) => ({ ...item, target: fieldTarget(item as unknown as NotificationRow) }));
    // A visit assigned opens that very visit (its purpose says which screen); a signed agreement its business.
    const assignmentIds = items.filter((i) => i.target?.type === 'visit_assignment').map((i) => i.target!.id);
    if (assignmentIds.length) {
      const rows = new Map((await this.prisma.visitAssignment.findMany({
        where: { id: { in: assignmentIds } }, select: { id: true, purpose: true, businessId: true, relatedType: true, relatedId: true, status: true, assignedStaffId: true },
      })).map((r) => [r.id, r]));
      for (const item of items) {
        const row = item.target?.type === 'visit_assignment' ? rows.get(item.target.id) : undefined;
        if (!row || !item.target) continue;
        item.target.businessId = row.businessId;
        item.target.purpose = row.purpose;
        item.target.open = row.status === 'assigned' && row.assignedStaffId === actor.sub;
        if (row.relatedType === 'interview' && row.relatedId) item.target.interviewId = row.relatedId;
      }
    }
    const agreementIds = items.filter((i) => i.target?.type === 'agreement').map((i) => i.target!.id);
    if (agreementIds.length) {
      const rows = new Map((await this.prisma.businessAgreement.findMany({ where: { id: { in: agreementIds } }, select: { id: true, businessId: true } })).map((r) => [r.id, r.businessId]));
      for (const item of items) {
        if (item.target?.type !== 'agreement') continue;
        const businessId = rows.get(item.target.id);
        item.target = businessId ? { type: 'business', id: businessId } : null;
      }
    }
    // A new match opens the candidates of its vacancy's business.
    const vacancyIds = [...new Set(items.map((i) => i.target?.vacancyId).filter((id): id is string => Boolean(id)))];
    if (vacancyIds.length) {
      const owners = new Map((await this.prisma.vacancy.findMany({ where: { id: { in: vacancyIds } }, select: { id: true, businessId: true } })).map((v) => [v.id, v.businessId]));
      for (const item of items) if (item.target?.vacancyId) item.target.businessId = owners.get(item.target.vacancyId);
    }
    return { unseenCount: list.unseenCount, openCount: list.openCount, items, asOf: list.asOf };
  }

  private async catchUp(staffId: string): Promise<void> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - NOTIFY_LOOKBACK_MS);
    const [assignments, agreements, handovers] = await Promise.all([
      this.prisma.visitAssignment.findMany({
        where: { assignedStaffId: staffId, status: 'assigned', updatedAt: { gte: since } },
        include: { business: { select: { name: true, locality: true } } },
        take: 50,
      }),
      this.prisma.businessAgreement.findMany({
        where: { signedAt: { gte: since }, business: { accountAgentId: staffId } },
        include: { business: { select: { id: true, name: true } } },
        take: 50,
      }),
      handedTo(this.prisma, staffId, 'revisit', now).then(async (revisits) => [
        ...revisits.map((r) => ({ ...r, kind: 'revisit' as const })),
        ...(await handedTo(this.prisma, staffId, 'joining', now)).map((r) => ({ ...r, kind: 'joining' as const })),
      ]),
    ]);
    for (const a of assignments) {
      const verify = isVerificationVisitPurpose(a.purpose);
      await this.notifications.open({
        recipientStaffId: staffId,
        kind: 'field_visit_assigned',
        title: verify ? `Verification visit: ${a.business.name}` : a.purpose === 'interview_attendance' ? `Attend an interview at ${a.business.name}` : `Visit ${a.business.name}`,
        body: [a.business.locality, a.requestedFor ? `owner picked ${istDateKey(a.requestedFor)}` : null].filter(Boolean).join(' · ') || null,
        link: null,
        subjectType: 'visit_assignment',
        subjectId: a.id,
        once: true,
      }, now);
    }
    for (const g of agreements) {
      await this.notifications.open({
        recipientStaffId: staffId,
        kind: 'field_agreement_signed',
        title: `${g.business.name} signed the agreement`,
        body: null,
        link: null,
        subjectType: 'business_agreement',
        subjectId: g.id,
        once: true,
      }, now);
    }
    for (const h of handovers) {
      await this.notifications.open({
        recipientStaffId: staffId,
        kind: 'field_work_handed_over',
        title: h.kind === 'revisit' ? 'A revisit was handed over to you' : 'A joining to confirm was handed over to you',
        body: null,
        link: null,
        subjectType: h.kind === 'revisit' ? 'business_visit' : 'placement',
        subjectId: h.recordId,
        once: true,
      }, now);
    }
  }
}

type NotificationRow = { kind: string; subjectType: string; subjectId: string };

/** Where a notification opens in Laboura Field (the app maps it to its own screens). */
export interface FieldTarget {
  type: string;
  id: string;
  vacancyId?: string;
  businessId?: string;
  purpose?: string;
  interviewId?: string;
  open?: boolean;
}

export function fieldTarget(n: NotificationRow): FieldTarget | null {
  switch (n.kind) {
    case 'field_visit_assigned':
      return { type: 'visit_assignment', id: n.subjectId };
    case 'field_agreement_signed':
      return { type: 'agreement', id: n.subjectId };
    case 'business_assigned':
      return { type: 'business', id: n.subjectId };
    case 'field_work_handed_over':
      return n.subjectType === 'placement' ? { type: 'placement', id: n.subjectId } : { type: 'revisit', id: n.subjectId };
    case 'new_match_registered': {
      const [vacancyId] = n.subjectId.split(':');
      return vacancyId ? { type: 'vacancy_matches', id: vacancyId, vacancyId } : null;
    }
    case 'job_seeker_assigned':
      return { type: 'job_seeker', id: n.subjectId };
    case 'referral_assigned':
      return { type: 'referral', id: n.subjectId };
    case 'request_decided':
      return { type: n.subjectType === 'attendance_correction' ? 'correction' : 'leave', id: n.subjectId };
    case 'payslip_ready':
      return { type: 'payslip', id: n.subjectId };
    default:
      return null;
  }
}

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

