import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PayoutAccountService } from './payout-account.service';
import { CreatePayoutLinkDto } from './dto/create-payout-link.dto';
import { SubmitPayoutAccountDto } from './dto/submit-payout-account.dto';
import { Public } from '../../common/rbac/public.decorator';

@Controller('payout-accounts')
@UseInterceptors(PiiMaskingInterceptor)
export class PayoutAccountController {
  constructor(private readonly payoutAccountService: PayoutAccountService) {}

  /**
   * Send the "add your UPI or bank details" link by hand: CEO and Finance only
   * (FN-Payouts is the one screen that does this; the link sent at joining is
   * sent by the system). Payout details are money, which a Manager never sees.
   */
  @Post('links')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo', 'finance')
  async createPayoutLink(
    @Body() dto: CreatePayoutLinkDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.payoutAccountService.createPayoutLink(
      req.user.sub,
      req.user.role,
      dto,
    );
  }

  @Get('link/:token')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  async getLinkDetails(@Param('token') token: string) {
    return this.payoutAccountService.getLinkDetails(token);
  }

  @Post('send-otp')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body('token') token: string) {
    return this.payoutAccountService.sendOtp(token);
  }

  @Post('submit')
  @Public('token page: the job seeker, business or partner proves who they are with the link token')
  @HttpCode(HttpStatus.OK)
  async submitPayoutAccount(@Body() dto: SubmitPayoutAccountDto) {
    return this.payoutAccountService.submitPayoutAccount(dto);
  }

  @Get('cooling')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo', 'finance')
  async listCoolingAccounts() {
    return this.payoutAccountService.listCoolingAccounts();
  }

  /**
   * Someone's payout accounts (masked number, IFSC, verified holder name):
   * CEO and Finance only (Master Guide, Bank and UPI details, 11 Nov).
   */
  @Get(':ownerType/:ownerId')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('ceo', 'finance')
  async listAccountsForOwner(
    @Param('ownerType') ownerType: string,
    @Param('ownerId') ownerId: string,
  ) {
    return this.payoutAccountService.listAccountsForOwner(ownerType, ownerId);
  }
}
