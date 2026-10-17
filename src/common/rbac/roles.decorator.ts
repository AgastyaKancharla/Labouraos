import { SetMetadata } from '@nestjs/common';
import { Role } from './rbac.types';

export const ROLES_METADATA_KEY = 'rbac_roles';

export const RequireRoles = (...roles: Role[]) =>
  SetMetadata(ROLES_METADATA_KEY, roles);
