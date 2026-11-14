import { BadRequestException, ForbiddenException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AttendanceClock } from '../attendance/attendance-clock';
import { AttendanceService } from '../attendance/attendance.service';
import { AttendanceDaysService } from '../attendance/attendance-days.service';
import { AttendanceRequestsService } from '../attendance/attendance-requests.service';
import { AttendanceReportsService } from '../attendance/attendance-reports.service';
import { LeaveService } from '../attendance/leave.service';
import { TargetService } from '../target/target.service';
import { LeaderboardService } from '../target/leaderboard.service';
import { TargetOverviewService } from '../target/target-overview.service';
import { CeoTeamService } from '../ceo-portal/ceo-team.service';
import { ManagerTargetsService } from '../screens-manager/manager-targets.service';
import { TeamLeadScreensService } from '../screens-team-lead/team-lead-screens.service';
import { PayrollService } from '../finance/payroll.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { StaffService } from './staff.service';
import { OWNER_ACCOUNT_HAS_PAY, OWNER_ACCOUNT_NO_ATTENDANCE, OWNER_ACCOUNT_NO_TARGETS } from './owner-account';

jest.setTimeout(180000);

const shared = { at: new Date('2026-11-10T06:30:00.000Z') }; // 12:00 IST, a Tuesday: late for a normal agent

class OwnerClock extends AttendanceClock {
  now(): Date {
    return new Date(shared.at.getTime());
  }
}

/**
 * Owner accounts (owner decision 14 Nov): the CEO marks an owner's own call or
 * field agent account. Its work counts in the lists and reports, but it is
 * left out of targets, leaderboards, attendance, salary and incentives.
 */
