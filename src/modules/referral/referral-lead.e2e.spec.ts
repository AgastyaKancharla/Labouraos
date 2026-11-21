import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OTP_PROVIDER } from '../../common/otp/otp.interface';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { CustomerTokenService } from '../../common/customer-auth/customer-token.service';
import { WhatsAppInboxService } from '../whatsapp-inbox/whatsapp-inbox.service';
import { SHARE_SLUG_PATTERN } from './referral-share-link';

/** Wednesday 17 March 2027, 11:00 IST (a date no other suite opens attendance days on). */
const SWEEP_AT = new Date('2027-03-17T05:30:00.000Z');
const SWEEP_DAY = new Date('2027-03-17T00:00:00.000Z');

describe('Referral partners (rev 202): personal share link and QR, the lead page, Submit a lead in the app, agents\' lead list', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: MockOtpProvider;
  let tokens: CustomerTokenService;
  const stamp = String(Date.now());
  const staffIds: string[] = [];
  const referralIds: string[] = [];
  const seekerIds: string[] = [];
  const accountIds: string[] = [];
  let n = 0;
  const newPhone = () => `+9178${stamp.slice(-6)}${String((n += 1)).padStart(2, '0')}`;
  type S = { id: string; role: string; code: string };
  let ceo: S;
  let tl: S;
  let agentA: S;
  let agentB: S;
  let finance: S;
  let tl2: S;
  let agentC: S;
  let partner: { id: string; code: string; phone: string };
  let pausedPartner: { id: string };
  let slug: string;
  let customer: { accountId: string; sessionId: string; profileId: string };
  let otherCustomer: { accountId: string; sessionId: string; profileId: string };

  const bearer = (s: S) => `Bearer ${jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null })}`;
  const customerBearer = (c: { accountId: string; sessionId: string }) => `Bearer ${tokens.signAccess(c.accountId, c.sessionId).accessToken}`;
  const api = () => request(app.getHttpServer());

  async function makeStaff(role: string, boss?: S): Promise<S> {
    const i = staffIds.length;
    const s = await prisma.staff.create({
      data: {
        code: `RL-${role.slice(0, 3).toUpperCase()}-${stamp}-${i}`,
        name: `Lead ${role} ${i}`,
        email: `rl-${role}-${stamp}-${i}@laboura.local`,
        passwordHash: await bcrypt.hash('Lead-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: boss && role === 'call_agent' ? boss.id : null,
        reportsToId: boss?.id ?? null,
      },
    });
    staffIds.push(s.id);
    return { id: s.id, role: s.role, code: s.code };
  }

  async function makePartner(name: string, extra: { registeredByStaffId?: string; pausedAt?: Date } = {}) {
    const r = await prisma.referral.create({
      data: { code: `RF-L${stamp.slice(-5)}${referralIds.length}`, name, phone: newPhone(), registeredByStaffId: extra.registeredByStaffId ?? null, pausedAt: extra.pausedAt ?? null },
    });
    referralIds.push(r.id);
    return r;
  }

  async function makeCustomer(referralId: string, phone: string) {
    const account = await prisma.customerAccount.create({ data: { phone, phoneVerifiedAt: new Date(), createdVia: 'phone', language: 'en' } });
    accountIds.push(account.id);
    const session = await prisma.customerSession.create({
      data: { accountId: account.id, refreshTokenHash: tokens.hashRefreshToken(`lead-${stamp}-${accountIds.length}`), signedInWith: 'phone', expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const profile = await prisma.customerProfile.create({ data: { accountId: account.id, kind: 'referral', referralId, linkedVia: 'phone_match' } });
    return { accountId: account.id, sessionId: session.id, profileId: profile.id };
  }

  async function sendCode(phone: string): Promise<{ requestId: string; code: string }> {
    const res = await api().post(`/referral-links/${slug}/send-code`).send({ phone }).expect(200);
    return { requestId: res.body.requestId, code: otp.getCode(res.body.requestId)! };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OTP_PROVIDER) as MockOtpProvider;
    tokens = app.get(CustomerTokenService);
    ceo = await makeStaff('ceo');
    tl = await makeStaff('team_lead', ceo);
    agentA = await makeStaff('call_agent', tl);
    agentB = await makeStaff('call_agent', tl);
    finance = await makeStaff('finance', ceo);
    tl2 = await makeStaff('team_lead', ceo);
    agentC = await makeStaff('call_agent', tl2);
    const p = await makePartner('Suresh Babu', { registeredByStaffId: agentA.id });
    partner = { id: p.id, code: p.code, phone: p.phone };
    pausedPartner = await makePartner('Paused Partner', { pausedAt: new Date() });
    customer = await makeCustomer(partner.id, partner.phone);
    const other = await makePartner('Other Partner');
    otherCustomer = await makeCustomer(other.id, other.phone);
  }, 120000);

  afterAll(async () => {
    await prisma.referralLead.deleteMany({ where: { referralId: { in: referralIds } } });
    await prisma.messageLog.deleteMany({ where: { subjectId: { in: [...referralIds, ...seekerIds] } } });
    await prisma.customerAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.attendanceDay.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.updateMany({ where: { id: { in: staffIds } }, data: { reportsToId: null, teamLeadId: null } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('an agent gets the partner\'s personal link and QR; the link stays the same; Finance cannot', async () => {
    const first = await api().get(`/referrals/${partner.id}/share-link`).set('Authorization', bearer(agentA)).expect(200);
    expect(first.body.url).toMatch(/\/p\/ref\/[a-z0-9]{10}$/);
    expect(first.body.qrSvg).toMatch(/^<svg/);
    expect(first.body.code).toBe(partner.code);
    slug = first.body.url.split('/').pop();
    expect(slug).toMatch(SHARE_SLUG_PATTERN);
    expect(slug).not.toContain(partner.code.toLowerCase());
    const again = await api().get(`/referrals/${partner.id}/share-link`).set('Authorization', bearer(tl)).expect(200);
    expect(again.body.url).toBe(first.body.url);
    await api().get(`/referrals/${partner.id}/share-link`).set('Authorization', bearer(finance)).expect(403);
  });

  it('the link page shows only the partner\'s first name and code; unknown or paused partners look the same', async () => {
    const page = await api().get(`/referral-links/${slug}`).expect(200);
    expect(page.body).toEqual({ valid: true, partnerFirstName: 'Suresh', partnerCode: partner.code });
    const unknown = await api().get('/referral-links/zzzzzzzzzz').expect(404);
    expect(unknown.body.code).toBe('LINK_NOT_ACTIVE');
    await api().get('/referral-links/NOT-A-SLUG').expect(404);
    const pausedSlug = (await api().get(`/referrals/${pausedPartner.id}/share-link`).set('Authorization', bearer(ceo)).expect(200)).body.url.split('/').pop();
    const paused = await api().get(`/referral-links/${pausedSlug}`).expect(404);
    expect(paused.body.code).toBe('LINK_NOT_ACTIVE');
  });

  it('a person leaves their own number (checked by a code sent from this page) and the partner is told', async () => {
    const phone = newPhone();
    const { requestId, code } = await sendCode(phone);
    const wrong = await api().post(`/referral-links/${slug}/leads`).send({ name: 'Manju', phone, lookingFor: 'job', consent: true, requestId, code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    await api().post(`/referral-links/${slug}/leads`).send({ name: 'Manju', phone, lookingFor: 'job', requestId, code }).expect(400);
    await api().post(`/referral-links/${slug}/leads`).send({ name: 'Manju', phone, lookingFor: 'boat', consent: true, requestId, code }).expect(400);
    const ok = await api().post(`/referral-links/${slug}/leads`).send({ name: 'Manju Nath', phone, lookingFor: 'job', area: 'JP Nagar', consent: true, requestId, code }).expect(200);
    expect(ok.body).toEqual({ received: true });
    const lead = await prisma.referralLead.findFirstOrThrow({ where: { referralId: partner.id, phone } });
    expect(lead).toMatchObject({ name: 'Manju Nath', lookingFor: 'job', area: 'JP Nagar', source: 'link', status: 'open', assignedStaffId: null });
    const told = await prisma.messageLog.findFirst({ where: { subjectType: 'referral', subjectId: partner.id, template: 'referral_lead_received' } });
    expect(told).toMatchObject({ channel: 'whatsapp', status: 'sent', relatedId: lead.id });

    // The code is used up; the same person again (new code) adds no second open lead.
    await api().post(`/referral-links/${slug}/leads`).send({ name: 'Manju Nath', phone, lookingFor: 'job', consent: true, requestId, code }).expect(400);
    await new Promise((r) => setTimeout(r, 10));
    await prisma.publicOtpSend.deleteMany({ where: { linkKey: { startsWith: `ref-link:${slug}:` } } });
    const second = await sendCode(phone);
    await api().post(`/referral-links/${slug}/leads`).send({ name: 'Manju Nath', phone, lookingFor: 'job', consent: true, ...second }).expect(200);
    expect(await prisma.referralLead.count({ where: { referralId: partner.id, phone, status: 'open' } })).toBe(1);
  });

  it('a code from the share page opens nothing else, and a code from another page is refused here', async () => {
    const phone = newPhone();
    const sent = await api().post('/consent/send-otp').send({ token: 'not-a-real-token' });
    expect(sent.status).toBeGreaterThanOrEqual(400);
    const { requestId, code } = await sendCode(phone);
    // The same code on another partner's page does not work.
    const otherSlug = (await api().get(`/referrals/${referralIds[2]}/share-link`).set('Authorization', bearer(ceo)).expect(200)).body.url.split('/').pop();
    await api().post(`/referral-links/${otherSlug}/leads`).send({ name: 'Kiran', phone, lookingFor: 'staff', consent: true, requestId, code }).expect(400);
  });

  it('the Laboura app: the partner\'s link, "Submit a lead", and their own leads with first name and stage only', async () => {
    const link = await api().get(`/customer-api/v1/me/profiles/${customer.profileId}/referral/share-link`).set('Authorization', customerBearer(customer)).expect(200);
    expect(link.body.url.split('/').pop()).toBe(slug);
    await api().get(`/customer-api/v1/me/profiles/${customer.profileId}/referral/share-link`).set('Authorization', customerBearer(otherCustomer)).expect(404);
    await api().get(`/customer-api/v1/me/profiles/${customer.profileId}/referral/share-link`).set('Authorization', bearer(agentA)).expect(401);

    const phone = newPhone();
    const sent = await api().post(`/customer-api/v1/me/profiles/${customer.profileId}/referral/leads`).set('Authorization', customerBearer(customer))
      .send({ name: 'Lakshmi Devi', phone: phone.slice(3), lookingFor: 'staff', note: 'Runs a bakery in Jayanagar' }).expect(201);
    expect(sent.body.received).toBe(true);
    await api().post(`/customer-api/v1/me/profiles/${customer.profileId}/referral/leads`).set('Authorization', customerBearer(customer)).send({ name: 'X', phone: '123', lookingFor: 'job' }).expect(400);

    const mine = await api().get(`/customer-api/v1/me/profiles/${customer.profileId}/referral/leads`).set('Authorization', customerBearer(customer)).expect(200);
    expect(mine.body.leads.map((l: { firstName: string; stage: string }) => [l.firstName, l.stage])).toEqual(expect.arrayContaining([['Lakshmi', 'with_our_team'], ['Manju', 'with_our_team']]));
    expect(JSON.stringify(mine.body)).not.toContain(phone.slice(3));
    expect(JSON.stringify(mine.body)).not.toContain('Devi');
  });

  it('the sweep hands partners\' leads to the partner\'s own agent when on shift; agents see their list with masked numbers', async () => {
    await prisma.attendanceDay.create({ data: { staffId: agentA.id, date: SWEEP_DAY, loginAt: SWEEP_AT, dayType: 'open' } });
    const result = await app.get(WhatsAppInboxService).sweep(SWEEP_AT);
    expect(result.leadsAssigned).toBeGreaterThanOrEqual(2);
    const mine = await prisma.referralLead.findMany({ where: { referralId: partner.id, status: 'open' } });
    expect(mine.every((l) => l.assignedStaffId === agentA.id)).toBe(true);

    const list = await api().get('/referral-leads').set('Authorization', bearer(agentA)).expect(200);
    expect(list.body.rows.length).toBe(mine.length);
    expect(list.body.rows[0].partner.code).toBe(partner.code);
    for (const lead of mine) expect(JSON.stringify(list.body)).not.toContain(lead.phone.slice(3));
    const otherAgent = await api().get('/referral-leads').set('Authorization', bearer(agentB)).expect(200);
    expect(otherAgent.body.rows).toEqual([]);
    const teamLead = await api().get('/referral-leads').set('Authorization', bearer(tl)).expect(200);
    expect(teamLead.body.rows.length).toBeGreaterThanOrEqual(mine.length);
  });

  it('closing: only the lead\'s agent; "registered" needs the record made for them (found by number or ID)', async () => {
    const lead = await prisma.referralLead.findFirstOrThrow({ where: { referralId: partner.id, lookingFor: 'job', status: 'open' } });
    await api().post(`/referral-leads/${lead.id}/outcome`).set('Authorization', bearer(agentB)).send({ outcome: 'not_interested' }).expect(404);
    const early = await api().post(`/referral-leads/${lead.id}/outcome`).set('Authorization', bearer(agentA)).send({ outcome: 'registered' });
    expect(early.status).toBe(409);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-L${stamp.slice(-6)}`, name: 'Manju Nath', phone: lead.phone, minSalary: 1500000, maxSalary: 1800000,
        preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', status: 'lead', heardFrom: 'referral_partner', referredById: partner.id,
        trades: { create: { trade: 'Cook', isPrimary: true } },
      },
    });
    seekerIds.push(seeker.id);
    const list = await api().get('/referral-leads').set('Authorization', bearer(agentA)).expect(200);
    expect(list.body.rows.find((r: { id: string }) => r.id === lead.id).alreadyRegistered).toMatchObject({ type: 'job_seeker', code: seeker.code });
    await api().post(`/referral-leads/${lead.id}/outcome`).set('Authorization', bearer(agentA)).send({ outcome: 'registered' }).expect(200);
    expect(await prisma.referralLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: 'closed', outcome: 'registered', subjectType: 'job_seeker', subjectId: seeker.id });
    await api().post(`/referral-leads/${lead.id}/outcome`).set('Authorization', bearer(agentA)).send({ outcome: 'registered' }).expect(409);
    const mine = await api().get(`/customer-api/v1/me/profiles/${customer.profileId}/referral/leads`).set('Authorization', customerBearer(customer)).expect(200);
    expect(mine.body.leads.find((l: { id: string }) => l.id === lead.id).stage).toBe('registered');
  });

  it('lead routes refuse another agent and another team\'s Team Lead (404); a Team Lead hands over only inside the team', async () => {
    const lead = await prisma.referralLead.findFirstOrThrow({ where: { referralId: partner.id, status: 'open', assignedStaffId: agentA.id } });
    // Partner lead take: a lead already with another agent is 404
    await api().post(`/referral-leads/${lead.id}/take`).set('Authorization', bearer(agentB)).expect(404);
    // Partner lead outcome: another agent's lead is 404
    await api().post(`/referral-leads/${lead.id}/outcome`).set('Authorization', bearer(agentB)).send({ outcome: 'wrong_number' }).expect(404);
    // Partner lead assign: another team's Team Lead cannot see it (404)
    await api().post(`/referral-leads/${lead.id}/assign`).set('Authorization', bearer(tl2)).send({ staffId: agentC.id }).expect(404);
    // Partner lead assign body:staffId: a Team Lead cannot hand it to another team's agent (403)
    await api().post(`/referral-leads/${lead.id}/assign`).set('Authorization', bearer(tl)).send({ staffId: agentC.id }).expect(403);
    const list = await api().get('/referral-leads').set('Authorization', bearer(tl2)).expect(200);
    expect(list.body.rows.map((r: { id: string }) => r.id)).not.toContain(lead.id);
  });

  it('a Team Lead hands a lead to a teammate (audited); a paused partner cannot submit from the app', async () => {
    const lead = await prisma.referralLead.findFirstOrThrow({ where: { referralId: partner.id, status: 'open' } });
    await api().post(`/referral-leads/${lead.id}/assign`).set('Authorization', bearer(tl)).send({ staffId: agentB.id }).expect(200);
    expect((await prisma.referralLead.findUniqueOrThrow({ where: { id: lead.id } })).assignedStaffId).toBe(agentB.id);
    await api().post(`/referral-leads/${lead.id}/assign`).set('Authorization', bearer(agentA)).send({ staffId: agentA.id }).expect(403);
    const pausedCustomer = await makeCustomer(pausedPartner.id, (await prisma.referral.findUniqueOrThrow({ where: { id: pausedPartner.id } })).phone);
    const res = await api().post(`/customer-api/v1/me/profiles/${pausedCustomer.profileId}/referral/leads`).set('Authorization', customerBearer(pausedCustomer))
      .send({ name: 'Someone Else', phone: newPhone(), lookingFor: 'job' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PARTNER_PAUSED');
  });
});
