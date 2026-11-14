import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOddHourIst } from '../login-code/login-code.crypto';
import { CallAgentMetricsService } from '../target/call-agent-metrics.service';
import { FieldAgentMetricsService } from '../target/field-agent-metrics.service';
import { TargetService } from '../target/target.service';
import { istDayKey, istStartOfDay, istStartOfMonth, percent } from './ceo-common';
import { NOT_OWNER_ACCOUNT } from '../staff/owner-account';

/** A session counts as "signed in now" while it is live and was used in the last hour. */
const SIGNED_IN_WINDOW_MS = 60 * 60 * 1000;
const AGENT_ROLES = ['call_agent', 'field_agent'];

export type StaffState = 'active' | 'invite_pending' | 'locked' | 'deactivated';

/** The status word shown on Team & access: deactivated, then locked, then invite, then active. */
export function staffState(row: { status: string; lockedUntil: Date | null }, now: Date): StaffState {
  if (row.status === 'deactivated') return 'deactivated';
  if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) return 'locked';
  if (row.status === 'pending_invite') return 'invite_pending';
  return 'active';
}

/** A Team Lead's team name, or "Team <first name>" until the CEO names it. */
export function teamLabel(lead: { name: string; teamName: string | null } | null | undefined): string | null {
  if (!lead) return null;
  return lead.teamName?.trim() || `Team ${lead.name.split(' ')[0]}`;
}

export type Pace = 'on_pace' | 'behind' | 'no_target' | 'early';

/**
 * Pace for a monthly target (guide, Targets: "after the 10th, anyone under 80%
 * of pace is flagged to their Team Lead and Manager"). Expected so far is the
 * target × the share of the month gone; before the 11th nobody is flagged.
 */
export function paceFor(achieved: number, target: number | null | undefined, dayOfMonth: number, daysInMonth: number): Pace {
  if (!target || target <= 0) return 'no_target';
  if (dayOfMonth <= 10) return 'early';
  const expected = (target * dayOfMonth) / daysInMonth;
  return achieved >= expected * 0.8 ? 'on_pace' : 'behind';
}

export interface Month {
  year: number;
  month: number;
}

export function parseMonth(year: unknown, month: unknown, now: Date): Month {
  const [ny, nm] = istDayKey(now).split('-').map(Number);
  const y = year === undefined || year === '' ? ny : Number(year);
  const m = month === undefined || month === '' ? nm : Number(month);
  if (!Number.isInteger(y) || y < 2020 || y > 2100) throw new BadRequestException('year must be a 4-digit year');
  if (!Number.isInteger(m) || m < 1 || m > 12) throw new BadRequestException('month must be 1 to 12');
  return { year: y, month: m };
}

/**
 * Team & access, Teams, Devices & logins, Login codes, Targets and the
 * Leaderboard for the CEO portal (designs C-Team, C-Teams, C-Team-Devices,
 * C-LoginCodes, C-Team-Targets, C-Leaderboard). Reads only, plus the team name
 * and copying a month's targets; every other action goes to the existing staff,
 * device, login-code and target endpoints.
 */
/** Titles of the one top-level role (guide, People and roles). */
export const STAFF_TITLES = ['ceo', 'founder', 'co_founder'] as const;

