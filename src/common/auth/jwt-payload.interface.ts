export interface JwtPayload {
  sub: string; // staff id
  role: string; // staff role
  email: string;
  code: string;
  area?: string | null;
  teamLeadId?: string | null;
}
