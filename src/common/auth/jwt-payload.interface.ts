export interface JwtPayload {
  sub: string; // staff id
  role: string; // staff role
  email: string | null;
  code: string;
  teamLeadId?: string | null;
  sid?: string; // staff session id
  /** The app the session belongs to (office or field); a token works only in its own app. */
  app?: 'office' | 'field';
}
