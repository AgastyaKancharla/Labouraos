import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WHATSAPP_PROVIDER, WhatsAppMessageResult } from '../../common/whatsapp/whatsapp.interface';
import { MockWhatsAppProvider } from '../../common/whatsapp/mock-whatsapp.provider';
import { SMS_PROVIDER, SmsProvider, SmsSendResult } from '../message/sms.provider';
import { MessagingService } from '../message/messaging.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { AttendanceService } from '../attendance/attendance.service';
import { encryptCallRoutingPhone } from '../staff/call-routing-key';
import { ConsentLinkService } from '../consent/consent-link.service';
import { RetentionService } from '../retention/retention.service';
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';
import { WhatsAppInboxService } from './whatsapp-inbox.service';
import { WhatsAppEventsService, MAX_SEND_TRIES } from './whatsapp-events.service';
import { resolveRegistrationPrefill } from './lead-call.service';

const APP_SECRET = 'whatsapp_app_secret_for_review_tests_32';
/** Wednesday 24 March 2027, 11:00 IST: a date no other suite opens attendance days on. */
const DAY_11 = new Date('2027-03-24T05:30:00.000Z');
const MIN = 60_000;

class FrozenClock {
  at = DAY_11;
  now(): Date {
    return this.at;
  }
}

class SwitchableWhatsApp extends MockWhatsAppProvider {
  fail = false;
  async sendTemplateMessage(phone: string, templateName: string, params: Record<string, string>): Promise<WhatsAppMessageResult> {
    if (this.fail) return { messageId: '', status: 'failed', phone, templateName, error: 'down', timestamp: new Date() };
    return super.sendTemplateMessage(phone, templateName, params);
  }
}

class SwitchableSms implements SmsProvider {
  fail = false;
  sent: string[] = [];
  async sendTemplate(phone: string, template: string): Promise<SmsSendResult> {
    if (this.fail) return { messageId: '', status: 'failed', error: 'down' };
    this.sent.push(`${phone}:${template}`);
    return { messageId: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, status: 'sent' };
  }
}

