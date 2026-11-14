import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Who may act on one call (/calls/:id, its outcome, notes and recording),
 * checked before the route runs (owner rule, Master Guide 14 Nov):
 * - the CEO and Managers: any call;
 * - a Team Lead: their own calls and those made by the agents whose Team Lead
 *   they are;
 * - a call or field agent: only the calls they made themselves.
 * A call made by nobody (system) is for the CEO and Managers only. An unknown
 * id is left to the route, which answers 404. Runs after JwtAuthGuard and
 * RbacGuard, which check the token and the role list.
 */
@Injectable()
export class CallAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    const id = (request.params as Record<string, string | undefined>)?.id;
    if (!user || !id) return false;
    if (user.role === 'ceo' || user.role === 'manager') return true;

    const call = await this.prisma.callRecord.findUnique({ where: { id }, select: { staffId: true } });
    if (!call) return true;
    if (call.staffId && call.staffId === user.sub) return true;
    if (user.role === 'team_lead' && call.staffId) {
      const maker = await this.prisma.staff.findUnique({
        where: { id: call.staffId },
        select: { teamLeadId: true },
      });
      if (maker?.teamLeadId === user.sub) return true;
    }
    throw new ForbiddenException(
      user.role === 'team_lead'
        ? 'Access denied: this call was made outside your team'
        : 'Access denied: you can only open calls you made',
    );
  }
}