describe('Owner accounts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = `${Date.now()}`;
  const ids: string[] = [];
  let n = 0;

  async function make(role: string, line: { lead?: string; manager?: string } = {}, extra: Record<string, unknown> = {}) {
    n += 1;
    const row = await prisma.staff.create({
      data: {
        code: `OA-${role.slice(0, 2).toUpperCase()}-${stamp}-${n}`,
        name: `Owner test ${role} ${n}`,
        email: `oa-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: 'hash',
        role,
        status: 'active',
        city: 'Bengaluru',
        teamLeadId: line.lead ?? null,
        reportsToId: line.lead ?? line.manager ?? null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        joinedOn: new Date('2026-10-01T00:00:00.000Z'),
        ...extra,
      },
    });
    ids.push(row.id);
    return row;
  }

  const jwtOf = (s: { id: string; role: string; code: string; email: string | null }): JwtPayload => ({ sub: s.id, role: s.role, code: s.code, email: s.email });

  /** A small company: CEO, a Manager, a Team Lead, a normal call and field agent, and an owner call and field agent. */
  async function company() {
    const ceo = await make('ceo');
    const manager = await make('manager', { manager: ceo.id });
    const lead = await make('team_lead', { manager: manager.id });
    const callAgent = await make('call_agent', { lead: lead.id });
    const fieldAgent = await make('field_agent', { lead: lead.id });
    const ownerCall = await make('call_agent', { lead: lead.id }, { isOwnerAccount: true });
    const ownerField = await make('field_agent', { lead: lead.id }, { isOwnerAccount: true });
    return { ceo, manager, lead, callAgent, fieldAgent, ownerCall, ownerField };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AttendanceClock)
      .useClass(OwnerClock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const where = { staffId: { in: ids } };
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: ids } }, { subjectId: { in: ids } }] } });
    await prisma.attendanceSegment.deleteMany({ where });
    await prisma.attendanceDay.deleteMany({ where });
    await prisma.leaveAccrual.deleteMany({ where });
    await prisma.leaveRequest.deleteMany({ where });
    await prisma.staffSalary.deleteMany({ where });
    await prisma.target.deleteMany({ where });
    await prisma.reviewFlag.deleteMany({ where: { raisedForStaffId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.staff.updateMany({ where: { id: { in: ids } }, data: { teamLeadId: null, reportsToId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  describe('marking', () => {
    it('only the CEO marks an owner account, only on call and field agents, and it is audited', async () => {
      const { ceo, manager, lead, callAgent } = await company();
      const staff = app.get(StaffService);
      const created = await staff.createStaff({ name: `Owner invite ${stamp}`, email: '', role: 'field_agent', reportsToId: lead.id, ownerAccount: true }, jwtOf(ceo));
      ids.push(created.staff.id);
      expect(created.staff.isOwnerAccount).toBe(true);
      await expect(
        staff.createStaff({ name: `Manager try ${stamp}`, email: '', role: 'call_agent', reportsToId: lead.id, ownerAccount: true }, jwtOf(manager)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        staff.createStaff({ name: `Lead try ${stamp}`, email: '', role: 'team_lead', reportsToId: manager.id, ownerAccount: true }, jwtOf(ceo)),
      ).rejects.toThrow('Only call agent and field agent accounts can be owner accounts');

      const marked = await staff.setOwnerAccount(callAgent.id, true, jwtOf(ceo));
      expect(marked.isOwnerAccount).toBe(true);
      const audit = await prisma.auditLog.findFirst({ where: { actorId: ceo.id, action: 'staff.owner_account_set', entityCode: callAgent.code } });
      expect(audit).toBeTruthy();
      await expect(staff.setOwnerAccount(callAgent.id, false, jwtOf(manager))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(staff.setOwnerAccount(lead.id, true, jwtOf(ceo))).rejects.toBeInstanceOf(BadRequestException);
      await expect(staff.setOwnerAccount(callAgent.id, 'yes', jwtOf(ceo))).rejects.toThrow('ownerAccount must be true or false');
      const cleared = await staff.setOwnerAccount(callAgent.id, false, jwtOf(ceo));
      expect(cleared.isOwnerAccount).toBe(false);
      expect(await prisma.auditLog.count({ where: { action: 'staff.owner_account_cleared', entityCode: callAgent.code } })).toBe(1);
    });
  });

  it('is not marked or cleared once the account has pay or finished attendance in a month not yet approved', async () => {
    const c = await company();
    const staff = app.get(StaffService);
    // A salary: refused.
    await prisma.staffSalary.create({ data: { staffId: c.callAgent.id, monthlyPaise: 1800000, effectiveFromMonth: '2026-11', setByStaffId: c.ceo.id } });
    await expect(staff.setOwnerAccount(c.callAgent.id, true, jwtOf(c.ceo))).rejects.toThrow(OWNER_ACCOUNT_HAS_PAY);
    // A finished attendance day this month: refused.
    await prisma.attendanceDay.create({
      data: { staffId: c.fieldAgent.id, date: new Date('2026-11-09T00:00:00.000Z'), loginAt: new Date('2026-11-09T04:00:00.000Z'), logoutAt: new Date('2026-11-09T12:00:00.000Z'), dayType: 'full' },
    });
    await expect(staff.setOwnerAccount(c.fieldAgent.id, true, jwtOf(c.ceo))).rejects.toThrow(OWNER_ACCOUNT_HAS_PAY);
    // Clearing an owner account that worked a finished day this month: refused too.
    await prisma.attendanceDay.create({
      data: { staffId: c.ownerCall.id, date: new Date('2026-11-09T00:00:00.000Z'), loginAt: new Date('2026-11-09T04:00:00.000Z'), logoutAt: new Date('2026-11-09T12:00:00.000Z'), dayType: 'full' },
    });
    await expect(staff.setOwnerAccount(c.ownerCall.id, false, jwtOf(c.ceo))).rejects.toThrow(OWNER_ACCOUNT_HAS_PAY);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: c.ownerCall.id } })).isOwnerAccount).toBe(true);
    // An owner account that has not worked yet can still be cleared.
    expect((await staff.setOwnerAccount(c.ownerField.id, false, jwtOf(c.ceo))).isOwnerAccount).toBe(false);
  });

  describe('targets and leaderboards', () => {
    it('refuses a target for an owner account and leaves one set earlier out of every target list and leaderboard', async () => {
      const c = await company();
      const now = shared.at;
      const targets = app.get(TargetService);
      await expect(
        targets.setTarget({ staffId: c.ownerField.id, year: 2026, month: 11, placementsClosed: 5 }, c.ceo.id, now, jwtOf(c.ceo)),
      ).rejects.toThrow(OWNER_ACCOUNT_NO_TARGETS);
      // A target from before the account was marked stays in the table but is shown nowhere.
      const old = await prisma.target.create({ data: { staffId: c.ownerField.id, year: 2026, month: 11, placementsClosed: 4, createdById: c.ceo.id } });
      await expect(targets.updateTarget(old.id, { placementsClosed: 6 }, c.ceo.id, now, jwtOf(c.ceo))).rejects.toThrow(OWNER_ACCOUNT_NO_TARGETS);
      await prisma.target.create({ data: { staffId: c.ownerCall.id, year: 2026, month: 11, candidatesActivated: 10, createdById: c.ceo.id } });
      await targets.setTarget({ staffId: c.fieldAgent.id, year: 2026, month: 11, placementsClosed: 5 }, c.ceo.id, now, jwtOf(c.ceo));
      await targets.setTarget({ staffId: c.callAgent.id, year: 2026, month: 11, candidatesActivated: 20 }, c.ceo.id, now, jwtOf(c.ceo));
      const owners = [c.ownerCall.id, c.ownerField.id];

      const listed = await targets.listTargets({ year: 2026, month: 11 }, jwtOf(c.ceo));
      expect(listed.map((t) => t.staffId)).toEqual(expect.arrayContaining([c.fieldAgent.id, c.callAgent.id]));
      expect(listed.some((t) => owners.includes(t.staffId))).toBe(false);
      const leadList = await targets.listTargets({ year: 2026, month: 11 }, jwtOf(c.lead));
      expect(leadList.some((t) => owners.includes(t.staffId))).toBe(false);

      const board = await app.get(LeaderboardService).getLeaderboard({ year: 2026, month: 11 }, jwtOf(c.ceo), now);
      expect(board.leaderboard.map((r) => r.staffId)).toContain(c.fieldAgent.id);
      expect(board.leaderboard.some((r) => owners.includes(r.staffId))).toBe(false);

      const ceoTeam = app.get(CeoTeamService);
      const ceoBoard = await ceoTeam.targetsBoard({ year: 2026, month: 11 }, now);
      expect(ceoBoard.rows.map((r) => r.staff.id)).toContain(c.callAgent.id);
      expect(ceoBoard.rows.some((r) => owners.includes(r.staff.id))).toBe(false);
      expect(ceoBoard.leaderboard.some((r) => owners.includes(r.staff.id))).toBe(false);
      const range = await ceoTeam.leaderboardRange({ from: new Date('2026-11-01T00:00:00Z'), to: now });
      expect(range.leaderboard.some((r) => owners.includes(r.staff.id))).toBe(false);

      const overview = await app.get(TargetOverviewService).getOverview({ year: 2026, month: 11 }, jwtOf(c.lead), now);
      expect(overview.agents.map((a) => a.staff.id)).toEqual(expect.arrayContaining([c.callAgent.id, c.fieldAgent.id]));
      expect(overview.agents.some((a) => owners.includes(a.staff.id))).toBe(false);

      const mg = await app.get(ManagerTargetsService).board({ id: c.manager.id, role: 'manager' }, 2026, 11, now);
      expect(mg.agents.map((a) => a.staff.id)).toContain(c.callAgent.id);
      expect(mg.agents.some((a) => owners.includes(a.staff.id))).toBe(false);
      expect(mg.leaderboard.some((a) => owners.includes(a.staff.id))).toBe(false);
      // The team's target is the sum of its agents' targets, owner accounts left out.
      expect(mg.teams.find((t) => t.teamLeadId === c.lead.id)).toMatchObject({ placementsClosed: 5, candidatesActivated: 20 });

      // An owner account's own overview shows no target, even one set before it was marked.
      const ownOverview = await app.get(TargetOverviewService).getOverview({ staffId: c.ownerField.id, year: 2026, month: 11 }, jwtOf(c.ceo), now);
      expect(ownOverview.agent?.target).toBeNull();
      // C-Teams: owner accounts are never "behind" (both normal agents are, after the 10th).
      const teams = await ceoTeam.teams(new Date('2026-11-20T06:30:00.000Z'));
      expect(teams.rows.find((r) => r.id === c.lead.id)?.agentsBehind).toBe(2);

      const tl = app.get(TeamLeadScreensService);
      const tlBoard = await tl.targets({ id: c.lead.id, role: 'team_lead' });
      expect(tlBoard.agents.some((a) => owners.includes(a.staff.id))).toBe(false);
      // The team list itself still has the owner accounts (their work is in the lists).
      const members = await tl.members({ id: c.lead.id, role: 'team_lead' });
      expect(members.map((m) => m.id)).toEqual(expect.arrayContaining(owners));
    });
  });

  describe('attendance', () => {
    it('an owner account\'s day starts by itself, never late, and ending it is never a half day or a flag', async () => {
      const c = await company();
      shared.at = new Date('2026-11-10T06:30:00.000Z');
      const attendance = app.get(AttendanceService);
      const owner = await attendance.todayForSelf(c.ownerCall.id);
      expect(owner).toMatchObject({ ownerAccount: true, lateMinutes: 0, status: 'available', shortfallSeconds: 0 });
      expect(owner.loginAt).toBeTruthy();
      // A field owner's day starts too, without the GPS a field agent's Login needs.
      const field = await attendance.todayForSelf(c.ownerField.id);
      expect(field).toMatchObject({ ownerAccount: true, lateMinutes: 0, status: 'available' });
      // A normal agent is not started by asking, and is late at noon.
      const normalBefore = await attendance.todayForSelf(c.callAgent.id);
      expect(normalBefore).toMatchObject({ ownerAccount: false, loginAt: null });
      const normal = await attendance.login(c.callAgent.id, {});
      expect(normal.lateMinutes).toBeGreaterThan(0);
      // Calls are not blocked: the owner is Available.
      expect(await attendance.isAvailable(c.ownerCall.id)).toBe(true);

      shared.at = new Date('2026-11-10T07:00:00.000Z');
      await attendance.logout(c.ownerCall.id);
      const ended = await prisma.attendanceDay.findFirstOrThrow({ where: { staffId: c.ownerCall.id } });
      expect(ended).toMatchObject({ dayType: 'full', shortfallSeconds: 0, flagged: false });
      // Asking again does not restart an ended day; starting it again reopens it.
      expect((await attendance.todayForSelf(c.ownerCall.id)).logoutAt).toBeTruthy();
      const again = await attendance.login(c.ownerCall.id, {});
      expect(again).toMatchObject({ logoutAt: null, status: 'available' });
      // Forgotten logout: closed without a flag.
      await attendance.closeForgottenDays(c.ownerField.id);
      expect(await prisma.attendanceDay.findFirstOrThrow({ where: { staffId: c.ownerField.id } })).toMatchObject({ flagged: false, dayType: 'full' });
    });

    it('is never marked absent, has no leave or corrections, earns no leave and is in no attendance report', async () => {
      const c = await company();
      shared.at = new Date('2026-11-12T06:30:00.000Z');
      const days = app.get(AttendanceDaysService);
      const date = new Date('2026-11-03T00:00:00.000Z');
      const marked = await days.markAbsentDays(date, [c.ownerCall.id, c.callAgent.id]);
      expect(await prisma.attendanceDay.count({ where: { staffId: c.ownerCall.id, date } })).toBe(0);
      // The normal agent is marked (unless the Settings' go-live date is later in this database).
      expect(await prisma.attendanceDay.count({ where: { staffId: c.callAgent.id, date } })).toBe(marked.marked);
      expect(marked.marked).toBeLessThanOrEqual(1);

      const requests = app.get(AttendanceRequestsService);
      await expect(
        requests.requestLeave({ id: c.ownerCall.id, role: 'call_agent' }, { kind: 'casual', fromDate: '2026-11-20', toDate: '2026-11-20', reason: 'Trip' }),
      ).rejects.toThrow(OWNER_ACCOUNT_NO_ATTENDANCE);
      await expect(
        requests.requestCorrection({ id: c.ownerField.id, role: 'field_agent' }, { date: '2026-11-11', from: '10:00', to: '11:00', reason: 'Signal' }),
      ).rejects.toThrow(OWNER_ACCOUNT_NO_ATTENDANCE);
      expect(await app.get(LeaveService).ensureAccrued(c.ownerCall.id)).toBe(0);
      expect(await prisma.leaveAccrual.count({ where: { staffId: c.ownerCall.id } })).toBe(0);

      const reports = app.get(AttendanceReportsService);
      const people = await reports.peopleInScope({ id: c.ceo.id, role: 'ceo' }, true);
      expect(people.map((p) => p.id)).toContain(c.callAgent.id);
      expect(people.some((p) => p.id === c.ownerCall.id || p.id === c.ownerField.id)).toBe(false);
      const leadPeople = await reports.peopleInScope({ id: c.lead.id, role: 'team_lead' }, false);
      expect(leadPeople.some((p) => p.id === c.ownerCall.id)).toBe(false);
      const sheet = await reports.monthSheet({ id: c.ceo.id, role: 'ceo' }, '2026-11');
      expect(sheet.rows.map((r) => r.staffCode)).toContain(c.callAgent.code);
      expect(sheet.rows.some((r) => r.staffCode === c.ownerCall.code)).toBe(false);
    });

    it('raises no idle bell about an owner account', async () => {
      const c = await company();
      shared.at = new Date('2026-11-13T06:30:00.000Z');
      const date = new Date('2026-11-13T00:00:00.000Z');
      const startedAt = new Date('2026-11-13T05:00:00.000Z');
      for (const person of [c.ownerCall, c.callAgent]) {
        const day = await prisma.attendanceDay.create({ data: { staffId: person.id, date, loginAt: startedAt, dayType: 'open', lastHeartbeatAt: startedAt } });
        await prisma.attendanceSegment.create({ data: { staffId: person.id, dayId: day.id, status: 'idle', startedAt, source: 'idle_detector' } });
      }
      await app.get(NotificationSourcesService).syncIdle(shared.at);
      const bells = await prisma.notification.findMany({ where: { kind: 'agent_idle', recipientStaffId: c.lead.id, clearedAt: null } });
      expect(bells.some((b) => b.title.includes(c.callAgent.code))).toBe(true);
      expect(bells.some((b) => b.title.includes(c.ownerCall.code))).toBe(false);
    });
  });

  describe('salary', () => {
    it('is not on the salary list or sheet and gets no salary', async () => {
      const c = await company();
      const payroll = app.get(PayrollService);
      await expect(payroll.setSalary(c.ownerCall.id, { monthlyPaise: 2000000, effectiveFromMonth: '2026-11' }, { id: c.ceo.id, role: 'ceo' })).rejects.toThrow(
        OWNER_ACCOUNT_NO_ATTENDANCE,
      );
      await expect(
        payroll.addCorrection({ staffId: c.ownerCall.id, relatesToMonth: '2026-09', amountPaise: 50000, reason: 'Back pay' }, { id: c.ceo.id, role: 'ceo' }, shared.at),
      ).rejects.toThrow(OWNER_ACCOUNT_NO_ATTENDANCE);
      const salaries = await payroll.staffSalaries(shared.at);
      expect(salaries.rows.map((r) => r.staffId)).toContain(c.callAgent.id);
      expect(salaries.rows.some((r) => r.staffId === c.ownerCall.id || r.staffId === c.ownerField.id)).toBe(false);
      const sheet = await payroll.sheet('2026-10', new Date('2026-11-12T06:30:00.000Z'));
      const codes = (sheet.rows as Array<{ staffCode: string }>).map((r) => r.staffCode);
      expect(codes).not.toContain(c.ownerCall.code);
      expect(codes).not.toContain(c.ownerField.code);
    });
  });
});