describe('WhatsApp review fixes (21 Nov): heard-from, linking, failed links, calls by id, lead follow-up, retries, retention, blocks', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let inbox: WhatsAppInboxService;
  let events: WhatsAppEventsService;
  let messaging: MessagingService;
  const clock = new FrozenClock();
  const wa = new SwitchableWhatsApp();
  const sms = new SwitchableSms();
  const stamp = String(Date.now());
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const referralIds: string[] = [];
  const businessIds: string[] = [];
  const phones: string[] = [];
  let n = 0;
  const newPhone = () => {
    const p = `+9177${stamp.slice(-6)}${String((n += 1)).padStart(2, '0')}`;
    phones.push(p);
    return p;
  };
  type S = { id: string; role: string; code: string };
  let ceo: S;
  let manager: S;
  let tl: S;
  let tl2: S;
  let agentA: S;
  let agentB: S;
  let agentC: S;

  const bearer = (s: S) => `Bearer ${jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null })}`;
  const api = () => request(app.getHttpServer());

  async function makeStaff(role: string, boss?: S, callPhone?: string): Promise<S> {
    const i = staffIds.length;
    const s = await prisma.staff.create({
      data: {
        code: `WR-${role.slice(0, 3).toUpperCase()}-${stamp}-${i}`,
        name: `Review ${role} ${i}`,
        email: `wr-${role}-${stamp}-${i}@laboura.local`,
        passwordHash: await bcrypt.hash('Review-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: boss && role === 'call_agent' ? boss.id : null,
        reportsToId: boss?.id ?? null,
        callRoutingPhone: callPhone ? encryptCallRoutingPhone(callPhone) : null,
      },
    });
    staffIds.push(s.id);
    return { id: s.id, role: s.role, code: s.code };
  }

  async function makeSeeker(extra: { phone?: string; registeredByStaffId?: string | null; status?: string; paymentReceivedAt?: Date | null; heardFrom?: string } = {}) {
    const s = await prisma.jobSeeker.create({
      data: {
        code: `JS-R${stamp.slice(-5)}${seekerIds.length}`,
        name: `Review Person ${seekerIds.length}`,
        phone: extra.phone ?? newPhone(),
        minSalary: 1500000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: extra.status ?? 'lead',
        paymentReceivedAt: extra.paymentReceivedAt ?? null,
        registeredByStaffId: extra.registeredByStaffId ?? null,
        heardFrom: extra.heardFrom ?? null,
        trades: { create: { trade: 'Cook', isPrimary: true } },
      },
    });
    seekerIds.push(s.id);
    return s;
  }

  async function makePartner(extra: { registeredByStaffId?: string } = {}) {
    const r = await prisma.referral.create({ data: { code: `RF-R${stamp.slice(-5)}${referralIds.length}`, name: 'Suresh Babu', phone: newPhone(), registeredByStaffId: extra.registeredByStaffId ?? null } });
    referralIds.push(r.id);
    return r;
  }

  async function onShift(staff: S) {
    await app.get(AttendanceService).login(staff.id, {});
    await app.get(AttendanceService).setStatus(staff.id, 'available');
  }

  function deliver(raw: string) {
    const sig = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
    return api().post('/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);
  }

  function inbound(phone: string, text: string, name = 'Sender') {
    const from = phone.replace('+', '');
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ profile: { name }, wa_id: from }],
        messages: [{ from, id: `wamid.R.${stamp}.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(clock.now().getTime() / 1000)), type: 'text', text: { body: text } }],
      } }] }],
    });
  }

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_PROVIDER).useValue(wa)
      .overrideProvider(SMS_PROVIDER).useValue(sms)
      .overrideProvider(WhatsAppInboxClock).useValue(clock)
      .overrideProvider(AttendanceClock).useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    inbox = app.get(WhatsAppInboxService);
    events = app.get(WhatsAppEventsService);
    messaging = app.get(MessagingService);
    ceo = await makeStaff('ceo');
    manager = await makeStaff('manager', ceo);
    tl = await makeStaff('team_lead', manager);
    tl2 = await makeStaff('team_lead', manager);
    agentA = await makeStaff('call_agent', tl, newPhone());
    agentB = await makeStaff('call_agent', tl, newPhone());
    agentC = await makeStaff('call_agent', tl2, newPhone());
  }, 120000);

  afterAll(async () => {
    const convs = await prisma.whatsAppConversation.findMany({ where: { OR: [{ phone: { in: phones } }, { phone: { startsWith: 'anon:' }, subjectId: { in: seekerIds } }] }, select: { id: true } });
    const convIds = convs.map((c) => c.id);
    const leadIds = (await prisma.referralLead.findMany({ where: { referralId: { in: referralIds } }, select: { id: true } })).map((l) => l.id);
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectId: { in: [...convIds, ...leadIds] } }] } });
    await prisma.whatsAppConversation.deleteMany({ where: { id: { in: convIds } } });
    await prisma.referralLead.deleteMany({ where: { referralId: { in: referralIds } } });
    await prisma.callRecord.deleteMany({ where: { OR: [{ staffId: { in: staffIds } }, { subjectId: { in: seekerIds } }] } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: [...seekerIds, ...referralIds, ...businessIds, ...convIds] } } });
    await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: [...seekerIds, ...referralIds, ...businessIds] } } });
    await prisma.payoutAccount.deleteMany({ where: { ownerId: { in: referralIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.attendanceSegment.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: [...seekerIds, ...referralIds] } } });
    await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.referralIdentityVerification.deleteMany({ where: { referralId: { in: referralIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('B1: a job seeker with heard-from "whatsapp" is accepted by the database (and by the validator)', async () => {
    const s = await makeSeeker({ heardFrom: 'whatsapp' });
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id: s.id } })).heardFrom).toBe('whatsapp');
    await expect(makeSeeker({ heardFrom: 'carrier_pigeon' })).rejects.toThrow();
    const { HEARD_FROM_VALUES } = await import('../job-seeker/job-seeker.validator');
    expect(HEARD_FROM_VALUES).toContain('whatsapp');
  });

  it('S3: linking a conversation to a record with another number needs a Team Lead (with a reason, own team only)', async () => {
    await onShift(agentA);
    const phone = newPhone();
    await deliver(inbound(phone, 'Hello, I am already registered')).expect(200);
    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { phone } });
    await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { assignedStaffId: agentA.id } });
    const other = await makeSeeker({ registeredByStaffId: agentC.id });
    const mine = await makeSeeker({ registeredByStaffId: agentA.id });

    const refused = await api().post(`/whatsapp/conversations/${conv.id}/link`).set('Authorization', bearer(agentA)).send({ code: mine.code });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NUMBER_DOES_NOT_MATCH');
    await api().post(`/whatsapp/conversations/${conv.id}/link`).set('Authorization', bearer(tl)).send({ code: mine.code }).expect(400);
    // Another team's record: the Team Lead cannot see it.
    await api().post(`/whatsapp/conversations/${conv.id}/link`).set('Authorization', bearer(tl)).send({ code: other.code, reason: 'Same person, new number' }).expect(404);
    await api().post(`/whatsapp/conversations/${conv.id}/link`).set('Authorization', bearer(tl)).send({ code: mine.code, reason: 'Same person, new number' }).expect(200);
    expect(await prisma.auditLog.count({ where: { actorId: tl.id, action: 'whatsapp.conversation_linked' } })).toBe(1);

    // A record with this very number links by itself, for the agent too.
    const phone2 = newPhone();
    await deliver(inbound(phone2, 'hi')).expect(200);
    const conv2 = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { phone: phone2 } });
    await prisma.whatsAppConversation.update({ where: { id: conv2.id }, data: { assignedStaffId: agentA.id } });
    const same = await makeSeeker({ phone: phone2 });
    await api().post(`/whatsapp/conversations/${conv2.id}/link`).set('Authorization', bearer(agentA)).send({ code: same.code }).expect(200);
  });

  it('S3/S9: the block is checked on the conversation\'s number too, not only on the linked record', async () => {
    const phone = newPhone();
    const blocked = await makeSeeker({ phone });
    await prisma.callRecord.create({
      data: { code: `CL-R1${stamp.slice(-6)}`, provider: 'mock', providerCallId: `wr-dnc-${stamp}`, providerStatus: 'completed', subjectType: 'job_seeker', subjectId: blocked.id, agentOutcome: 'do_not_call', agentOutcomeAt: clock.now() },
    });
    await deliver(inbound(phone, 'Who is this?')).expect(200);
    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { phone } });
    // Pretend it was linked to someone else: templates still refused because of the number.
    const elsewhere = await makeSeeker();
    await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { subjectType: 'job_seeker', subjectId: elsewhere.id, assignedStaffId: agentA.id } });
    clock.at = new Date(DAY_11.getTime() + 25 * 60 * MIN);
    const res = await api().post(`/whatsapp/conversations/${conv.id}/template`).set('Authorization', bearer(agentA)).send({ template: 'whatsapp_follow_up' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DO_NOT_CONTACT');
    clock.at = DAY_11;
    // Calling that number is refused too.
    const call = await api().post(`/whatsapp/conversations/${conv.id}/call`).set('Authorization', bearer(agentA));
    expect(call.status).toBe(403);
    expect(call.body.code).toBe('DO_NOT_CALL');
  });

  it('S9: lift-aware stand-in: a later answered call lifts a block; a do-not-call still gets its payment receipt', async () => {
    const s = await makeSeeker();
    await prisma.callRecord.create({
      data: { code: `CL-R2${stamp.slice(-6)}`, provider: 'mock', providerCallId: `wr-dnc2-${stamp}`, providerStatus: 'completed', subjectType: 'job_seeker', subjectId: s.id, agentOutcome: 'do_not_call', agentOutcomeAt: new Date(DAY_11.getTime() - 60 * MIN) },
    });
    expect(await messaging.messagingBlocked('job_seeker', s.id)).toBe(true);
    expect(await messaging.messagingBlocked('job_seeker', s.id, 'payment_receipt')).toBe(false);
    expect(await messaging.messagingBlocked('job_seeker', s.id, 'consent_link')).toBe(true);
    const receipt = await messaging.send({ channel: 'sms', template: 'payment_receipt', subjectType: 'job_seeker', subjectId: s.id, variables: { link: 'x' } });
    expect(receipt.status).toBe('sent');
    await prisma.callRecord.create({
      data: { code: `CL-R3${stamp.slice(-6)}`, provider: 'mock', providerCallId: `wr-lift-${stamp}`, providerStatus: 'completed', answered: true, subjectType: 'job_seeker', subjectId: s.id, agentOutcome: 'interested', agentOutcomeAt: DAY_11 },
    });
    expect(await messaging.messagingBlocked('job_seeker', s.id)).toBe(false);
  });

  it('S1: a new WhatsApp contact is called by conversation id and registered with a prefill reference (never the number)', async () => {
    const phone = newPhone();
    await deliver(inbound(phone, 'I need a job', 'Manju')).expect(200);
    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { phone } });
    await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { assignedStaffId: agentA.id } });
    // Another agent cannot call it (he cannot even see it).
    await api().post(`/whatsapp/conversations/${conv.id}/call`).set('Authorization', bearer(agentB)).expect(404);
    const placed = await api().post(`/whatsapp/conversations/${conv.id}/call`).set('Authorization', bearer(agentA)).expect(200);
    const record = await prisma.callRecord.findUniqueOrThrow({ where: { id: placed.body.callRecordId } });
    expect(record).toMatchObject({ staffId: agentA.id, subjectType: null, relatedType: 'whatsapp_conversation', relatedId: conv.id, direction: 'outbound' });
    expect(JSON.stringify(placed.body)).not.toContain(phone.slice(3));

    // WhatsApp registration prefill: another agent's conversation is 404
    await api().post(`/whatsapp/conversations/${conv.id}/registration-prefill`).set('Authorization', bearer(agentB)).expect(404);
    const prefill = await api().post(`/whatsapp/conversations/${conv.id}/registration-prefill`).set('Authorization', bearer(agentA)).expect(200);
    expect(prefill.body).toMatchObject({ name: 'Manju', heardFrom: 'whatsapp', maskedPhone: `******${phone.slice(-4)}` });
    expect(JSON.stringify(prefill.body)).not.toContain(phone.slice(3));
    expect(resolveRegistrationPrefill(prefill.body.prefillRef, agentA.id, clock.now())).toBe(phone);
    expect(resolveRegistrationPrefill(prefill.body.prefillRef, agentB.id, clock.now())).toBeNull();
    expect(resolveRegistrationPrefill(prefill.body.prefillRef, agentA.id, new Date(clock.now().getTime() + 31 * MIN))).toBeNull();
  });

  it('S1/S8: a partner lead is called by id; until then it waits, moves off an agent who is off shift, and rings the Team Lead then the Manager', async () => {
    const partner = await makePartner({ registeredByStaffId: agentC.id });
    const lead = await prisma.referralLead.create({
      data: { referralId: partner.id, name: 'Kiran Raj', phone: newPhone(), lookingFor: 'job', source: 'link', status: 'open', assignedStaffId: agentC.id, assignedAt: clock.now(), createdAt: clock.now() },
    });
    // agentC is not on shift: the sweep moves the lead to an agent who is.
    await inbox.sweep(clock.now());
    const moved = await prisma.referralLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(moved.assignedStaffId).not.toBe(agentC.id);
    expect([agentA.id]).toContain(moved.assignedStaffId);
    for (let i = 0; i < 2; i += 1) {
      clock.at = new Date(clock.at.getTime() + 10 * MIN);
      await inbox.sweep(clock.now());
    }
    expect(await prisma.notification.count({ where: { recipientStaffId: tl.id, kind: 'referral_lead_waiting', subjectId: lead.id, clearedAt: null } })).toBe(1);
    for (let i = 0; i < 11; i += 1) {
      clock.at = new Date(clock.at.getTime() + 10 * MIN);
      await inbox.sweep(clock.now());
    }
    expect(await prisma.notification.count({ where: { recipientStaffId: manager.id, kind: 'referral_lead_waiting', subjectId: lead.id, clearedAt: null } })).toBe(1);
    clock.at = DAY_11;

    // Partner lead call: only the agent who has the lead (404 for another)
    await api().post(`/referral-leads/${lead.id}/call`).set('Authorization', bearer(agentB)).expect(404);
    // Partner lead registration prefill: only the agent who has the lead (404 for another)
    await api().post(`/referral-leads/${lead.id}/registration-prefill`).set('Authorization', bearer(agentB)).expect(404);
    const placed = await api().post(`/referral-leads/${lead.id}/call`).set('Authorization', bearer(agentA)).expect(200);
    expect((await prisma.callRecord.findUniqueOrThrow({ where: { id: placed.body.callRecordId } })).relatedType).toBe('referral_lead');
    expect((await prisma.referralLead.findUniqueOrThrow({ where: { id: lead.id } })).firstCalledAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { subjectId: lead.id, clearedAt: null } })).toBe(0);
    const prefill = await api().post(`/referral-leads/${lead.id}/registration-prefill`).set('Authorization', bearer(agentA)).expect(200);
    expect(prefill.body).toMatchObject({ name: 'Kiran Raj', heardFrom: 'referral_partner', referredBy: { code: partner.code } });
    expect(JSON.stringify(prefill.body)).not.toContain(lead.phone.slice(3));
  });

  it('S4: WhatsApp fails a link later: a fresh link goes by SMS and the agent who sent it gets a bell; the earlier link keeps working', async () => {
    const s = await makeSeeker({ registeredByStaffId: agentA.id });
    await app.get(ConsentLinkService).createLink(s.id);
    const before = await prisma.publicLink.count({ where: { subjectId: s.id, revokedAt: null } });
    await api().post(`/whatsapp/send-link/registration/${s.id}`).set('Authorization', bearer(agentA)).expect(200);
    const waLog = await prisma.messageLog.findFirstOrThrow({ where: { subjectId: s.id, template: 'consent_link', channel: 'whatsapp', status: 'sent' } });
    expect(waLog).toMatchObject({ relatedType: 'sent_by_staff', relatedId: agentA.id });
    expect(await prisma.publicLink.count({ where: { subjectId: s.id, revokedAt: null } })).toBe(before + 1);
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: waLog.providerMessageId, status: 'failed', timestamp: '1' }] } }] }] });
    await deliver(raw).expect(200);
    await deliver(raw).expect(200);
    const smsLogs = await prisma.messageLog.findMany({ where: { subjectId: s.id, template: 'consent_link', channel: 'sms', status: 'sent', createdAt: { gt: waLog.createdAt } } });
    expect(smsLogs).toHaveLength(1);
    const bell = await prisma.notification.findFirst({ where: { recipientStaffId: agentA.id, kind: 'whatsapp_link_failed' } });
    expect(bell?.title).toContain('went by SMS');
    expect(await prisma.publicLink.count({ where: { subjectId: s.id, revokedAt: null } })).toBe(before + 2);
  });

  describe('S2 and the event messages', () => {
    it('payment stuck: one WhatsApp after an hour at the payment step', async () => {
      clock.at = new Date('2027-03-25T06:30:00.000Z');
      const s = await makeSeeker();
      const lead = await prisma.jobSeeker.update({ where: { id: s.id }, data: { photoStoragePath: 'x/selfie.jpg', guaranteeFloorPaise: 1500000 } });
      for (const purpose of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates']) {
        await prisma.consent.create({ data: { subjectType: 'job_seeker', subjectId: lead.id, purpose, granted: true, grantedAt: new Date('2027-03-25T04:00:00Z'), noticeVersion: '1.2', language: 'en', method: 'sms_link' } });
      }
      await prisma.identityVerification.create({ data: { jobSeekerId: lead.id, method: 'aadhaar_qr', vendor: 'in_house', status: 'verified' } });
      await app.get(ConsentLinkService).createLink(lead.id, { sms: false });
      await prisma.publicLink.updateMany({ where: { subjectId: lead.id }, data: { createdAt: new Date('2027-03-25T04:00:00Z') } });
      await prisma.consent.updateMany({ where: { subjectId: lead.id }, data: { updatedAt: new Date('2027-03-25T04:00:00Z') } });
      await prisma.identityVerification.updateMany({ where: { jobSeekerId: lead.id }, data: { updatedAt: new Date('2027-03-25T04:00:00Z') } });
      const result = await events.sweep(clock.now());
      expect(result.payment).toBeGreaterThanOrEqual(1);
      expect(await prisma.messageLog.findFirst({ where: { subjectId: lead.id, template: 'payment_stuck' } })).toMatchObject({ channel: 'whatsapp', status: 'sent', relatedId: 'payment' });
    });

    it('partner and business done: one message each', async () => {
      clock.at = new Date('2027-03-25T06:30:00.000Z');
      const partner = await makePartner();
      await prisma.referral.update({ where: { id: partner.id }, data: { photoStoragePath: 'p/selfie.jpg' } });
      await prisma.consent.create({ data: { subjectType: 'referral', subjectId: partner.id, purpose: 'agreement_terms', granted: true, grantedAt: clock.now(), noticeVersion: '1.0', language: 'en', method: 'sms_link' } });
      await prisma.referralIdentityVerification.create({ data: { referralId: partner.id, method: 'aadhaar_qr', vendor: 'in_house', status: 'verified', nameMatches: true, isAdult: true } });
      await prisma.payoutAccount.create({
        data: { code: `PA-R${stamp.slice(-6)}`, ownerType: 'referral', ownerId: partner.id, ownerNameAtEntry: 'Suresh Babu', method: 'upi', maskedValue: 'su***@upi', valueHash: `h-${stamp}`, status: 'verified', activeFrom: clock.now() },
      });
      await prisma.payoutAccount.updateMany({ where: { ownerId: partner.id }, data: { updatedAt: clock.now() } });
      const b = await prisma.business.create({
        data: { code: `BZ-R${stamp.slice(-6)}`, name: 'Lakshmi Bakery', ownerName: 'Lakshmi', phone: newPhone(), verificationStatus: 'verified', verifiedAt: new Date(clock.now().getTime() - 60 * MIN) },
      });
      businessIds.push(b.id);
      await events.sweep(clock.now());
      await events.sweep(clock.now());
      expect(await prisma.messageLog.count({ where: { subjectId: partner.id, template: 'partner_registration_done', status: 'sent' } })).toBe(1);
      expect(await prisma.messageLog.count({ where: { subjectId: b.id, template: 'business_registration_done', status: 'sent' } })).toBe(1);
    });

    it('both channels failing: at most 3 tries with a growing gap, then it stops', async () => {
      const s = await makeSeeker({ status: 'active', paymentReceivedAt: new Date('2027-03-25T05:00:00Z') });
      wa.fail = true;
      sms.fail = true;
      try {
        clock.at = new Date('2027-03-25T06:30:00.000Z');
        const failedTries = () => prisma.messageLog.count({ where: { subjectId: s.id, template: 'registration_done', channel: 'whatsapp', status: 'failed' } });
        // Each try's time is when its row was written: set it relative to the test clock.
        const triedAgo = (minutes: number) => prisma.messageLog.updateMany({ where: { subjectId: s.id }, data: { createdAt: new Date(clock.now().getTime() - minutes * MIN) } });
        await events.sweep(clock.now());
        expect(await failedTries()).toBe(1);
        await triedAgo(2);
        await events.sweep(clock.now());
        expect(await failedTries()).toBe(1);
        await triedAgo(11);
        await events.sweep(clock.now());
        expect(await failedTries()).toBe(2);
        await triedAgo(30);
        await events.sweep(clock.now());
        expect(await failedTries()).toBe(2);
        await triedAgo(61);
        await events.sweep(clock.now());
        expect(await failedTries()).toBe(MAX_SEND_TRIES);
        await triedAgo(24 * 60);
        await events.sweep(clock.now());
        expect(await failedTries()).toBe(MAX_SEND_TRIES);
        expect(await prisma.messageLog.count({ where: { subjectId: s.id, template: 'registration_done', channel: 'sms', status: 'failed' } })).toBe(MAX_SEND_TRIES);
      } finally {
        wa.fail = false;
        sms.fail = false;
      }
    });

    it('stopped part-way: never more than 3 nudges, a day apart', async () => {
      const s = await makeSeeker();
      const nudges = () => prisma.messageLog.count({ where: { subjectId: s.id, template: { in: ['registration_stopped', 'payment_stuck'] }, status: 'sent' } });
      // Three earlier nudges (other steps), the last one two days ago.
      for (const [i, step] of ['consent', 'selfie', 'id_check'].entries()) {
        await prisma.messageLog.create({ data: { channel: 'whatsapp', template: 'registration_stopped', subjectType: 'job_seeker', subjectId: s.id, relatedType: 'registration_step', relatedId: `${step}-old-${i}`, status: 'sent', createdAt: new Date(Date.now() - (5 - i) * 24 * 60 * MIN) } });
      }
      clock.at = new Date('2027-03-26T06:30:00.000Z');
      await app.get(ConsentLinkService).createLink(s.id, { sms: false });
      await prisma.publicLink.updateMany({ where: { subjectId: s.id }, data: { createdAt: new Date('2027-03-26T02:00:00Z') } });
      const linksBefore = await prisma.publicLink.count({ where: { subjectId: s.id } });
      await events.sweep(clock.now());
      expect(await nudges()).toBe(3);
      // Decided before any link is made: no extra link for a nudge that is not sent.
      expect(await prisma.publicLink.count({ where: { subjectId: s.id } })).toBe(linksBefore);
    });

    it('referral_lead_received waits for the morning in quiet hours', async () => {
      const partner = await makePartner();
      const lead = await prisma.referralLead.create({ data: { referralId: partner.id, name: 'Night Lead', phone: newPhone(), lookingFor: 'job', source: 'link', status: 'open', createdAt: new Date('2027-03-25T17:00:00Z') } });
      clock.at = new Date('2027-03-25T17:30:00.000Z'); // 23:00 IST
      await events.sweep(clock.now());
      expect(await prisma.messageLog.count({ where: { relatedId: lead.id, template: 'referral_lead_received' } })).toBe(0);
      clock.at = new Date('2027-03-26T04:00:00.000Z'); // 09:30 IST
      await events.sweep(clock.now());
      expect(await prisma.messageLog.count({ where: { relatedId: lead.id, template: 'referral_lead_received', status: 'sent' } })).toBe(1);
    });
  });

  it('S7: retention removes old message text (not during a dispute) and anonymises conversations and leads of anonymised people', async () => {
    clock.at = DAY_11;
    const phone = newPhone();
    await deliver(inbound(phone, 'old private message')).expect(200);
    const conv = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { phone } });
    await prisma.whatsAppMessage.updateMany({ where: { conversationId: conv.id }, data: { createdAt: new Date('2025-01-01T00:00:00Z') } });
    const gone = await makeSeeker();
    const goneConv = await prisma.whatsAppConversation.create({ data: { phone: newPhone(), profileName: 'Gone Person', subjectType: 'job_seeker', subjectId: gone.id, status: 'open' } });
    await prisma.jobSeeker.update({ where: { id: gone.id }, data: { anonymisedAt: new Date() } });
    const partner = await makePartner();
    const lead = await prisma.referralLead.create({ data: { referralId: partner.id, name: 'Old Lead', phone: newPhone(), lookingFor: 'job', source: 'link', status: 'closed', closedAt: new Date('2024-01-01T00:00:00Z'), createdAt: new Date('2024-01-01T00:00:00Z') } });
    await prisma.referralLead.update({ where: { id: lead.id }, data: { closedAt: new Date('2024-01-01T00:00:00Z') } });

    const summary = await app.get(RetentionService).runRetentionCleanup({ now: new Date() });
    expect(summary.whatsapp?.messagesCleared).toBeGreaterThanOrEqual(1);
    expect((await prisma.whatsAppMessage.findFirstOrThrow({ where: { conversationId: conv.id, direction: 'in' } })).body).toBeNull();
    const anon = await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: goneConv.id } });
    expect(anon.phone).toBe(`anon:${goneConv.id}`);
    expect(anon.profileName).toBeNull();
    const anonLead = await prisma.referralLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(anonLead).toMatchObject({ name: 'Anonymised', phone: `anon:${lead.id}` });
  });
});
