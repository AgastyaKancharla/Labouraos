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
import { WhatsAppInboxClock } from './whatsapp-inbox.clock';
import { WhatsAppInboxService } from './whatsapp-inbox.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { ConsentLinkService } from '../consent/consent-link.service';
import { WhatsAppInboxJob } from '../../jobs/whatsapp-inbox.job';

const APP_SECRET = 'whatsapp_app_secret_for_e2e_tests_32ch';
const VERIFY_TOKEN = 'verify-token-for-e2e-tests';
/** Wednesday 3 March 2027, 11:00 IST: a date no other suite opens attendance days on. */
const DAY1_11 = new Date('2027-03-03T05:30:00.000Z');
const DAY1 = new Date('2027-03-03T00:00:00.000Z');
const MIN = 60_000;

class FrozenClock {
  at = DAY1_11;
  now(): Date {
    return this.at;
  }
}

/** The mock sender, with a switch that makes WhatsApp fail (to see the SMS fallback). */
class SwitchableWhatsApp extends MockWhatsAppProvider {
  fail = false;
  async sendTemplateMessage(phone: string, templateName: string, params: Record<string, string>): Promise<WhatsAppMessageResult> {
    if (this.fail) return { messageId: '', status: 'failed', phone, templateName, error: 'down', timestamp: new Date() };
    return super.sendTemplateMessage(phone, templateName, params);
  }
}

