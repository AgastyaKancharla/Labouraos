import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { BUSINESS_PHOTO_LINK_TTL_SECONDS, BUSINESS_PHOTO_STORAGE, BusinessPhotoStorage } from '../business/storefront-photo.storage';
import { istDayKey, istStartOfDay } from '../ceo-portal/ceo-common';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS, CANDIDATE_PHOTO_STORAGE, CandidatePhotoStorage } from '../job-seeker/photo-storage';
import { notificationLink } from '../notification/notification.constants';
import { NotificationService } from '../notification/notification.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';
import { Actor, TeamLeadScreensService } from './team-lead-screens.service';
import { QUALITY_CHECKLIST, scoreOf } from './quality';

const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const VISIT_FLAG_KINDS = ['visit_short', 'visits_too_far_apart', 'visit_photo_reused', 'visit_gps_suspect', 'visits_no_onboarding', 'visit_flagged'];
/** The system picks this many calls a day for the Team Lead to score (guide, 9 Nov). */
const CALLS_PICKED_PER_DAY = 3;
const STUCK_STATUSES: Record<string, string> = {
  lead: "Didn't finish the consent step",
  consented: 'Stopped before the ID check or payment',
  pending_activation: 'Stopped at payment',
};

/**
 * Actions and checks on the Team Lead portal: the work list, reminders,
 * moving a business inside the team, registration checks (T-Verify), visit
 * proof (T-Visits, photos through short-lived links only), call scoring
 * (T-Quality) and coaching notes (T-Agent). Every write is audited.
 */
