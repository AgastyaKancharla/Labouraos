import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppMessageResult, WhatsAppProvider } from '../whatsapp/whatsapp.interface';
import { phoneHash } from '../../modules/call/contact-block';
import { isNoWhatsApp, markNoWhatsApp } from '../../modules/message/no-whatsapp';
import { MockOtpProvider } from './mock-otp.provider';
import { WHATSAPP_OTP_PREFIX, WhatsAppFirstOtpProvider, whatsappCodeHash } from './whatsapp-first-otp.provider';
import { whatsappIsLive } from './otp.module';

class CodeWhatsApp implements WhatsAppProvider {
  sent: Array<{ phone: string; template: string; code: string; id: string }> = [];
  refuse: string | null = null;
  async sendTemplateMessage(phone: string, templateName: string, params: Record<string, string>): Promise<WhatsAppMessageResult> {
    if (this.refuse) return { messageId: '', status: 'failed', phone, templateName, errorCode: this.refuse, timestamp: new Date() };
    const id = `wamid.${randomUUID()}`;
    this.sent.push({ phone, template: templateName, code: params.code, id });
    return { messageId: id, status: 'sent', phone, templateName, timestamp: new Date() };
  }
}

describe('Codes WhatsApp first, "Send by SMS" after 30 seconds (Master Guide rev 211)', () => {
  let prisma: PrismaService;
  let clock: number;
  let wa: CodeWhatsApp;
  let sms: MockOtpProvider;
  let otp: WhatsAppFirstOtpProvider;
  const phones: string[] = [];

  function phone() {
    const p = `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    phones.push(p);
    return p;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    clock = Date.UTC(2026, 10, 25, 6, 0);
    wa = new CodeWhatsApp();
    sms = new MockOtpProvider({ timeProvider: () => clock });
    otp = new WhatsAppFirstOtpProvider(sms, wa, prisma, () => new Date(clock));
  });

  afterAll(async () => {
    const hashes = phones.map((p) => phoneHash(p));
    await prisma.otpSession.deleteMany({ where: { phoneHash: { in: hashes } } });
    await prisma.noWhatsAppPhone.deleteMany({ where: { phoneHash: { in: hashes } } });
    await prisma.$disconnect();
  });

  it('is used only while WhatsApp is live', () => {
    expect(whatsappIsLive({})).toBe(false);
    expect(whatsappIsLive({ WHATSAPP_PROVIDER_MODE: 'mock' })).toBe(false);
    expect(whatsappIsLive({ WHATSAPP_PROVIDER_MODE: 'meta' })).toBe(true);
  });

  it('sends our own code on WhatsApp (Authentication template), stores only its HMAC, and accepts it once', async () => {
    const to = phone();
    const sent = await otp.sendOtp(to, { purpose: 'job_seeker' });
    expect(sent.requestId.startsWith(WHATSAPP_OTP_PREFIX)).toBe(true);
    expect(sent.sentBy).toBe('whatsapp');
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0].template).toBe('verification_code');
    const code = wa.sent[0].code;
    expect(code).toMatch(/^\d{6}$/);
    const row = await prisma.otpSession.findUniqueOrThrow({ where: { requestId: sent.requestId } });
    expect(row).toMatchObject({ channel: 'whatsapp', codeHash: whatsappCodeHash(sent.requestId, code), whatsappMessageId: wa.sent[0].id });
    expect(JSON.stringify(row)).not.toContain(`"${code}"`);
    expect(await otp.verifyOtp(sent.requestId, code === '000000' ? '111111' : '000000')).toBe(false);
    expect(await otp.verifyOtp(sent.requestId, code)).toBe(true);
    expect(await otp.isVerified(sent.requestId, to, 'job_seeker')).toBe(true);
    expect(await otp.isVerified(sent.requestId, to, 'business_contact')).toBe(false);
    expect(await otp.getPhoneLast4(sent.requestId)).toBe(to.slice(-4));
    expect(await otp.consumeVerified(sent.requestId, to, 'job_seeker')).toBe(true);
    expect(await otp.consumeVerified(sent.requestId, to, 'job_seeker')).toBe(false);
    expect(await otp.verifyOtp(sent.requestId, code)).toBe(false);
  });

  it('"Send by SMS" waits 30 seconds, keeps the request id, and then either code is accepted', async () => {
    const to = phone();
    const sent = await otp.sendOtp(to, { purpose: 'job_seeker' });
    const waCode = wa.sent[0].code;
    await expect(otp.sendOtp(to, { purpose: 'job_seeker', requestId: sent.requestId, channel: 'sms' })).rejects.toThrow(/Resend is available/);
    clock += 30_000;
    const bySms = await otp.sendOtp(to, { purpose: 'job_seeker', requestId: sent.requestId, channel: 'sms' });
    expect(bySms).toMatchObject({ requestId: sent.requestId, sentBy: 'sms', resendsLeft: 2 });
    const row = await prisma.otpSession.findUniqueOrThrow({ where: { requestId: sent.requestId } });
    const smsCode = sms.getCode(row.smsRequestId!)!;
    expect(smsCode).toMatch(/^\d{6}$/);
    // The WhatsApp code still works…
    expect(await otp.verifyOtp(sent.requestId, waCode)).toBe(true);
    // …and on another request the SMS code works too.
    const second = await otp.sendOtp(to, { purpose: 'referral' });
    clock += 30_000;
    await otp.sendOtp(to, { purpose: 'referral', requestId: second.requestId, channel: 'sms' });
    const secondRow = await prisma.otpSession.findUniqueOrThrow({ where: { requestId: second.requestId } });
    expect(await otp.verifyOtp(second.requestId, sms.getCode(secondRow.smsRequestId!)!)).toBe(true);
    expect(await otp.isVerified(second.requestId, to, 'referral')).toBe(true);
  });

  it('five wrong codes end the request, shared between the two codes; resend limits as before', async () => {
    const to = phone();
    const sent = await otp.sendOtp(to, { purpose: 'job_seeker' });
    const code = wa.sent[0].code;
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i += 1) expect(await otp.verifyOtp(sent.requestId, wrong)).toBe(false);
    expect(await otp.verifyOtp(sent.requestId, code)).toBe(false);
    await expect(otp.sendOtp(to, { purpose: 'job_seeker', requestId: sent.requestId })).rejects.toThrow(/no longer active/);
    // Expiry: 5 minutes.
    const late = await otp.sendOtp(to, { purpose: 'job_seeker' });
    clock += 5 * 60 * 1000 + 1;
    expect(await otp.verifyOtp(late.requestId, wa.sent[wa.sent.length - 1].code)).toBe(false);
  });

  it('a resend on WhatsApp makes a new code (the old one stops working); at most 3 resends; another number is refused', async () => {
    const to = phone();
    const sent = await otp.sendOtp(to, { purpose: 'job_seeker' });
    const first = wa.sent[0].code;
    await expect(otp.sendOtp(phone(), { purpose: 'job_seeker', requestId: sent.requestId })).rejects.toThrow(/original phone/);
    for (let i = 0; i < 3; i += 1) {
      clock += 30_000;
      await otp.sendOtp(to, { purpose: 'job_seeker', requestId: sent.requestId });
    }
    clock += 30_000;
    await expect(otp.sendOtp(to, { purpose: 'job_seeker', requestId: sent.requestId })).rejects.toThrow(/maximum of 3/);
    const latest = wa.sent[wa.sent.length - 1].code;
    if (latest !== first) expect(await otp.verifyOtp(sent.requestId, first)).toBe(false);
    expect(await otp.verifyOtp(sent.requestId, latest)).toBe(true);
  });

  it('WhatsApp refuses (131026): the SMS sender\'s code instead, and the number is marked; marked numbers go by SMS', async () => {
    const to = phone();
    wa.refuse = '131026';
    const sent = await otp.sendOtp(to, { purpose: 'job_seeker' });
    expect(sent.requestId.startsWith(WHATSAPP_OTP_PREFIX)).toBe(false);
    expect(await otp.verifyOtp(sent.requestId, sms.getCode(sent.requestId)!)).toBe(true);
    expect(await isNoWhatsApp(prisma, to)).toBe(true);
    expect(await prisma.otpSession.count({ where: { phoneHash: phoneHash(to), channel: 'whatsapp' } })).toBe(0);
    wa.refuse = null;
    const again = await otp.sendOtp(to, { purpose: 'job_seeker' });
    expect(again.requestId.startsWith(WHATSAPP_OTP_PREFIX)).toBe(false);
    expect(wa.sent).toHaveLength(0);
    // "Send by SMS" on a fresh send skips WhatsApp too.
    const other = phone();
    const direct = await otp.sendOtp(other, { purpose: 'job_seeker', channel: 'sms' });
    expect(direct.requestId.startsWith(WHATSAPP_OTP_PREFIX)).toBe(false);
    await markNoWhatsApp(prisma, other, { source: 'staff' });
  });

  it('Meta reports the code failed later: the code goes by SMS on the same request, once', async () => {
    const to = phone();
    const sent = await otp.sendOtp(to, { purpose: 'job_seeker' });
    expect(await otp.onWhatsAppFailed(wa.sent[0].id, '131026')).toBe(true);
    expect(await otp.onWhatsAppFailed(wa.sent[0].id, '131026')).toBe(true);
    expect(await otp.onWhatsAppFailed('wamid.not-a-code', '131026')).toBe(false);
    const row = await prisma.otpSession.findUniqueOrThrow({ where: { requestId: sent.requestId } });
    expect(row.smsRequestId).toBeTruthy();
    expect(await isNoWhatsApp(prisma, to)).toBe(true);
    expect(await otp.verifyOtp(sent.requestId, sms.getCode(row.smsRequestId!)!)).toBe(true);
  });

  it('requests the SMS sender made stay the SMS sender\'s', async () => {
    const to = phone();
    const own = await sms.sendOtp(to, { purpose: 'job_seeker' });
    expect(await otp.verifyOtp(own.requestId, sms.getCode(own.requestId)!)).toBe(true);
    expect(await otp.isVerified(own.requestId, to, 'job_seeker')).toBe(true);
    expect(await otp.getPurpose(own.requestId)).toBe('job_seeker');
  });
});
