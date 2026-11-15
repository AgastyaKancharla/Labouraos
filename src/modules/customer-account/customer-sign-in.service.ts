import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { customerTestModeFields } from '../../common/customer-auth/customer-otp-test-mode';
import { parseIndianMobile } from '../../common/phone/indian-mobile';
import { CustomerAuthClock } from '../../common/customer-auth/customer-auth.clock';
import { CustomerTokenService } from '../../common/customer-auth/customer-token.service';
import {
  CUSTOMER_LANGUAGES,
  CUSTOMER_SESSION_DAYS,
  CUSTOMER_STEP_UP_MINUTES,
  CUSTOMER_STEP_UP_PURPOSES,
  CustomerStepUpPurpose,
} from '../../common/customer-auth/customer-app.constants';
import { CUSTOMER_ERROR_CODES, CustomerApiError, customerUnauthorized } from '../../common/customer-auth/customer-auth.errors';
import { AuditService } from '../../common/audit/audit.service';
import { CustomerAccountService } from './customer-account.service';
import { CustomerLinkingService, LinkedProfile } from './customer-linking.service';
import { customerPhoneHash, CustomerOtpLimiter, hashOf, OtpCaller } from './customer-otp-limiter.service';
import { AppleIdTokenVerifier, ExternalIdentity, GoogleIdTokenVerifier } from './google-id-token.verifier';
import { HUMAN_CHECK_PROVIDER, HumanCheckProvider } from './human-check.provider';

const DAY_MS = 24 * 60 * 60 * 1000;
/** OTP provider purposes for the customer realm (stored on the OTP session; never the staff ones). */
export const OTP_PURPOSE_SIGN_IN = 'customer_sign_in';
/** Adding a mobile to a Google or Apple account: bound to that account. */
export const OTP_PURPOSE_ADD_PHONE = 'customer_add_phone';
/** A fresh code for one sensitive action, bound to the account: customer_step_up:<action>. */
export function stepUpOtpPurpose(action: string): string {
  return `customer_step_up:${action}`;
}
/** Refresh grace: the token renewed in the last 30 seconds on the same phone (two renewals at once). */
const REFRESH_GRACE_MS = 30_000;

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  installationId?: string | null;
}

export interface DeviceInput {
  installationId?: unknown;
  platform?: unknown;
  appVersion?: unknown;
}

export type SignInNext = 'add_phone' | 'choose_role' | 'choose_profile' | 'home';

function bad(code: (typeof CUSTOMER_ERROR_CODES)[keyof typeof CUSTOMER_ERROR_CODES], message: string, status = HttpStatus.BAD_REQUEST, extra: Record<string, unknown> = {}) {
  return new CustomerApiError(status, code, message, extra);
}

