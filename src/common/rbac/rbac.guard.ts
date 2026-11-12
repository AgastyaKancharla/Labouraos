import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload.interface';
import {
  Action,
  RBAC_MATRIX,
  Role,
} from './rbac.types';
import {
  PERMISSION_METADATA_KEY,
  RequiredPermission,
} from './permissions.decorator';
import { ROLES_METADATA_KEY } from './roles.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission =
      this.reflector.getAllAndOverride<RequiredPermission>(
        PERMISSION_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );

    const requiredRoles =
      this.reflector.getAllAndOverride<Role[]>(
        ROLES_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requiredPermission && !requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;

    if (!user || !user.role) {
      throw new UnauthorizedException('Authentication required');
    }

    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(user.role as Role)) {
        throw new ForbiddenException(
          `Role '${user.role}' is not permitted to perform this action`,
        );
      }
    }

    if (!requiredPermission) {
      return true;
    }

    const method = request.method.toUpperCase();
    const action: Action =
      requiredPermission.action ??
      (method === 'GET' || method === 'HEAD' ? 'read' : 'write');

    const roleRule = RBAC_MATRIX[user.role as Role]?.[requiredPermission.resource]?.[action];

    if (
      user.role === 'field_agent' &&
      requiredPermission.resource === 'business' &&
      action === 'write' &&
      request.method.toUpperCase() === 'POST' &&
      /^\/?businesses\/?$/.test(request.path)
    ) {
      return true;
    }
    if (
      user.role === 'call_agent' &&
      requiredPermission.resource === 'business' &&
      action === 'write' &&
      request.method.toUpperCase() === 'POST' &&
      /^\/?businesses\/?$/.test(request.path)
    ) {
      return true;
    }

    if (!roleRule || !roleRule.allowed) {
      throw new ForbiddenException(
        `Role '${user.role}' is not permitted to perform '${action}' on '${requiredPermission.resource}'`,
      );
    }

    // Enforce Scope
    if (roleRule.scope === 'all') {
      return true;
    }

    if (roleRule.scope === 'own_account' || roleRule.scope === 'own_lead') {
      const business = await this.getBusinessForRequest(requiredPermission.resource, request);
      if (!business) {
        throw new ForbiddenException('Access denied: business could not be resolved for this write');
      }
      if (roleRule.scope === 'own_lead') {
        if (
          user.role !== 'call_agent' ||
          business.leadCreatedByStaffId !== user.sub ||
          business.verificationStatus !== 'lead'
        ) {
          throw new ForbiddenException('Call agents may only edit leads they created while they remain leads');
        }
      } else if (business.accountAgentId !== user.sub) {
        const isBusinessWrite = requiredPermission.resource === 'business';
        const leadException =
          isBusinessWrite &&
          business.leadCreatedByStaffId === user.sub &&
          ['lead', 'pending_visit'].includes(business.verificationStatus ?? '');
        const visitException = isBusinessWrite
          ? await this.prisma.visitAssignment.findFirst({
              where: {
                businessId: business.id,
                assignedStaffId: user.sub,
                status: 'assigned',
              },
              select: { id: true },
            })
          : null;
        if (!leadException && !visitException) {
          throw new ForbiddenException('Access denied: business is outside your account');
        }
      }
    }

    if (roleRule.scope === 'own_team') {
      // M3: a Team Lead reads the job seekers their own team registered
      // (themselves or an agent who reports to them), not the city's. Writes
      // keep the service's own rule ("only the team lead of the team that
      // created this record can edit it").
      if (requiredPermission.resource === 'job_seeker' && action === 'read') {
        const seeker = await this.getJobSeekerForRequest(request);
        if (seeker) {
          const registeredBy = seeker.registeredByStaffId;
          const inTeam =
            registeredBy === user.sub ||
            (registeredBy
              ? await this.prisma.staff.findFirst({
                  where: { id: registeredBy, teamLeadId: user.sub },
                  select: { id: true },
                })
              : null);
          if (!inTeam) {
            throw new ForbiddenException('Access denied: job seeker is outside your team');
          }
          return true;
        }
      }
      if (['business', 'vacancy', 'placement'].includes(requiredPermission.resource)) {
        const business = await this.getBusinessForRequest(requiredPermission.resource, request);
        if (business) {
          const staffIds = [business.accountAgentId, business.leadCreatedByStaffId]
            .filter((id): id is string => Boolean(id));
          const belongsToTeam = staffIds.length
            ? await this.prisma.staff.findFirst({
                where: { id: { in: staffIds }, teamLeadId: user.sub },
                select: { id: true },
              })
            : null;
          if (!belongsToTeam) {
            throw new ForbiddenException('Access denied: business is outside your team');
          }
          return true;
        }
      }
      const targetStaffId =
        (request.params?.staffId as string | undefined) ??
        (request.params?.id as string | undefined);

      if (targetStaffId && targetStaffId !== user.sub) {
        if (requiredPermission.resource === 'staff') {
          const targetStaff = await this.prisma.staff.findUnique({
            where: { id: targetStaffId },
            select: { teamLeadId: true },
          });

          if (!targetStaff || targetStaff.teamLeadId !== user.sub) {
            throw new ForbiddenException(
              `Access denied: staff '${targetStaffId}' is not part of your team`,
            );
          }
        } else if (requiredPermission.resource === 'target') {
          const staffIdParam = request.params?.staffId as string | undefined;
          if (staffIdParam) {
            const targetStaff = await this.prisma.staff.findUnique({
              where: { id: staffIdParam },
              select: { teamLeadId: true },
            });
            if (!targetStaff || targetStaff.teamLeadId !== user.sub) {
              throw new ForbiddenException(`Access denied: staff is not part of your team`);
            }
          } else {
            const target = await this.prisma.target.findUnique({
              where: { id: targetStaffId },
              include: { staff: { select: { teamLeadId: true } } },
            });

            if (!target || target.staff.teamLeadId !== user.sub) {
              throw new ForbiddenException(
                `Access denied: staff is not part of your team`,
              );
            }
          }
        }
      }
    }

    if (roleRule.scope === 'own_only') {
      const targetId =
        (request.params?.staffId as string | undefined) ??
        (request.params?.id as string | undefined);
      if (targetId && targetId !== user.sub) {
        if (requiredPermission.resource === 'staff') {
          throw new ForbiddenException('Access denied: can only access your own profile');
        } else if (requiredPermission.resource === 'target') {
          if (request.params?.staffId) {
            if (request.params.staffId !== user.sub) {
              throw new ForbiddenException('Access denied: can only access your own targets');
            }
          } else {
            const target = await this.prisma.target.findUnique({
              where: { id: targetId },
              select: { staffId: true },
            });

            if (!target || target.staffId !== user.sub) {
              throw new ForbiddenException('Access denied: can only access your own targets');
            }
          }
        } else {
          throw new ForbiddenException('Access denied: can only access your own profile');
        }
      }
    }

    return true;
  }

  /** The job seeker a /job-seekers/:id… request names (by id or JS- code), or null. */
  private async getJobSeekerForRequest(
    request: Request,
  ): Promise<{ id: string; registeredByStaffId: string | null } | null> {
    const id = (request.params as Record<string, string | undefined>)?.id;
    if (!id || !/^\/?job-seekers\//.test(request.path)) return null;
    return this.prisma.jobSeeker.findFirst({
      where: { OR: [{ id }, { code: id }] },
      select: { id: true, registeredByStaffId: true },
    });
  }

  private async getBusinessForRequest(
    resource: string,
    request: Request,
  ): Promise<{
    id: string;
    accountAgentId: string | null;
    leadCreatedByStaffId: string | null;
    verificationStatus: string | null;
  } | null> {
    const params = request.params as Record<string, string | undefined>;
    const path = request.path;
    const select = {
      id: true,
      accountAgentId: true,
      leadCreatedByStaffId: true,
      verificationStatus: true,
    } as const;
    if (resource === 'business') {
      const id = params.id ?? params.businessId;
      if (!id) return null;
      return this.prisma.business.findFirst({
        where: { OR: [{ id }, { code: id }] },
        select,
      });
    }
    if (resource === 'vacancy') {
      const businessId = path.startsWith('/businesses/')
        ? params.id ?? params.businessId
        : typeof request.body?.businessId === 'string'
          ? request.body.businessId
          : null;
      if (businessId) {
        return this.prisma.business.findFirst({
          where: { OR: [{ id: businessId }, { code: businessId }] },
          select,
        });
      }
      const vacancyId = params.id;
      if (!vacancyId) return null;
      const vacancy = await this.prisma.vacancy.findFirst({
        where: { OR: [{ id: vacancyId }, { code: vacancyId }] },
        select: { business: { select } },
      });
      return vacancy?.business ?? null;
    }
    if (resource === 'placement') {
      const entityId = params.id;
      if (!entityId) return null;
      if (path.includes('/vacancies/')) {
        const vacancy = await this.prisma.vacancy.findFirst({
          where: { OR: [{ id: entityId }, { code: entityId }] },
          select: { business: { select } },
        });
        return vacancy?.business ?? null;
      }
      const placement = await this.prisma.placement.findFirst({
        where: { OR: [{ id: entityId }, { code: entityId }] },
        select: { business: { select } },
      });
      return placement?.business ?? null;
    }
    return null;
  }
}
