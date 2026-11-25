import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AttendanceClock } from '../attendance/attendance-clock';
import { FieldVisitClock } from '../field-visit/field-visit-clock';
import { businessRowState, callAgentBusinessRow, callAgentSeekerRow, referralRowState, seekerRowState } from '../screens-field/field-people.service';
import { page } from './call-people.service';
import { CallWorkClock } from './call-work-clock';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** 11:30 IST on 23 Nov 2026. */
const NOON = new Date('2026-11-23T06:00:00.000Z');

class TestClock {
  at: Date = NOON;
  now(): Date {
    return this.at;
  }
}

type Who = { id: string; role: string; code: string; name: string };

describe('Call agent console lists (23 Nov): the row state for the call agent', () => {
  it('a business: the agreement link only on his own lead; field work becomes no button (Active)', () => {
    const agreement = businessRowState({ kind: 'agreement_waiting', agreementState: 'not_sent' }, { canAct: true, shifts: 1, freshVacancy: true });
    expect(callAgentBusinessRow(agreement, { canSendAgreement: true })).toMatchObject({ status: 'agreement_not_sent', action: 'agreement_link', group: 'needs_action' });
    expect(callAgentBusinessRow(agreement, { canSendAgreement: false })).toMatchObject({ status: 'agreement_not_sent', action: null, group: 'active' });
    const ready = businessRowState({ kind: 'ready_show_candidates', vacancyId: 'v1' }, { canAct: true, shifts: 1, freshVacancy: true });
    expect(callAgentBusinessRow(ready, { canSendAgreement: true })).toMatchObject({ status: 'ready', action: null, vacancyId: null, group: 'active' });
    const visit = businessRowState({ kind: 'candidates_hidden', reason: 'not_verified' }, { canAct: true, shifts: 1, freshVacancy: true });
    expect(callAgentBusinessRow(visit, { canSendAgreement: true })).toMatchObject({ status: 'not_verified', action: null, group: 'active' });
    // No shifts: Add vacancy (the form adds the shift).
    const noShifts = businessRowState({ kind: 'add_vacancy' }, { canAct: true, shifts: 0, freshVacancy: false });
    expect(callAgentBusinessRow(noShifts, { canSendAgreement: false })).toMatchObject({ status: 'no_shifts', action: 'add_vacancy', group: 'needs_action' });
    const confirm = businessRowState({ kind: 'vacancy_to_confirm', vacancyId: 'v2' }, { canAct: true, shifts: 1, freshVacancy: true });
    expect(callAgentBusinessRow(confirm, { canSendAgreement: false })).toMatchObject({ action: 'confirm_vacancy', vacancyId: 'v2' });
  });

  it('a job seeker: Scan Aadhaar QR (field, live) becomes Resend link', () => {
    const base = { status: 'consented', linkSent: true, placed: false, nextInterviewAt: null, bookableVacancyId: null };
    const row = seekerRowState({ ...base, stuck: { step: 'id_check', state: 'not_started', reason: null, waitingForTeamLead: false } });
    expect(callAgentSeekerRow(row)).toMatchObject({ status: 'id_check_needed', action: 'registration_link', group: 'needs_action' });
  });

  it('a referral partner: terms, selfie, ID, UPI, all set', () => {
    const at = (step: string, extra: Partial<{ state: string; reason: string | null; waitingForTeamLead: boolean; actions: Array<'partner_terms_link'> }> = {}) => ({
      step, state: 'not_started', reason: null, waitingForTeamLead: false, actions: ['partner_terms_link'] as Array<'partner_terms_link'>, ...extra,
    });
    expect(referralRowState({ paused: false, stuck: at('terms') })).toMatchObject({ status: 'terms_not_signed', action: 'partner_terms_link', group: 'needs_action' });
    expect(referralRowState({ paused: false, stuck: at('selfie') })).toMatchObject({ status: 'selfie_missing', action: 'partner_terms_link' });
    expect(referralRowState({ paused: false, stuck: at('id_check', { state: 'in_progress', waitingForTeamLead: true, actions: [] }) })).toMatchObject({ status: 'waiting_tl', waiting: true, action: null, group: 'waiting_tl' });
    expect(referralRowState({ paused: false, stuck: at('id_check', { state: 'stuck', reason: 'Under 18: registration stops', actions: [] }) })).toMatchObject({ status: 'id_stopped', group: 'done' });
    expect(referralRowState({ paused: false, stuck: at('upi') })).toMatchObject({ status: 'upi_missing', action: 'partner_terms_link' });
    expect(referralRowState({ paused: false, stuck: at('upi', { state: 'in_progress', reason: 'UPI or bank account name did not match the verified identity', actions: [] }) })).toMatchObject({ status: 'upi_mismatch', action: null, group: 'active' });
    expect(referralRowState({ paused: false, stuck: at('complete', { state: 'done', actions: [] }) })).toMatchObject({ status: 'all_set', done: true, group: 'done' });
    expect(referralRowState({ paused: true, stuck: at('terms') })).toMatchObject({ status: 'paused', action: null, group: 'active' });
  });

  it('pages: counts for every chip, the rows under one chip, and the next offset', () => {
    const rows = ['needs_action', 'needs_action', 'waiting_tl', 'active', 'done'].map((group, i) => ({ id: String(i), row: { group: group as 'needs_action' } }));
    const first = page({ query: '', results: rows }, { limit: '2' });
    expect(first).toMatchObject({ filter: 'all', total: 5, nextOffset: 2, counts: { all: 5, needs_action: 2, waiting_tl: 1, active: 1, done: 1 } });
    expect(first.results.map((r) => r.id)).toEqual(['0', '1']);
    expect(page({ query: '', results: rows }, { limit: '2', offset: '4' })).toMatchObject({ nextOffset: null, results: [{ id: '4' }] });
    expect(page({ query: '', results: rows }, { filter: 'waiting_tl' })).toMatchObject({ total: 1, results: [{ id: '2' }] });
    expect(() => page({ query: '', results: rows }, { filter: 'everything' })).toThrow();
    expect(() => page({ query: '', results: rows }, { offset: '-1' })).toThrow();
  });
});

