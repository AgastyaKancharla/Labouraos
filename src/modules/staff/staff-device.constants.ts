export const STAFF_DEVICE_STATUSES = ['pending', 'approved', 'revoked'] as const;
export type StaffDeviceStatus = (typeof STAFF_DEVICE_STATUSES)[number];

/**
 * The CEO approves his own new device with his authenticator code in the
 * login flow; nobody else approves it (decided 11 Nov).
 */
export const SELF_APPROVED_DEVICE_ROLES = ['ceo'] as const;

/** A Manager's or Finance's new device is approved by the CEO (decided 11 Nov). */
export const CEO_APPROVED_DEVICE_ROLES = ['manager', 'finance'] as const;

/** Roles a Manager may approve devices for: anyone below Manager. */
export const BELOW_MANAGER_ROLES = ['team_lead', 'call_agent', 'field_agent'] as const;
