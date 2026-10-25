import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
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

@Controller('payments')
@UseInterceptors(PiiMaskingInterceptor)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

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
  @RequireRoles('ceo', 'manager', 'finance')
  async disburse(
    @Param('id') id: string,
    @Body() body: { simulateFailure?: boolean },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.paymentService.disbursePayout(id, req.user.sub, body);
  }

  @Post('webhook')
  async webhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-signature') xSig?: string,
    @Headers('x-razorpay-signature') rzpSig?: string,
    @Headers('x-webhook-signature') webhookSig?: string,
  ) {
    const signature = xSig || rzpSig || webhookSig;
    return this.paymentService.handleWebhook(body, signature);
  }

  @Post('mock/simulate-webhook')
  async simulateWebhook(@Body() body: Record<string, unknown>) {
    return this.paymentService.handleWebhook(body);
  }
}