function requirePhone(value: unknown): string {
  const phone = parseIndianMobile(value);
  if (!phone) throw bad(CUSTOMER_ERROR_CODES.PHONE_INVALID, 'Enter a 10-digit mobile number', HttpStatus.BAD_REQUEST, { field: 'phone' });
  return phone;
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function language(value: unknown): string | null {
  return typeof value === 'string' && (CUSTOMER_LANGUAGES as readonly string[]).includes(value) ? value : null;
}

function ipHash(ip: string | null | undefined): string | null {
  return hashOf('session-ip', ip);
}

/** Two first sign-ins for one number or Google/Apple account at once: the loser re-reads. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function installationRequired(): CustomerApiError {
  return bad(CUSTOMER_ERROR_CODES.INSTALLATION_REQUIRED, 'The app must send its installation id (X-Laboura-Installation)', HttpStatus.BAD_REQUEST);
}

/**
 * Customer sign-in (decided 14 Nov): mobile + OTP or Google; a verified mobile
 * before any profile; 90-day sessions per phone renewed on refresh; a fresh
 * OTP for sensitive actions; OTP abuse limits per phone, address and device.
 * Uses the existing OTP provider (mock on the test setup), never staff login.
 */
@Injectable()
export class CustomerSignInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: CustomerTokenService,
    private readonly clock: CustomerAuthClock,
    private readonly limiter: CustomerOtpLimiter,
    private readonly linking: CustomerLinkingService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly apple: AppleIdTokenVerifier,
    private readonly accounts: CustomerAccountService,
    private readonly audit: AuditService,
    @Inject(HUMAN_CHECK_PROVIDER) private readonly humanCheck: HumanCheckProvider,
  ) {}

  // ─── OTP ────────────────────────────────────────────────────────────────

  /**
   * Sends a code for one flow. Every customer code is recorded with its purpose,
   * the installation that asked and (for signed-in flows) the account, so it is
   * accepted only by that same flow, phone and account (security review H1).
   */
  private async send(
    phone: string,
    purpose: string,
    body: { requestId?: unknown; humanCheckToken?: unknown },
    caller: OtpCaller,
    accountId: string | null,
  ) {
    if (!caller.installationId) throw installationRequired();
    const now = this.clock.now();
    const resendOf = typeof body?.requestId === 'string' && body.requestId ? body.requestId : undefined;
    if (resendOf) {
      const original = await this.limiter.sendFor(resendOf);
      if (!original || original.purpose !== purpose || original.phoneHash !== customerPhoneHash(phone)
        || original.deviceHash !== hashOf('device', caller.installationId) || (original.accountId ?? null) !== accountId) {
        throw bad(CUSTOMER_ERROR_CODES.OTP_EXPIRED, 'Ask for a new code.');
      }
    }
    if (await this.limiter.needsHumanCheck(caller, now)) {
      const passed = await this.humanCheck.verify(body?.humanCheckToken, { installationId: caller.installationId ?? null, ip: caller.ip ?? null });
      if (!passed) {
        throw bad(CUSTOMER_ERROR_CODES.HUMAN_CHECK_REQUIRED, 'Please confirm you are a person, then ask for the code again', HttpStatus.FORBIDDEN, { provider: this.humanCheck.name });
      }
    }
    // Above the system-wide daily limit everyone is asked for the human check
    // (needsHumanCheck) instead of sending stopping, so an attack can neither
    // lock existing customers out nor shut sign-ups (security re-check N3, INF-4).
    const rowId = await this.limiter.claimSend(caller, now);
    let result;
    try {
      // Codes the person asked for are sent at any hour (the real sender exempts customer_* purposes).
      result = await this.otp.getProvider().sendOtp(phone, { purpose, requestId: resendOf });
    } catch (error) {
      // A send that failed does not use up the person's hourly and daily codes.
      await this.limiter.releaseSend(rowId);
      throw error;
    }
    await this.limiter.bindSend(rowId, { requestId: result.requestId, purpose, accountId });
    const provider = this.otp.getProvider();
    const code = provider instanceof MockOtpProvider ? provider.getCode(result.requestId) : undefined;
    return {
      requestId: result.requestId,
      resendAvailableAt: result.resendAvailableAt,
      resendsLeft: result.resendsLeft,
      ...customerTestModeFields(code),
    };
  }

  /**
   * Checks a code for this phone and flow. A request that was not sent by this
   * flow, to this phone, from this installation (and account) is refused without
   * charging the claimed phone: only the address and installation pay (H2).
   * With `consume`, the code can't be used again.
   */
  private async checkCode(
    phone: string,
    requestId: unknown,
    code: unknown,
    caller: OtpCaller,
    purpose: string,
    accountId: string | null,
    consume: boolean,
  ): Promise<void> {
    const now = this.clock.now();
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100 || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      throw bad(CUSTOMER_ERROR_CODES.OTP_INVALID, 'Enter the 6-digit code sent to your mobile', HttpStatus.BAD_REQUEST, { field: 'code' });
    }
    await this.limiter.assertCanVerify(caller, now);
    const binding = await this.limiter.sendFor(requestId);
    const matches = binding
      && binding.purpose === purpose
      && binding.phoneHash === customerPhoneHash(phone)
      && binding.deviceHash === hashOf('device', caller.installationId)
      && (accountId === null || binding.accountId === accountId);
    if (!matches) {
      await this.limiter.recordWrongCode(caller, now, false);
      throw bad(binding ? CUSTOMER_ERROR_CODES.OTP_INVALID : CUSTOMER_ERROR_CODES.OTP_EXPIRED,
        binding ? 'This code is not for this number' : 'This code has expired. Ask for a new one.');
    }
    // A registration code already checked once (the form was refused and sent
    // again) is still good until the registration uses it up.
    if (!consume && (await this.otp.isVerified(requestId, phone, purpose))) return;
    const provider = this.otp.getProvider();
    const ok = (await provider.verifyOtp(requestId, code)) && (await this.otp.isVerified(requestId, phone, purpose));
    if (!ok) {
      const attemptsLeft = await this.limiter.recordWrongCode(caller, now, true);
      throw bad(CUSTOMER_ERROR_CODES.OTP_INVALID, 'Wrong code', HttpStatus.BAD_REQUEST, { attemptsLeft });
    }
    if (consume && !(await this.otp.consumeVerified(requestId, phone, purpose))) {
      throw bad(CUSTOMER_ERROR_CODES.OTP_EXPIRED, 'This code has expired. Ask for a new one.');
    }
  }

  private caller(phone: string, ctx: RequestContext): OtpCaller {
    return { phone, ip: ctx.ip, installationId: ctx.installationId };
  }

  sendSignInOtp(body: { phone?: unknown; requestId?: unknown; humanCheckToken?: unknown }, ctx: RequestContext) {
    const phone = requirePhone(body?.phone);
    return this.send(phone, OTP_PURPOSE_SIGN_IN, body ?? {}, this.caller(phone, ctx), null);
  }

  async verifySignInOtp(
    body: { phone?: unknown; requestId?: unknown; code?: unknown; device?: DeviceInput; language?: unknown },
    ctx: RequestContext,
  ) {
    const phone = requirePhone(body?.phone);
    await this.checkCode(phone, body?.requestId, body?.code, this.caller(phone, ctx), OTP_PURPOSE_SIGN_IN, null, true);
    const now = this.clock.now();
    const accountId = await this.accountForPhone(phone, language(body?.language), now);
    await this.assertUsable(accountId);
    const linked = await this.linking.linkByVerifiedPhone(accountId, phone);
    await this.audit.log({
      actorId: `customer:${accountId}`, action: 'customer.sign_in', entityType: 'customer_account', entityCode: accountId,
      after: { method: 'phone', linked: linked.length },
    });
    return this.sessionAnswer(accountId, 'phone', body?.device, ctx, linked);
  }

  private async accountForPhone(phone: string, lang: string | null, now: Date): Promise<string> {
    const identity = await this.prisma.customerIdentity.findUnique({
      where: { provider_subject: { provider: 'phone', subject: phone } },
      select: { id: true, accountId: true },
    });
    if (identity) {
      await this.prisma.customerIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: now } });
      return identity.accountId;
    }
    const byPhone = await this.prisma.customerAccount.findUnique({ where: { phone }, select: { id: true } });
    if (byPhone) {
      await this.prisma.customerIdentity.create({ data: { accountId: byPhone.id, provider: 'phone', subject: phone, verifiedAt: now, lastUsedAt: now } });
      return byPhone.id;
    }
    try {
      const account = await this.prisma.customerAccount.create({
        data: {
          phone,
          phoneVerifiedAt: now,
          createdVia: 'phone',
          language: lang ?? 'en',
          identities: { create: { provider: 'phone', subject: phone, verifiedAt: now, lastUsedAt: now } },
        },
        select: { id: true },
      });
      return account.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.customerAccount.findUnique({ where: { phone }, select: { id: true } });
      if (!winner) throw error;
      return winner.id;
    }
  }

  // ─── Google and Apple ──────────────────────────────────────────────────

  signInWithGoogle(body: { idToken?: unknown; nonce?: unknown; device?: DeviceInput; language?: unknown }, ctx: RequestContext) {
    return this.signInExternal('google', body, ctx);
  }

  signInWithApple(body: { idToken?: unknown; nonce?: unknown; name?: unknown; device?: DeviceInput; language?: unknown }, ctx: RequestContext) {
    return this.signInExternal('apple', body, ctx);
  }

  private verifierFor(provider: 'google' | 'apple') {
    return provider === 'google' ? this.google : this.apple;
  }

  private async signInExternal(
    provider: 'google' | 'apple',
    body: { idToken?: unknown; nonce?: unknown; name?: unknown; device?: DeviceInput; language?: unknown },
    ctx: RequestContext,
  ) {
    if (!ctx.installationId) throw installationRequired();
    const identityInfo: ExternalIdentity = await this.verifierFor(provider).verify(body?.idToken, body?.nonce);
    const now = this.clock.now();
    // Apple sends the name only to the app, the first time: the app passes it on.
    const name = identityInfo.name ?? optionalText(body?.name, 120);
    const identity = await this.prisma.customerIdentity.findUnique({
      where: { provider_subject: { provider, subject: identityInfo.sub } },
      select: { id: true, accountId: true },
    });
    let accountId: string;
    if (identity) {
      accountId = identity.accountId;
      await this.prisma.customerIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: now, email: identityInfo.email } });
    } else {
      try {
        const account = await this.prisma.customerAccount.create({
          data: {
            createdVia: provider,
            email: identityInfo.email,
            displayName: name,
            language: language(body?.language) ?? 'en',
            identities: { create: { provider, subject: identityInfo.sub, email: identityInfo.email, verifiedAt: now, lastUsedAt: now } },
          },
          select: { id: true },
        });
        accountId = account.id;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const winner = await this.prisma.customerIdentity.findUnique({
          where: { provider_subject: { provider, subject: identityInfo.sub } },
          select: { accountId: true },
        });
        if (!winner) throw error;
        accountId = winner.accountId;
      }
    }
    await this.assertUsable(accountId);
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { phone: true } });
    const linked = account.phone ? await this.linking.linkByVerifiedPhone(accountId, account.phone) : [];
    await this.audit.log({
      actorId: `customer:${accountId}`, action: 'customer.sign_in', entityType: 'customer_account', entityCode: accountId,
      after: { method: provider, linked: linked.length },
    });
    return this.sessionAnswer(accountId, provider, body?.device, ctx, linked);
  }

  /**
   * Proof for a Google- or Apple-only account (no mobile) on a sensitive action:
   * a fresh ID token (issued in the last 10 minutes) for the same identity.
   */
  async assertFreshExternalProof(accountId: string, proof: { provider?: unknown; idToken?: unknown; nonce?: unknown }): Promise<'google' | 'apple'> {
    const provider = proof?.provider === 'apple' ? 'apple' : proof?.provider === 'google' ? 'google' : null;
    if (!provider) throw bad(CUSTOMER_ERROR_CODES.STEP_UP_REQUIRED, 'Sign in with Google or Apple again to confirm', HttpStatus.FORBIDDEN, { purpose: 'delete_account' });
    const info = await this.verifierFor(provider).verify(proof.idToken, proof.nonce);
    const identity = await this.prisma.customerIdentity.findUnique({ where: { provider_subject: { provider, subject: info.sub } }, select: { accountId: true } });
    const fresh = info.issuedAt !== null && this.clock.now().getTime() / 1000 - info.issuedAt <= 600;
    if (!identity || identity.accountId !== accountId || !fresh) {
      throw bad(CUSTOMER_ERROR_CODES.STEP_UP_REQUIRED, 'Sign in again with the same account to confirm', HttpStatus.FORBIDDEN, { purpose: 'delete_account' });
    }
    return provider;
  }

  // ─── Adding the mobile to a Google account ────────────────────────────

  async sendAddPhoneOtp(accountId: string, body: { phone?: unknown; requestId?: unknown; humanCheckToken?: unknown }, ctx: RequestContext) {
    const phone = requirePhone(body?.phone);
    return this.send(phone, OTP_PURPOSE_ADD_PHONE, body ?? {}, this.caller(phone, ctx), accountId);
  }

  async verifyAddPhone(
    accountId: string,
    sessionId: string,
    body: { phone?: unknown; requestId?: unknown; code?: unknown },
    ctx: RequestContext,
  ) {
    const phone = requirePhone(body?.phone);
    await this.checkCode(phone, body?.requestId, body?.code, this.caller(phone, ctx), OTP_PURPOSE_ADD_PHONE, accountId, true);
    const now = this.clock.now();
    const me = await this.prisma.customerAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, phone: true, status: true, _count: { select: { profiles: { where: { status: 'active' } } } } },
    });
    if (me.status === 'deletion_requested') {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.DELETION_PENDING, 'This account is being deleted. Cancel the deletion first.');
    }
    if (me.phone === phone) {
      return { account: await this.accounts.me(accountId), linked: [], next: await this.next(accountId) };
    }
    const other = await this.prisma.customerAccount.findFirst({
      where: { OR: [{ phone }, { identities: { some: { provider: 'phone', subject: phone } } }], id: { not: accountId } },
      select: { id: true, status: true, _count: { select: { profiles: { where: { status: 'active' } } } } },
    });

    if (!other) {
      if (me.phone) {
        // Changing a verified mobile is done by an agent (guide: the old number or an agent verifies the new one).
        throw bad(CUSTOMER_ERROR_CODES.NOT_ALLOWED, 'This account already has a verified mobile. Call Laboura to change it.', HttpStatus.FORBIDDEN);
      }
      await this.prisma.$transaction([
        this.prisma.customerAccount.update({ where: { id: accountId }, data: { phone, phoneVerifiedAt: now } }),
        this.prisma.customerIdentity.create({ data: { accountId, provider: 'phone', subject: phone, verifiedAt: now, lastUsedAt: now } }),
      ]);
      const linked = await this.linking.linkByVerifiedPhone(accountId, phone);
      await this.audit.log({
        actorId: `customer:${accountId}`, action: 'customer.phone_added', entityType: 'customer_account', entityCode: accountId,
        after: { linked: linked.length },
      });
      return { account: await this.accounts.me(accountId), linked, next: await this.next(accountId) };
    }

    if (other.status === 'deletion_requested') {
      throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.DELETION_PENDING, 'The account with this mobile is being deleted. Call Laboura for help.');
    }
    if (other.status === 'deleted' || other.status === 'blocked' || (me._count.profiles > 0 && other._count.profiles > 0) || me.phone) {
      throw bad(CUSTOMER_ERROR_CODES.PHONE_IN_USE, 'This mobile belongs to another Laboura account. Call Laboura for help.', HttpStatus.CONFLICT);
    }
    // Join the two: the account without profiles goes into the one with them
    // (the phone account when both are empty).
    const keep = me._count.profiles > 0 ? accountId : other.id;
    const drop = keep === accountId ? other.id : accountId;
    await this.prisma.$transaction(async (tx) => {
      await tx.customerIdentity.updateMany({ where: { accountId: drop }, data: { accountId: keep } });
      const dropRow = await tx.customerAccount.findUniqueOrThrow({ where: { id: drop }, select: { email: true, displayName: true } });
      await tx.customerSession.updateMany({ where: { accountId: drop, revokedAt: null }, data: { revokedAt: now, endedReason: 'replaced' } });
      await tx.customerDevice.updateMany({ where: { accountId: drop }, data: { pushToken: null, revokedAt: now } });
      await tx.customerAccount.update({
        where: { id: drop },
        data: { status: 'deleted', deletedAt: now, phone: null, email: null, displayName: null },
      });
      const keepRow = await tx.customerAccount.findUniqueOrThrow({ where: { id: keep }, select: { email: true, displayName: true } });
      await tx.customerAccount.update({
        where: { id: keep },
        data: {
          phone,
          phoneVerifiedAt: now,
          email: keepRow.email ?? dropRow.email,
          displayName: keepRow.displayName ?? dropRow.displayName,
        },
      });
      const hasPhoneIdentity = await tx.customerIdentity.findUnique({ where: { provider_subject: { provider: 'phone', subject: phone } } });
      if (!hasPhoneIdentity) {
        await tx.customerIdentity.create({ data: { accountId: keep, provider: 'phone', subject: phone, verifiedAt: now, lastUsedAt: now } });
      }
    });
    const linked = await this.linking.linkByVerifiedPhone(keep, phone);
    await this.audit.log({
      actorId: `customer:${keep}`, action: 'customer.accounts_joined', entityType: 'customer_account', entityCode: keep,
      after: { joined: drop },
    });
    if (keep === accountId) {
      return { account: await this.accounts.me(accountId), linked, next: await this.next(accountId) };
    }
    // This session belonged to the closed account: a fresh session for the kept one on the same phone.
    const session = await this.prisma.customerSession.findUnique({ where: { id: sessionId }, select: { device: { select: { installationId: true, platform: true, appVersion: true } } } });
    return this.sessionAnswer(keep, 'google', session?.device ?? undefined, ctx, linked);
  }

  // ─── Sessions ───────────────────────────────────────────────────────────

  private sessionEnd(now: Date): Date {
    return new Date(now.getTime() + CUSTOMER_SESSION_DAYS * DAY_MS);
  }

  private async upsertDevice(accountId: string, device: DeviceInput | undefined, ctx: RequestContext, now: Date): Promise<string | null> {
    // The header is the installation the OTP was bound to; the body may only repeat it.
    void device?.installationId;
    const installationId = optionalText(ctx.installationId, 100);
    if (!installationId) return null;
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { status: true } });
    if (account.status === 'deletion_requested') {
      // An account being deleted cannot be opened on a new phone (security review M4).
      const known = await this.prisma.customerDevice.findUnique({ where: { accountId_installationId: { accountId, installationId } }, select: { id: true } });
      if (!known) {
        throw new CustomerApiError(HttpStatus.CONFLICT, CUSTOMER_ERROR_CODES.DELETION_PENDING, 'This account is being deleted and cannot be opened on a new phone. Cancel the deletion on your old phone, or call Laboura.');
      }
    }
    const platform = ['android', 'ios', 'web'].includes(String(device?.platform)) ? String(device?.platform) : 'android';
    const appVersion = optionalText(device?.appVersion, 40);
    const row = await this.prisma.customerDevice.upsert({
      where: { accountId_installationId: { accountId, installationId } },
      create: { accountId, installationId, platform, appVersion, lastSeenAt: now },
      update: { platform, appVersion, lastSeenAt: now, revokedAt: null },
      select: { id: true },
    });
    return row.id;
  }

  private async sessionAnswer(
    accountId: string,
    signedInWith: 'phone' | 'google' | 'apple',
    device: DeviceInput | undefined,
    ctx: RequestContext,
    linked: LinkedProfile[],
  ) {
    const now = this.clock.now();
    const deviceId = await this.upsertDevice(accountId, device, ctx, now);
    // Every session is tied to a phone (refresh binding, "no new phone while deletion is pending").
    if (!deviceId) throw installationRequired();
    // One sign-in per phone: an older session on this phone ends.
    await this.prisma.customerSession.updateMany({
      where: { accountId, deviceId, revokedAt: null },
      data: { revokedAt: now, endedReason: 'replaced' },
    });
    const refreshToken = this.tokens.newRefreshToken();
    const expiresAt = this.sessionEnd(now);
    const session = await this.prisma.customerSession.create({
      data: {
        accountId,
        deviceId,
        refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
        signedInWith,
        expiresAt,
        lastUsedAt: now,
        ipHash: ipHash(ctx.ip),
        userAgent: optionalText(ctx.userAgent, 300),
      },
      select: { id: true },
    });
    await this.prisma.customerAccount.update({ where: { id: accountId }, data: { lastSeenAt: now } });
    const access = this.tokens.signAccess(accountId, session.id);
    return {
      accessToken: access.accessToken,
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
      account: await this.accounts.me(accountId),
      linked,
      next: await this.next(accountId),
    };
  }

  async next(accountId: string): Promise<SignInNext> {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { phoneVerifiedAt: true, _count: { select: { profiles: { where: { status: 'active' } } } } },
    });
    if (!account.phoneVerifiedAt) return 'add_phone';
    if (account._count.profiles === 0) return 'choose_role';
    return account._count.profiles === 1 ? 'home' : 'choose_profile';
  }

  private async assertUsable(accountId: string): Promise<void> {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { status: true } });
    if (account.status === 'blocked') throw customerUnauthorized(CUSTOMER_ERROR_CODES.ACCOUNT_BLOCKED, 'This account is blocked. Call Laboura for help.');
    if (account.status === 'deleted') throw customerUnauthorized(CUSTOMER_ERROR_CODES.ACCOUNT_DELETED, 'This account was deleted.');
  }

  async refresh(body: { refreshToken?: unknown }, ctx: RequestContext) {
    const raw = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
    const invalid = () => customerUnauthorized(CUSTOMER_ERROR_CODES.REFRESH_INVALID, 'Sign in again');
    if (!ctx.installationId) throw installationRequired();
    if (!raw || raw.length > 200) throw invalid();
    const hash = this.tokens.hashRefreshToken(raw);
    const now = this.clock.now();
    const select = {
      id: true, accountId: true, revokedAt: true, expiresAt: true, deviceId: true, lastUsedAt: true,
      device: { select: { installationId: true } },
    } as const;
    const session = await this.prisma.customerSession.findUnique({ where: { refreshTokenHash: hash }, select });
    // A refresh token works only on the phone it was given to.
    const samePhone = (row: { device: { installationId: string } | null }) =>
      Boolean(row.device) && row.device!.installationId === ctx.installationId;
    if (!session) {
      const previous = await this.prisma.customerSession.findUnique({ where: { previousRefreshTokenHash: hash }, select });
      if (previous && !previous.revokedAt && samePhone(previous) && now.getTime() - previous.lastUsedAt.getTime() <= REFRESH_GRACE_MS) {
        // Two renewals at once from the same phone: answer with a fresh access
        // token only; the app keeps the refresh token the other renewal returned.
        const access = this.tokens.signAccess(previous.accountId, previous.id);
        return {
          accessToken: access.accessToken,
          accessTokenExpiresIn: access.expiresInSeconds,
          refreshToken: null,
          refreshTokenExpiresAt: previous.expiresAt,
          account: await this.accounts.me(previous.accountId),
          linked: [],
          next: await this.next(previous.accountId),
        };
      }
      if (previous) {
        // An old refresh token used again: it was copied. End that session.
        await this.prisma.customerSession.updateMany({ where: { id: previous.id, revokedAt: null }, data: { revokedAt: now, endedReason: 'revoked' } });
      }
      throw invalid();
    }
    if (session.revokedAt || session.expiresAt.getTime() <= now.getTime() || !samePhone(session)) throw invalid();
    await this.assertUsable(session.accountId);
    const refreshToken = this.tokens.newRefreshToken();
    const expiresAt = this.sessionEnd(now);
    const updated = await this.prisma.customerSession.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        previousRefreshTokenHash: hash,
        refreshTokenHash: this.tokens.hashRefreshToken(refreshToken),
        expiresAt,
        lastUsedAt: now,
        ipHash: ipHash(ctx.ip),
      },
    });
    if (updated.count !== 1) throw invalid();
    if (session.deviceId) await this.prisma.customerDevice.updateMany({ where: { id: session.deviceId }, data: { lastSeenAt: now } });
    await this.prisma.customerAccount.update({ where: { id: session.accountId }, data: { lastSeenAt: now } });
    const access = this.tokens.signAccess(session.accountId, session.id);
    return {
      accessToken: access.accessToken,
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
      account: await this.accounts.me(session.accountId),
      linked: [],
      next: await this.next(session.accountId),
    };
  }

  async signOut(sessionId: string): Promise<void> {
    const now = this.clock.now();
    const session = await this.prisma.customerSession.findUnique({ where: { id: sessionId }, select: { deviceId: true } });
    await this.prisma.customerSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now, endedReason: 'sign_out' } });
    if (session?.deviceId) {
      // No more notifications to this phone (proposal 7.1: push tokens go on sign-out).
      await this.prisma.customerDevice.updateMany({ where: { id: session.deviceId }, data: { pushToken: null, pushTokenUpdatedAt: now } });
    }
  }

  // ─── Fresh OTP for sensitive actions ──────────────────────────────────

  private purpose(value: unknown): CustomerStepUpPurpose {
    if (typeof value !== 'string' || !(CUSTOMER_STEP_UP_PURPOSES as readonly string[]).includes(value)) {
      throw bad(CUSTOMER_ERROR_CODES.VALIDATION, `purpose must be one of ${CUSTOMER_STEP_UP_PURPOSES.join(', ')}`, HttpStatus.BAD_REQUEST, { field: 'purpose' });
    }
    return value as CustomerStepUpPurpose;
  }

  private async verifiedPhone(accountId: string): Promise<string> {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: accountId }, select: { phone: true, phoneVerifiedAt: true } });
    if (!account.phone || !account.phoneVerifiedAt) {
      throw bad(CUSTOMER_ERROR_CODES.PHONE_REQUIRED, 'Verify your mobile number first', HttpStatus.FORBIDDEN);
    }
    return account.phone;
  }

  async sendStepUp(accountId: string, body: { purpose?: unknown; requestId?: unknown; humanCheckToken?: unknown }, ctx: RequestContext) {
    const action = this.purpose(body?.purpose);
    const phone = await this.verifiedPhone(accountId);
    return this.send(phone, stepUpOtpPurpose(action), body ?? {}, this.caller(phone, ctx), accountId);
  }

  async verifyStepUp(accountId: string, sessionId: string, body: { purpose?: unknown; requestId?: unknown; code?: unknown }, ctx: RequestContext) {
    const purpose = this.purpose(body?.purpose);
    const phone = await this.verifiedPhone(accountId);
    if (purpose === 'register') {
      throw bad(CUSTOMER_ERROR_CODES.VALIDATION, 'A registration code goes in the registration form, not here', HttpStatus.BAD_REQUEST, { field: 'purpose' });
    }
    await this.checkCode(phone, body?.requestId, body?.code, this.caller(phone, ctx), stepUpOtpPurpose(purpose), accountId, true);
    const now = this.clock.now();
    await this.prisma.customerSession.update({ where: { id: sessionId }, data: { stepUpAt: now, stepUpPurpose: purpose } });
    return { purpose, validUntil: new Date(now.getTime() + CUSTOMER_STEP_UP_MINUTES * 60_000) };
  }

  /** Uses up a fresh step-up for this action, or answers 403 STEP_UP_REQUIRED. */
  async consumeStepUp(sessionId: string, purpose: CustomerStepUpPurpose): Promise<void> {
    const now = this.clock.now();
    const used = await this.prisma.customerSession.updateMany({
      where: { id: sessionId, revokedAt: null, stepUpPurpose: purpose, stepUpAt: { gte: new Date(now.getTime() - CUSTOMER_STEP_UP_MINUTES * 60_000) } },
      data: { stepUpAt: null, stepUpPurpose: null },
    });
    if (used.count !== 1) {
      throw bad(CUSTOMER_ERROR_CODES.STEP_UP_REQUIRED, 'Confirm with a fresh code sent to your mobile', HttpStatus.FORBIDDEN, { purpose });
    }
  }

  /**
   * Registration (purpose `register`): checks the code sent to the account's own
   * mobile, without using it up — the existing registration service uses it up
   * when it saves the record (one code, one record, as on the agent's form).
   */
  async checkRegistrationOtp(accountId: string, otp: unknown, ctx: RequestContext): Promise<{ phone: string; requestId: string }> {
    const phone = await this.verifiedPhone(accountId);
    const value = (otp ?? {}) as { requestId?: unknown; code?: unknown };
    await this.checkCode(phone, value.requestId, value.code, this.caller(phone, ctx), stepUpOtpPurpose('register'), accountId, false);
    return { phone, requestId: value.requestId as string };
  }
}
