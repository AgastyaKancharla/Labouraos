import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { PaymentFilterDto } from './dto/payment-filter.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { Response } from 'express';
import { UpiCollectionService } from './upi-collection.service';
import { RecordPayoutDto } from './dto/record-payout.dto';

@Controller('payments')
@UseInterceptors(PiiMaskingInterceptor)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly upiCollectionService: UpiCollectionService,
  ) {}

  @Get('request/:token')
  async paymentRequestPage(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (accept?.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return this.upiCollectionService.renderPaymentPage(token);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.upiCollectionService.getPaymentPage(token);
  }

  @Get(':id/receipt')
  async getPaymentReceipt(@Param('id') id: string) {
    const payment = await this.paymentService.findById(id);
    return {
      paymentId: payment.id,
      paymentCode: payment.code,
      amountPaise: payment.amount,
      status: payment.status,
      confirmedAt: payment.confirmedAt,
      type: payment.type,
      receiptType: 'registration_receipt',
      note: 'Registration receipt. No GST is added to this fee.',
    };
  }

  @Post(':id/resend')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  async resendPayment(@Param('id') id: string) {
    return this.upiCollectionService.resendRequest(id);
  }

  @Post('request/:token/utr-hint')
  @HttpCode(HttpStatus.OK)
  async savePaymentUtrHint(@Param('token') token: string, @Body('utr') utr: unknown) {
    return this.upiCollectionService.saveUtrHint(token, utr);
  }

  @Post('request/:token/card')
  @HttpCode(HttpStatus.OK)
  async payByCard(
    @Param('token') token: string,
    @Headers('accept') accept: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.paymentService.payByCard(token);
    if (accept?.includes('text/html')) {
      res.redirect(result.paymentLink);
      return;
    }
    return result;
  }

  @Post('bank-feed/webhook')
  @HttpCode(HttpStatus.OK)
  async bankFeedWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-bank-signature') bankSig?: string,
    @Headers('x-bank-feed-signature') bankFeedSig?: string,
    @Headers('x-signature') sig?: string,
    @Headers('x-webhook-signature') webhookSig?: string,
  ) {
    const signature = bankSig || bankFeedSig || sig || webhookSig;
    return this.paymentService.handleBankFeedWebhook(req.rawBody, signature);
  }

  @Post('bank-credits')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async recordBankCredit(
    @Body()
    body: {
      bankUtr: string;
      amountPaise: number;
      receivedAt: string;
      payerName?: string;
      payerVpaMasked?: string;
      remark?: string;
    },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.recordManualBankCredit(body, req.user.sub);
  }

  @Get('bank-credits')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'read')
  @RequireRoles('ceo', 'finance')
  async listBankCredits(@Query('status') status?: string) {
    return this.paymentService.listBankCredits({ status });
  }

  @Post('bank-credits/:id/ignore')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async ignoreBankCredit(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.ignoreBankCredit(id, body.reason, req.user.sub);
  }

  @Get('review-flags')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'read')
  @RequireRoles('ceo', 'finance')
  async listReviewFlags(@Query('status') status?: string) {
    return this.paymentService.listPaymentMismatchFlags(status);
  }

  @Post('review-flags/:id/resolve')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async resolveReviewFlag(
    @Param('id') id: string,
    @Body() body: { resolution: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.resolvePaymentMismatchFlag(id, body.resolution, req.user.sub);
  }

  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async confirmPayment(
    @Param('id') id: string,
    @Body() body: { bankCreditId: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.confirmPaymentWithBankCredit(id, body.bankCreditId, req.user.sub);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'read')
  @RequireRoles('ceo', 'manager', 'finance')
  async findAll(@Query() query: PaymentFilterDto) {
    return this.paymentService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'read')
  @RequireRoles('ceo', 'manager', 'finance')
  async findById(@Param('id') id: string) {
    return this.paymentService.findById(id);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async approvePayment(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.approvePayment(id, req.user.sub);
  }

  @Post(':id/record-payout')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async recordPayout(
    @Param('id') id: string,
    @Body() body: RecordPayoutDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.recordPayout(id, req.user.sub, body);
  }

  /**
   * Collection webhook (activation and placement-fee payments). The signature is
   * verified over `req.rawBody`, the bytes the gateway sent, which requires
   * `rawBody: true` at app creation (see main.ts).
   */
  @Post('webhook')
  async webhook(
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-signature') xSig?: string,
    @Headers('x-razorpay-signature') rzpSig?: string,
    @Headers('x-webhook-signature') webhookSig?: string,
  ) {
    const signature = xSig || rzpSig || webhookSig;
    return this.paymentService.handleWebhook(body, signature, req.rawBody);
  }

  @Post('mock/simulate-webhook')
  async simulateWebhook(@Body() body: Record<string, unknown>) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException('Cannot POST /payments/mock/simulate-webhook in production');
    }
    return this.paymentService.simulateMockWebhook(body);
  }
}
