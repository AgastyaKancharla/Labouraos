import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { CUSTOMER_API_PREFIX } from '../../common/customer-auth/customer-app.constants';
import { CurrentCustomer, CustomerRoute } from '../../common/customer-auth/customer-auth.decorators';
import { CustomerPrincipal } from '../../common/customer-auth/customer-auth.guard';
import { requestContext } from '../customer-account/customer-request-context';
import { CustomerHomeService } from './customer-home.service';
import { CustomerRegistrationService } from './customer-registration.service';
import { CustomerRequestsService } from './customer-requests.service';

type Body_ = Record<string, unknown>;

/**
 * The signed-in customer's own sign-ups, profiles and requests
 * (docs/customer-app-api.md §4 to §11). Every route needs a customer token;
 * a profile id in the path only picks among the caller's own profiles.
 */
@Controller(CUSTOMER_API_PREFIX)
export class CustomerAppController {
  constructor(
    private readonly registration: CustomerRegistrationService,
    private readonly homes: CustomerHomeService,
    private readonly requests: CustomerRequestsService,
  ) {}

  @Post('me/signups')
  @CustomerRoute()
  async startSignup(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Res({ passthrough: true }) res: Response) {
    const result = await this.registration.startSignup(me.accountId, body ?? {});
    res.status(result.created ? 201 : 200);
    return result.body;
  }

  @Post('me/register/age-check')
  @HttpCode(200)
  @CustomerRoute()
  ageCheck(@Body() body: Body_) {
    return this.registration.ageCheck(body ?? {});
  }

  @Post('me/register/job-seeker')
  @CustomerRoute()
  registerJobSeeker(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Req() req: Request) {
    return this.registration.registerJobSeeker(me.accountId, body ?? {}, requestContext(req));
  }

  @Post('me/register/business')
  @CustomerRoute()
  registerBusiness(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Req() req: Request) {
    return this.registration.registerBusiness(me.accountId, body ?? {}, requestContext(req));
  }

  @Post('me/register/referral')
  @CustomerRoute()
  registerReferral(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Req() req: Request) {
    return this.registration.registerReferral(me.accountId, body ?? {}, requestContext(req));
  }

  @Post('me/profiles/:profileId/links')
  @CustomerRoute()
  issueLink(@CurrentCustomer() me: CustomerPrincipal, @Param('profileId') profileId: string, @Body() body: Body_) {
    return this.requests.issueLink(me.accountId, profileId, body ?? {});
  }

  @Get('me/profiles/:profileId/home')
  @CustomerRoute()
  home(@CurrentCustomer() me: CustomerPrincipal, @Param('profileId') profileId: string) {
    return this.homes.home(me.accountId, profileId);
  }

  @Post('me/profiles/:profileId/vacancy-drafts')
  @CustomerRoute()
  createDraft(@CurrentCustomer() me: CustomerPrincipal, @Param('profileId') profileId: string, @Body() body: Body_) {
    return this.requests.createDraft(me.accountId, profileId, body ?? {});
  }

  @Patch('me/profiles/:profileId/vacancy-drafts/:draftId')
  @CustomerRoute()
  updateDraft(@CurrentCustomer() me: CustomerPrincipal, @Param('profileId') profileId: string, @Param('draftId') draftId: string, @Body() body: Body_) {
    return this.requests.updateDraft(me.accountId, profileId, draftId, body ?? {});
  }

  @Delete('me/profiles/:profileId/vacancy-drafts/:draftId')
  @HttpCode(204)
  @CustomerRoute()
  async discardDraft(@CurrentCustomer() me: CustomerPrincipal, @Param('profileId') profileId: string, @Param('draftId') draftId: string): Promise<void> {
    await this.requests.discardDraft(me.accountId, profileId, draftId);
  }

  @Post('me/profiles/:profileId/vacancy-drafts/:draftId/confirm')
  @CustomerRoute()
  confirmDraft(@CurrentCustomer() me: CustomerPrincipal, @Param('profileId') profileId: string, @Param('draftId') draftId: string, @Body() body: Body_) {
    return this.requests.confirmDraft(me.accountId, me.sessionId, profileId, draftId, body ?? {});
  }

  @Post('me/callback-requests')
  @CustomerRoute()
  async callback(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_, @Res({ passthrough: true }) res: Response) {
    const result = await this.requests.requestCallback(me.accountId, body ?? {});
    res.status(result.created ? 201 : 200);
    return result.body;
  }

  @Get('me/callback-requests')
  @CustomerRoute()
  callbacks(@CurrentCustomer() me: CustomerPrincipal) {
    return this.requests.listCallbacks(me.accountId);
  }

  @Get('me/deletion')
  @CustomerRoute()
  deletionInfo(@CurrentCustomer() me: CustomerPrincipal) {
    return this.requests.deletionInfo(me.accountId);
  }

  @Post('me/deletion')
  @CustomerRoute()
  requestDeletion(@CurrentCustomer() me: CustomerPrincipal, @Body() body: Body_) {
    return this.requests.requestDeletion(me.accountId, me.sessionId, body ?? {});
  }
}
