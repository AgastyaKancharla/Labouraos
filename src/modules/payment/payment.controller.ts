import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';

@Controller('payments')
@UseInterceptors(PiiMaskingInterceptor)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'read')
  async findAll() {
    return this.paymentService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePermission('payment', 'read')
  async findById(@Param('id') id: string) {
    return this.paymentService.findById(id);
  }

  @Post('webhook')
  async webhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-signature') signature?: string,
  ) {
    return this.paymentService.handleWebhook(body, signature);
  }

  @Post('mock/simulate-webhook')
  async simulateWebhook(@Body() body: Record<string, unknown>) {
    return this.paymentService.handleWebhook(body);
  }
}
