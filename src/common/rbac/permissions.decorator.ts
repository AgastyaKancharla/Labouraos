import { SetMetadata } from '@nestjs/common';
import { Resource, Action } from './rbac.types';

export const PERMISSION_METADATA_KEY = 'rbac_permission';

export interface RequiredPermission {
  resource: Resource;
  action?: Action;
}

export const RequirePermission = (resource: Resource, action?: Action) =>
  SetMetadata(PERMISSION_METADATA_KEY, { resource, action });
