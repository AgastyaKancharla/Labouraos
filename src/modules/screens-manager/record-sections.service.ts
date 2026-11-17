import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { businessOwners, personOwners } from '../../common/rbac/own-team';
import { stripMoney } from '../../common/rbac/money-visibility';
import { AttendanceClock } from '../attendance/attendance-clock';
import { DateRange } from '../ceo-portal/ceo-common';
import { RecordPhotosService } from '../ceo-portal/record-photos.service';
import { RecordWheres, eitherWheres } from '../ceo-portal/record-scope';
import type { AssignKind, RecordSection, SectionScope, Viewer } from './record-section-scope';
import { NotificationKind, notificationLink } from '../notification/notification.constants';
import { NotificationService } from '../notification/notification.service';
import { ManagerListQuery, ManagerRecordsService } from './manager-records.service';

export { parseSection, sectionScope } from './record-section-scope';
export type { AssignKind, RecordSection, SectionScope, Viewer } from './record-section-scope';

/** The receiving agent's bell (rev 196): one kind per record kind, linking to the record. */
const ASSIGNED_KIND: Record<AssignKind, { kind: NotificationKind; title: string }> = {
  job_seeker: { kind: 'job_seeker_assigned', title: 'New job seeker assigned to you' },
  referral: { kind: 'referral_assigned', title: 'New referral partner assigned to you' },
  business: { kind: 'business_assigned', title: 'New business assigned to you' },
};

/**
 * "My team" / "Not assigned" sections, profiles, photos and "Assign" for the
 * Team Lead (rev 194) and the Manager (rev 196). Lists and profiles are the
 * Manager's (ManagerRecordsService: the CEO's services with every payment,
 * refund, payout, fee and GST section dropped); stripMoney then removes any
 * money field left, and each controller's PII interceptor masks phone numbers.
 * A profile opens when the record is in either section; any other is 404.
 */