describe('Call agent console lists (23 Nov): GET /call-work/my/job-seekers | businesses | referrals', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const clock = new TestClock();
  const stamp = Date.now();
  const tag = String(stamp).slice(-6);
  const staffIds: string[] = [];
  const businessIds: string[] = [];
  const seekerIds: string[] = [];
  const referralIds: string[] = [];
  let seq = 0;
  let agent: Who;
  let otherAgent: Who;
  let fieldAgent: Who;
  let teamLead: Who;

  const tokenFor = (s: Who) => jwt.sign({ sub: s.id, role: s.role, code: s.code, email: null });
  const get = (who: Who, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenFor(who)}`);
  const next = () => String(++seq).padStart(3, '0');

  async function makeStaff(role: string): Promise<Who> {
    const n = staffIds.length;
    const staff = await prisma.staff.create({
      data: {
        code: `CL-${role.slice(0, 3).toUpperCase()}-${stamp}-${n}`,
        name: `Lists ${role} ${n}`,
        email: `cl-${role}-${stamp}-${n}@laboura.local`,
        passwordHash: await bcrypt.hash('Lists-Password-1', 4),
        role,
        status: 'active',
      },
    });
    staffIds.push(staff.id);
    return staff;
  }

  async function makeSeeker(by: Who, fields: Partial<{ name: string; createdAt: Date; paymentReceivedAt: Date; status: string; assignedStaffId: string; hitCount: number }> = {}) {
    const n = next();
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-CL${tag}${n}`,
        name: fields.name ?? `Seeker ${n}`,
        phone: `+9183${tag}${n.slice(-2)}`,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        registeredByStaffId: by.id,
        assignedStaffId: fields.assignedStaffId ?? null,
        status: fields.status ?? 'lead',
        locality: 'Bommanahalli',
        hitCount: fields.hitCount ?? 0,
        paymentReceivedAt: fields.paymentReceivedAt ?? null, guaranteeStartsAt: fields.paymentReceivedAt ?? null,
        createdAt: fields.createdAt ?? NOON,
        trades: { create: [{ trade: 'Cook', yearsExperience: 2, isPrimary: true }] },
      },
    });
    seekerIds.push(seeker.id);
    return seeker;
  }

  async function makeBusiness(fields: { name: string; leadBy: Who; accountAgent?: Who | null; verificationStatus?: string; createdAt?: Date }) {
    const n = next();
    const business = await prisma.business.create({
      data: {
        code: `BZ-CL${tag}${n}`,
        name: fields.name,
        phone: `+9194${tag}${n.slice(-2)}`,
        phoneVerified: true,
        latitude: 12.93,
        longitude: 77.63,
        locality: 'Bellandur',
        businessType: 'restaurant',
        accountAgentId: fields.accountAgent?.id ?? null,
        leadCreatedByStaffId: fields.leadBy.id,
        leadChannel: 'phone',
        verificationStatus: fields.verificationStatus ?? 'lead',
        createdAt: fields.createdAt ?? NOON,
      },
    });
    businessIds.push(business.id);
    return business;
  }

  async function makeReferral(by: Who, fields: Partial<{ name: string; type: string; assignedStaffId: string; createdAt: Date }> = {}) {
    const n = next();
    const referral = await prisma.referral.create({
      data: {
        code: `RF-CL${tag}${n}`,
        name: fields.name ?? `Partner ${n}`,
        phone: `+9182${tag}${n.slice(-2)}`,
        phoneVerified: true,
        type: fields.type ?? 'individual',
        locality: 'HSR Layout',
        registeredByStaffId: by.id,
        assignedStaffId: fields.assignedStaffId ?? null,
        createdAt: fields.createdAt ?? NOON,
      },
    });
    referralIds.push(referral.id);
    return referral;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FieldVisitClock)
      .useValue(clock)
      .overrideProvider(AttendanceClock)
      .useValue(clock)
      .overrideProvider(CallWorkClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    agent = await makeStaff('call_agent');
    otherAgent = await makeStaff('call_agent');
    fieldAgent = await makeStaff('field_agent');
    teamLead = await makeStaff('team_lead');
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.jobSeeker.updateMany({ where: { id: { in: seekerIds } }, data: { referredById: null } });
    await prisma.consent.deleteMany({ where: { subjectId: { in: [...seekerIds, ...referralIds] } } });
    await prisma.publicLink.deleteMany({ where: { subjectId: { in: [...businessIds, ...seekerIds, ...referralIds] } } });
    await prisma.identityVerification.deleteMany({ where: { jobSeekerId: { in: seekerIds } } });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.referral.deleteMany({ where: { id: { in: referralIds } } });
    await prisma.businessAgreement.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('is for call agents only', async () => {
    await request(app.getHttpServer()).get('/call-work/my/job-seekers').expect(401);
    for (const path of ['/call-work/my/job-seekers', '/call-work/my/businesses', '/call-work/my/referrals']) {
      await get(fieldAgent, path).expect(403);
      await get(teamLead, path).expect(403);
    }
    await get(agent, '/call-work/my/job-seekers?filter=everyone').expect(400);
    await get(agent, '/call-work/my/job-seekers?offset=x').expect(400);
  });

  it('job seekers: his own (assigned to him, else registered by him), another agent’s hidden; rows and needs action first', async () => {
    const fresh = await makeSeeker(agent, { name: 'CL Fresh Ravi', createdAt: new Date(NOON.getTime() - HOUR) });
    const linked = await makeSeeker(agent, { name: 'CL Linked Suresh', createdAt: new Date(NOON.getTime() - 2 * HOUR) });
    await prisma.publicLink.create({
      data: { tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), purpose: 'registration', subjectType: 'job_seeker', subjectId: linked.id, createdAt: NOON, expiresAt: new Date(NOON.getTime() + DAY) },
    });
    const paid = await makeSeeker(agent, { name: 'CL Paid Lakshmi', status: 'active', hitCount: 1, paymentReceivedAt: new Date(NOON.getTime() - 4 * DAY), createdAt: new Date(NOON.getTime() - 5 * DAY) });
    // Given to him by the Team Lead (registered by someone else): his.
    const given = await makeSeeker(otherAgent, { name: 'CL Given Manju', assignedStaffId: agent.id, createdAt: new Date(NOON.getTime() - 3 * HOUR) });
    // Another agent's own, and one he registered but the Team Lead gave to another agent: not his.
    const theirs = await makeSeeker(otherAgent, { name: 'CL Their Person' });
    const movedAway = await makeSeeker(agent, { name: 'CL Moved Away', assignedStaffId: otherAgent.id });

    const body = (await get(agent, '/call-work/my/job-seekers').expect(200)).body;
    const ids = body.results.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([fresh.id, linked.id, paid.id, given.id]));
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(movedAway.id);
    const by = (id: string) => body.results.find((s: { id: string }) => s.id === id);
    expect(by(fresh.id)).toMatchObject({ name: 'CL Fresh Ravi', trade: 'Cook', yearsExperience: 2, locality: 'Bommanahalli', photoUrl: null, guarantee: null, row: { status: 'link_not_sent', action: 'registration_link', group: 'needs_action' } });
    expect(by(fresh.id).phoneLast4).toMatch(/^\d{4}$/);
    expect(by(linked.id).row).toMatchObject({ status: 'link_not_finished', action: 'registration_link' });
    expect(by(paid.id)).toMatchObject({ hits: 1, guarantee: { day: 4 }, row: { status: 'active', done: true, group: 'active' } });
    // Needs action first.
    const groups = body.results.map((s: { row: { group: string } }) => s.row.group);
    expect(groups.indexOf('active')).toBeGreaterThan(groups.lastIndexOf('needs_action'));
    expect(body.counts.all).toBe(body.total);
    expect(body.counts.needs_action).toBeGreaterThanOrEqual(3);
    // No full phone numbers and no rupee amounts.
    expect(JSON.stringify(body)).not.toMatch(/\+91\d{10}|Paise|amount/i);

    // The other agent sees his own and the one given to him, never this agent's.
    const theirList = (await get(otherAgent, '/call-work/my/job-seekers').expect(200)).body.results.map((s: { id: string }) => s.id);
    expect(theirList).toEqual(expect.arrayContaining([theirs.id, movedAway.id]));
    expect(theirList).not.toContain(fresh.id);
    expect(theirList).not.toContain(given.id);

    // Search, a filter chip and paging.
    const search = (await get(agent, `/call-work/my/job-seekers?q=${encodeURIComponent('Linked Suresh')}`).expect(200)).body;
    expect(search.results.map((s: { id: string }) => s.id)).toEqual([linked.id]);
    const active = (await get(agent, '/call-work/my/job-seekers?filter=active').expect(200)).body;
    expect(active.results.every((s: { row: { group: string } }) => s.row.group === 'active')).toBe(true);
    const first = (await get(agent, '/call-work/my/job-seekers?limit=2').expect(200)).body;
    expect(first.results).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const second = (await get(agent, '/call-work/my/job-seekers?limit=2&offset=2').expect(200)).body;
    expect(second.results[0].id).not.toBe(first.results[0].id);
  });

  it('businesses: his leads (no account agent yet), with the agreement link only while a lead; another agent’s and a field agent’s are hidden', async () => {
    const lead = await makeBusiness({ name: 'CL Lead Sweets', leadBy: agent, createdAt: new Date(NOON.getTime() - HOUR) });
    const visiting = await makeBusiness({ name: 'CL Visit Hotel', leadBy: agent, verificationStatus: 'pending_visit', createdAt: new Date(NOON.getTime() - 2 * HOUR) });
    const theirs = await makeBusiness({ name: 'CL Their Shop', leadBy: otherAgent });
    // Verified by a field agent who became its account agent: his business now, not the call agent's.
    const taken = await makeBusiness({ name: 'CL Taken Mess', leadBy: agent, accountAgent: fieldAgent, verificationStatus: 'verified' });

    const body = (await get(agent, '/call-work/my/businesses').expect(200)).body;
    const names = body.results.map((b: { name: string }) => b.name);
    expect(names).toEqual(expect.arrayContaining(['CL Lead Sweets', 'CL Visit Hotel']));
    expect(names).not.toContain(theirs.name);
    expect(names).not.toContain(taken.name);
    const by = (id: string) => body.results.find((b: { id: string }) => b.id === id);
    expect(by(lead.id)).toMatchObject({
      businessType: 'restaurant', locality: 'Bellandur', openVacancies: 0, candidatesShown: 0, interviewsToday: 0,
      row: { status: 'agreement_not_sent', action: 'agreement_link', group: 'needs_action' },
    });
    // Past the lead stage a call agent may not write to the business: the status line, no button.
    expect(by(visiting.id).row).toMatchObject({ status: 'agreement_not_sent', action: null, group: 'active' });
    expect(body.results[0].row.group).toBe('needs_action');
    expect(JSON.stringify(body)).not.toMatch(/\+91\d{10}|Paise|amount/i);

    const theirNames = (await get(otherAgent, '/call-work/my/businesses').expect(200)).body.results.map((b: { name: string }) => b.name);
    expect(theirNames).toContain('CL Their Shop');
    expect(theirNames).not.toContain('CL Lead Sweets');
  });

  it('referral partners: his own (assigned, else registered), status from "Where they’re stuck", referred count; another agent’s hidden', async () => {
    const fresh = await makeReferral(agent, { name: 'CL Fresh Partner', createdAt: new Date(NOON.getTime() - HOUR) });
    const shop = await makeReferral(agent, { name: 'CL Shop Partner', type: 'business', createdAt: new Date(NOON.getTime() - 2 * HOUR) });
    await prisma.consent.create({
      data: { subjectType: 'referral', subjectId: shop.id, purpose: 'agreement_terms', granted: true, noticeVersion: '1.2', language: 'en', method: 'sms_link', grantedAt: NOON },
    });
    const referredSeeker = await makeSeeker(agent, { name: 'CL Referred One' });
    await prisma.jobSeeker.update({ where: { id: referredSeeker.id }, data: { referredById: shop.id } });
    const theirs = await makeReferral(otherAgent, { name: 'CL Their Partner' });
    const given = await makeReferral(otherAgent, { name: 'CL Given Partner', assignedStaffId: agent.id });

    const body = (await get(agent, '/call-work/my/referrals').expect(200)).body;
    const ids = body.results.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([fresh.id, shop.id, given.id]));
    expect(ids).not.toContain(theirs.id);
    const by = (id: string) => body.results.find((r: { id: string }) => r.id === id);
    expect(by(fresh.id)).toMatchObject({ partnerType: 'individual', locality: 'HSR Layout', referred: 0, row: { status: 'terms_not_signed', action: 'partner_terms_link', group: 'needs_action' } });
    expect(by(shop.id)).toMatchObject({ partnerType: 'business', referred: 1, row: { status: 'selfie_missing', action: 'partner_terms_link' } });
    expect(by(fresh.id).phoneLast4).toMatch(/^\d{4}$/);
    expect(JSON.stringify(body)).not.toMatch(/\+91\d{10}|Paise|amount/i);

    const theirIds = (await get(otherAgent, '/call-work/my/referrals').expect(200)).body.results.map((r: { id: string }) => r.id);
    expect(theirIds).toContain(theirs.id);
    expect(theirIds).not.toContain(fresh.id);
    expect(theirIds).not.toContain(given.id);
  });

  it('Home "Done today" rows say which person they open (a vacancy opens its business)', async () => {
    const today = await makeSeeker(agent, { name: 'CL Done Today', createdAt: new Date(NOON.getTime() - 30 * 60 * 1000) });
    const home = (await get(agent, '/call-work/home').expect(200)).body;
    const rows = home.doneToday as Array<{ kind: string; code: string | null; ref: string | null }>;
    expect(rows.find((r) => r.kind === 'registered' && r.code === today.code)).toMatchObject({ ref: today.code });
    for (const row of rows) {
      expect(row).toHaveProperty('ref');
      if (row.ref) expect(row.ref).toMatch(/^(JS|BZ|RF)-/);
    }
  });
});
