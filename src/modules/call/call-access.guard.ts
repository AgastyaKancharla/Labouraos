import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnTeam } from '../../common/rbac/own-team';

/**
 * Who may act on one call (/calls/:id, its outcome, notes and recording),
 * checked before the route runs (owner rule, Master Guide 14 Nov):
 * - the CEO and Managers: any call;
 * - a Team Lead: calls made by someone in their own team (OwnTeam);
 * - a call or field agent: only the calls they made themselves.
 * A call made by nobody (system) is for the CEO and Managers only. An unknown
 * id is left to the route, which answers 404. Runs after JwtAuthGuard and
 * RbacGuard, which check the token and the role list.
 */
@Injectable()
export class CallAccessGuard implements CanActivate {
  private readonly team: OwnTeam;

  constructor(private readonly prisma: PrismaService) {
    this.team = new OwnTeam(prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    const id = (request.params as Record<string, string | undefined>)?.id;
    if (!user || !id) return false;
    if (user.role === 'ceo' || user.role === 'manager') return true;

    const call = await this.prisma.callRecord.findUnique({ where: { id }, select: { staffId: true } });
    if (!call) return true;
    if (call.staffId && call.staffId === user.sub) return true;
    if (user.role === 'team_lead' && (await this.team.includes(user.sub, call.staffId))) return true;
    throw new ForbiddenException(
      user.role === 'team_lead'
        ? 'Access denied: this call was made outside your team'
        : 'Access denied: you can only open calls you made',
    );
  }
}

/**
 * Placing a call (POST /calls): a Team Lead calls only their own team's job
 * seekers, partners and businesses (owner rule, Master Guide 14 Nov). Agents,
 * Managers and the CEO keep their reach (agents call city-wide, role table).
 * A missing or unknown subject is left to the route (400 / 404).
 */
@Injectable()
export class CallPlaceGuard implements CanActivate {
  private readonly team: OwnTeam;

  constructor(private readonly prisma: PrismaService) {
    this.team = new OwnTeam(prisma);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) return false;
    if (user.role !== 'team_lead') return true;
    const body = (request.body ?? {}) as { subjectType?: unknown; subjectId?: unknown };
    const ref = typeof body.subjectId === 'string' ? body.subjectId : undefined;
    if (!ref) return true;
    const where = { OR: [{ id: ref }, { code: ref }] };
    let owners: Array<string | null> | null = null;
    if (body.subjectType === 'job_seeker') {
      const seeker = await this.prisma.jobSeeker.findFirst({ where, select: { registeredByStaffId: true } });
      owners = seeker ? [seeker.registeredByStaffId] : null;
    } else if (body.subjectType === 'referral') {
      const partner = await this.prisma.referral.findFirst({ where, select: { registeredByStaffId: true } });
      owners = partner ? [partner.registeredByStaffId] : null;
    } else if (body.subjectType === 'business') {
      const business = await this.prisma.business.findFirst({
        where,
        select: { accountAgentId: true, leadCreatedByStaffId: true },
      });
      owners = business ? [business.accountAgentId, business.leadCreatedByStaffId] : null;
    } else {
      return true; // the route refuses an unknown subject type
    }
    if (owners === null) return true;
    if (await this.team.includesAny(user.sub, owners)) return true;
    throw new ForbiddenException('Access denied: you can only call your own team’s people and businesses');
  }
}
