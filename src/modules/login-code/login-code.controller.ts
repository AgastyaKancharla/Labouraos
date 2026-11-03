import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { LoginCodeActor, LoginCodeService } from './login-code.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('login-codes')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'manager', 'team_lead')
export class LoginCodeController {
  constructor(private readonly loginCodeService: LoginCodeService) {}

  private actor(req: AuthenticatedRequest): LoginCodeActor {
    return { id: req.user.sub, role: req.user.role };
  }

  @Get('pending')
  pending(@Req() req: AuthenticatedRequest) {
    return this.loginCodeService.listPending(this.actor(req));
  }

  @Get('report')
  report(
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.loginCodeService.report(this.actor(req), from, to);
  }

  @Post(':id/reveal')
  @HttpCode(HttpStatus.OK)
  reveal(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.loginCodeService.reveal(id, this.actor(req));
  }

  @Post(':id/refuse')
  @HttpCode(HttpStatus.OK)
  refuse(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { reason?: string },
  ) {
    return this.loginCodeService.refuse(id, this.actor(req), body?.reason ?? '');
  }
}
