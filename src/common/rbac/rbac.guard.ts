import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload.interface';
import {
  Action,
  RBAC_MATRIX,
  Resource,
  Role,
} from './rbac.types';
import {
  PERMISSION_METADATA_KEY,
  PermissionTarget,
  PermissionTargetSpec,
  RequiredPermission,
  TargetKind,
  TargetSource,
} from './permissions.decorator';
import { OwnTeam } from './own-team';
import { ROLES_METADATA_KEY } from './roles.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly team: OwnTeam;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    this.team = new OwnTeam(prisma);
  }

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
      declaredPath(request) === '/businesses'
    ) {
      return true;
    }
    if (
      user.role === 'call_agent' &&
      requiredPermission.resource === 'business' &&
      action === 'write' &&
      request.method.toUpperCase() === 'POST' &&
      declaredPath(request) === '/businesses'
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

    // Own team / own account / own lead on a record: checked against the
    // record the route declares (RequirePermission target, or the declared
    // route pattern), never the raw URL, whose letter case and shape the
    // caller controls. A route with an id this cannot place is refused.
    if (
      ENTITY_RESOURCES.includes(requiredPermission.resource) &&
      (roleRule.scope === 'own_team' || roleRule.scope === 'own_account' || roleRule.scope === 'own_lead')
    ) {
      return this.checkRecordScope(user, requiredPermission, roleRule.scope, action, request);
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

  /** Applies an own-team, own-account or own-lead rule to the record(s) the route acts on. */
  private async checkRecordScope(
    user: JwtPayload,
    permission: RequiredPermission,
    scope: 'own_team' | 'own_account' | 'own_lead',
    action: Action,
    request: Request,
  ): Promise<boolean> {
    const spec = targetFor(permission, declaredPath(request));
    if (spec === null) {
      throw new ForbiddenException('Access denied: this route has no team or account check for your role');
    }
    if (spec === 'service') {
      return true;
    }
    if (spec === 'none') {
      if (scope === 'own_team') return true; // a list the service scopes, or a create
      throw new ForbiddenException('Access denied: business could not be resolved for this write');
    }
    for (const target of Array.isArray(spec) ? spec : [spec]) {
      // A job seeker or partner named on another kind of route (say, the
      // candidates shown on a vacancy) is checked by the role's own rule for
      // job seekers or partners: city-wide for agents, own team for a Team Lead.
      const kindResource = KIND_RESOURCE[target.kind];
      let targetScope: string = scope;
      if (kindResource && kindResource !== permission.resource) {
        const rule = RBAC_MATRIX[user.role as Role]?.[kindResource]?.[action];
        if (!rule?.allowed) {
          throw new ForbiddenException(`Role '${user.role}' is not permitted to perform '${action}' on '${kindResource}'`);
        }
        if (rule.scope === 'all') continue;
        targetScope = rule.scope;
      }
      if (targetScope !== 'own_team' && targetScope !== 'own_account' && targetScope !== 'own_lead') {
        throw new ForbiddenException('Access denied: this record is outside your scope');
      }
      const { values, many } = readSource(request, target.from);
      if (values.length === 0) {
        if (many) continue; // an empty list names nobody; the route validates it
        throw new ForbiddenException('Access denied: the record this request acts on was not named');
      }
      for (const value of values) {
        await this.checkOneRecord(user, target.kind, value, targetScope, permission.resource);
      }
    }
    return true;
  }

  private async checkOneRecord(
    user: JwtPayload,
    kind: TargetKind,
    ref: string,
    scope: 'own_team' | 'own_account' | 'own_lead',
    resource: string,
  ): Promise<void> {
    if (kind === 'job_seeker' || kind === 'job_seeker_hit') {
      const seeker = await this.loadJobSeeker(kind, ref);
      if (!seeker) {
        throw new NotFoundException(kind === 'job_seeker' ? `Job seeker '${ref}' not found` : `Job seeker hit '${ref}' not found`);
      }
      if (scope !== 'own_team' || !(await this.team.includes(user.sub, seeker.registeredByStaffId))) {
        throw new ForbiddenException('Access denied: job seeker is outside your own team');
      }
      return;
    }
    if (kind === 'referral') {
      const partner = await this.prisma.referral.findFirst({
        where: { OR: [{ id: ref }, { code: ref }] },
        select: { registeredByStaffId: true },
      });
      // The partner read answers 404 for a partner outside the team, so
      // every other action on it does too.
      if (!partner || scope !== 'own_team' || !(await this.team.includes(user.sub, partner.registeredByStaffId))) {
        throw new NotFoundException(`Referral partner '${ref}' not found`);
      }
      return;
    }

    const business = await this.loadBusiness(kind, ref);
    if (!business) {
      if (scope === 'own_team') {
        throw new NotFoundException(`${kind === 'business' ? 'Business' : kind === 'vacancy' ? 'Vacancy' : 'Placement'} '${ref}' not found`);
      }
      throw new ForbiddenException('Access denied: business could not be resolved for this write');
    }
    if (scope === 'own_team') {
      if (!(await this.team.includesAny(user.sub, [business.accountAgentId, business.leadCreatedByStaffId]))) {
        throw new ForbiddenException('Access denied: business is outside your team');
      }
      return;
    }
    if (scope === 'own_lead') {
      if (
        user.role !== 'call_agent' ||
        business.leadCreatedByStaffId !== user.sub ||
        business.verificationStatus !== 'lead'
      ) {
        throw new ForbiddenException('Call agents may only edit leads they created while they remain leads');
      }
      return;
    }
    // own_account
    if (business.accountAgentId === user.sub) return;
    const isBusinessWrite = resource === 'business';
    const leadException =
      isBusinessWrite &&
      business.leadCreatedByStaffId === user.sub &&
      ['lead', 'pending_visit'].includes(business.verificationStatus ?? '');
    const visitException = isBusinessWrite
      ? await this.prisma.visitAssignment.findFirst({
          where: { businessId: business.id, assignedStaffId: user.sub, status: 'assigned' },
          select: { id: true },
        })
      : null;
    if (!leadException && !visitException) {
      throw new ForbiddenException('Access denied: business is outside your account');
    }
  }

  private async loadJobSeeker(
    kind: 'job_seeker' | 'job_seeker_hit',
    ref: string,
  ): Promise<{ id: string; registeredByStaffId: string | null } | null> {
    const select = { id: true, registeredByStaffId: true } as const;
    if (kind === 'job_seeker') {
      return this.prisma.jobSeeker.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select });
    }
    const hit = await this.prisma.jobSeekerHit.findUnique({ where: { id: ref }, select: { jobSeeker: { select } } });
    return hit?.jobSeeker ?? null;
  }

  /** The business a business, vacancy or placement reference belongs to. */
  private async loadBusiness(
    kind: 'business' | 'vacancy' | 'placement' | TargetKind,
    ref: string,
  ): Promise<{
    id: string;
    accountAgentId: string | null;
    leadCreatedByStaffId: string | null;
    verificationStatus: string | null;
  } | null> {
    const select = {
      id: true,
      accountAgentId: true,
      leadCreatedByStaffId: true,
      verificationStatus: true,
    } as const;
    const where = { OR: [{ id: ref }, { code: ref }] };
    if (kind === 'business') {
      return this.prisma.business.findFirst({ where, select });
    }
    if (kind === 'vacancy') {
      const vacancy = await this.prisma.vacancy.findFirst({ where, select: { business: { select } } });
      return vacancy?.business ?? null;
    }
    if (kind === 'placement') {
      const placement = await this.prisma.placement.findFirst({ where, select: { business: { select } } });
      return placement?.business ?? null;
    }
    return null;
  }
}

