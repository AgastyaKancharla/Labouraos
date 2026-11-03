export const STAFF_DEVICE_STATUSES = ['pending', 'approved', 'revoked'] as const;
export type StaffDeviceStatus = (typeof STAFF_DEVICE_STATUSES)[number];

/** Devices for these roles are approved by the person themself in the login flow, never by someone else. */
export const SELF_APPROVED_DEVICE_ROLES = ['ceo', 'manager', 'finance'] as const;

/** Roles a Manager may approve devices for: anyone below Manager. */
export const BELOW_MANAGER_ROLES = ['team_lead', 'call_agent', 'field_agent'] as const;
