export interface JwtPayload {
  sub: string; // staff id
  role: string; // staff role
  email: string | null;
  code: string;
  teamLeadId?: string | null;
  sid?: string; // staff session id
  /** The app the session belongs to (office or field); a token works only in its own app. */
  app?: 'office' | 'field';
  /**
   * Set on tokens issued without a TOTP check (account not yet enrolled).
   * Such a token is only accepted by routes marked @AllowTotpSetupScope().
   */
  scope?: 'totp_setup';
}
