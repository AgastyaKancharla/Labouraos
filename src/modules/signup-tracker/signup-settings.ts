/**
 * Timing rules for unfinished app sign-ups (customer app proposal 4.2 and
 * questions 9 to 11, confirmed 14 Nov: "as settings the CEO can change").
 *
 * The numbers belong in the CEO's Settings (PricingPolicy), like every other
 * rule number. The PricingPolicy row does not have these columns yet (only
 * Agent A edits prisma/), so each one is read from the policy row under the
 * field name below when it exists, and falls back to the confirmed default
 * until then. When the columns are added with these names, the CEO's
 * Settings screen changes them with no code change here.
 */
export const SIGNUP_SETTING_DEFAULTS = {
  /** First reminder (push) this many minutes after they stop. */
  signupFirstReminderMinutes: 30,
  /** Second reminder this many minutes after they stop. */
  signupSecondReminderMinutes: 240,
  /** A business that stops gets a call task this many minutes after it stops. */
  signupBusinessCallMinutes: 240,
  /** A job seeker who stopped at payment (stage E) is called after this many working minutes. */
  signupPaymentStopWorkingMinutes: 120,
  /** Call tries before the sign-up is closed as "no response". */
  signupMaxCallTries: 3,
  /** The tries are spread over this many working days (one try a day). */
  signupCallTryDays: 3,
  /** A "no response" sign-up comes back on the re-engagement list after this many days. */
  signupReengageDays: 30,
  /**
   * This many stuck job seeker sign-ups in one area make one area task for the
   * Team Lead (proposal 4.2: "several stuck sign-ups sit in one area"). The
   * guide gives no number; 3 is a setting, not a rule.
   */
  signupAreaClusterMin: 3,
  /** A sign-up counts as "stuck" for the area task after this many hours without progress. */
  signupStuckHours: 24,
} as const;

export type SignupSettingKey = keyof typeof SIGNUP_SETTING_DEFAULTS;

export interface SignupSettings {
  firstReminderMinutes: number;
  secondReminderMinutes: number;
  businessCallMinutes: number;
  paymentStopWorkingMinutes: number;
  maxCallTries: number;
  callTryDays: number;
  reengageDays: number;
  areaClusterMin: number;
  stuckHours: number;
  /** Calling hours from Settings (guide: 09:00 to 21:00). */
  callingHoursStart: string;
  callingHoursEnd: string;
  /** The office working day from Settings (shiftStart / shiftEnd). */
  workdayStart: string;
  workdayEnd: string;
  /** Weekly days off, 0 = Sunday (Settings). Public holidays come from the Holiday table. */
  weeklyOffDays: number[];
}

/** The policy fields this file reads that exist today. */
export interface SignupPolicySource {
  callingHoursStart: string;
  callingHoursEnd: string;
  shiftStart: string;
  shiftEnd: string;
  weeklyOffDays: number[];
}

function positiveInt(source: object, key: SignupSettingKey): number {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : SIGNUP_SETTING_DEFAULTS[key];
}

/** The sign-up settings in force, from the current PricingPolicy row. */
export function signupSettingsFrom(policy: SignupPolicySource): SignupSettings {
  return {
    firstReminderMinutes: positiveInt(policy, 'signupFirstReminderMinutes'),
    secondReminderMinutes: positiveInt(policy, 'signupSecondReminderMinutes'),
    businessCallMinutes: positiveInt(policy, 'signupBusinessCallMinutes'),
    paymentStopWorkingMinutes: positiveInt(policy, 'signupPaymentStopWorkingMinutes'),
    maxCallTries: positiveInt(policy, 'signupMaxCallTries'),
    callTryDays: positiveInt(policy, 'signupCallTryDays'),
    reengageDays: positiveInt(policy, 'signupReengageDays'),
    areaClusterMin: positiveInt(policy, 'signupAreaClusterMin'),
    stuckHours: positiveInt(policy, 'signupStuckHours'),
    callingHoursStart: policy.callingHoursStart,
    callingHoursEnd: policy.callingHoursEnd,
    workdayStart: policy.shiftStart,
    workdayEnd: policy.shiftEnd,
    weeklyOffDays: policy.weeklyOffDays,
  };
}

/** Which settings are still read from the defaults (the column is missing). For the CEO view. */
export function missingSettingColumns(policy: object): SignupSettingKey[] {
  return (Object.keys(SIGNUP_SETTING_DEFAULTS) as SignupSettingKey[]).filter((key) => !(key in policy));
}