@Injectable()
export class TeamLeadChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: AttendanceClock,
    private readonly screens: TeamLeadScreensService,
    private readonly scope: ReportingScopeService,
    private readonly flags: ReviewFlagService,
    private readonly notifications: NotificationService,
    @Inject(BUSINESS_PHOTO_STORAGE) private readonly photoStore: BusinessPhotoStorage,
    @Optional() @Inject(CANDIDATE_PHOTO_STORAGE) private readonly candidatePhotos?: CandidatePhotoStorage,
  ) {}

  // ---------------------------------------------------------------- work

  /** T-Work: registrations stuck, follow-ups overdue, interviews today and results overdue, the team's businesses. */
  async work(actor: Actor) {
    const team = await this.screens.members(actor);
    const ids = team.map((row) => row.id);
    const people = [...ids, actor.id];
    const now = this.clock.now();
    const dayStart = istStartOfDay(istDayKey(now));
    const [stuck, followUpsOverdue, interviewsToday, overdue, businesses] = await Promise.all([
      this.prisma.jobSeeker.findMany({
        where: { registeredByStaffId: { in: people }, status: { in: Object.keys(STUCK_STATUSES) }, createdAt: { lte: new Date(now.getTime() - DAY_MS), gte: new Date(now.getTime() - 30 * DAY_MS) }, anonymisedAt: null },
        select: { id: true, code: true, name: true, status: true, createdAt: true, registeredByStaffId: true },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      this.prisma.followUpTask.count({ where: { assignedStaffId: { in: people }, status: 'pending', dueAt: { lt: now } } }),
      this.prisma.interview.findMany({
        where: { slotStartsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) }, status: { notIn: ['cancelled', 'declined'] }, OR: [{ proposedByStaffId: { in: people } }, { business: { accountAgentId: { in: people } } }] },
        select: { id: true, code: true, slotStartsAt: true, status: true, candidateArrivedAt: true, result: true, jobSeeker: { select: { code: true, name: true } }, business: { select: { name: true, accountAgentId: true } }, vacancy: { select: { tradeSkill: true, roleTitle: true } } },
        orderBy: { slotStartsAt: 'asc' },
      }),
      this.prisma.interview.findMany({
        where: { resultDueAt: { lt: now }, result: null, slotStartsAt: { lt: dayStart }, status: { in: ['confirmed', 'offered', 'no_result'] }, OR: [{ proposedByStaffId: { in: people } }, { business: { accountAgentId: { in: people } } }] },
        select: { id: true, code: true, slotStartsAt: true, status: true, jobSeeker: { select: { code: true, name: true } }, business: { select: { name: true, accountAgentId: true } }, vacancy: { select: { tradeSkill: true, roleTitle: true } } },
        orderBy: { slotStartsAt: 'desc' },
        take: 30,
      }),
      this.prisma.business.findMany({ where: { accountAgentId: { in: ids }, anonymisedAt: null }, select: { id: true, code: true, name: true, locality: true, accountAgentId: true }, orderBy: { name: 'asc' }, take: 300 }),
    ]);
    const nameOf = (id: string | null | undefined) => team.find((row) => row.id === id) ?? null;
    const interviewRow = (row: (typeof interviewsToday)[number] | (typeof overdue)[number], late: boolean) => ({
      id: row.id,
      code: row.code,
      at: row.slotStartsAt.toISOString(),
      jobSeeker: { code: row.jobSeeker.code, firstName: row.jobSeeker.name.split(' ')[0] },
      trade: row.vacancy?.roleTitle ?? row.vacancy?.tradeSkill ?? null,
      business: row.business.name,
      fieldAgent: nameOf(row.business.accountAgentId),
      status: late ? 'Owner result overdue' : 'candidateArrivedAt' in row && row.candidateArrivedAt ? 'Arrived' : 'result' in row && row.result ? 'Result in' : 'Booked',
    });
    return {
      summary: { stuck: stuck.length, followUpsOverdue, interviewsToday: interviewsToday.length, resultsOverdue: overdue.length },
      stuck: stuck.map((row) => ({
        jobSeeker: { id: row.id, code: row.code, firstName: row.name.split(' ')[0] },
        agent: nameOf(row.registeredByStaffId),
        where: STUCK_STATUSES[row.status] ?? row.status,
        hours: Math.floor((now.getTime() - row.createdAt.getTime()) / HOUR_MS),
      })),
      interviews: [...interviewsToday.map((row) => interviewRow(row, false)), ...overdue.map((row) => interviewRow(row, true))],
      businesses: businesses.map((row) => ({ id: row.id, code: row.code, name: row.name, locality: row.locality, accountAgent: nameOf(row.accountAgentId) })),
      fieldAgents: team.filter((row) => row.role === 'field_agent'),
    };
  }

  /** "Remind the agent": a bell for the agent about one job seeker (or anything), audited. */
  async remind(actor: Actor, body: { staffId?: string; jobSeekerId?: string; text?: string }) {
    const member = await this.screens.requireMember(actor, String(body?.staffId ?? ''));
    const text = String(body?.text ?? '').trim().slice(0, 200);
    let seeker: { id: string; code: string; name: string } | null = null;
    if (body?.jobSeekerId) {
      seeker = await this.prisma.jobSeeker.findUnique({ where: { id: body.jobSeekerId }, select: { id: true, code: true, name: true } });
      if (!seeker) throw new NotFoundException('Job seeker not found');
    }
    if (!seeker && !text) throw new BadRequestException('Say what the reminder is about');
    const now = this.clock.now();
    const lead = await this.prisma.staff.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } });
    await this.notifications.open(
      {
        recipientStaffId: member.id,
        kind: 'agent_reminder',
        title: seeker ? `${lead.name} reminds you: call ${seeker.code} · ${seeker.name.split(' ')[0]} first` : `${lead.name} reminds you`,
        body: text || 'Close to a refund — call first today',
        link: notificationLink(member.role, 'agent_reminder', { id: seeker?.id ?? null }),
        subjectType: 'team_lead_reminder',
        subjectId: `${seeker?.id ?? 'note'}:${istDayKey(now)}:${now.getTime()}`,
        once: true,
      },
      now,
    );
    await this.audit.log({
      actorId: actor.id,
      action: 'team_lead.agent_reminded',
      entityType: 'staff',
      entityCode: member.code,
      after: { jobSeekerCode: seeker?.code ?? null },
    });
    return { ok: true, staff: member };
  }

  /** Move a business to another field agent in the team; its open visits and follow-ups move with it. */
  async moveBusiness(actor: Actor, businessId: string, body: { toStaffId?: string }) {
    const team = await this.screens.members(actor);
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: { id: true, code: true, accountAgentId: true } });
    if (!business) throw new NotFoundException('Business not found');
    const from = team.find((row) => row.id === business.accountAgentId);
    if (!from) throw new ForbiddenException("Only your team's businesses move here; moving to another team is done by the Manager");
    const to = team.find((row) => row.id === body?.toStaffId && row.role === 'field_agent');
    if (!to) throw new BadRequestException('Pick a field agent in your team');
    if (to.id === from.id) throw new BadRequestException('It is already with this agent');
    const now = this.clock.now();
    const moved = await this.prisma.$transaction(async (tx) => {
      await tx.business.update({ where: { id: business.id }, data: { accountAgentId: to.id, accountAgentAssignedAt: now } });
      const followUps = await tx.followUpTask.updateMany({ where: { subjectType: 'business', subjectId: business.id, status: 'pending', assignedStaffId: from.id }, data: { assignedStaffId: to.id } });
      const visits = await tx.visitAssignment.updateMany({ where: { businessId: business.id, status: { in: ['pending', 'assigned'] }, assignedStaffId: from.id }, data: { assignedStaffId: to.id } });
      return { followUps: followUps.count, visits: visits.count };
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'business.account_agent_moved',
      entityType: 'business',
      entityCode: business.code,
      before: { accountAgentId: from.id },
      after: { accountAgentId: to.id, followUpsMoved: moved.followUps, visitsMoved: moved.visits },
    });
    return { ok: true, business: business.code, from, to, ...moved };
  }

  // ------------------------------------------------------- registrations

  /** T-Verify: paid registrations from the team in the last 7 days not yet checked, the ones with signals first. */
  async registrations(actor: Actor) {
    const team = await this.screens.members(actor);
    const people = [...team.map((row) => row.id), actor.id];
    const now = this.clock.now();
    const monthStart = istStartOfDay(`${istDayKey(now).slice(0, 8)}01`);
    const seekers = await this.prisma.jobSeeker.findMany({
      where: { registeredByStaffId: { in: people }, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) }, anonymisedAt: null, status: { notIn: ['lead'] } },
      select: {
        id: true, code: true, name: true, whatsappPhone: true, dateOfBirth: true, photoStoragePath: true, registeredByStaffId: true, paymentReceivedAt: true, createdAt: true,
        trades: { select: { trade: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
        identityVerifications: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true, status: true, nameMatches: true, isAdult: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const checked = await this.prisma.teamLeadCheck.findMany({ where: { subjectType: 'job_seeker', subjectId: { in: seekers.map((s) => s.id) } }, select: { subjectId: true } });
    const checkedIds = new Set(checked.map((row) => row.subjectId));
    const rows = [];
    for (const seeker of seekers.filter((s) => !checkedIds.has(s.id))) {
      const duplicateWhere: Prisma.JobSeekerWhereInput[] = [];
      if (seeker.whatsappPhone) duplicateWhere.push({ whatsappPhone: seeker.whatsappPhone }, { phone: seeker.whatsappPhone });
      if (seeker.dateOfBirth) duplicateWhere.push({ name: { equals: seeker.name, mode: 'insensitive' }, dateOfBirth: seeker.dateOfBirth });
      const duplicates = duplicateWhere.length
        ? await this.prisma.jobSeeker.findMany({ where: { id: { not: seeker.id }, anonymisedAt: null, OR: duplicateWhere }, select: { code: true }, take: 3 })
        : [];
      const idCheck = seeker.identityVerifications[0] ?? null;
      const signals: string[] = [];
      if (duplicates.length) signals.push('Possible duplicate');
      if (idCheck?.status === 'failed') signals.push('ID check failed');
      if (idCheck && idCheck.nameMatches === false) signals.push('Name does not match the ID');
      if (!idCheck || idCheck.status !== 'verified') signals.push('ID not verified yet');
      rows.push({
        jobSeeker: { id: seeker.id, code: seeker.code, name: seeker.name },
        trade: seeker.trades[0]?.trade ?? null,
        registeredBy: team.find((row) => row.id === seeker.registeredByStaffId) ?? null,
        registeredAt: seeker.createdAt.toISOString(),
        paid: Boolean(seeker.paymentReceivedAt),
        hasSelfie: Boolean(seeker.photoStoragePath),
        idCheck: idCheck ? { method: idCheck.method, status: idCheck.status, nameMatches: idCheck.nameMatches, isAdult: idCheck.isAdult } : null,
        duplicates: duplicates.map((row) => row.code),
        signals,
        verdict: duplicates.length ? 'Possible duplicate' : signals.filter((s) => s !== 'ID not verified yet').length ? signals[0] : 'Looks normal',
      });
    }
    rows.sort((a, b) => Number(b.verdict !== 'Looks normal') - Number(a.verdict !== 'Looks normal'));
    const [checkedThisMonth, fakesThisMonth] = await Promise.all([
      this.prisma.teamLeadCheck.count({ where: { subjectType: 'job_seeker', checkedByStaffId: actor.id, createdAt: { gte: monthStart } } }),
      this.prisma.teamLeadCheck.count({ where: { subjectType: 'job_seeker', checkedByStaffId: actor.id, verdict: 'fake', createdAt: { gte: monthStart } } }),
    ]);
    return {
      summary: { toCheck: rows.length, possibleDuplicates: rows.filter((row) => row.duplicates.length).length, checkedThisMonth, fakesThisMonth },
      rows: rows.slice(0, 20),
    };
  }

  /** The selfie of a registration from the team, through a short-lived private link. */
  async selfie(actor: Actor, jobSeekerId: string) {
    const team = await this.screens.members(actor);
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId }, select: { code: true, photoStoragePath: true, registeredByStaffId: true } });
    if (!seeker || (seeker.registeredByStaffId !== actor.id && !team.some((row) => row.id === seeker.registeredByStaffId))) {
      throw new NotFoundException('Not a registration from your team');
    }
    if (!seeker.photoStoragePath || !this.candidatePhotos) return { url: null, expiresInSeconds: 0 };
    const url = await this.candidatePhotos.signedUrl(seeker.photoStoragePath, CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    await this.audit.log({ actorId: actor.id, action: 'team_lead.selfie_viewed', entityType: 'job_seeker', entityCode: seeker.code, changedFields: [] });
    return { url, expiresInSeconds: CANDIDATE_PHOTO_LINK_TTL_SECONDS };
  }

  /** "Looks right" or "Fake · flag it" (opens a flag the Manager sees). */
  async checkRegistration(actor: Actor, jobSeekerId: string, body: { verdict?: string; note?: string }) {
    const verdict = body?.verdict === 'fake' ? 'fake' : body?.verdict === 'ok' ? 'ok' : null;
    if (!verdict) throw new BadRequestException('verdict is ok or fake');
    const note = String(body?.note ?? '').trim();
    if (verdict === 'fake' && !note) throw new BadRequestException('Say what looks fake');
    const team = await this.screens.members(actor);
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId }, select: { id: true, code: true, registeredByStaffId: true } });
    if (!seeker || (seeker.registeredByStaffId !== actor.id && !team.some((row) => row.id === seeker.registeredByStaffId))) {
      throw new NotFoundException('Not a registration from your team');
    }
    let flagId: string | null = null;
    if (verdict === 'fake') {
      flagId = await this.raiseForManager(actor, 'registration_suspect', 'job_seeker', seeker.id, seeker.registeredByStaffId, { jobSeekerCode: seeker.code, note });
    }
    const check = await this.prisma.teamLeadCheck.create({
      data: { subjectType: 'job_seeker', subjectId: seeker.id, verdict, note: note || null, flagId, checkedByStaffId: actor.id, createdAt: this.clock.now() },
    });
    await this.audit.log({ actorId: actor.id, action: `team_lead.registration_${verdict}`, entityType: 'job_seeker', entityCode: seeker.code, after: { verdict, flagId } });
    return { id: check.id, verdict, flagId };
  }

  // -------------------------------------------------------------- visits

  /** T-Visits: the team's shop visits on a day, with their proof and any visit flags. */
  async visits(actor: Actor, dateText?: string) {
    const team = await this.screens.members(actor);
    const ids = team.map((row) => row.id);
    const now = this.clock.now();
    const day = dateText && /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : istDayKey(now);
    const start = istStartOfDay(day);
    const end = new Date(start.getTime() + DAY_MS);
    const visits = await this.prisma.businessVisit.findMany({
      where: { staffId: { in: ids }, visitedAt: { gte: start, lt: end } },
      select: {
        id: true, staffId: true, shopName: true, visitedAt: true, startedAt: true, durationSeconds: true, outcome: true, boardPhotoPath: true, selfieUrl: true,
        proofDistanceMeters: true, gpsSuspect: true, geofenceFlag: true, purpose: true, business: { select: { id: true, name: true, code: true } },
      },
      orderBy: { visitedAt: 'asc' },
    });
    const openFlags = await this.prisma.reviewFlag.findMany({
      where: { status: 'open', kind: { in: VISIT_FLAG_KINDS }, raisedForStaffId: { in: ids } },
      select: { id: true, code: true, kind: true, subjectType: true, subjectId: true, details: true },
    });
    const checks = await this.prisma.teamLeadCheck.findMany({ where: { subjectType: 'business_visit', subjectId: { in: visits.map((v) => v.id) } }, orderBy: { createdAt: 'desc' } });
    const flagsFor = (visitId: string) =>
      openFlags.filter((flag) => (flag.subjectType === 'business_visit' && flag.subjectId === visitId) || (flag.details as Record<string, unknown> | null)?.visitId === visitId);
    const rows = visits.map((visit) => {
      const flags = flagsFor(visit.id);
      const check = checks.find((row) => row.subjectId === visit.id) ?? null;
      return {
        id: visit.id,
        agent: team.find((row) => row.id === visit.staffId) ?? null,
        shop: visit.business?.name ?? visit.shopName ?? 'Shop',
        businessCode: visit.business?.code ?? null,
        at: (visit.startedAt ?? visit.visitedAt).toISOString(),
        durationSeconds: visit.durationSeconds,
        proof: {
          boardPhoto: Boolean(visit.boardPhotoPath),
          selfie: Boolean(visit.selfieUrl),
          gpsOk: !visit.gpsSuspect && !visit.geofenceFlag && (visit.proofDistanceMeters === null || visit.proofDistanceMeters <= 150),
          distanceMeters: visit.proofDistanceMeters === null ? null : Math.round(visit.proofDistanceMeters),
        },
        outcome: visit.outcome,
        flags: flags.map((flag) => ({ id: flag.id, code: flag.code, kind: flag.kind })),
        check: check ? { verdict: check.verdict, at: check.createdAt.toISOString() } : null,
      };
    });
    const agreements = await this.prisma.businessAgreement.findMany({ where: { signedAt: { gte: start, lt: end }, business: { accountAgentId: { in: ids } } }, select: { businessId: true } });
    return {
      date: day,
      summary: {
        visits: rows.length,
        toCheck: rows.filter((row) => row.flags.length && !row.check).length,
        signedUp: new Set(agreements.map((row) => row.businessId)).size,
      },
      rows,
    };
  }

  /** The visit's name-board photo and selfie, through short-lived private links only. */
  async visitPhotos(actor: Actor, visitId: string) {
    const visit = await this.requireTeamVisit(actor, visitId);
    const sign = async (path: string | null) => {
      if (!path || !this.photoStore.signedUrl) return null;
      return this.photoStore.signedUrl(path, BUSINESS_PHOTO_LINK_TTL_SECONDS);
    };
    const result = { boardPhoto: await sign(visit.boardPhotoPath), selfie: await sign(visit.selfieUrl), expiresInSeconds: BUSINESS_PHOTO_LINK_TTL_SECONDS };
    await this.audit.log({ actorId: actor.id, action: 'team_lead.visit_photos_viewed', entityType: 'business_visit', entityCode: visit.id, changedFields: [] });
    return result;
  }

  /** "Looks right" closes the visit's open flags; "Flag" opens one the Manager sees. */
  async checkVisit(actor: Actor, visitId: string, body: { verdict?: string; note?: string }) {
    const verdict = body?.verdict === 'flag' ? 'flagged' : body?.verdict === 'ok' ? 'ok' : null;
    if (!verdict) throw new BadRequestException('verdict is ok or flag');
    const note = String(body?.note ?? '').trim();
    if (verdict === 'flagged' && !note) throw new BadRequestException('Say what is wrong with the visit');
    const visit = await this.requireTeamVisit(actor, visitId);
    let flagId: string | null = null;
    if (verdict === 'ok') {
      const open = await this.prisma.reviewFlag.findMany({
        where: { status: 'open', kind: { in: VISIT_FLAG_KINDS }, raisedForStaffId: visit.staffId, OR: [{ subjectType: 'business_visit', subjectId: visit.id }, { details: { path: ['visitId'], equals: visit.id } }] },
        select: { id: true },
      });
      for (const flag of open) {
        await this.flags.resolve(flag.id, actor, { status: 'dismissed', resolution: note || 'Checked the proof: the visit looks right' });
      }
    } else {
      flagId = await this.raiseForManager(actor, 'visit_flagged', 'business_visit', visit.id, visit.staffId, { visitId: visit.id, note });
    }
    await this.prisma.teamLeadCheck.create({
      data: { subjectType: 'business_visit', subjectId: visit.id, verdict, note: note || null, flagId, checkedByStaffId: actor.id, createdAt: this.clock.now() },
    });
    await this.audit.log({ actorId: actor.id, action: `team_lead.visit_${verdict}`, entityType: 'business_visit', entityCode: visit.id, after: { verdict, flagId } });
    return { verdict, flagId };
  }

  private async requireTeamVisit(actor: Actor, visitId: string) {
    const team = await this.screens.members(actor);
    const visit = await this.prisma.businessVisit.findUnique({ where: { id: visitId }, select: { id: true, staffId: true, boardPhotoPath: true, selfieUrl: true } });
    if (!visit || !team.some((row) => row.id === visit.staffId)) throw new NotFoundException('Not a visit by your team');
    return visit;
  }

  // ------------------------------------------------------------- quality

  /**
   * T-Quality: recorded calls by the team in the last 7 days. The system picks
   * up to 3 a day not yet scored (spread across agents, newest first); the
   * Team Lead can score any of them. Minimal on purpose: a six-item checklist.
   */
  async quality(actor: Actor) {
    const team = await this.screens.members(actor);
    const ids = team.map((row) => row.id);
    const now = this.clock.now();
    const monthStart = istStartOfDay(`${istDayKey(now).slice(0, 8)}01`);
    const calls = await this.prisma.callRecord.findMany({
      where: { staffId: { in: ids }, recordingStoragePath: { not: null }, recordingDeletedAt: null, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } },
      select: { id: true, code: true, staffId: true, subjectType: true, subjectId: true, startedAt: true, createdAt: true, durationSec: true, agentOutcome: true, purpose: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const scores = await this.prisma.callQualityScore.findMany({ where: { callRecordId: { in: calls.map((c) => c.id) } } });
    const scored = new Set(scores.map((s) => s.callRecordId));
    const today = istDayKey(now);
    const picked: typeof calls = [];
    const seenAgents = new Set<string>();
    for (const call of calls.filter((c) => !scored.has(c.id) && istDayKey(c.createdAt) === today)) {
      if (picked.length >= CALLS_PICKED_PER_DAY) break;
      if (call.staffId && seenAgents.has(call.staffId) && calls.some((other) => other.staffId && !seenAgents.has(other.staffId) && !scored.has(other.id) && istDayKey(other.createdAt) === today)) continue;
      picked.push(call);
      if (call.staffId) seenAgents.add(call.staffId);
    }
    const subjects = await this.screens.subjectNames(calls);
    const monthScores = await this.prisma.callQualityScore.findMany({ where: { staffId: { in: ids }, createdAt: { gte: monthStart } }, select: { staffId: true, score: true } });
    const byAgent = team
      .map((member) => {
        const mine = monthScores.filter((s) => s.staffId === member.id);
        return { staff: member, listened: mine.length, average: mine.length ? Math.round(mine.reduce((sum, s) => sum + s.score, 0) / mine.length) : null };
      })
      .filter((row) => row.listened > 0);
    const lowest = [...byAgent].sort((a, b) => (a.average ?? 0) - (b.average ?? 0))[0] ?? null;
    const row = (call: (typeof calls)[number]) => {
      const score = scores.find((s) => s.callRecordId === call.id) ?? null;
      return {
        id: call.id,
        code: call.code,
        agent: team.find((m) => m.id === call.staffId) ?? null,
        with: subjects.get(`${call.subjectType}:${call.subjectId}`) ?? null,
        at: (call.startedAt ?? call.createdAt).toISOString(),
        durationSec: call.durationSec,
        result: call.agentOutcome ?? call.purpose ?? null,
        picked: picked.some((p) => p.id === call.id),
        score: score ? { score: score.score, checks: score.checks, note: score.note, flagged: score.flagged } : null,
      };
    };
    return {
      checklist: QUALITY_CHECKLIST,
      summary: {
        toListen: picked.length,
        listenedThisMonth: monthScores.length,
        teamAverage: monthScores.length ? Math.round(monthScores.reduce((sum, s) => sum + s.score, 0) / monthScores.length) : null,
        lowest: lowest ? { staff: lowest.staff, average: lowest.average } : null,
      },
      picked: picked.map(row),
      calls: calls.map(row),
    };
  }

  /** Saves (or replaces) the checklist score for one call by the team; "Flag this call" opens a flag. */
  async scoreCall(actor: Actor, callId: string, body: { checks?: unknown; note?: string; flag?: boolean }) {
    const team = await this.screens.members(actor);
    const call = await this.prisma.callRecord.findUnique({ where: { id: callId }, select: { id: true, code: true, staffId: true, recordingStoragePath: true } });
    if (!call || !team.some((row) => row.id === call.staffId)) throw new NotFoundException("Not a call by your team");
    if (!call.recordingStoragePath) throw new BadRequestException('This call has no recording to score');
    const checks = Array.isArray(body?.checks) ? body.checks.map((value) => value === true) : null;
    if (!checks || checks.length !== QUALITY_CHECKLIST.length) throw new BadRequestException(`checks is a list of ${QUALITY_CHECKLIST.length} yes/no answers`);
    const note = String(body?.note ?? '').trim().slice(0, 1000) || null;
    const score = scoreOf(checks);
    const flagged = body?.flag === true;
    if (flagged && !note) throw new BadRequestException('Say why the call is flagged');
    const now = this.clock.now();
    const saved = await this.prisma.callQualityScore.upsert({
      where: { callRecordId: call.id },
      create: { callRecordId: call.id, staffId: call.staffId as string, scoredByStaffId: actor.id, checks, score, note, flagged, createdAt: now },
      update: { scoredByStaffId: actor.id, checks, score, note, flagged: flagged || undefined },
    });
    let flagId: string | null = null;
    if (flagged) flagId = await this.raiseForManager(actor, 'call_flagged', 'call_record', call.id, call.staffId, { callCode: call.code, score, note });
    await this.audit.log({ actorId: actor.id, action: 'team_lead.call_scored', entityType: 'call_record', entityCode: call.code, after: { score, flagged, flagId } });
    return { id: saved.id, callId: call.id, score, flagged, flagId };
  }

  // -------------------------------------------------------------- notes

  async addNote(actor: Actor, staffId: string, body: { text?: string; kind?: string }) {
    const member = await this.screens.requireMember(actor, staffId);
    const text = String(body?.text ?? '').trim();
    if (!text) throw new BadRequestException('Write the note');
    if (text.length > 2000) throw new BadRequestException('Keep a note under 2,000 characters');
    // A Team Lead cannot give a written warning: they ask the Manager (POST /requests, written_warning).
    const kind = ['note', 'one_to_one', 'verbal_warning'].includes(String(body?.kind)) ? String(body?.kind) : 'note';
    const note = await this.prisma.staffCoachingNote.create({ data: { staffId: member.id, authorStaffId: actor.id, kind, text, createdAt: this.clock.now() } });
    await this.audit.log({ actorId: actor.id, action: 'team_lead.coaching_note_added', entityType: 'staff', entityCode: member.code, after: { kind } });
    return { id: note.id, kind: note.kind, text: note.text, at: note.createdAt.toISOString() };
  }

  // ------------------------------------------------------------ helpers

  /** Opens a flag owned by the Team Lead's Manager (the Team Lead is reporting it up). */
  private async raiseForManager(
    actor: Actor,
    kind: 'registration_suspect' | 'visit_flagged' | 'call_flagged',
    subjectType: string,
    subjectId: string,
    raisedForStaffId: string | null,
    details: Record<string, unknown>,
  ): Promise<string> {
    const chain = await this.scope.chainOf(actor.id);
    const flag = await this.flags.raise({
      kind,
      subjectType,
      subjectId,
      raisedForStaffId,
      details: { ...details, raisedByStaffId: actor.id },
      owner: { role: chain.manager ? 'manager' : 'ceo', staffId: chain.manager?.id ?? null, byStaffId: actor.id, note: String(details.note ?? '') || null },
    });
    return flag.id;
  }
}
