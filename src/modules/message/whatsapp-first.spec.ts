import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WhatsAppMessageResult, WhatsAppProvider } from '../../common/whatsapp/whatsapp.interface';
import { phoneHash } from '../call/contact-block';
import { MessagingService, SMS_BACKUP, openBackupPayload } from './messaging.service';
import { addWorkingTime, clearNoWhatsApp, isNoWhatsApp, markNoWhatsApp } from './no-whatsapp';
import { SmsProvider } from './sms.provider';

/** 25 Nov 2026 at hh:mm IST. */
function ist(hh: number, mm = 0, day = 25): Date {
  return new Date(Date.UTC(2026, 10, day, hh, mm) - (5 * 60 + 30) * 60 * 1000);
}

class FakeWhatsApp implements WhatsAppProvider {
  sent: Array<{ phone: string; template: string; params: Record<string, string>; id: string }> = [];
  refuse: string | null = null;
  async sendTemplateMessage(phone: string, templateName: string, params: Record<string, string>): Promise<WhatsAppMessageResult> {
    if (this.refuse) return { messageId: '', status: 'failed', phone, templateName, error: 'refused', errorCode: this.refuse, timestamp: new Date() };
    const id = `wamid.${randomUUID()}`;
    this.sent.push({ phone, template: templateName, params, id });
    return { messageId: id, status: 'sent', phone, templateName, timestamp: new Date() };
  }
}

class FakeSms implements SmsProvider {
  sent: Array<{ phone: string; template: string; variables: Record<string, string> }> = [];
  async sendTemplate(phone: string, template: string, _dlt: string, variables: Record<string, string>) {
    this.sent.push({ phone, template, variables });
    return { messageId: `sms.${randomUUID()}`, status: 'sent' as const };
  }
}

