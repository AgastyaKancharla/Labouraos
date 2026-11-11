import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `******${digits.slice(-4)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

@Controller('registration')
export class RegistrationController {
  constructor(
    private readonly publicLinks: PublicLinkStoreService,
    private readonly otp: OtpService,
    private readonly jobSeekers: JobSeekerService,
    private readonly prisma: PrismaService,
    private readonly upi: UpiCollectionService,
  ) {}

  @Post(':token/selfie')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
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

  @Post('payment/:token/send-otp')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async sendPaymentOnlyOtp(@Param('token') token: string) {
    const link = await this.requirePaymentLink(token);
    const result = await this.otp.sendOtp(link.phone!);
    return { success: true, requestId: result.requestId, phone: maskPhone(link.phone!) };
  }

  @Get('payment/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async getPaymentOnlyPage(
    @Param('token') token: string,
    @Query('requestId') requestId: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const link = await this.requirePaymentLink(token);
    if (!requestId || !(await this.otp.isVerified(requestId, link.phone!))) {
      throw new BadRequestException('OTP to the payment contact number is required');
    }
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
    const details = {
      firstName: seeker.name.trim().split(/\s+/)[0] ?? seeker.name,
      jobSeekerCode: seeker.code,
      amountPaise: payment.expectedAmountPaise,
      payment: paymentDetails,
    };
    if (accept?.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job seeker payment</title><main><h1>Payment for ${escapeHtml(details.firstName)} (${escapeHtml(details.jobSeekerCode)})</h1><p>₹${escapeHtml(paymentDetails.amount)}</p>${paymentDetails.qrSvg}<a href="${escapeHtml(paymentDetails.upiUri)}">Pay with UPI</a></main></html>`;
    }
    return details;
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
