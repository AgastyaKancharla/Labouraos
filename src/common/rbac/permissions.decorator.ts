import { SetMetadata } from '@nestjs/common';
import { Resource, Action } from './rbac.types';

export const PERMISSION_METADATA_KEY = 'rbac_permission';

/** The kinds of record a scoped rule (own team, own account, own lead) can be checked against. */
export type TargetKind =
  | 'job_seeker'
  | 'job_seeker_hit'
  | 'referral'
  | 'business'
  | 'vacancy'
  | 'placement';

/**
 * Where the record a request acts on comes from: a route parameter
 * (`param:id`), a body field (`body:jobSeekerId`), every entry of a body array
 * (`body:jobSeekerIds[]`) or a query value (`query:jobSeekerId`).
 */
export type TargetSource = `param:${string}` | `body:${string}` | `query:${string}`;

export interface PermissionTarget {
  kind: TargetKind;
  from: TargetSource;
}

/**
 * The record RbacGuard checks a scoped rule against:
 * - a PermissionTarget: that record;
 * - 'none': the route acts on no single record (a list the service scopes, or
 *   a create);
 * - 'service': the route's id is not one of the kinds above and the service
 *   applies the scope itself (say so in a comment on the route).
 * Left out, RbacGuard reads it from the declared route pattern
 * (/job-seekers/:id…, /businesses/:id…, /vacancies/:id…). A route with a
 * parameter that matches none of those is refused for scoped roles (fail
 * closed), so a new route cannot skip the team check by accident.
 */
export type PermissionTargetSpec = PermissionTarget | PermissionTarget[] | 'none' | 'service';

export interface RequiredPermission {
  resource: Resource;
  action?: Action;
  target?: PermissionTargetSpec;
}

export const RequirePermission = (resource: Resource, action?: Action, target?: PermissionTargetSpec) =>
  SetMetadata(PERMISSION_METADATA_KEY, { resource, action, target });
