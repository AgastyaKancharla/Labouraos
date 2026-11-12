import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Optional,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { OtpService } from '../../common/otp/otp.service';
import { JobSeekerService } from './job-seeker.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpiCollectionService } from '../payment/upi-collection.service';
import { Response as ExpressResponse } from 'express';
import { Public } from '../../common/rbac/public.decorator';
import { publicPageLink, wantsHtml } from '../../common/public-pages';
import { RegistrationJourneyService } from './registration-journey.service';
import { KycRecoveryService } from '../../common/kyc/kyc-recovery.service';
import { PublicOtpLimiter } from '../../common/public-otp-limiter.service';
import { publicLanguage, shortNameOf } from './registration-journey';
import { testModeFields } from '../../common/otp/otp-test-mode';
import { CheckLinkBeforeUpload } from '../../common/public-link-upload.guard';

const TOKEN_PAGE = 'token page: the job seeker, business or partner proves who they are with the link token';

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `******${digits.slice(-4)}`;
}

@Controller('registration')
export class RegistrationController {
  constructor(
    private readonly publicLinks: PublicLinkStoreService,
    private readonly otp: OtpService,
    private readonly jobSeekers: JobSeekerService,
    private readonly prisma: PrismaService,
    private readonly upi: UpiCollectionService,
    private readonly journey: RegistrationJourneyService,
    private readonly otpLimiter: PublicOtpLimiter,
    @Optional() private readonly kycRecovery?: KycRecoveryService,
  ) {}

  /**
   * "I'll wait — SMS me when it's back" (P01e): only while the ID service is down.
   * He already proved his number on this link, so no second code is asked.
   */
  @Post(':token/id-check-wait')
  @Public(TOKEN_PAGE)
  async waitForIdService(@Param('token') token: string, @Body() body: { requestId?: string }) {
    const link = await this.requireRegistrationLink(token);
    if (!body?.requestId || !(await this.otp.isVerified(body.requestId, link.phone!))) {
      throw new BadRequestException('OTP to the registered mobile is required');
    }
    if (!this.kycRecovery || !(await this.kycRecovery.isDown())) {
      throw new BadRequestException('ID check service is available');
    }
    await this.kycRecovery.requestRecovery(link.subjectId, link.id);
    return { success: true, waitingForRecovery: true };
  }

  /**
   * Where the registration link stands (web page P00/P02r and every step after it).
   * Without a verified OTP to his own number it shows only the masked number and language.
   */
  @Get(':token/status')
  @Public(TOKEN_PAGE)
  async status(@Param('token') token: string, @Query('requestId') requestId?: string) {
    const link = await this.requireRegistrationLink(token);
    const verified = Boolean(requestId) && (await this.otp.isVerified(requestId!, link.phone!));
    return this.journey.status(link.subjectId, verified);
  }

  /** He types the code sent to his own number (P00); the answer is where he stands. */
  @Post(':token/verify-otp')
  @Public(TOKEN_PAGE)
  async verifyOtp(@Param('token') token: string, @Body() body: { requestId?: string; code?: string }) {
    const link = await this.requireRegistrationLink(token);
    await this.verifyCode(body, link.phone!);
    return this.journey.status(link.subjectId, true);
  }

  @Post(':token/selfie')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  @CheckLinkBeforeUpload('registration', 'job_seeker', 'A valid job seeker registration link is required')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadSelfie(
    @Param('token') token: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Body() body: { requestId?: string; captureSource?: string },
  ) {
    const link = await this.requireRegistrationLink(token);
    if (!body.requestId || !(await this.otp.isVerified(body.requestId, link.phone ?? ''))) {
      throw new BadRequestException('OTP to the registered mobile is required');
    }
    if (body.captureSource !== 'live_camera') {
      throw new BadRequestException('A live camera capture is required; gallery uploads are refused');
    }
    if (!photo) throw new BadRequestException('A camera capture is required');
    return this.jobSeekers.uploadPhoto(link.subjectId, photo, 'system');
  }

  @Post(':token/id-check')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async verifyIdentity(
    @Param('token') token: string,
    @Body() body: Record<string, unknown> & { requestId?: string },
  ) {
    const link = await this.requireRegistrationLink(token);
    if (!body.requestId || !(await this.otp.isVerified(body.requestId, link.phone ?? ''))) {
      throw new BadRequestException('OTP to the registered mobile is required');
    }
    const providerInput = { ...body };
    delete providerInput.requestId;
    return this.jobSeekers.verifyIdentityWithProvider(link.subjectId, providerInput, 'system');
  }

  @Get(':token/terms')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async getTerms(@Param('token') token: string, @Query('requestId') requestId: string) {
    const link = await this.requireRegistrationLink(token);
    if (!requestId || !(await this.otp.isVerified(requestId, link.phone ?? ''))) {
      throw new BadRequestException('OTP to the registered mobile is required');
    }
    return this.jobSeekers.registrationTerms(link.subjectId);
  }

