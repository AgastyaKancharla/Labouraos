import { Body, Controller, Get, Headers, Ip, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { VacancyConfirmationService } from './vacancy-confirmation.service';
import { Public } from '../../common/rbac/public.decorator';
import { publicPageLink, wantsHtml } from '../../common/public-pages';

/**
 * Public pages for the business's (or branch's) contact person to confirm a vacancy later, from the SMS link.
 * The link opens only after an OTP sent to the number the link was sent to.
 * A browser opening the link goes to the phone page P07-VacancyConfirm (/p/vacancy-confirm/:token,
 * rev 192 fix S3), which calls these routes; links already sent with this address keep working.
 */
@Controller('vacancy-confirm')
export class VacancyConfirmController {
  constructor(private readonly confirmationService: VacancyConfirmationService) {}

  @Get(':token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async details(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (wantsHtml(accept)) {
      res.redirect(302, publicPageLink('vacancyConfirm', token));
      return;
    }
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
    const confirmed = await this.confirmationService.confirmFromLink(token, body ?? {}, {
      userAgent: userAgent?.slice(0, 300),
      ipHash: ip ? createHash('sha256').update(ip).digest('hex') : undefined,
    });
    // A public answer: what the page shows ("Confirmed, thank you"), never the business record
    // or staff ids (like the agreement page, which answers only when it was signed).
    return {
      vacancyCode: confirmed.code,
      status: confirmed.status,
      confirmedAt: confirmed.confirmedAt,
      confirmationMethod: confirmed.confirmationMethod,
      confirmedByName: confirmed.confirmedByName,
    };
  }
}
