/**
 * Reads and validates the JWT secret from the environment.
 * Throws at startup if JWT_SECRET is unset or shorter than 32 characters (fail closed).
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is missing or empty. Server cannot start without a secure secret.',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `JWT_SECRET must be at least 32 characters long (received ${secret.length} characters).`,
    );
  }
  return secret;
}
