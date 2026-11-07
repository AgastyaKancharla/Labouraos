import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
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

  @Post('request/:token/utr-hint')
  @HttpCode(HttpStatus.OK)
  async savePaymentUtrHint(@Param('token') token: string, @Body('utr') utr: unknown) {
    return this.upiCollectionService.saveUtrHint(token, utr);
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

  @Post(':id/disburse')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async disburse(
    @Param('id') id: string,
    @Body() body: { simulateFailure?: boolean },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.disbursePayout(id, req.user.sub, body);
  }

  @Post(':id/retry-payout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async retryPayout(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.retryPayout(id, req.user.sub);
  }

  @Post(':id/resolve-payout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'write')
  @RequireRoles('ceo', 'finance')
  async resolvePayout(
    @Param('id') id: string,
    @Body() body: { outcome?: unknown; gatewayReference?: unknown; note?: unknown },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.resolvePayout(id, req.user.sub, body);
  }

  /**
   * RazorpayX payout-status callback. Not behind JWT: it is authenticated by the
   * HMAC signature over the raw body. Requires `rawBody: true` at app creation.
   */
  @Post('payout-webhook')
  @HttpCode(HttpStatus.OK)
  async payoutWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    return this.paymentService.handlePayoutWebhook(req.rawBody, signature, eventId);
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
    return this.paymentService.handleWebhook(body);
  }
}