const ENTITY_RESOURCES: readonly string[] = ['job_seeker', 'referral', 'business', 'vacancy', 'placement'];

/** Kinds checked by their own resource's rule when they appear on another resource's route. */
const KIND_RESOURCE: Partial<Record<TargetKind, Resource>> = {
  job_seeker: 'job_seeker',
  job_seeker_hit: 'job_seeker',
  referral: 'referral',
};

/**
 * Where each declared route pattern's record comes from, for routes that do
 * not name it on RequirePermission. Matched against the pattern the route was
 * declared with (request.route.path), which the caller cannot change.
 */
const INFERRED_TARGETS: Array<[RegExp, PermissionTarget]> = [
  [/^\/job-seekers\/:id(\/|$)/, { kind: 'job_seeker', from: 'param:id' }],
  [/^\/job-seeker-hits\/:id(\/|$)/, { kind: 'job_seeker_hit', from: 'param:id' }],
  [/^\/referrals\/:id(\/|$)/, { kind: 'referral', from: 'param:id' }],
  [/^\/businesses\/:id(\/|$)/, { kind: 'business', from: 'param:id' }],
  [/^\/businesses\/:businessId(\/|$)/, { kind: 'business', from: 'param:businessId' }],
  [/^\/vacancies\/:id(\/|$)/, { kind: 'vacancy', from: 'param:id' }],
  [/^\/placements\/:id(\/|$)/, { kind: 'placement', from: 'param:id' }],
];

/** "/job-seekers/:id/status" from a declared pattern, whatever its slashes. */
export function normaliseRoutePath(path: string | undefined | null): string | undefined {
  if (typeof path !== 'string') return undefined;
  const joined = `/${path}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/** The pattern the matched route was declared with, or undefined. */
function declaredPath(request: Request): string | undefined {
  const route = (request as Request & { route?: { path?: unknown } }).route;
  return normaliseRoutePath(typeof route?.path === 'string' ? route.path : undefined);
}

/**
 * The record a scoped rule is checked against: the route's own declaration,
 * else the one its declared pattern implies, else 'none' for a pattern with no
 * parameter. null means a parameter nobody placed: the guard refuses.
 */
export function targetFor(
  permission: Pick<RequiredPermission, 'target'>,
  routePath: string | undefined,
): PermissionTargetSpec | null {
  if (permission.target) return permission.target;
  const path = normaliseRoutePath(routePath);
  if (!path) return null;
  for (const [pattern, target] of INFERRED_TARGETS) {
    if (pattern.test(path)) return target;
  }
  return path.includes(':') ? null : 'none';
}

function readSource(request: Request, from: TargetSource): { values: string[]; many: boolean } {
  const [where, rawName] = from.split(':') as ['param' | 'body' | 'query', string];
  const many = rawName.endsWith('[]');
  const name = many ? rawName.slice(0, -2) : rawName;
  const bag =
    where === 'param'
      ? (request.params as Record<string, unknown> | undefined)
      : where === 'query'
        ? (request.query as Record<string, unknown> | undefined)
        : (request.body as Record<string, unknown> | undefined);
  const raw = bag && typeof bag === 'object' ? bag[name] : undefined;
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw];
  if (!many && list.length > 1) {
    throw new ForbiddenException('Access denied: one record expected');
  }
  // Anything that is not a plain id (an object, a number) names no record
  // the check can place: refused rather than skipped.
  if (list.some((value) => typeof value !== 'string' || !value)) {
    throw new ForbiddenException('Access denied: the record this request acts on was not named');
  }
  return { values: [...new Set(list as string[])], many };
}
