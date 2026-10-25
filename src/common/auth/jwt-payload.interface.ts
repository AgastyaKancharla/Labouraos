export interface JwtPayload {
  sub: string; // staff id
  role: string; // staff role
  email: string;
  code: string;
  area?: string | null;
  teamLeadId?: string | null;
  sid?: string; // staff session id
  /**
   * Set on tokens issued without a TOTP check (account not yet enrolled).
   * Such a token is only accepted by routes marked @AllowTotpSetupScope().
   */
  scope?: 'totp_setup';
}
