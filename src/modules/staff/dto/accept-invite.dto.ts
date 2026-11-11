export class AcceptInviteDto {
  token!: string;
  password!: string;
  /**
   * CEO, Managers and Finance only: the first code from the authenticator app
   * set up on the invite page (POST /staff/accept-invite/authenticator). When
   * it is left out, the authenticator is set up at the first sign-in instead.
   */
  totpCode?: string;
}

export class InviteTokenDto {
  token!: string;
}
