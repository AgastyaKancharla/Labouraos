import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClearInfo, NotificationDraft, NotificationService } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import type { DirectoryRow, StaffDirectory } from '../notification/staff-directory';
import { istClockOn } from '../attendance/staff-shift';

export const LOGIN_CODE_BELL = 'login_code_request' as const;
export const DEVICE_BELL = 'device_approval_request' as const;
export const NO_CODE_BELL = 'signed_in_without_code' as const;

export interface NoCodeSignInRow {
  id: string;
  title: string;
  body: string | null;
  at: string;
}

/**
 * Bells for sign-in requests (Master Guide rev 202, decided 21 Nov): the Team
 * Lead (and the Manager over them) hears about every login-code request and
 * every new-device approval request at once, instead of finding them only on
 * the Login codes screen. Who hears is who may act:
 * - an agent's login code or new device: their Team Lead and the Manager
 *   above (an owner account that reports to a CEO: the CEO);
 * - a Team Lead's new device: the Manager above, else the CEO;
 * - a Manager's or Finance's new device: the CEO.
 * The bell clears by itself when the code is given, used, refused or runs
 * out, and when the device is approved or refused (the notification sweep
 * catches anything an event missed). Bells never carry a phone number.
 */
@Injectable()
export class SignInBellsService implements OnModuleInit {
  private readonly logger = new Logger(SignInBellsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Optional() private readonly sources?: NotificationSourcesService,
  ) {}

  onModuleInit(): void {
    // Swept with the requests: expired codes and decided devices clear even without an event.
    this.sources?.registerRequestSource('sign-in requests', (now) => this.syncAll(now));
  }

