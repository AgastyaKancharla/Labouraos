import { SetMetadata } from '@nestjs/common';
import { AUDIT_METADATA_KEY, AuditMetadata } from './audit.constants';

export const AuditAction = (
  action: string,
  entityType: string,
  entityCodeField = 'code',
) => SetMetadata(AUDIT_METADATA_KEY, { action, entityType, entityCodeField } as AuditMetadata);