@Injectable()
export class RecordSectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: AttendanceClock,
    private readonly records: ManagerRecordsService,
    private readonly photos: RecordPhotosService,
    private readonly notifications: NotificationService,
  ) {}

  private pick(s: SectionScope, section: RecordSection): RecordWheres {
    return section === 'unassigned' ? s.unassigned : s.team;
  }

  private viewable(s: SectionScope): RecordWheres {
    return eitherWheres(s.team, s.unassigned);
  }

  // Lists and profiles ------------------------------------------------------

  async jobSeekers(s: SectionScope, section: RecordSection, q: ManagerListQuery) {
    return stripMoney(await this.records.jobSeekersIn(this.pick(s, section).seeker, q));
  }

  async jobSeeker(s: SectionScope, id: string) {
    const detail = stripMoney(await this.records.jobSeekerIn(this.viewable(s).seeker, id));
    return { ...detail, assignment: await this.assignmentOf(s, 'job_seeker', id) };
  }

  async businessList(s: SectionScope, section: RecordSection, q: ManagerListQuery) {
    return stripMoney(await this.records.businessListIn(this.pick(s, section).business, q));
  }

  async business(s: SectionScope, id: string) {
    const detail = stripMoney(await this.records.businessIn(this.viewable(s).business, id));
    return { ...detail, assignment: await this.assignmentOf(s, 'business', id) };
  }

  async vacancies(s: SectionScope, section: RecordSection, q: ManagerListQuery) {
    return stripMoney(await this.records.vacanciesIn(this.pick(s, section).vacancy, q));
  }

  async vacancy(s: SectionScope, id: string) {
    return stripMoney(await this.records.vacancyIn(this.viewable(s).vacancy, id));
  }

  async interviews(s: SectionScope, section: RecordSection, range: DateRange, now: Date) {
    return stripMoney(await this.records.interviewsIn(this.pick(s, section).interview, range, now));
  }

  async placementList(s: SectionScope, section: RecordSection, q: ManagerListQuery) {
    return stripMoney(await this.records.placementListIn(this.pick(s, section).placement, q));
  }

  async placement(s: SectionScope, id: string) {
    return stripMoney(await this.records.placementIn(this.viewable(s).placement, id));
  }

  async referrals(s: SectionScope, section: RecordSection, q: ManagerListQuery) {
    return stripMoney(await this.records.referralsIn(this.pick(s, section).referral, q));
  }

  async partner(s: SectionScope, id: string) {
    const detail = stripMoney(await this.records.partnerIn(this.viewable(s).referral, id));
    return { ...detail, assignment: await this.assignmentOf(s, 'referral', id) };
  }

  // Photos on the profiles (same checks as the profiles) -----------------------

  async seekerSelfie(s: SectionScope, id: string) {
    return this.photos.seekerSelfie(s.viewer, this.viewable(s).seeker, id);
  }

  async partnerPhoto(s: SectionScope, id: string) {
    return this.photos.partnerPhoto(s.viewer, this.viewable(s).referral, id);
  }

  async visitPhotos(s: SectionScope, businessId: string, visitId: string) {
    return this.photos.visitPhotos(s.viewer, this.viewable(s).business, businessId, visitId);
  }

  // Assign ---------------------------------------------------------------------

  private async loadOwned(kind: AssignKind, ref: string) {
    const where = { OR: [{ id: ref }, { code: ref }] };
    if (kind === 'business') {
      const b = await this.prisma.business.findFirst({ where, select: { id: true, code: true, name: true, city: true, accountAgentId: true, leadCreatedByStaffId: true } });
      return b ? { ...b, assignedStaffId: null as string | null, owners: businessOwners(b) } : null;
    }
    const select = { id: true, code: true, name: true, city: true, registeredByStaffId: true, assignedStaffId: true } as const;
    const p = kind === 'job_seeker' ? await this.prisma.jobSeeker.findFirst({ where, select }) : await this.prisma.referral.findFirst({ where, select });
    return p ? { ...p, accountAgentId: null as string | null, owners: personOwners(p) } : null;
  }

  /** Where a record stands for the profile: its section and who holds it. */
  private async assignmentOf(s: SectionScope, kind: AssignKind, ref: string) {
    const record = await this.loadOwned(kind, ref);
    if (!record) throw new NotFoundException('Not found');
    const inTeam = record.owners.some((id) => s.staffIds.includes(id));
    const holderId = kind === 'business' ? record.accountAgentId : record.assignedStaffId;
    const holder = holderId ? await this.prisma.staff.findUnique({ where: { id: holderId }, select: { id: true, name: true } }) : null;
    return { section: inTeam ? 'team' : 'unassigned', assignedTo: holder, canAssign: true };
  }

  /** The people an assignment can go to, for the picker (active, the viewer first). */
  async assigneeList(s: SectionScope) {
    const rows = await this.prisma.staff.findMany({
      where: { id: { in: s.assignees }, status: 'active' },
      select: { id: true, code: true, name: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    const me = rows.filter((r) => r.id === s.viewer.id);
    return { rows: [...me, ...rows.filter((r) => r.id !== s.viewer.id)].map((r) => ({ ...r, me: r.id === s.viewer.id, canHoldBusiness: r.id === s.viewer.id || r.role === 'field_agent' || r.role === 'team_lead' })) };
  }

  /**
   * Give an unowned record of the viewer's city (cities), or one his team or
   * tree owns, to someone in `assignees` (active). Another team's record, or an
   * unowned one elsewhere → 403. Job seeker and referral partner:
   * assignedStaffId/assignedAt (registeredByStaffId never changes). Business:
   * its account agent through the one account-agent path (setAccountAgent,
   * with the account agent's history); it goes to the viewer himself, a field
   * agent or a Team Lead. Every assignment is audited (record_assigned: actor,
   * kind, id, from, to) and the receiver gets a bell linking to the record.
   */
  async assign(s: SectionScope, body: { kind?: unknown; id?: unknown; toStaffId?: unknown }) {
    const kind = body?.kind;
    if (kind !== 'job_seeker' && kind !== 'referral' && kind !== 'business') throw new BadRequestException('kind is job_seeker, referral or business');
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const toStaffId = typeof body.toStaffId === 'string' ? body.toStaffId.trim() : '';
    if (!id) throw new BadRequestException('id is required');
    if (!toStaffId) throw new BadRequestException('Pick who it goes to');
    const record = await this.loadOwned(kind, id);
    if (!record) throw new NotFoundException('Not found');
    const inTeam = record.owners.some((owner) => s.staffIds.includes(owner));
    const unassignedHere = record.owners.length === 0 && s.cities.includes(record.city);
    if (!inTeam && !unassignedHere) throw new ForbiddenException('This belongs to another team. Only your own records and unassigned ones in your city can be assigned here.');

    const to = s.assignees.includes(toStaffId)
      ? await this.prisma.staff.findFirst({ where: { id: toStaffId, status: 'active' }, select: { id: true, code: true, name: true, role: true } })
      : null;
    if (!to) throw new BadRequestException(s.viewer.role === 'team_lead' ? 'Pick yourself or an active agent of your team' : 'Pick someone active in your teams');
    if (kind === 'business' && to.id !== s.viewer.id && to.role !== 'field_agent' && to.role !== 'team_lead') {
      throw new BadRequestException('A business goes to a field agent (or a Team Lead), not a call agent');
    }
    const fromId = kind === 'business' ? record.accountAgentId : record.assignedStaffId;
    if (fromId === to.id) throw new BadRequestException(`It is already with ${to.name}`);

    const where = `Assigned on the ${s.viewer.role === 'team_lead' ? 'Team Lead' : 'Manager'} portal`;
    if (kind === 'business') {
      await this.setAccountAgent(s.viewer, { id: record.id, code: record.code, city: record.city, accountAgentId: record.accountAgentId }, to.id, where);
    } else {
      const assignedAt = this.clock.now();
      if (kind === 'job_seeker') await this.prisma.jobSeeker.update({ where: { id: record.id }, data: { assignedStaffId: to.id, assignedAt } });
      else await this.prisma.referral.update({ where: { id: record.id }, data: { assignedStaffId: to.id, assignedAt } });
    }
    await this.audit.log({
      actorId: s.viewer.id,
      action: 'record_assigned',
      entityType: kind,
      entityCode: record.code,
      before: { kind, id: record.id, from: fromId, section: inTeam ? 'team' : 'unassigned' },
      after: { kind, id: record.id, to: to.id },
      changedFields: kind === 'business' ? ['accountAgentId'] : ['assignedStaffId', 'assignedAt'],
      reason: where,
      city: record.city,
    });
    if (to.id !== s.viewer.id) await this.notifyAssigned(kind, record, to, s.viewer);
    return { ok: true, kind, id: record.id, code: record.code, from: fromId, to: { id: to.id, name: to.name } };
  }

  /** The receiver's bell: "New job seeker assigned to you" with the record's code and name. */
  private async notifyAssigned(kind: AssignKind, record: { id: string; code: string; name: string }, to: { id: string; role: string }, by: Viewer) {
    const now = this.clock.now();
    const giver = await this.prisma.staff.findUnique({ where: { id: by.id }, select: { name: true } });
    const { kind: notificationKind, title } = ASSIGNED_KIND[kind];
    await this.notifications.open(
      {
        recipientStaffId: to.id,
        kind: notificationKind,
        title,
        body: `${record.code} · ${record.name}${giver ? ` — from ${giver.name}` : ''}`,
        link: notificationLink(to.role, notificationKind, { id: record.id }),
        subjectType: kind,
        subjectId: `${record.id}:${now.getTime()}`,
        once: true,
      },
      now,
    );
  }

  /**
   * The one account-agent change of the Team Lead and Manager portals (T-Work's
   * move and "Assign"): sets the business's account agent and its assignment
   * time, moves the old agent's pending follow-ups and open visit assignments
   * with it, and writes the account agent's history row (audit:
   * business.account_agent_moved, or business.account_agent_assigned when it
   * had none, as after a verification visit). Callers check who may do it.
   */
  async setAccountAgent(
    actor: Viewer,
    business: { id: string; code: string; city: string; accountAgentId: string | null },
    toStaffId: string,
    reason?: string,
  ): Promise<{ followUps: number; visits: number }> {
    const now = this.clock.now();
    const fromId = business.accountAgentId;
    const moved = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.business.update({ where: { id: business.id }, data: { accountAgentId: toStaffId, accountAgentAssignedAt: now } });
      if (!fromId) return { followUps: 0, visits: 0 };
      const followUps = await tx.followUpTask.updateMany({ where: { subjectType: 'business', subjectId: business.id, status: 'pending', assignedStaffId: fromId }, data: { assignedStaffId: toStaffId } });
      const visits = await tx.visitAssignment.updateMany({ where: { businessId: business.id, status: { in: ['pending', 'assigned'] }, assignedStaffId: fromId }, data: { assignedStaffId: toStaffId } });
      return { followUps: followUps.count, visits: visits.count };
    });
    await this.audit.log({
      actorId: actor.id,
      action: fromId ? 'business.account_agent_moved' : 'business.account_agent_assigned',
      entityType: 'business',
      entityCode: business.code,
      before: { accountAgentId: fromId },
      after: { accountAgentId: toStaffId, accountAgentAssignedAt: now.toISOString(), followUpsMoved: moved.followUps, visitsMoved: moved.visits },
      changedFields: ['accountAgentId', 'accountAgentAssignedAt'],
      ...(reason ? { reason } : {}),
      city: business.city,
    });
    return moved;
  }
}
