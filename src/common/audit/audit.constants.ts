export const AUDIT_METADATA_KEY = 'audit_action_metadata';

export interface AuditMetadata {
  action: string;
  entityType: string;
  entityCodeField?: string; // defaults to 'code' on response object or param
}
