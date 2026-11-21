import { Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/rbac/public.decorator';
import { parseWhatsAppWebhook, verifyChallenge, whatsappSignatureMatches } from './meta-webhook';
import { WhatsAppInboxService } from './whatsapp-inbox.service';

/**
 * The WhatsApp Cloud API webhook (Meta format, 21 Nov): inbound messages
 * become conversations, statuses move sent messages forward. Configure the
 * callback URL `https://<site>/whatsapp/webhook` in the Meta app with
 * WHATSAPP_VERIFY_TOKEN; every POST must carry X-Hub-Signature-256 signed with
 * WHATSAPP_APP_SECRET. A repeated delivery adds nothing.
 */
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(private readonly inbox: WhatsAppInboxService) {}

  @Get()
  @Public('webhook: Meta checks the endpoint with the verify token, not a staff login')
  verify(@Query() query: Record<string, unknown>) {
    const challenge = verifyChallenge(query);
    if (challenge === null) throw new ForbiddenException('Verify token does not match');
    return challenge;
  }

  @Post()
  @HttpCode(200)
  @Public('webhook: the sender is checked by its signature, not a staff login')
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') signature?: string) {
    if (!whatsappSignatureMatches(req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid WhatsApp signature');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody!.toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid WhatsApp signature');
    }
    return this.inbox.receive(parseWhatsAppWebhook(payload));
  }
}
