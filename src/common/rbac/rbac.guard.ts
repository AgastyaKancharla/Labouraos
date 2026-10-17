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

    if (!roleRule || !roleRule.allowed) {
      throw new ForbiddenException(
        `Role '${user.role}' is not permitted to perform '${action}' on '${requiredPermission.resource}'`,
      );
    }

    // Enforce Scope
    if (roleRule.scope === 'all') {
      return true;
    }

    if (roleRule.scope === 'own_area') {
      const targetArea =
        (request.params?.area as string | undefined) ??
        (request.query?.area as string | undefined) ??
        (request.body?.area as string | undefined);

      if (targetArea && targetArea !== user.area) {
        throw new ForbiddenException(
          `Access denied: entity is in area '${targetArea}' but user is restricted to area '${user.area}'`,
        );
      }

      // If entity ID is provided in route params, look up the entity's area in DB
      const entityId = request.params?.id as string | undefined;
      if (entityId) {
        let entityArea: string | null = null;
        if (requiredPermission.resource === 'business') {
          const business = await this.prisma.business.findUnique({
            where: { id: entityId },
            select: { area: true },
          });
          entityArea = business?.area ?? null;
        }

        if (entityArea && entityArea !== user.area) {
          throw new ForbiddenException(
            `Access denied: resource belongs to area '${entityArea}', not your area '${user.area}'`,
          );
        }
      }
    }

    if (roleRule.scope === 'own_team') {
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
        }
      }
    }

    if (roleRule.scope === 'own_only') {
      const targetId = request.params?.id as string | undefined;
      if (targetId && targetId !== user.sub) {
        throw new ForbiddenException('Access denied: can only access your own profile');
      }
    }

    return true;
  }
}
