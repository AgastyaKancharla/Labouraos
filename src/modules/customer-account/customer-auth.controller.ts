import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/rbac/public.decorator';
import { CUSTOMER_API_PREFIX, CUSTOMER_LANGUAGES, CUSTOMER_SESSION_DAYS } from '../../common/customer-auth/customer-app.constants';
import { CurrentCustomer, CustomerRoute } from '../../common/customer-auth/customer-auth.decorators';
import { CustomerPrincipal } from '../../common/customer-auth/customer-auth.guard';
import { otpTestModeEnabled } from '../../common/otp/otp-test-mode';
import { CustomerSignInService } from './customer-sign-in.service';
import { googleClientIds } from './google-id-token.verifier';
import { requestContext } from './customer-request-context';

type Body_ = Record<string, unknown>;

/**
 * Customer sign-in routes (docs/customer-app-api.md §2, §3). The routes before
 * a token exists are public with their own OTP limits; the rest need a
 * customer token. Staff sign-in is src/common/auth and never shares a route.
 */
@Controller(CUSTOMER_API_PREFIX)
export class CustomerAuthController {
  constructor(private readonly signIn: CustomerSignInService) {}

  @Get('config')
  @Public('Customer app start-up settings (Google client ids, languages); no personal data')
  config() {
    const ids = googleClientIds();
    const on = Boolean(ids.android || ids.ios || ids.web);
    return {
      googleClientIds: ids,
      googleSignIn: on,
      otpTestMode: otpTestModeEnabled(),
      languages: CUSTOMER_LANGUAGES,
      otpResendSeconds: 30,
      otpMaxResends: 3,
      sessionDays: CUSTOMER_SESSION_DAYS,
    };
  }

  @Post('auth/otp/send')
  @HttpCode(200)
  @Public('Customer sign-in: sends an OTP; limited per phone, address and device (CustomerOtpLimiter)')
  sendOtp(@Body() body: Body_, @Req() req: Request) {
    return this.signIn.sendSignInOtp(body ?? {}, requestContext(req));
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  @Public('Customer sign-in: checks the OTP and opens a customer session (customer realm, never staff)')
  verifyOtp(@Body() body: Body_, @Req() req: Request) {
    return this.signIn.verifySignInOtp(body ?? {}, requestContext(req));
  }

  @Post('auth/google')
  @HttpCode(200)
  @Public('Customer sign-in with a Google ID token checked against Google keys and Laboura client ids')
  google(@Body() body: Body_, @Req() req: Request) {
    return this.signIn.signInWithGoogle(body ?? {}, requestContext(req));
  }

  @Post('auth/refresh')
  @HttpCode(200)
  @Public('Customer session renewal with a refresh token (hashed, rotated, reuse ends the session)')
  refresh(@Body() body: Body_, @Req() req: Request) {
    return this.signIn.refresh(body ?? {}, requestContext(req));
  }

  @Post('auth/phone/send')
  @HttpCode(200)
  @CustomerRoute()
  sendPhone(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Req() req: Request) {
    return this.signIn.sendAddPhoneOtp(me.accountId, body ?? {}, requestContext(req));
  }

  @Post('auth/phone/verify')
  @HttpCode(200)
  @CustomerRoute()
  verifyPhone(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Req() req: Request) {
    return this.signIn.verifyAddPhone(me.accountId, me.sessionId, body ?? {}, requestContext(req));
  }

  @Post('auth/sign-out')
  @HttpCode(204)
  @CustomerRoute()
  async signOut(@CurrentCustomer() me: CustomerPrincipal): Promise<void> {
    await this.signIn.signOut(me.sessionId);
  }

  @Post('auth/step-up/send')
  @HttpCode(200)
  @CustomerRoute()
  sendStepUp(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Req() req: Request) {
    return this.signIn.sendStepUp(me.accountId, body ?? {}, requestContext(req));
  }

  @Post('auth/step-up/verify')
  @HttpCode(200)
  @CustomerRoute()
  verifyStepUp(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Req() req: Request) {
    return this.signIn.verifyStepUp(me.accountId, me.sessionId, body ?? {}, requestContext(req));
  }
}
