/**
 * Reads LOGIN_CODE_SECRET. Throws if it is missing or shorter than 32 characters,
 * so a process that constructs the login-code service cannot start without it.
 */
export function getLoginCodeSecret(): string {
  const secret = process.env.LOGIN_CODE_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'LOGIN_CODE_SECRET environment variable is missing or empty. Server cannot start without a secure secret.',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `LOGIN_CODE_SECRET must be at least 32 characters long (received ${secret.length} characters).`,
    );
  }
  return secret;
}
