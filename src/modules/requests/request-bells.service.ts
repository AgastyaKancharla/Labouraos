import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Notification, StaffRequest } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { placementOf } from '../attendance/request-routing';
import { notificationLink } from '../notification/notification.constants';
import { ClearInfo, NotificationDraft, NotificationService } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { DirectoryRow, StaffDirectory } from '../notification/staff-directory';
import { KIND_TITLE, REASON_TEXT, StaffRequestKind } from './requests.constants';

/**
 * Bells for StaffRequests (hit removal, target change, day change, written
 * warning): whoever the request is with right now — the Team Lead, the
 * Manager after 24 hours or when forwarded, the CEO after 48 more — and the
 * requester once it is decided. Same rules as leave and corrections.
 */
@Injectable()
export class RequestBellsService implements OnModuleInit {
  private readonly logger = new Logger(RequestBellsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly sources: NotificationSourcesService,
  ) {}

  onModuleInit(): void {
    this.sources.registerRequestSource('staff requests', (now) => this.syncAll(now));
  }

  recipients(row: StaffRequest, dir: StaffDirectory, now: Date): Array<{ person: DirectoryRow; why: string }> {
    const placement = placementOf(row, now);
    const out: Array<{ person: DirectoryRow; why: string }> = [];
    const add = (person: DirectoryRow | null | undefined, why: string | null) => {
      if (person && why && person.status === 'active') out.push({ person, why });
    };
    if (placement.withTeamLead) add(dir.get(row.routedToStaffId), row.routeReason);
    if (placement.withManager) {
      const manager = row.routedToRole === 'manager' ? dir.get(row.routedToStaffId) : dir.chainOf(row.staffId).manager;
      if (manager) add(manager, placement.managerReason);
      else for (const ceo of dir.ceos()) add(ceo, placement.managerReason);
    }
    if (placement.withCeo) for (const ceo of dir.ceos()) add(ceo, placement.ceoReason);
    return out.filter((entry) => entry.person.id !== row.staffId && entry.person.id !== row.requestedByStaffId);
  }

  drafts(row: StaffRequest, dir: StaffDirectory, now: Date): NotificationDraft[] {
    if (row.status !== 'pending') return [];
    const person = dir.get(row.staffId);
    const who = person ? `${person.name} (${person.code})` : 'A staff member';
    const title = `${KIND_TITLE[row.kind as StaffRequestKind] ?? 'Request'} · ${who}`;
    const seen = new Set<string>();
    const out: NotificationDraft[] = [];
    for (const { person: recipient, why } of this.recipients(row, dir, now)) {
      if (seen.has(recipient.id)) continue;
      seen.add(recipient.id);
      out.push({
        recipientStaffId: recipient.id,
        kind: 'staff_request',
        title,
        body: REASON_TEXT[why] ?? why,
        link: notificationLink(recipient.role, 'staff_request', { ref: `${row.kind}.${row.id}` }),
        subjectType: 'staff_request',
        subjectId: row.id,
      });
    }
    return out;
  }

  clearInfo(row: StaffRequest | null): ClearInfo {
    if (!row) return { byStaffId: null, reason: 'request_gone' };
    if (row.status !== 'pending') return { byStaffId: row.decidedByStaffId, reason: `request_${row.status}` };
    if (row.forwardedAt) return { byStaffId: row.forwardedByStaffId, reason: 'forwarded' };
    return { byStaffId: null, reason: 'moved' };
  }

  async sync(id: string, now: Date = this.notifications.now()): Promise<void> {
    try {
      const row = await this.prisma.staffRequest.findUnique({ where: { id } });
      const dir = await this.sources.directory();
      await this.notifications.syncSubject('staff_request', 'staff_request', id, row ? this.drafts(row, dir, now) : [], this.clearInfo(row), now);
      if (row && row.status !== 'pending') await this.notifyRequester(row, dir, now);
    } catch (error) {
      // A bell never blocks the work itself.
      this.logger.warn(`Bell for request ${id} failed: ${(error as Error).message}`);
    }
  }

  private async notifyRequester(row: StaffRequest, dir: StaffDirectory, now: Date) {
    const requester = dir.get(row.requestedByStaffId);
    if (!requester || requester.status !== 'active' || requester.id === row.decidedByStaffId) return;
    const decider = dir.get(row.overturnedByStaffId ?? row.decidedByStaffId);
    const overturned = Boolean(row.overturnedAt);
    await this.notifications.open(
      {
        recipientStaffId: requester.id,
        kind: 'request_decided',
        title: `Your request (${(KIND_TITLE[row.kind as StaffRequestKind] ?? 'request').toLowerCase()}) was ${row.status}${overturned ? ' (decision changed)' : ''}`,
        body: decider ? `By ${decider.name} (${decider.code})` : null,
        link: notificationLink(requester.role, 'request_decided'),
        subjectType: 'staff_request',
        subjectId: overturned ? `${row.id}:overturned` : row.id,
        once: true,
      },
      now,
    );
  }

  async syncAll(now: Date = this.notifications.now()): Promise<void> {
    const dir = await this.sources.directory();
    const pending = await this.prisma.staffRequest.findMany({ where: { status: 'pending' } });
    const drafts = pending.flatMap((row) => this.drafts(row, dir, now));
    const cache = new Map<string, StaffRequest | null>(pending.map((row) => [row.id, row]));
    await this.notifications.reconcileKind(
      'staff_request',
      drafts,
      async (note: Notification) => {
        if (!cache.has(note.subjectId)) cache.set(note.subjectId, await this.prisma.staffRequest.findUnique({ where: { id: note.subjectId } }));
        return this.clearInfo(cache.get(note.subjectId) ?? null);
      },
      now,
    );
  }
}