describe('WhatsApp first, SMS as backup (Master Guide rev 211)', () => {
  let prisma: PrismaService;
  let wa: FakeWhatsApp;
  let sms: FakeSms;
  let messaging: MessagingService;
  const subjectIds: string[] = [];
  const phones: string[] = [];

  function person() {
    const subjectId = randomUUID();
    subjectIds.push(subjectId);
    const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    phones.push(phone);
    // A business record that does not exist: no contact block, the number given explicitly.
    return { subjectType: 'business', subjectId, recipientPhone: phone };
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(() => {
    wa = new FakeWhatsApp();
    sms = new FakeSms();
    messaging = new MessagingService(prisma, wa, sms);
  });

  afterAll(async () => {
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: subjectIds } } });
    await prisma.noWhatsAppPhone.deleteMany({ where: { phoneHash: { in: phones.map((p) => phoneHash(p)) } } });
    await prisma.$disconnect();
  });

  it('counts the backup hour only between 9 AM and 9 PM IST', () => {
    const hour = 60 * 60 * 1000;
    expect(addWorkingTime(ist(10, 0), hour).toISOString()).toBe(ist(11, 0).toISOString());
    expect(addWorkingTime(ist(20, 30), hour).toISOString()).toBe(ist(9, 30, 26).toISOString());
    expect(addWorkingTime(ist(7, 0), hour).toISOString()).toBe(ist(10, 0).toISOString());
    expect(addWorkingTime(ist(22, 0), hour).toISOString()).toBe(ist(10, 0, 26).toISOString());
    expect(addWorkingTime(ist(22, 0), 0).toISOString()).toBe(ist(9, 0, 26).toISOString());
  });

  it('goes on WhatsApp only, with a sealed SMS backup due 1 working hour later; delivered means no SMS ever', async () => {
    const p = person();
    const res = await messaging.sendPreferWhatsApp({ ...p, template: 'agreement_link', variables: { link: 'https://x/p/a/secret-token' } }, ist(10, 0));
    expect(res).toMatchObject({ channel: 'whatsapp', status: 'sent' });
    expect(sms.sent).toHaveLength(0);
    const row = await prisma.messageLog.findUniqueOrThrow({ where: { id: res.id! } });
    expect(row.smsBackup).toBe(SMS_BACKUP.pending);
    expect(row.smsBackupDueAt?.toISOString()).toBe(ist(11, 0).toISOString());
    // The link token is never stored in the clear.
    expect(row.smsBackupPayload).not.toContain('secret-token');
    expect(openBackupPayload(row.smsBackupPayload)?.v.link).toBe('https://x/p/a/secret-token');

    await messaging.applyProviderStatus(row.providerMessageId!, 'delivered', null, ist(10, 5));
    expect((await prisma.messageLog.findUniqueOrThrow({ where: { id: row.id } })).smsBackup).toBe(SMS_BACKUP.notNeeded);
    await messaging.sweepSmsBackups(ist(12, 0));
    expect(sms.sent).toHaveLength(0);
  });

  it('not delivered within the working hour: the sweep sends the SMS once (never before, never twice)', async () => {
    const p = person();
    const res = await messaging.sendPreferWhatsApp({ ...p, template: 'payment_receipt', variables: { link: 'https://x/r/1' } }, ist(20, 30));
    await messaging.sweepSmsBackups(ist(20, 59));
    await messaging.sweepSmsBackups(ist(9, 29, 26));
    expect(sms.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(0);
    // Quiet hours: nothing goes even if the time has passed.
    expect(await messaging.sweepSmsBackups(ist(23, 0, 26))).toEqual({ sent: 0, failed: 0 });
    await messaging.sweepSmsBackups(ist(9, 30, 26));
    await messaging.sweepSmsBackups(ist(9, 40, 26));
    const mine = sms.sent.filter((m) => m.phone === p.recipientPhone);
    expect(mine).toEqual([{ phone: p.recipientPhone, template: 'payment_receipt', variables: { link: 'https://x/r/1' } }]);
    const row = await prisma.messageLog.findUniqueOrThrow({ where: { id: res.id! } });
    expect(row.smsBackup).toBe(SMS_BACKUP.sent);
    expect(row.smsBackupPayload).toBeNull();
    expect(row.smsBackupMessageLogId).toBeTruthy();
    // A late "delivered" changes nothing about the SMS already sent.
    await messaging.applyProviderStatus(row.providerMessageId!, 'delivered', null, ist(9, 45, 26));
    expect(sms.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(1);
  });

  it('a later "failed" (131026) sends the SMS at once and marks the number "No WhatsApp"; a repeat does nothing', async () => {
    const p = person();
    const res = await messaging.sendPreferWhatsApp({ ...p, template: 'consent_link', variables: { link: 'https://x/l' } }, ist(11, 0));
    const row = await prisma.messageLog.findUniqueOrThrow({ where: { id: res.id! } });
    const first = await messaging.applyProviderStatus(row.providerMessageId!, 'failed', '131026', ist(11, 2));
    expect(first).toMatchObject({ unchanged: false, backupHandled: true });
    await messaging.applyProviderStatus(row.providerMessageId!, 'failed', '131026', ist(11, 3));
    expect(sms.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(1);
    expect(await isNoWhatsApp(prisma, p.recipientPhone)).toBe(true);
    const after = await prisma.messageLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'failed', errorCode: '131026', smsBackup: SMS_BACKUP.sent });

    // Later messages to that number go straight by SMS.
    const next = await messaging.sendPreferWhatsApp({ ...p, template: 'payment_receipt', variables: { link: 'https://x/r' } }, ist(12, 0));
    expect(next).toMatchObject({ channel: 'sms', status: 'sent', whatsappMessageId: null });
    expect(wa.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(1);
  });

  it('a "failed" after 9 PM waits for 9 AM', async () => {
    const p = person();
    const res = await messaging.sendPreferWhatsApp({ ...p, template: 'payment_receipt', variables: { link: 'https://x/r' } }, ist(20, 50));
    const row = await prisma.messageLog.findUniqueOrThrow({ where: { id: res.id! } });
    await messaging.applyProviderStatus(row.providerMessageId!, 'failed', '131049', ist(21, 30));
    expect(sms.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(0);
    expect((await prisma.messageLog.findUniqueOrThrow({ where: { id: row.id } })).smsBackupDueAt?.toISOString()).toBe(ist(9, 0, 26).toISOString());
    // Not a "no WhatsApp" code: the number is not marked.
    expect(await isNoWhatsApp(prisma, p.recipientPhone)).toBe(false);
    await messaging.sweepSmsBackups(ist(9, 1, 26));
    expect(sms.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(1);
  });

  it('Meta refuses at sending with 131026: SMS at once, the number marked, no backup left waiting', async () => {
    const p = person();
    wa.refuse = '131026';
    const res = await messaging.sendPreferWhatsApp({ ...p, template: 'interview_cancelled', variables: {} }, ist(10, 0));
    expect(res).toMatchObject({ channel: 'sms', status: 'sent' });
    expect(res.whatsappMessageId).toBeTruthy();
    expect(await isNoWhatsApp(prisma, p.recipientPhone)).toBe(true);
    const rows = await prisma.messageLog.findMany({ where: { subjectId: p.subjectId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.channel, r.status, r.smsBackup])).toEqual([['whatsapp', 'failed', null], ['sms', 'sent', null]]);
    expect(rows[0].errorCode).toBe('131026');
  });

  it('"Send by SMS" sends no WhatsApp; a staff mark can be cleared again', async () => {
    const p = person();
    const res = await messaging.sendOn('sms', { ...p, template: 'vacancy_confirm_link', variables: { link: 'https://x/v' } });
    expect(res.channel).toBe('sms');
    expect(wa.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(0);
    expect(await markNoWhatsApp(prisma, p.recipientPhone, { source: 'staff', staffId: null })).toBe(true);
    expect(await markNoWhatsApp(prisma, p.recipientPhone, { source: 'staff', staffId: null })).toBe(false);
    expect(await clearNoWhatsApp(prisma, p.recipientPhone)).toBe(true);
    const wa1 = await messaging.sendOn('whatsapp', { ...p, template: 'vacancy_confirm_link', variables: { link: 'https://x/v' } }, );
    expect(wa1.channel).toBe('whatsapp');
  });

  it('the both-channel exceptions go on WhatsApp and SMS together and never get a backup', async () => {
    const p = person();
    const both = await messaging.sendBoth({ ...p, template: 'call_attempt_notice', variables: { candidateName: 'Ravi', trade: 'cook' } });
    expect([both.sms.channel, both.sms.status, both.whatsapp.channel, both.whatsapp.status]).toEqual(['sms', 'sent', 'whatsapp', 'sent']);
    const rows = await prisma.messageLog.findMany({ where: { subjectId: p.subjectId } });
    expect(rows.every((r) => r.smsBackup === null)).toBe(true);
    await messaging.sweepSmsBackups(ist(15, 0, 27));
    expect(sms.sent.filter((m) => m.phone === p.recipientPhone)).toHaveLength(1);
  });
});
