import { BadRequestException, Body, Controller, Get, Headers, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { NoWhatsAppService } from './no-whatsapp.service';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { MessagingService } from './messaging.service';
import { Public } from '../../common/rbac/public.decorator';
import { queryText } from '../../common/http/plain-query';

@Controller()
export class MessageController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly noWhatsApp: NoWhatsAppService,
  ) {}

  /** "No WhatsApp" on a person's profile (rev 211): call agent console only (call agents read every record). */
  @Get('no-whatsapp')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent')
  noWhatsAppView(@Query('kind') kind?: string, @Query('id') id?: string) {
    return this.noWhatsApp.view(queryText(kind, 'kind'), queryText(id, 'id'));
  }

  @Put('no-whatsapp')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent')
  setNoWhatsApp(@Req() req: Request & { user: JwtPayload }, @Body() body: { kind?: unknown; id?: unknown; noWhatsApp?: unknown }) {
    return this.noWhatsApp.set({ id: req.user.sub }, body?.kind, body?.id, body?.noWhatsApp);
  }

  @Post('messages/webhook/whatsapp')
  @Public('webhook: the sender is checked by its signature, not a staff login')
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
  @Public('webhook: the sender is checked by its signature, not a staff login')
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