@Injectable()
export class CeoTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly targets: TargetService,
    private readonly callMetrics: CallAgentMetricsService,
    private readonly fieldMetrics: FieldAgentMetricsService,
  ) {}

  private async signedInIds(now: Date): Promise<Set<string>> {
    const sessions = await this.prisma.staffSession.findMany({
      where: {
        revokedAt: null,
        absoluteExpiresAt: { gt: now },
        lastActivityAt: { gt: new Date(now.getTime() - SIGNED_IN_WINDOW_MS) },
      },
      select: { staffId: true },
    });
    return new Set(sessions.map((s) => s.staffId));
  }

  /** C-Team: the organisation, every account and the "Add a staff member" choices. */
  /**
   * Guide, People and roles: the CEO, founders and co-founders are one
   * top-level role with different titles. Only the CEO sets the title, and
   * only on a CEO-level account. Audited.
   */
  async setTitle(actorId: string, staffId: string, body: { title?: unknown; reason?: unknown }) {
    const title = typeof body?.title === 'string' ? body.title : '';
    if (!STAFF_TITLES.includes(title as (typeof STAFF_TITLES)[number])) throw new BadRequestException(`title is one of ${STAFF_TITLES.join(', ')}`);
    const target = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, code: true, role: true, title: true } });
    if (!target) throw new NotFoundException('Staff account not found');
    if (target.role !== 'ceo') throw new BadRequestException('Only a CEO-level account has the title CEO, founder or co-founder');
    await this.prisma.staff.update({ where: { id: staffId }, data: { title } });
    await this.audit.log({
      actorId,
      action: 'staff.title_set',
      entityType: 'staff',
      entityCode: target.code,
      before: { title: target.title },
      after: { title },
      reason: typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
    });
    return { id: target.id, title };
  }

  async team(now: Date) {
    const [staff, online] = await Promise.all([
      this.prisma.staff.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          email: true,
          role: true,
          title: true,
          status: true,
          totpEnabled: true,
          lockedUntil: true,
          lockedReason: true,
          failedLoginCount: true,
          teamName: true,
          teamLeadId: true,
          reportsToId: true,
          createdAt: true,
          deactivatedAt: true,
          joinedOn: true,
          isOwnerAccount: true,
        },
        orderBy: [{ createdAt: 'asc' }],
      }),
      this.signedInIds(now),
    ]);
    const byId = new Map(staff.map((s) => [s.id, s]));
    const teamOf = (s: (typeof staff)[number]): string | null => {
      if (s.role === 'team_lead') return teamLabel(s);
      if (AGENT_ROLES.includes(s.role)) return teamLabel(byId.get(s.teamLeadId ?? s.reportsToId ?? '') ?? null);
      if (s.role === 'manager') {
        const names = staff.filter((t) => t.role === 'team_lead' && t.reportsToId === s.id && t.status !== 'deactivated').map((t) => teamLabel(t) as string);
        return names.length ? names.join(', ') : null;
      }
      return null;
    };
    const live = staff.filter((s) => s.status !== 'deactivated');
    const rows = staff.map((s) => {
      const boss = s.reportsToId ? byId.get(s.reportsToId) : null;
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        email: s.email,
        role: s.role,
        title: s.title,
        team: teamOf(s),
        reportsTo: boss ? { id: boss.id, name: boss.name, role: boss.role } : null,
        state: staffState(s, now),
        authenticator: s.totpEnabled,
        signedIn: online.has(s.id),
        lockedUntil: s.lockedUntil && s.lockedUntil.getTime() > now.getTime() ? s.lockedUntil.toISOString() : null,
        lockedReason: s.lockedReason,
        createdAt: s.createdAt.toISOString(),
        joinedOn: s.joinedOn ? s.joinedOn.toISOString().slice(0, 10) : null,
        /** Owner account: their work counts in the lists, not in targets, leaderboard, attendance or salary. */
        ownerAccount: s.isOwnerAccount,
      };
    });
    const leads = live.filter((s) => s.role === 'team_lead');
    const countAgents = (leadId: string, role: string) =>
      live.filter((a) => a.role === role && (a.teamLeadId ?? a.reportsToId) === leadId).length;
    return {
      rows,
      totals: {
        accounts: live.length,
        signedInNow: live.filter((s) => online.has(s.id)).length,
        invitesPending: live.filter((s) => s.status === 'pending_invite').length,
        locked: live.filter((s) => staffState(s, now) === 'locked').length,
        withoutAuthenticator: live.filter((s) => ['ceo', 'manager', 'finance'].includes(s.role) && !s.totpEnabled).length,
      },
      organisation: {
        ceos: live.filter((s) => s.role === 'ceo').map((s) => ({ id: s.id, name: s.name })),
        managers: live
          .filter((s) => s.role === 'manager')
          .map((m) => ({ id: m.id, name: m.name, teams: leads.filter((t) => t.reportsToId === m.id).map((t) => teamLabel(t) as string) })),
        teamLeads: leads.map((t) => ({
          id: t.id,
          name: t.name,
          team: teamLabel(t),
          manager: t.reportsToId ? (byId.get(t.reportsToId)?.name ?? null) : null,
          callAgents: countAgents(t.id, 'call_agent'),
          fieldAgents: countAgents(t.id, 'field_agent'),
        })),
        finance: live.filter((s) => s.role === 'finance').map((s) => ({ id: s.id, name: s.name })),
      },
      reportsToOptions: live
        .filter((s) => ['ceo', 'manager', 'team_lead'].includes(s.role) && s.status === 'active')
        .map((s) => ({ id: s.id, name: s.name, role: s.role, team: s.role === 'team_lead' ? teamLabel(s) : null })),
    };
  }

  /** C-Teams: one row per Team Lead with their Manager, agents, this month's results and pace. */
  async teams(now: Date) {
    const staff = await this.prisma.staff.findMany({
      where: { status: { not: 'deactivated' } },
      select: { id: true, code: true, name: true, role: true, teamName: true, teamLeadId: true, reportsToId: true, isOwnerAccount: true },
      orderBy: { name: 'asc' },
    });
    const byId = new Map(staff.map((s) => [s.id, s]));
    const monthStart = istStartOfMonth(now);
    const { year, month } = parseMonth(undefined, undefined, now);
    const day = Number(istDayKey(now).slice(8, 10));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const targets = await this.prisma.target.findMany({ where: { year, month } });
    const leads = staff.filter((s) => s.role === 'team_lead');
    const rows = [];
    for (const lead of leads) {
      const agents = staff.filter((a) => AGENT_ROLES.includes(a.role) && (a.teamLeadId ?? a.reportsToId) === lead.id);
      const ids = agents.map((a) => a.id);
      const [placements, activations] = ids.length
        ? await Promise.all([
            this.prisma.placement.count({ where: { createdByStaffId: { in: ids }, createdAt: { gte: monthStart, lte: now }, status: { not: 'cancelled' } } }),
            this.prisma.jobSeeker.count({ where: { registeredByStaffId: { in: ids }, paymentReceivedAt: { gte: monthStart, lte: now } } }),
          ])
        : [0, 0];
      let behind = 0;
      for (const agent of agents) {
        // Owner accounts carry no targets, so they are never behind (owner decision 14 Nov).
        if (agent.isOwnerAccount) continue;
        const t = targets.find((x) => x.staffId === agent.id);
        if (!t) continue;
        const achieved =
          agent.role === 'field_agent'
            ? await this.prisma.placement.count({ where: { createdByStaffId: agent.id, createdAt: { gte: monthStart, lte: now }, status: { not: 'cancelled' } } })
            : await this.prisma.jobSeeker.count({ where: { registeredByStaffId: agent.id, paymentReceivedAt: { gte: monthStart, lte: now } } });
        const goal = agent.role === 'field_agent' ? t.placementsClosed : t.candidatesActivated;
        if (paceFor(achieved, goal, day, daysInMonth) === 'behind') behind += 1;
      }
      const manager = lead.reportsToId ? byId.get(lead.reportsToId) : null;
      rows.push({
        id: lead.id,
        code: lead.code,
        teamName: lead.teamName,
        team: teamLabel(lead),
        teamLead: { id: lead.id, name: lead.name },
        manager: manager ? { id: manager.id, name: manager.name } : null,
        callAgents: agents.filter((a) => a.role === 'call_agent').length,
        fieldAgents: agents.filter((a) => a.role === 'field_agent').length,
        agents: agents.map((a) => ({ id: a.id, code: a.code, name: a.name, role: a.role })),
        placementsThisMonth: placements,
        activationsThisMonth: activations,
        agentsBehind: behind,
      });
    }
    const agentsWithoutTeam = staff
      .filter((a) => AGENT_ROLES.includes(a.role) && !(a.teamLeadId ?? a.reportsToId))
      .map((a) => ({ id: a.id, code: a.code, name: a.name, role: a.role }));
    return {
      rows,
      agentsWithoutTeam,
      managers: staff.filter((s) => s.role === 'manager').map((m) => ({ id: m.id, name: m.name })),
      allAgents: staff.filter((a) => AGENT_ROLES.includes(a.role)).map((a) => ({ id: a.id, name: a.name, role: a.role, teamLeadId: a.teamLeadId ?? a.reportsToId })),
    };
  }

  /** Names a Team Lead's team ("Team South"). Audit-logged. Empty clears it. */
  async setTeamName(actor: JwtPayload, teamLeadId: string, body: { name?: unknown }) {
    const lead = await this.prisma.staff.findUnique({ where: { id: teamLeadId }, select: { id: true, role: true, teamName: true, name: true } });
    if (!lead) throw new NotFoundException('Team Lead not found');
    if (lead.role !== 'team_lead') throw new BadRequestException('Only a Team Lead has a team');
    if (body?.name !== undefined && body.name !== null && typeof body.name !== 'string') throw new BadRequestException('name must be text');
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length > 40) throw new BadRequestException('Team name must be 40 characters or fewer');
    const updated = await this.prisma.staff.update({ where: { id: teamLeadId }, data: { teamName: name || null }, select: { id: true, name: true, teamName: true } });
    await this.audit.log({
      actorId: actor.sub,
      action: 'staff.team_named',
      entityType: 'staff',
      entityCode: teamLeadId,
      before: { teamName: lead.teamName },
      after: { teamName: updated.teamName },
    });
    return { id: updated.id, teamName: updated.teamName, team: teamLabel(updated) };
  }

  /** C-Team-Devices: every device with its owner and the last login time (no office network since 14 Nov). */
  async devices(now: Date) {
    const devices = await this.prisma.staffDevice.findMany({
      include: {
        staff: { select: { id: true, code: true, name: true, role: true } },
        approvedByStaff: { select: { id: true, name: true } },
        loginCodeRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }],
    });
    const rows = devices.map((d) => {
      const last = d.loginCodeRequests[0];
      const lastLogin = d.lastSeenAt ?? last?.createdAt ?? null;
      return {
        id: d.id,
        staff: { id: d.staff.id, code: d.staff.code, name: d.staff.name, role: d.staff.role },
        label: d.label,
        platform: d.platform,
        status: d.status,
        lastLoginAt: lastLogin ? lastLogin.toISOString() : null,
        oddHour: lastLogin ? isOddHourIst(lastLogin) : false,
        requestedAt: d.requestedAt?.toISOString() ?? null,
        approvedAt: d.approvedAt?.toISOString() ?? null,
        approvedBy: d.approvedByStaff?.name ?? null,
      };
    });
    return {
      rows,
      summary: {
        approved: rows.filter((r) => r.status === 'approved').length,
        pending: rows.filter((r) => r.status === 'pending').length,
        revoked: rows.filter((r) => r.status === 'revoked').length,
        oddHour: rows.filter((r) => r.status !== 'revoked' && r.oddHour).length,
      },
      codesToday: await this.codesGiven(istStartOfDay(istDayKey(now)), now),
    };
  }

  private async codesGiven(from: Date, to: Date) {
    const rows = await this.prisma.loginCodeRequest.findMany({
      where: { revealedAt: { gte: from, lte: to } },
      include: {
        staff: { select: { id: true, name: true, code: true } },
        revealedByStaff: { select: { id: true, name: true, role: true } },
        staffDevice: { select: { label: true } },
      },
      orderBy: { revealedAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      at: (r.revealedAt as Date).toISOString(),
      givenBy: r.revealedByStaff ? { id: r.revealedByStaff.id, name: r.revealedByStaff.name, role: r.revealedByStaff.role } : null,
      to: { id: r.staff.id, name: r.staff.name, code: r.staff.code },
      device: r.staffDevice.label,
      used: Boolean(r.usedAt),
    }));
  }

  /** C-LoginCodes: tiles, locked accounts, invites not accepted and every code given in the period. */
  async access(now: Date, from?: Date, to?: Date) {
    const dayStart = istStartOfDay(istDayKey(now));
    const [waiting, locked, invites, codes, codesTodayCount] = await Promise.all([
      this.prisma.loginCodeRequest.count({ where: { status: 'pending', expiresAt: { gt: now } } }),
      this.prisma.staff.findMany({
        where: { status: { not: 'deactivated' }, lockedUntil: { gt: now } },
        select: { id: true, code: true, name: true, role: true, lockedUntil: true, lockedReason: true, failedLoginCount: true, lockedByStaffId: true, updatedAt: true },
        orderBy: { lockedUntil: 'desc' },
      }),
      this.prisma.staff.findMany({
        where: { status: 'pending_invite' },
        select: { id: true, code: true, name: true, role: true, inviteExpiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.codesGiven(from ?? dayStart, to ?? now),
      this.prisma.loginCodeRequest.count({ where: { revealedAt: { gte: dayStart, lte: now } } }),
    ]);
    return {
      summary: {
        waiting,
        codesToday: codesTodayCount,
        locked: locked.length,
        invitesPending: invites.length,
      },
      locked: locked.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        role: s.role,
        lockedUntil: (s.lockedUntil as Date).toISOString(),
        reason: s.lockedReason ?? (s.lockedByStaffId ? 'Locked by a manager' : `${s.failedLoginCount} wrong passwords`),
        byManager: Boolean(s.lockedByStaffId),
      })),
      invites: invites.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        role: s.role,
        invitedAt: s.createdAt.toISOString(),
        expired: s.inviteExpiresAt ? s.inviteExpiresAt.getTime() <= now.getTime() : true,
      })),
      codes,
    };
  }

  private async achievedFor(staff: { id: string; role: string }, m: Month, now: Date) {
    if (staff.role === 'call_agent') {
      const r = await this.callMetrics.getCallAgentMetrics(staff.id, m.year, m.month, undefined, now);
      return { main: r.metrics.candidatesActivated, second: r.metrics.vacanciesCaptured, refundRate: r.metrics.refundRate };
    }
    const r = await this.fieldMetrics.getFieldAgentMetrics(staff.id, m.year, m.month, undefined, now);
    return { main: r.metrics.placementsClosed, second: r.metrics.repeatBusinesses, refundRate: null };
  }

  /**
   * C-Team-Targets and C-Leaderboard: every agent's target for the month, what
   * they achieved, progress and pace. Ranked on results that make money —
   * activations and placements — never on calls dialled (guide, Targets).
   */
  async targetsBoard(m: Month, now: Date) {
    const agents = await this.prisma.staff.findMany({
      // Owner accounts are left out of targets and the leaderboard (owner decision 14 Nov).
      where: { role: { in: AGENT_ROLES }, status: { not: 'deactivated' }, ...NOT_OWNER_ACCOUNT },
      select: { id: true, code: true, name: true, role: true, teamLeadId: true, reportsToId: true, status: true },
      orderBy: { code: 'asc' },
    });
    const leadIds = [...new Set(agents.map((a) => a.teamLeadId ?? a.reportsToId).filter((x): x is string => Boolean(x)))];
    const leads = leadIds.length ? await this.prisma.staff.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, teamName: true } }) : [];
    const targets = await this.prisma.target.findMany({ where: { year: m.year, month: m.month } });
    const { start, end } = this.monthBounds(m);
    const isCurrent = now.getTime() >= start.getTime() && now.getTime() <= end.getTime();
    const daysInMonth = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
    const dayOfMonth = isCurrent ? Number(istDayKey(now).slice(8, 10)) : now.getTime() > end.getTime() ? daysInMonth : 0;
    const rows = [];
    for (const agent of agents) {
      const target = targets.find((t) => t.staffId === agent.id) ?? null;
      const achieved = now.getTime() < start.getTime() ? { main: 0, second: 0, refundRate: null } : await this.achievedFor(agent, m, now);
      const mainTarget = agent.role === 'call_agent' ? (target?.candidatesActivated ?? null) : (target?.placementsClosed ?? null);
      const secondTarget = agent.role === 'call_agent' ? (target?.vacanciesCaptured ?? null) : (target?.repeatBusinesses ?? null);
      let feesPaise: number | null = null;
      if (agent.role === 'field_agent') {
        const fees = await this.prisma.placement.aggregate({
          where: { createdByStaffId: agent.id, paidAt: { gte: start, lte: end } },
          _sum: { placementFee: true },
        });
        feesPaise = fees._sum.placementFee ?? 0;
      }
      const lead = leads.find((l) => l.id === (agent.teamLeadId ?? agent.reportsToId));
      rows.push({
        staff: { id: agent.id, code: agent.code, name: agent.name, role: agent.role },
        team: teamLabel(lead ?? null),
        targetId: target?.id ?? null,
        target: target
          ? {
              candidatesActivated: target.candidatesActivated,
              vacanciesCaptured: target.vacanciesCaptured,
              refundRate: target.refundRate,
              placementsClosed: target.placementsClosed,
              replacementsInside15Days: target.replacementsInside15Days,
              repeatBusinesses: target.repeatBusinesses,
            }
          : null,
        main: { achieved: achieved.main, target: mainTarget },
        second: { achieved: achieved.second, target: secondTarget },
        feesPaise,
        progressPercent: mainTarget ? percent(achieved.main, mainTarget) : null,
        pace: paceFor(achieved.main, mainTarget, dayOfMonth, daysInMonth),
      });
    }
    const ranked = [...rows].sort((a, b) => {
      const pa = a.progressPercent ?? -1;
      const pb = b.progressPercent ?? -1;
      return b.main.achieved - a.main.achieved || pb - pa || a.staff.code.localeCompare(b.staff.code);
    });
    return {
      year: m.year,
      month: m.month,
      dayOfMonth,
      daysInMonth,
      rows,
      leaderboard: ranked.map((r, i) => ({ position: i + 1, ...r })),
      summary: {
        agents: rows.length,
        withTarget: rows.filter((r) => r.target).length,
        behind: rows.filter((r) => r.pace === 'behind').length,
      },
    };
  }

  /**
   * C-Leaderboard for Today / This week / Custom: the same money-making
   * results as the month board, counted inside the range — call agents by
   * candidates activated (₹499 received) and vacancies captured, field agents
   * by placements closed (joined and paid) and fees paid. No targets: those
   * are monthly. Never calls dialled.
   */
  async leaderboardRange(range: { from: Date; to: Date }) {
    const agents = await this.prisma.staff.findMany({
      // Owner accounts are left out of the leaderboard (owner decision 14 Nov).
      where: { role: { in: AGENT_ROLES }, status: { not: 'deactivated' }, ...NOT_OWNER_ACCOUNT },
      select: { id: true, code: true, name: true, role: true, teamLeadId: true, reportsToId: true },
      orderBy: { code: 'asc' },
    });
    const ids = agents.map((a) => a.id);
    const leadIds = [...new Set(agents.map((a) => a.teamLeadId ?? a.reportsToId).filter((x): x is string => Boolean(x)))];
    const within = { gte: range.from, lte: range.to };
    const [leads, activated, vacancies, closed, fees] = await Promise.all([
      leadIds.length ? this.prisma.staff.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, teamName: true } }) : [],
      this.prisma.jobSeeker.groupBy({ by: ['registeredByStaffId'], where: { registeredByStaffId: { in: ids }, paymentReceivedAt: within }, _count: { _all: true } }),
      this.prisma.vacancy.groupBy({ by: ['capturedByStaffId'], where: { capturedByStaffId: { in: ids }, createdAt: within }, _count: { _all: true } }),
      this.prisma.placement.groupBy({ by: ['createdByStaffId'], where: { createdByStaffId: { in: ids }, joinedDate: within, paidAt: { not: null } }, _count: { _all: true } }),
      this.prisma.placement.groupBy({ by: ['createdByStaffId'], where: { createdByStaffId: { in: ids }, paidAt: within }, _sum: { placementFee: true } }),
    ]);
    const count = (rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string, id: string) =>
      rows.find((r) => r[key] === id)?._count._all ?? 0;
    const rows = agents.map((agent) => {
      const call = agent.role === 'call_agent';
      const lead = leads.find((l) => l.id === (agent.teamLeadId ?? agent.reportsToId));
      return {
        staff: { id: agent.id, code: agent.code, name: agent.name, role: agent.role },
        team: teamLabel(lead ?? null),
        targetId: null,
        target: null,
        main: { achieved: call ? count(activated, 'registeredByStaffId', agent.id) : count(closed, 'createdByStaffId', agent.id), target: null },
        second: { achieved: call ? count(vacancies, 'capturedByStaffId', agent.id) : 0, target: null },
        feesPaise: call ? null : (fees.find((f) => f.createdByStaffId === agent.id)?._sum.placementFee ?? 0),
        progressPercent: null,
        pace: 'no_target' as const,
      };
    });
    const ranked = [...rows].sort((a, b) => b.main.achieved - a.main.achieved || a.staff.code.localeCompare(b.staff.code));
    return { from: range.from.toISOString(), to: range.to.toISOString(), leaderboard: ranked.map((r, i) => ({ position: i + 1, ...r })) };
  }

  private monthBounds(m: Month) {
    const key = `${m.year}-${String(m.month).padStart(2, '0')}-01`;
    const start = istStartOfDay(key);
    const nextIdx = m.year * 12 + m.month;
    const nextKey = `${Math.floor(nextIdx / 12)}-${String((nextIdx % 12) + 1).padStart(2, '0')}-01`;
    return { start, end: new Date(istStartOfDay(nextKey).getTime() - 1) };
  }

  /**
   * "Copy from November": every agent with a target in `from` and none in `to`
   * gets the same numbers for `to`, through the normal target rules (CEO or
   * Manager only; past months refused by TargetService). Existing targets for
   * `to` are left alone.
   */
  async copyTargets(actor: JwtPayload, body: { fromYear?: unknown; fromMonth?: unknown; toYear?: unknown; toMonth?: unknown }, now: Date) {
    const from = parseMonth(body?.fromYear, body?.fromMonth, now);
    const to = parseMonth(body?.toYear, body?.toMonth, now);
    if (from.year === to.year && from.month === to.month) throw new BadRequestException('Pick two different months');
    const [source, existing] = await Promise.all([
      this.prisma.target.findMany({ where: { year: from.year, month: from.month, staff: { status: { not: 'deactivated' }, ...NOT_OWNER_ACCOUNT } } }),
      this.prisma.target.findMany({ where: { year: to.year, month: to.month }, select: { staffId: true } }),
    ]);
    const have = new Set(existing.map((t) => t.staffId));
    let copied = 0;
    const skipped: { staffId: string; reason: string }[] = [];
    for (const t of source) {
      if (have.has(t.staffId)) {
        skipped.push({ staffId: t.staffId, reason: 'already has a target' });
        continue;
      }
      await this.targets.setTarget(
        {
          staffId: t.staffId,
          year: to.year,
          month: to.month,
          candidatesActivated: t.candidatesActivated,
          refundRate: t.refundRate,
          vacanciesCaptured: t.vacanciesCaptured,
          placementsClosed: t.placementsClosed,
          replacementsInside15Days: t.replacementsInside15Days,
          repeatBusinesses: t.repeatBusinesses,
        },
        actor.sub,
        now,
        actor,
      );
      copied += 1;
    }
    return { copied, skipped, from, to };
  }
}


