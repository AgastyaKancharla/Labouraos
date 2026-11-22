export class LoginDto {
  staffCode?: string;
  password?: string;
  /** Required for every role. */
  deviceId?: string;
  /** CEO, Manager, Finance and Team Lead: the code from their own authenticator. */
  totpCode?: string;
  /**
   * The app signing in: 'office' (app.laboura.com) or 'field' (Laboura Field).
   * Each app accepts only its own roles; see src/common/auth/staff-app.ts.
   */
  app?: string;
  /**
   * Accepted on the body only so a request that still sends an email can be
   * refused. It is never used to find an account.
   */
  email?: string;  /** Laboura Field: the phone's location, kept on the attendance day that opens at this sign-in (22 Nov). Optional. */
  latitude?: number;
  longitude?: number;
}

export class VerifyLoginCodeDto {
  loginRequestId?: string;
  code?: string;
  /** The same device id the login was started with. */
  deviceId?: string;
  /** From the `awaiting_code` answer: only the sign-in that asked has it. */
  loginRequestProof?: string;
  /** The same app the login was started from ('office' or 'field'). */
  app?: string;
  /** Laboura Field: the phone's location, kept on the attendance day that opens at this sign-in (22 Nov). Optional. */
  latitude?: number;
  longitude?: number;
}

export class LoginResponseDto {
  accessToken!: string;
  sessionId?: string;
  /**
   * Laboura Field (field agents) only: restores the session when the app is
   * reopened, through POST /auth/field/refresh. Single use; rotated on refresh.
   */
  refreshToken?: string;
  /**
   * Shown once, at the first sign-in after a password reset: "Your password
   * was reset on … approved by …".
   */
  passwordResetNotice?: PasswordResetNotice;
  staff!: {
    id: string;
    code: string;
    name: string;
    email: string | null;
    role: string;
  };
}

export interface PasswordResetNotice {
  /** When the reset finished (ISO time). */
  at: string;
  /** Who approved it (gave the temporary password or revealed the reset code); null for the server command. */
  byName: string | null;
  byRole: string | null;
  /** temp_password, full_reset, reactivation, break_glass or senior_code. */
  how: string;
}

/**
 * First sign-in with a temporary password (rev 174–175): no session. The
 * set-up ticket opens the set-up steps only (selfie, new password twice,
 * authenticator for authenticator roles), for 15 minutes, on this device.
 */
export class SetupRequiredResponseDto {
  status!: 'setup_required';
  setupTicket!: string;
  expiresAt!: Date;
  staff!: { code: string; name: string; role: string };
  /** No staff photo yet (or the CEO asked for a new one): a live selfie first. */
  photoRequired!: boolean;
  /** CEO, Manager, Finance or Team Lead without an authenticator yet: set it up in this step. */
  authenticatorSetupRequired!: boolean;
  /** Authenticator already on (a reset that keeps it): type a code from it to finish. */
  authenticatorCodeRequired!: boolean;
  passwordRules!: { minLength: number; maxBytes: number };
  /** Field agents sign in on Laboura Field; everyone else on the web sign-in. */
  signInAt!: 'field_app' | 'web';
}

/** Call agents and field agents, after the device check. No token yet. */
export class AwaitingCodeResponseDto {
  status!: 'awaiting_code';
  loginRequestId!: string;
  /** Send back with the code, with the same deviceId: the code works only for this device and sign-in. */
  loginRequestProof!: string;
  expiresAt!: Date;
  /** Who reads the code out: the agent's Team Lead, or a CEO for an owner account that reports to a CEO. */
  codeFrom!: 'team_lead' | 'ceo';
}

export type LoginResult = LoginResponseDto | AwaitingCodeResponseDto | SetupRequiredResponseDto;

export class FieldRefreshDto {
  sessionId?: string;
  refreshToken?: string;
  deviceId?: string;
}