  /** Never blocks a sign-in: a failing bell is logged. */
  private async safely(label: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.warn(`Sign-in bell "${label}" failed: ${(error as Error).message}`);
    }
  }

  private async directory(): Promise<StaffDirectory | null> {
    return this.sources ? this.sources.directory() : null;
  }

  /** Who is told about this person's login code or new device. */
  recipients(dir: StaffDirectory, staffId: string): DirectoryRow[] {
    const person = dir.get(staffId);
    if (!person) return [];
    const chain = dir.chainOf(staffId);
    const ceos = chain.ceo ? [chain.ceo] : dir.ceos();
    if (person.role === 'call_agent' || person.role === 'field_agent') {
      const seniors = [chain.teamLead, chain.manager].filter((row): row is DirectoryRow => Boolean(row && row.status === 'active'));
      return seniors.length > 0 ? seniors : ceos;
    }
    if (person.role === 'team_lead') {
      return chain.manager && chain.manager.status === 'active' ? [chain.manager] : ceos;
    }
    return ceos;
  }

  private who(dir: StaffDirectory, staffId: string): string {
    const person = dir.get(staffId);
    return person ? `${person.name} (${person.code})` : 'A team member';
  }

  private drafts(
    dir: StaffDirectory,
    staffId: string,
    base: Omit<NotificationDraft, 'recipientStaffId' | 'link'>,
  ): NotificationDraft[] {
    return this.sources ? this.sources.drafts(this.recipients(dir, staffId), base) : [];
  }

  private loginCodeDraft(dir: StaffDirectory, row: { id: string; staffId: string; app: string | null }) {
    const where = row.app === 'field' ? 'Laboura Field' : row.app === 'office' ? 'the office app' : 'sign-in';
    return this.drafts(dir, row.staffId, {
      kind: LOGIN_CODE_BELL,
      title: `${this.who(dir, row.staffId)} is waiting for a login code`,
      body: `Signing in to ${where} · call them back from your own contacts and give the code on the Login codes screen`,
      subjectType: 'login_code_request',
      subjectId: row.id,
    });
  }

  private deviceDraft(dir: StaffDirectory, row: { id: string; staffId: string; label: string; app: string | null }) {
    return this.drafts(dir, row.staffId, {
      kind: DEVICE_BELL,
      title: `${this.who(dir, row.staffId)} asks to approve a new device`,
      body: `${row.label || 'New device'} · approve or refuse it on the Login codes screen`,
      subjectType: 'staff_device',
      subjectId: row.id,
    });
  }

  private loginCodeCleared(row: { status: string; revealedByStaffId: string | null; refusedByStaffId: string | null } | null): ClearInfo {
    if (!row) return { byStaffId: null, reason: 'request_gone' };
    if (row.status === 'revealed') return { byStaffId: row.revealedByStaffId, reason: 'code_given' };
    if (row.status === 'refused') return { byStaffId: row.refusedByStaffId, reason: 'refused' };
    if (row.status === 'used') return { byStaffId: row.revealedByStaffId, reason: 'used' };
    return { byStaffId: null, reason: 'expired' };
  }

  private deviceCleared(row: { status: string; approvedByStaffId: string | null; revokedByStaffId: string | null } | null): ClearInfo {
    if (!row) return { byStaffId: null, reason: 'device_gone' };
    if (row.status === 'approved') return { byStaffId: row.approvedByStaffId, reason: 'approved' };
    return { byStaffId: row.revokedByStaffId, reason: 'refused' };
  }

  /** One login-code request, straight after it is made, given, used or refused. */
  async syncLoginCode(requestId: string, now: Date = this.notifications.now()): Promise<void> {
    await this.safely('login code', async () => {
      const dir = await this.directory();
      if (!dir) return;
      const row = await this.prisma.loginCodeRequest.findUnique({
        where: { id: requestId },
        select: { id: true, staffId: true, app: true, status: true, expiresAt: true, revealedByStaffId: true, refusedByStaffId: true },
      });
      const waiting = row && row.status === 'pending' && row.expiresAt.getTime() > now.getTime();
      await this.notifications.syncSubject(
        LOGIN_CODE_BELL,
        'login_code_request',
        requestId,
        waiting ? this.loginCodeDraft(dir, row) : [],
        this.loginCodeCleared(row),
        now,
      );
    });
  }

  /** One device approval request, straight after it is made, approved or refused. */
  async syncDevice(deviceRowId: string, now: Date = this.notifications.now()): Promise<void> {
    await this.safely('device', async () => {
      const dir = await this.directory();
      if (!dir) return;
      const row = await this.prisma.staffDevice.findUnique({
        where: { id: deviceRowId },
        select: { id: true, staffId: true, label: true, app: true, status: true, approvedByStaffId: true, revokedByStaffId: true },
      });
      // The CEO approves his own new device with his authenticator: no bell for that.
      const owner = row ? dir.get(row.staffId) : null;
      const waiting = row && row.status === 'pending' && owner?.role !== 'ceo';
      await this.notifications.syncSubject(
        DEVICE_BELL,
        'staff_device',
        deviceRowId,
        waiting ? this.deviceDraft(dir, row) : [],
        this.deviceCleared(row),
        now,
      );
    });
  }

  /**
   * Signed in again without a code (a code was accepted earlier today on that
   * device) and it ended a session still in use, or came from a network not
   * seen today (21 Nov hardening): a bell for the same seniors, shown on their
   * Login codes screen. Informational: reading it clears it.
   */
  async noCodeSignIn(
    staffId: string,
    sessionId: string,
    why: { endedEarlierSession: boolean; newNetwork: boolean },
    now: Date = this.notifications.now(),
  ): Promise<void> {
    await this.safely('no-code sign-in', async () => {
      const dir = await this.directory();
      if (!dir || !sessionId) return;
      const reasons = [why.endedEarlierSession ? 'ended the earlier session' : null, why.newNetwork ? 'from a new network' : null]
        .filter(Boolean)
        .join(' and ');
      const drafts = this.drafts(dir, staffId, {
        kind: NO_CODE_BELL,
        title: `${this.who(dir, staffId)} signed in again without a code — ${reasons}`,
        body: 'A login code was given earlier today on the same device. If this was not them, lock the account or end the session.',
        subjectType: 'staff_session',
        subjectId: sessionId,
      });
      for (const draft of drafts) await this.notifications.open(draft, now);
    });
  }

  /** Today's "signed in again without a code" alerts for this senior (their Login codes screen). */
  async noCodeSignInsFor(readerId: string, now: Date = this.notifications.now()): Promise<NoCodeSignInRow[]> {
    const dayStart = istClockOn(now, '00:00');
    const rows = await this.prisma.notification.findMany({
      where: { recipientStaffId: readerId, kind: NO_CODE_BELL, createdAt: { gte: dayStart } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, title: true, body: true, createdAt: true },
    });
    return rows.map((row) => ({ id: row.id, title: row.title, body: row.body, at: row.createdAt.toISOString() }));
  }

  /** Every open sign-in request: opens missing bells, clears finished ones (the sweep). */
  async syncAll(now: Date = this.notifications.now()): Promise<void> {
    const dir = await this.directory();
    if (!dir) return;
    const codes = await this.prisma.loginCodeRequest.findMany({
      where: { status: 'pending', expiresAt: { gt: now } },
      select: { id: true, staffId: true, app: true },
    });
    await this.notifications.reconcileKind(
      LOGIN_CODE_BELL,
      codes.flatMap((row) => this.loginCodeDraft(dir, row)),
      async (bell: Notification) =>
        this.loginCodeCleared(
          await this.prisma.loginCodeRequest.findUnique({
            where: { id: bell.subjectId },
            select: { status: true, revealedByStaffId: true, refusedByStaffId: true },
          }),
        ),
      now,
    );
    const devices = await this.prisma.staffDevice.findMany({
      where: { status: 'pending', staff: { role: { not: 'ceo' } } },
      select: { id: true, staffId: true, label: true, app: true },
    });
    await this.notifications.reconcileKind(
      DEVICE_BELL,
      devices.flatMap((row) => this.deviceDraft(dir, row)),
      async (bell: Notification) =>
        this.deviceCleared(
          await this.prisma.staffDevice.findUnique({
            where: { id: bell.subjectId },
            select: { status: true, approvedByStaffId: true, revokedByStaffId: true },
          }),
        ),
      now,
    );
  }
}