  @Post(':token/terms-and-payment')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async acceptTermsAndPay(
    @Param('token') token: string,
    @Body() body: { requestId?: string; acceptTerms?: boolean },
  ) {
    const link = await this.requireRegistrationLink(token);
    if (!body.requestId || !(await this.otp.isVerified(body.requestId, link.phone ?? ''))) {
      throw new BadRequestException('OTP to the registered mobile is required');
    }
    return this.jobSeekers.acceptTermsAndCreatePayment(link.subjectId, body.acceptTerms);
  }

  @Post(':token/payment-only-link')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async sendPaymentOnlyLink(
    @Param('token') token: string,
    @Body() body: { requestId?: string; phone?: string },
  ) {
    const link = await this.requireRegistrationLink(token);
    if (!body.requestId || !(await this.otp.isVerified(body.requestId, link.phone ?? ''))) {
      throw new BadRequestException('OTP to the registered mobile is required');
    }
    if (!body.phone) throw new BadRequestException('A payment contact number is required');
    return this.jobSeekers.createPaymentOnlyLink(link.subjectId, body.phone, 'system');
  }

  /** Before the payer's OTP (P02s): only the masked number the code goes to, the language and how long the link lasts. */
  @Get('payment/:token/info')
  @Public(TOKEN_PAGE)
  async paymentOnlyInfo(@Param('token') token: string) {
    const link = await this.requirePaymentLink(token);
    return { maskedPhone: maskPhone(link.phone!), language: publicLanguage(link.language), expiresAt: link.expiresAt };
  }

  @Post('payment/:token/send-otp')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async sendPaymentOnlyOtp(@Param('token') token: string) {
    const link = await this.requirePaymentLink(token);
    await this.otpLimiter.claimSend(this.publicLinks.hashToken(token), link.phone!);
    const result = await this.otp.sendOtp(link.phone!);
    return { success: true, requestId: result.requestId, phone: maskPhone(link.phone!), resendAvailableAt: result.resendAvailableAt, ...testModeFields(result) };
  }

  /** The payer types the code; the answer is the payment page. */
  @Post('payment/:token/verify-otp')
  @Public(TOKEN_PAGE)
  async verifyPaymentOnlyOtp(@Param('token') token: string, @Body() body: { requestId?: string; code?: string }) {
    const link = await this.requirePaymentLink(token);
    await this.verifyCode(body, link.phone!);
    return this.paymentOnlyDetails(link);
  }

  /** Old payment-only URL: a browser goes to the new page (P02s); an API client gets the details after the payer's OTP. */
  @Get('payment/:token')
  @Public(TOKEN_PAGE)
  async getPaymentOnlyPage(
    @Param('token') token: string,
    @Query('requestId') requestId: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    if (wantsHtml(accept)) {
      res.redirect(302, publicPageLink('paymentOnly', token));
      return;
    }
    const link = await this.requirePaymentLink(token);
    if (!requestId || !(await this.otp.isVerified(requestId, link.phone!))) {
      throw new BadRequestException('OTP to the payment contact number is required');
    }
    return this.paymentOnlyDetails(link);
  }

  private async paymentOnlyDetails(link: Awaited<ReturnType<PublicLinkStoreService['findByToken']>>) {
    const metadata = link.metadata as { paymentId?: unknown } | null;
    const paymentId = typeof metadata?.paymentId === 'string' ? metadata.paymentId : '';
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.jobSeekerId !== link.subjectId || payment.type !== 'activation' || payment.status !== 'pending' || !payment.upiReference) {
      throw new BadRequestException('This payment link is no longer available');
    }
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: link.subjectId },
      select: { name: true, code: true },
    });
    if (!seeker) throw new BadRequestException('Job seeker not found');
    const paymentDetails = await this.upi.getPaymentPage(payment.upiReference);
    return {
      firstName: seeker.name.trim().split(/\s+/)[0] ?? seeker.name,
      displayName: shortNameOf(seeker.name),
      jobSeekerCode: seeker.code,
      amountPaise: payment.expectedAmountPaise,
      linkExpiresAt: link.expiresAt,
      language: publicLanguage(link.language),
      payment: paymentDetails,
    };
  }

  private async verifyCode(body: { requestId?: string; code?: string }, phone: string) {
    if (!body?.requestId || !body.code || !/^\d{4,8}$/.test(body.code)) {
      throw new BadRequestException('Type the code from the SMS');
    }
    const ok = await this.otp.verifyOtp(body.requestId, body.code);
    if (!ok || !(await this.otp.isVerified(body.requestId, phone))) {
      throw new BadRequestException('Wrong or expired code. Check the SMS or ask for a new code.');
    }
  }

  private async requireRegistrationLink(token: string) {
    const link = await this.publicLinks.findByToken(token);
    if (link.purpose !== 'registration' || link.subjectType !== 'job_seeker' || !link.phone) {
      throw new BadRequestException('A valid job seeker registration link is required');
    }
    return link;
  }

  private async requirePaymentLink(token: string) {
    const link = await this.publicLinks.findByToken(token);
    if (link.purpose !== 'payment_only' || link.subjectType !== 'job_seeker' || !link.phone) {
      throw new BadRequestException('A valid payment-only link is required');
    }
    return link;
  }
}
