import { BadRequestException, Controller, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { MessagingService } from './messaging.service';

@Controller()
export class MessageController {
  constructor(private readonly messaging: MessagingService) {}

  @Post('messages/webhook/whatsapp')
  whatsapp(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-message-signature') sig1?: string,
    @Headers('x-signature') sig2?: string,
    @Headers('x-hub-signature-256') sig3?: string,
  ) {
    const signature = sig1 || sig2 || sig3;
    return this.messaging.applyDelivery(req.rawBody, signature);
  }

  @Post('messages/webhook/sms')
  sms(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-message-signature') sig1?: string,
    @Headers('x-signature') sig2?: string,
  ) {
    const signature = sig1 || sig2;
    return this.messaging.applyDelivery(req.rawBody, signature);
  }

  @Get('messages')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('team_lead', 'manager', 'ceo')
  list(
    @Req() req: Request & { user: JwtPayload },
    @Query('subjectType') subjectType?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    if (!subjectType || !subjectId) {
      throw new BadRequestException('subjectType and subjectId are required');
    }
    return this.messaging.list({ id: req.user.sub, role: req.user.role }, subjectType, subjectId);
  }
}
