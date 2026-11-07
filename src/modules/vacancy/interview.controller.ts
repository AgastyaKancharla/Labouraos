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

  @Get('result/:token')
  async ownerResultPage(@Param('token') token: string) {
    this.interviews.validateOwnerResultLink(token);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview result</title></head><body><main><h1>Record interview result</h1><button type="button" onclick="sendOtp()">Send owner OTP</button><label>OTP request ID <input id="requestId"></label><label>OTP code <input id="otpCode" inputmode="numeric"></label><label>Result <select id="result"><option value="selected">Selected</option><option value="not_selected">Not selected</option><option value="candidate_no_show">Candidate did not come</option></select></label><label>Not selected reason <select id="reason"><option value="skills">Skills</option><option value="experience">Experience</option><option value="communication">Communication</option><option value="salary_expectation">Salary expectation</option><option value="not_suitable">Not suitable</option><option value="other">Other</option></select></label><label>Monthly salary (paise) <input id="salary" type="number" min="1"></label><label>Joining date <input id="joiningDate" type="date"></label><button type="button" onclick="submitResult()">Submit signed result</button><p id="message" aria-live="polite"></p></main><script>async function sendOtp(){const response=await fetch(location.pathname+'/otp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await response.json();document.getElementById('requestId').value=data.requestId||'';document.getElementById('message').textContent=data.success?'OTP sent to '+data.phone:'Unable to send OTP';}async function submitResult(){const result=document.getElementById('result').value;const body={otpRequestId:document.getElementById('requestId').value,otpCode:document.getElementById('otpCode').value,result,resultReason:document.getElementById('reason').value,selectedSalaryPaise:Number(document.getElementById('salary').value),selectedJoiningDate:document.getElementById('joiningDate').value};const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});document.getElementById('message').textContent=response.ok?'Thank you. The interview result is recorded.':'The result could not be recorded.';}</script></body></html>`;
  }

  @Post('result/:token/otp')
  sendOwnerOtp(@Param('token') token: string) {
    return this.interviews.sendOwnerResultOtp(token);
  }

  @Post('result/:token')
  submitOwnerResult(@Param('token') token: string, @Body() body: {
    otpRequestId: string;
    otpCode: string;
    result: 'selected' | 'not_selected' | 'candidate_no_show';
    resultReason?: string;
    selectedSalaryPaise?: number;
    selectedJoiningDate?: string;
  }) {
    return this.interviews.submitOwnerResult(token, body);
  }

  @Get('check/:token')
  checkPage(@Param('token') token: string) {
    this.interviews.validateCandidateCheckLink(token);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job offer check</title></head><body><main><h1>Did the business offer you the job?</h1><button type="button" onclick="answer('yes')">Yes</button><button type="button" onclick="answer('no')">No</button><p id="message" aria-live="polite"></p></main><script>async function answer(value){const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({answer:value})});document.getElementById('message').textContent=response.ok?'Thank you for answering.':'This link has expired or has already been used.';}</script></body></html>`;
  }

  @Post('check/:token')
  check(@Param('token') token: string, @Body() body: { answer: 'yes' | 'no' }) {
    return this.interviews.submitCandidateOfferCheck(token, body?.answer);
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
