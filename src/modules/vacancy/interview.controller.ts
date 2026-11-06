import { Body, Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { InterviewService } from './interview.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('interviews')
export class InterviewController {
  constructor(private readonly interviews: InterviewService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @UseInterceptors(PiiMaskingInterceptor)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  book(@Body() body: { vacancyId: string; jobSeekerId: string; slotId: string }, @Req() req: AuthenticatedRequest) {
    return this.interviews.book(body, req.user.sub);
  }

  @Get('reply/:token')
  async replyPage(@Param('token') token: string) {
    this.interviews.validateCandidateReplyLink(token);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview offer</title></head><body><main><h1>Can you attend this interview?</h1><button type="button" onclick="reply('yes')">Yes</button><button type="button" onclick="reply('no')">No</button><p id="result" aria-live="polite"></p></main><script>async function reply(answer){const result=document.getElementById('result');const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answer})});result.textContent=response.ok?(answer==='yes'?'Thank you. Your interview is confirmed.':'Thank you for letting us know.'):'This reply link has expired or has already been used.';}</script></body></html>`;
  }

  @Post('reply/:token')
  reply(@Param('token') token: string, @Body() body: { answer: 'yes' | 'no' }) {
    return this.interviews.respondFromLink(token, body?.answer);
  }

  @Post(':id/call-reply')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  recordCallReply(
    @Param('id') id: string,
    @Body() body: { callRecordId: string; answer: 'accepted_offer' | 'rejected_offer'; reason?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.interviews.respondFromCall(id, body.callRecordId, body.answer, body.reason, req.user.sub);
  }
}
