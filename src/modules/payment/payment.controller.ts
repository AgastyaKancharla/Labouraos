import { Controller, Get, UseGuards } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';

@Controller('payments')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get()
  @RequirePermission('payment', 'read')
  async findAll() {
    return this.paymentService.findAll();
  }
}