describe('WhatsApp (rev 202): inbound conversations as tracked leads, the WhatsApp tab, bells, event messages', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let inbox: WhatsAppInboxService;
  let events: WhatsAppEventsService;
  const clock = new FrozenClock();
  const provider = new SwitchableWhatsApp();
  const stamp = String(Date.now());
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const phones: string[] = [];
  let n = 0;
  const newPhone = () => {
    const p = `+9179${stamp.slice(-6)}${String((n += 1)).padStart(2, '0')}`;
    phones.push(p);
    return p;
  };
  let wamid = 0;

  type S = { id: string; role: string; code: string };
  let manager: S;
  let tl: S;
  let tl2: S;
  let agentA: S;
  let agentB: S;
  let agentC: S;
  let ceo: S;
  let seeker: { id: string; phone: string; code: string };
  let unknownPhone: string;

  const bearer = (s: S) => `Bearer ${jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null })}`;
  const api = () => request(app.getHttpServer());

  async function makeStaff(role: string, boss?: S): Promise<S> {
    const i = staffIds.length;
    const s = await prisma.staff.create({
      data: {
        code: `WA-${role.slice(0, 3).toUpperCase()}-${stamp}-${i}`,
        name: `WhatsApp ${role} ${i}`,
        email: `wa-${role}-${stamp}-${i}@laboura.local`,
        passwordHash: await bcrypt.hash('WhatsApp-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: boss && (role === 'call_agent' || role === 'field_agent') ? boss.id : null,
        reportsToId: boss?.id ?? null,
      },
    });
    staffIds.push(s.id);
    return { id: s.id, role: s.role, code: s.code };
  }

  async function onShift(staff: S, date = DAY1) {
    await prisma.attendanceDay.create({ data: { staffId: staff.id, date, loginAt: clock.now(), dayType: 'open' } });
  }

  function webhookBody(phone: string, text: string, id = `wamid.${stamp}.${(wamid += 1)}`, name = 'Sender Name') {
    const from = phone.replace('+', '');
    return {
      id,
      raw: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '918000000000', phone_number_id: '1' },
          contacts: [{ profile: { name }, wa_id: from }],
          messages: [{ from, id, timestamp: String(Math.floor(clock.now().getTime() / 1000)), type: 'text', text: { body: text } }],
        } }] }],
      }),
    };
  }

  function deliver(raw: string, secret = APP_SECRET) {
    const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return api().post('/whatsapp/webhook').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);
  }

  async function conversation(phone: string) {
    return prisma.whatsAppConversation.findUniqueOrThrow({ where: { phone } });
  }

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_PROVIDER)
      .useValue(provider)
      .overrideProvider(WhatsAppInboxClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    inbox = app.get(WhatsAppInboxService);
    events = app.get(WhatsAppEventsService);

    ceo = await makeStaff('ceo');
    manager = await makeStaff('manager', ceo);
    tl = await makeStaff('team_lead', manager);
    tl2 = await makeStaff('team_lead', manager);
    agentA = await makeStaff('call_agent', tl);
    agentB = await makeStaff('call_agent', tl);
    agentC = await makeStaff('call_agent', tl2);
    const s = await prisma.jobSeeker.create({
      data: {
        code: `JS-W${stamp.slice(-6)}`,
        name: 'Ravi Kumar',
        phone: newPhone(),
        minSalary: 1500000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        status: 'lead',
        registeredByStaffId: agentA.id,
        trades: { create: { trade: 'Cook', isPrimary: true } },
      },
    });
    seekerIds.push(s.id);
    seeker = { id: s.id, phone: s.phone, code: s.code };
    unknownPhone = newPhone();
  }, 120000);

  afterAll(async () => {
    const convs = await prisma.whatsAppConversation.findMany({ where: { phone: { in: phones } }, select: { id: true } });
    const convIds = convs.map((c) => c.id);
    await prisma.notification.deleteMany({ where: { OR: [{ recipientStaffId: { in: staffIds } }, { subjectId: { in: convIds } }] } });
    await prisma.whatsAppConversation.deleteMany({ where: { id: { in: convIds } } });
    await prisma.contactAttempt.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.messageLog.deleteMany({ where: { OR: [{ subjectId: { in: [...seekerIds, ...convIds] } }, { relatedId: { in: convIds } }] } });
    await prisma.callRecord.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('answers Meta\'s verification GET only with the verify token', async () => {
    const ok = await api().get('/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '424242' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('424242');
    await api().get('/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }).expect(403);
  });

  it('refuses a delivery without a valid signature (nothing stored)', async () => {
    const { raw } = webhookBody(unknownPhone, 'hello');
    await deliver(raw, 'another_secret_that_is_long_enough_32').expect(401);
    await api().post('/whatsapp/webhook').set('Content-Type', 'application/json').send(raw).expect(401);
    expect(await prisma.whatsAppConversation.findUnique({ where: { phone: unknownPhone } })).toBeNull();
  });

  it('nobody on shift: the new lead waits unassigned and gets "an agent will call you by 10 AM" once; a repeat delivery adds nothing', async () => {
    const before = provider.sentMessages.length;
    const first = webhookBody(unknownPhone, 'Hi, I need a cook job');
    const res = await deliver(first.raw).expect(200);
    expect(res.body).toEqual({ received: 1, duplicates: 0, statuses: 0 });
    const conv = await conversation(unknownPhone);
    expect(conv).toMatchObject({ status: 'open', assignedStaffId: null, subjectType: null, profileName: 'Sender Name' });
    expect(conv.autoReplyAt).not.toBeNull();
    const replies = provider.sentMessages.slice(before).filter((m) => m.phone === unknownPhone);
    expect(replies).toHaveLength(1);
    const auto = await prisma.whatsAppMessage.findFirst({ where: { conversationId: conv.id, kind: 'auto' } });
    expect(auto?.body).toBe('Thanks! An agent will call you by 10 AM.');

    // The same delivery again (Meta retries): no second message row, no second reply.
    const again = await deliver(first.raw).expect(200);
    expect(again.body).toEqual({ received: 0, duplicates: 1, statuses: 0 });
    clock.at = new Date(DAY1_11.getTime() + MIN);
    await deliver(webhookBody(unknownPhone, 'Are you there?').raw).expect(200);
    expect(provider.sentMessages.slice(before).filter((m) => m.phone === unknownPhone)).toHaveLength(1);
    expect(await prisma.whatsAppMessage.count({ where: { conversationId: conv.id, direction: 'in' } })).toBe(2);
  });

  it('when the shift starts the sweep hands it to the on-shift agent with the fewest open items', async () => {
    await onShift(agentB);
    clock.at = new Date(DAY1_11.getTime() + 2 * MIN);
    const result = await app.get(WhatsAppInboxJob).process(clock.now());
    expect(result.inbox.assigned).toBeGreaterThanOrEqual(1);
    const conv = await conversation(unknownPhone);
    expect(conv.assignedStaffId).toBe(agentB.id);
    expect(conv.assignmentReason).toBe('fair_share');
  });

  it('a known job seeker\'s message goes to his own agent when on shift, and shows in his message history', async () => {
    await onShift(agentA);
    await deliver(webhookBody(seeker.phone, 'Any update on my job?', undefined, 'Ravi').raw).expect(200);
    const conv = await conversation(seeker.phone);
    expect(conv).toMatchObject({ subjectType: 'job_seeker', subjectId: seeker.id, assignedStaffId: agentA.id, assignmentReason: 'own_agent' });
    const history = await prisma.messageLog.findFirst({ where: { subjectType: 'job_seeker', subjectId: seeker.id, template: 'whatsapp_inbound' } });
    expect(history).toMatchObject({ channel: 'whatsapp', status: 'received', relatedId: conv.id });
    // Not a contact attempt (the hit rule never counts it).
    expect(await prisma.contactAttempt.count({ where: { jobSeekerId: seeker.id } })).toBe(0);
  });

  it('the WhatsApp tab: an agent sees only his own conversations, with the number masked, and replies inside the window', async () => {
    const convA = await conversation(seeker.phone);
    const listA = await api().get('/whatsapp/conversations').set('Authorization', bearer(agentA)).expect(200);
    expect(listA.body.rows.map((r: { id: string }) => r.id)).toEqual([convA.id]);
    expect(listA.body.rows[0]).toMatchObject({ subjectCode: seeker.code, windowOpen: true, isNew: false });
    expect(JSON.stringify(listA.body)).not.toContain(seeker.phone.slice(3));

    // Another agent cannot open or answer it.
    await api().get(`/whatsapp/conversations/${convA.id}`).set('Authorization', bearer(agentB)).expect(404);
    await api().post(`/whatsapp/conversations/${convA.id}/reply`).set('Authorization', bearer(agentB)).send({ text: 'hi' }).expect(404);

    const thread = await api().get(`/whatsapp/conversations/${convA.id}`).set('Authorization', bearer(agentA)).expect(200);
    expect(thread.body).toMatchObject({ canAct: true, windowOpen: true, person: { code: seeker.code }, links: { registration: true, agreement: false } });
    expect(thread.body.messages.map((m: { direction: string; text: string }) => [m.direction, m.text])).toEqual([['in', 'Any update on my job?']]);

    await api().post(`/whatsapp/conversations/${convA.id}/reply`).set('Authorization', bearer(agentA)).send({ text: '' }).expect(400);
    await api().post(`/whatsapp/conversations/${convA.id}/reply`).set('Authorization', bearer(agentA)).send({ text: 'Yes Ravi, I will call you in 10 minutes.' }).expect(200);
    const after = await conversation(seeker.phone);
    expect(after.waitingSince).toBeNull();
    expect(after.lastOutboundAt).not.toBeNull();
    const out = await prisma.whatsAppMessage.findFirst({ where: { conversationId: convA.id, direction: 'out' } });
    expect(out).toMatchObject({ kind: 'text', status: 'sent', sentByStaffId: agentA.id });
    expect(await prisma.messageLog.count({ where: { subjectId: seeker.id, template: 'whatsapp_reply' } })).toBe(1);
  });

  it('unanswered: the Team Lead\'s bell after 15 working minutes, the Manager\'s after 2 hours; a reply clears them', async () => {
    const conv = await conversation(unknownPhone);
    expect(conv.waitingSince).not.toBeNull();
    for (let i = 1; i <= 2; i += 1) {
      clock.at = new Date(clock.at.getTime() + 10 * MIN);
      await inbox.sweep(clock.now());
    }
    const tlBell = await prisma.notification.findFirst({ where: { recipientStaffId: tl.id, kind: 'whatsapp_waiting', subjectId: conv.id, clearedAt: null } });
    expect(tlBell?.title).toContain('15 min');
    expect(tlBell?.body).toContain(agentB.code);
    expect(await prisma.notification.count({ where: { recipientStaffId: tl2.id, subjectId: conv.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientStaffId: manager.id, subjectId: conv.id } })).toBe(0);

    for (let i = 0; i < 11; i += 1) {
      clock.at = new Date(clock.at.getTime() + 10 * MIN);
      await inbox.sweep(clock.now());
    }
    const mgBell = await prisma.notification.findFirst({ where: { recipientStaffId: manager.id, kind: 'whatsapp_waiting', subjectId: conv.id, clearedAt: null } });
    expect(mgBell?.title).toContain('2 hours');

    await api().post(`/whatsapp/conversations/${conv.id}/reply`).set('Authorization', bearer(agentB)).send({ text: 'Hello! What job are you looking for?' }).expect(200);
    expect(await prisma.notification.count({ where: { subjectId: conv.id, clearedAt: null } })).toBe(0);
    expect((await conversation(unknownPhone)).waitingWorkSeconds).toBe(0);
  });

  it('working minutes only: no waiting time is counted while nobody is on shift', async () => {
    await deliver(webhookBody(unknownPhone, 'One more question').raw).expect(200);
    await prisma.attendanceDay.updateMany({ where: { staffId: { in: [agentA.id, agentB.id] }, date: DAY1 }, data: { logoutAt: clock.now() } });
    for (let i = 0; i < 3; i += 1) {
      clock.at = new Date(clock.at.getTime() + 10 * MIN);
      await inbox.sweep(clock.now());
    }
    expect((await conversation(unknownPhone)).waitingWorkSeconds).toBe(0);
    await prisma.attendanceDay.updateMany({ where: { staffId: { in: [agentA.id, agentB.id] }, date: DAY1 }, data: { logoutAt: null } });
  });

  it('the Team Lead\'s widget shows the team and the unassigned; a call agent cannot open it', async () => {
    const res = await api().get('/whatsapp/overview').set('Authorization', bearer(tl)).expect(200);
    expect(res.body.open).toBeGreaterThanOrEqual(2);
    const codes = res.body.agents.map((a: { code: string }) => a.code);
    expect(codes).toEqual(expect.arrayContaining([agentA.code, agentB.code]));
    expect(codes).not.toContain(agentC.code);
    expect(res.body.waitingList.length).toBeGreaterThanOrEqual(1);
    await api().get('/whatsapp/overview').set('Authorization', bearer(agentA)).expect(403);
    const tl2View = await api().get('/whatsapp/conversations').set('Authorization', bearer(tl2)).expect(200);
    expect(tl2View.body.rows.map((r: { id: string }) => r.id)).not.toContain((await conversation(seeker.phone)).id);
  });

  it('a Team Lead reassigns only inside the team (audited)', async () => {
    const conv = await conversation(unknownPhone);
    await api().post(`/whatsapp/conversations/${conv.id}/assign`).set('Authorization', bearer(tl)).send({ staffId: agentC.id }).expect(403);
    await api().post(`/whatsapp/conversations/${conv.id}/assign`).set('Authorization', bearer(tl)).send({ staffId: agentA.id }).expect(200);
    expect((await conversation(unknownPhone)).assignedStaffId).toBe(agentA.id);
    expect(await prisma.auditLog.count({ where: { actorId: tl.id, action: 'whatsapp.conversation_assigned' } })).toBe(1);
  });

  it('every lead closes with an outcome; "registered" needs the record; a new message opens it again', async () => {
    const conv = await conversation(unknownPhone);
    const reg = await api().post(`/whatsapp/conversations/${conv.id}/outcome`).set('Authorization', bearer(agentA)).send({ outcome: 'registered' });
    expect(reg.status).toBe(409);
    expect(reg.body.code).toBe('NOT_REGISTERED_YET');
    await api().post(`/whatsapp/conversations/${conv.id}/outcome`).set('Authorization', bearer(agentA)).send({ outcome: 'maybe' }).expect(400);
    await api().post(`/whatsapp/conversations/${conv.id}/outcome`).set('Authorization', bearer(agentA)).send({ outcome: 'not_interested', note: 'Wanted a driver job abroad' }).expect(200);
    expect(await conversation(unknownPhone)).toMatchObject({ status: 'closed', outcome: 'not_interested' });

    clock.at = new Date(clock.at.getTime() + MIN);
    await deliver(webhookBody(unknownPhone, 'Changed my mind, any cook jobs?').raw).expect(200);
    const reopened = await conversation(unknownPhone);
    expect(reopened).toMatchObject({ status: 'open', outcome: null, closedAt: null });
    expect(reopened.waitingSince).not.toBeNull();
  });

  it('quick button: the registration link goes on WhatsApp; a new lead must be registered first', async () => {
    const unknown = await conversation(unknownPhone);
    const refused = await api().post(`/whatsapp/conversations/${unknown.id}/send-link`).set('Authorization', bearer(unknown.assignedStaffId === agentA.id ? agentA : agentB)).send({ kind: 'registration' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('REGISTER_FIRST');

    const conv = await conversation(seeker.phone);
    const before = provider.sentMessages.length;
    const sent = await api().post(`/whatsapp/conversations/${conv.id}/send-link`).set('Authorization', bearer(agentA)).send({ kind: 'registration' }).expect(200);
    expect(sent.body).toEqual({ sent: true, sentBy: 'whatsapp' });
    expect(provider.sentMessages.slice(before).map((m) => [m.phone, m.templateName])).toEqual([[seeker.phone, 'consent_link']]);
    const row = await prisma.whatsAppMessage.findFirst({ where: { conversationId: conv.id, templateName: 'consent_link' } });
    expect(row?.body).toBe('Registration link sent');
  });

  it('"Send on WhatsApp" next to Resend: WhatsApp first, SMS when WhatsApp fails; never a contact attempt', async () => {
    const ok = await api().post(`/whatsapp/send-link/registration/${seeker.id}`).set('Authorization', bearer(agentA)).expect(200);
    expect(ok.body).toEqual({ sentBy: 'whatsapp' });
    provider.fail = true;
    try {
      const fallback = await api().post(`/whatsapp/send-link/registration/${seeker.id}`).set('Authorization', bearer(agentA)).expect(200);
      expect(fallback.body).toEqual({ sentBy: 'sms' });
    } finally {
      provider.fail = false;
    }
    const logs = await prisma.messageLog.findMany({ where: { subjectId: seeker.id, template: 'consent_link' }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => `${l.channel}:${l.status}`)).toEqual(['whatsapp:sent', 'whatsapp:sent', 'whatsapp:failed', 'sms:sent']);
    expect(await prisma.contactAttempt.count({ where: { jobSeekerId: seeker.id } })).toBe(0);
    // A field agent may send it too; finance may not.
    const finance = await makeStaff('finance', ceo);
    await api().post(`/whatsapp/send-link/registration/${seeker.id}`).set('Authorization', bearer(finance)).expect(403);
  });

  it('after 24 hours only a template can go; the agent picks one and the person can answer again', async () => {
    const conv = await conversation(seeker.phone);
    clock.at = new Date(clock.at.getTime() + 25 * 60 * MIN);
    const closed = await api().post(`/whatsapp/conversations/${conv.id}/reply`).set('Authorization', bearer(agentA)).send({ text: 'Hello?' });
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('WINDOW_CLOSED');
    await api().post(`/whatsapp/conversations/${conv.id}/template`).set('Authorization', bearer(agentA)).send({ template: 'registration_done' }).expect(400);
    await api().post(`/whatsapp/conversations/${conv.id}/template`).set('Authorization', bearer(agentA)).send({ template: 'whatsapp_follow_up' }).expect(200);
    const row = await prisma.whatsAppMessage.findFirst({ where: { conversationId: conv.id, templateName: 'whatsapp_follow_up' } });
    expect(row?.body).toContain('Hi Ravi, this is Laboura');
  });

  it('a do-not-call person gets no template', async () => {
    const conv = await conversation(seeker.phone);
    await prisma.callRecord.create({
      data: { code: `CL-W${stamp.slice(-6)}`, provider: 'mock', providerCallId: `wa-dnc-${stamp}`, providerStatus: 'completed', subjectType: 'job_seeker', subjectId: seeker.id, agentOutcome: 'do_not_call', agentOutcomeAt: clock.now() },
    });
    const res = await api().post(`/whatsapp/conversations/${conv.id}/template`).set('Authorization', bearer(agentA)).send({ template: 'whatsapp_missed_you' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DO_NOT_CONTACT');
    await prisma.callRecord.deleteMany({ where: { subjectId: seeker.id } });
  });

  it('delivery statuses move a sent message forward, once', async () => {
    const out = await prisma.whatsAppMessage.findFirstOrThrow({ where: { direction: 'out', kind: 'text', sentByStaffId: agentA.id, providerMessageId: { not: null } } });
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: out.providerMessageId, status: 'delivered', timestamp: '1' }] } }] }] });
    const first = await deliver(raw).expect(200);
    expect(first.body.statuses).toBe(1);
    const again = await deliver(raw).expect(200);
    expect(again.body.statuses).toBe(0);
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: out.id } })).status).toBe('delivered');
  });

  it('every conversation route refuses another agent and another team\'s Team Lead (404), and a Team Lead hands over only inside the team', async () => {
    const conv = await conversation(seeker.phone);
    expect(conv.assignedStaffId).toBe(agentA.id);
    const asB = (path: string, body: object = {}) => api().post(`/whatsapp/conversations/${conv.id}/${path}`).set('Authorization', bearer(agentB)).send(body);
    // WhatsApp thread: another agent's conversation is 404
    await api().get(`/whatsapp/conversations/${conv.id}`).set('Authorization', bearer(agentB)).expect(404);
    // WhatsApp reply: another agent's conversation is 404
    await asB('reply', { text: 'hello' }).expect(404);
    // WhatsApp template: another agent's conversation is 404
    await asB('template', { template: 'whatsapp_follow_up' }).expect(404);
    // WhatsApp send-link: another agent's conversation is 404
    await asB('send-link', { kind: 'registration' }).expect(404);
    // WhatsApp outcome: another agent's conversation is 404
    await asB('outcome', { outcome: 'spam' }).expect(404);
    // WhatsApp link to a record: another agent's conversation is 404
    await asB('link', { code: seeker.code }).expect(404);
    // WhatsApp take: a conversation already with another agent is 404
    await asB('take').expect(404);
    // WhatsApp assign: another team's Team Lead cannot see it (404)
    await api().post(`/whatsapp/conversations/${conv.id}/assign`).set('Authorization', bearer(tl2)).send({ staffId: agentC.id }).expect(404);
    // WhatsApp assign body:staffId: a Team Lead cannot hand it to another team's agent (403)
    await api().post(`/whatsapp/conversations/${conv.id}/assign`).set('Authorization', bearer(tl)).send({ staffId: agentC.id }).expect(403);
    expect((await conversation(seeker.phone)).assignedStaffId).toBe(agentA.id);
  });

  it('leave handover: an agent\'s open conversations move to the picked teammate, or wait for the sweep to spread them', async () => {
    const conv = await conversation(seeker.phone);
    expect(conv.assignedStaffId).toBe(agentA.id);
    const moved = await inbox.handOver(agentA.id, agentB.id, clock.now());
    expect(moved.conversations).toBeGreaterThanOrEqual(1);
    expect((await conversation(seeker.phone)).assignedStaffId).toBe(agentB.id);
    await inbox.handOver(agentB.id, null, clock.now());
    expect((await conversation(seeker.phone)).assignedStaffId).toBeNull();
    await prisma.whatsAppConversation.update({ where: { id: conv.id }, data: { assignedStaffId: agentA.id } });
  });

  describe('automatic event messages (WhatsApp, SMS as fallback)', () => {
    const at = (iso: string) => new Date(iso);
    async function makeSeeker(extra: { status?: string; paymentReceivedAt?: Date | null } = {}) {
      const s = await prisma.jobSeeker.create({
        data: {
          code: `JS-E${stamp.slice(-5)}${seekerIds.length}`,
          name: `Event Person ${seekerIds.length}`,
          phone: newPhone(),
          minSalary: 1500000,
          maxSalary: 1800000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          status: extra.status ?? 'lead',
          paymentReceivedAt: extra.paymentReceivedAt ?? null,
          registeredByStaffId: agentA.id,
          trades: { create: { trade: 'Cook', isPrimary: true } },
        },
      });
      seekerIds.push(s.id);
      return s;
    }
    async function linkSentAt(seekerId: string, when: Date) {
      await app.get(ConsentLinkService).createLink(seekerId, { sms: false });
      await prisma.publicLink.updateMany({ where: { subjectId: seekerId }, data: { createdAt: when } });
    }

    it('registration done: one WhatsApp when the ₹499 arrived; never twice; nothing in quiet hours', async () => {
      clock.at = at('2027-03-10T05:30:00.000Z'); // 11:00 IST
      const paid = await makeSeeker({ status: 'active', paymentReceivedAt: at('2027-03-10T04:30:00.000Z') });
      const first = await events.sweep(clock.now());
      expect(first.done).toBeGreaterThanOrEqual(1);
      const logs = await prisma.messageLog.findMany({ where: { subjectId: paid.id, template: 'registration_done' } });
      expect(logs.map((l) => `${l.channel}:${l.status}`)).toEqual(['whatsapp:sent']);
      await events.sweep(clock.now());
      expect(await prisma.messageLog.count({ where: { subjectId: paid.id, template: 'registration_done' } })).toBe(1);
      expect(await prisma.contactAttempt.count({ where: { jobSeekerId: paid.id } })).toBe(0);

      clock.at = at('2027-03-10T16:30:00.000Z'); // 22:00 IST
      expect(await events.sweep(clock.now())).toEqual({ quietHours: true, done: 0, stopped: 0, payment: 0 });
    });

    it('stopped part-way: one nudge with a fresh link after 2 hours without progress; not before; not twice; not to "do not call"', async () => {
      clock.at = at('2027-03-11T06:30:00.000Z'); // 12:00 IST
      const stopped = await makeSeeker();
      await linkSentAt(stopped.id, at('2027-03-11T04:00:00.000Z'));
      const recent = await makeSeeker();
      await linkSentAt(recent.id, at('2027-03-11T06:00:00.000Z'));
      const dnc = await makeSeeker();
      await linkSentAt(dnc.id, at('2027-03-11T03:00:00.000Z'));
      await prisma.callRecord.create({
        data: { code: `CL-E${stamp.slice(-6)}`, provider: 'mock', providerCallId: `wa-dnc2-${stamp}`, providerStatus: 'completed', subjectType: 'job_seeker', subjectId: dnc.id, agentOutcome: 'do_not_call', agentOutcomeAt: clock.now() },
      });

      const before = provider.sentMessages.length;
      const result = await events.sweep(clock.now());
      expect(result.stopped).toBe(1);
      const nudge = await prisma.messageLog.findFirst({ where: { subjectId: stopped.id, template: 'registration_stopped' } });
      expect(nudge).toMatchObject({ channel: 'whatsapp', status: 'sent', relatedType: 'registration_step', relatedId: 'consent' });
      expect(provider.sentMessages.slice(before).map((m) => m.phone)).toEqual([stopped.phone]);
      expect(await prisma.messageLog.count({ where: { subjectId: { in: [recent.id, dnc.id] }, template: { in: ['registration_stopped', 'payment_stuck'] } } })).toBe(0);
      // The earlier link still works (a fresh one was added, nothing revoked).
      expect(await prisma.publicLink.count({ where: { subjectId: stopped.id, revokedAt: null } })).toBe(2);

      clock.at = at('2027-03-11T08:30:00.000Z');
      await events.sweep(clock.now());
      expect(await prisma.messageLog.count({ where: { subjectId: stopped.id, template: 'registration_stopped' } })).toBe(1);
    });
  });
});
