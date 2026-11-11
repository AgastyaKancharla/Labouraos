import { Body, Controller, Get, Headers, Ip, Param, Post } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { VacancyConfirmationService } from './vacancy-confirmation.service';
import { Public } from '../../common/rbac/public.decorator';

/**
 * Public pages for the business's (or branch's) contact person to confirm a vacancy later, from the SMS link.
 * The link opens only after an OTP sent to the number the link was sent to.
 */
@Controller('vacancy-confirm')
export class VacancyConfirmController {
  constructor(private readonly confirmationService: VacancyConfirmationService) {}

  @Get(':token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async details(@Param('token') token: string) {
    return this.confirmationService.linkDetails(token);
  }

  @Post(':token/send-otp')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async sendOtp(@Param('token') token: string, @Body() body: { otpRequestId?: string }) {
    return this.confirmationService.sendLinkOtp(token, body?.otpRequestId);
  }

  @Post(':token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async confirm(
    @Param('token') token: string,
    @Body() body: { otpRequestId?: string; code?: string },
    @Headers('user-agent') userAgent: string | undefined,
    @Ip() ip: string | undefined,
  ) {
    return this.confirmationService.confirmFromLink(token, body ?? {}, {
      userAgent: userAgent?.slice(0, 300),
      ipHash: ip ? createHash('sha256').update(ip).digest('hex') : undefined,
    });
  }
}
