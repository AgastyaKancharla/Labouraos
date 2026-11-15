/** Minimum password length for everyone (Master Guide rev 174–175: 8 characters). */
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt silently ignores bytes beyond 72, so longer passwords are rejected. */
export const MAX_PASSWORD_BYTES = 72;

/** The password rules a new password must meet; null when it does. */
export function passwordRuleProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  }
  return null;
}

export const PASSWORD_RULES = { minLength: MIN_PASSWORD_LENGTH, maxBytes: MAX_PASSWORD_BYTES } as const;
