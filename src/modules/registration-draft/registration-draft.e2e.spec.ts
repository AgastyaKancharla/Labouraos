import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { verifiedOtpFor } from '../../test-support/verified-otp';
import { RetentionService } from '../retention/retention.service';
import { cleanDraftData, draftCheckHolds, DRAFT_KEEP_DAYS } from './registration-draft.rules';

jest.setTimeout(120000);

/**
 * Unfinished registrations (Master Guide rev 204, 21 Nov): the call agent's
 * forms saved on the server as they type, one per agent and kind, read only
 * by that agent; the OTP check kept for the draft until the number changes;
 * deleted on submit, on Discard and after 7 days.
 */
describe('Unfinished registrations (call agent drafts)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = Date.now();
  const staffIds: string[] = [];
  const referralPhones: string[] = [];
  let n = 0;
  const phoneFor = () => `9${String(stamp + (n += 1)).slice(-9)}`;

  const make = async (role: string) => {
    const s = await prisma.staff.create({
      data: { code: `RD-${role.slice(0, 2)}-${stamp}-${staffIds.length}`, name: `Draft ${role} ${staffIds.length}`, email: `draft-${role}-${stamp}-${staffIds.length}@laboura.local`, passwordHash: 'x', role, status: 'active' },
    });
    staffIds.push(s.id);
    return s;
  };
  const as = (who: { id: string; role: string; code: string }) => `Bearer ${jwt.sign({ sub: who.id, role: who.role, code: who.code, email: null })}`;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await prisma.registrationDraft.deleteMany({ where: { staffId: { in: staffIds } } });
    await prisma.referral.deleteMany({ where: { phone: { in: referralPhones.flatMap((p) => [p, `+91${p}`]) } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } }).catch(() => undefined);
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  it('saves the form per agent; nobody else — another agent, Team Lead, Manager, CEO — can read it', async () => {
    const mine = await make('call_agent');
    const other = await make('call_agent');
    const saved = await http().put('/registration-drafts').set('Authorization', as(mine))
      .send({ kind: 'job_seeker', name: 'Kavya Reddy', mobile: '', data: { name: 'Kavya Reddy', dateOfBirth: '2000-09-22', otpCode: '123456', selfie: 'data:image/png;base64,AAAA', place: { area: 'JP Nagar' } } })
      .expect(200);
    expect(saved.body).toMatchObject({ kind: 'job_seeker', name: 'Kavya Reddy', phoneVerified: false });
    // Only what the form holds: no OTP code, no pictures.
    expect(saved.body.data).toEqual({ name: 'Kavya Reddy', dateOfBirth: '2000-09-22', place: { area: 'JP Nagar' } });

    const list = await http().get('/registration-drafts').set('Authorization', as(mine)).expect(200);
    expect(list.body.drafts).toHaveLength(1);
    expect(list.body.drafts[0]).toMatchObject({ kind: 'job_seeker', name: 'Kavya Reddy' });
    expect((await http().get('/registration-drafts').set('Authorization', as(other)).expect(200)).body.drafts).toEqual([]);
    for (const role of ['team_lead', 'manager', 'ceo', 'field_agent', 'finance']) {
      const senior = await make(role);
      await http().get('/registration-drafts').set('Authorization', as(senior)).expect(403);
      await http().put('/registration-drafts').set('Authorization', as(senior)).send({ kind: 'job_seeker', data: {} }).expect(403);
      await http().delete('/registration-drafts?kind=job_seeker').set('Authorization', as(senior)).expect(403);
    }
    await http().get('/registration-drafts').expect(401);
    // Another agent's Discard never touches it.
    expect((await http().delete('/registration-drafts?kind=job_seeker').set('Authorization', as(other)).expect(200)).body).toEqual({ deleted: 0 });
    expect(await prisma.registrationDraft.count({ where: { staffId: mine.id } })).toBe(1);
    // Discard (asked once on the screen) deletes it.
    expect((await http().delete('/registration-drafts?kind=job_seeker').set('Authorization', as(mine)).expect(200)).body).toEqual({ deleted: 1 });
    await http().put('/registration-drafts').set('Authorization', as(mine)).send({ kind: 'vacancy', data: {} }).expect(400);
  });

  it('keeps the OTP check for the draft; a changed number must be checked again', async () => {
    const agent = await make('call_agent');
    const phone = phoneFor();
    const requestId = await verifiedOtpFor(app, phone);
    const put = (body: Record<string, unknown>) => http().put('/registration-drafts').set('Authorization', as(agent)).send({ kind: 'referral', data: { name: 'Ravi' }, name: 'Ravi', ...body });
    expect((await put({ mobile: phone, otpRequestId: requestId }).expect(200)).body.phoneVerified).toBe(true);
    // Later saves carry no code: the check stays while the number is the same.
    expect((await put({ mobile: phone }).expect(200)).body.phoneVerified).toBe(true);
    // A code for another number never marks this one.
    const otherRequest = await verifiedOtpFor(app, phoneFor());
    const changed = phoneFor();
    expect((await put({ mobile: changed, otpRequestId: otherRequest }).expect(200)).body.phoneVerified).toBe(false);
    // Back to the first number: checked again only with a new code.
    expect((await put({ mobile: phone }).expect(200)).body.phoneVerified).toBe(false);
  });

  it('a resumed draft with its OTP check registers the partner once ("draft:referral"), and the draft is deleted', async () => {
    const agent = await make('call_agent');
    const intruder = await make('call_agent');
    const phone = phoneFor();
    referralPhones.push(phone);
    const requestId = await verifiedOtpFor(app, phone);
    await http().put('/registration-drafts').set('Authorization', as(agent)).send({ kind: 'referral', name: 'Ravi Kumar', mobile: phone, otpRequestId: requestId, data: { name: 'Ravi Kumar' } }).expect(200);
    const body = {
      name: 'Ravi Kumar', phone, type: 'individual', whatsappPhone: phone, individualRole: 'shop_staff', locality: 'JP Nagar', pincode: '560078',
      heardFrom: 'other', otpRequestId: 'draft:referral',
    };
    // Someone else's draft check is never theirs.
    await http().post('/referrals').set('Authorization', as(intruder)).send(body).expect(400);
    // A different number than the one checked is refused.
    await http().post('/referrals').set('Authorization', as(agent)).send({ ...body, phone: phoneFor(), whatsappPhone: phone }).expect(400);
    const created = await http().post('/referrals').set('Authorization', as(agent)).send(body).expect(201);
    expect(created.body.code).toMatch(/^RF-/);
    expect(await prisma.registrationDraft.count({ where: { staffId: agent.id } })).toBe(0);
    // Used once.
    await http().post('/referrals').set('Authorization', as(agent)).send({ ...body }).expect((res) => expect([400, 409]).toContain(res.status));
  });

  it('a registration submitted with a live OTP also deletes the agent\'s draft of that kind', async () => {
    const agent = await make('call_agent');
    const phone = phoneFor();
    referralPhones.push(phone);
    await http().put('/registration-drafts').set('Authorization', as(agent)).send({ kind: 'referral', name: 'Asha', data: { name: 'Asha' } }).expect(200);
    await http().put('/registration-drafts').set('Authorization', as(agent)).send({ kind: 'job_seeker', name: 'Other form', data: { name: 'Other form' } }).expect(200);
    const otpRequestId = await verifiedOtpFor(app, phone);
    await http().post('/referrals').set('Authorization', as(agent))
      .send({ name: 'Asha', phone, type: 'individual', whatsappPhone: phone, individualRole: 'auto_driver', locality: 'JP Nagar', pincode: '560078', heardFrom: 'other', otpRequestId })
      .expect(201);
    expect((await prisma.registrationDraft.findMany({ where: { staffId: agent.id } })).map((d) => d.kind)).toEqual(['job_seeker']);
  });

  it(`the nightly cleanup deletes drafts after ${DRAFT_KEEP_DAYS} days`, async () => {
    const agent = await make('call_agent');
    await http().put('/registration-drafts').set('Authorization', as(agent)).send({ kind: 'business', name: 'Old shop', data: { boardName: 'Old shop' } }).expect(200);
    await http().put('/registration-drafts').set('Authorization', as(agent)).send({ kind: 'referral', name: 'New', data: { name: 'New' } }).expect(200);
    await prisma.registrationDraft.updateMany({ where: { staffId: agent.id, kind: 'business' }, data: { updatedAt: new Date(Date.now() - (DRAFT_KEEP_DAYS + 1) * 86_400_000) } });
    const dry = await app.get(RetentionService).runRetentionCleanup({ now: new Date(), dryRun: true });
    expect(dry.registrationDraftsDeleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.registrationDraft.count({ where: { staffId: agent.id } })).toBe(2);
    const run = await app.get(RetentionService).runRetentionCleanup({ now: new Date() });
    expect(run.registrationDraftsDeleted).toBeGreaterThanOrEqual(1);
    expect((await prisma.registrationDraft.findMany({ where: { staffId: agent.id } })).map((d) => d.kind)).toEqual(['referral']);
    // An expired draft is no longer listed either.
    expect((await http().get('/registration-drafts').set('Authorization', as(agent)).expect(200)).body.drafts.map((d: { kind: string }) => d.kind)).toEqual(['referral']);
  });

  it('rules: pictures, OTP fields and old checks are never kept', () => {
    expect(cleanDraftData({ code: '123456', otpRequestId: 'r', requestId: 'x', idCardPhoto: 'abc', staff: [{ code: 'RF-0012', aadhaarImage: 'x' }], note: 'data:image/jpeg;base64,xx' }))
      .toEqual({ staff: [{ code: 'RF-0012' }], note: null });
    const now = new Date('2026-11-21T12:00:00Z');
    expect(draftCheckHolds({ verifiedPhone: '+919845012345', verifiedAt: new Date('2026-11-20T12:00:00Z') }, '9845012345', now)).toBe(true);
    expect(draftCheckHolds({ verifiedPhone: '+919845012345', verifiedAt: new Date('2026-11-10T12:00:00Z') }, '9845012345', now)).toBe(false);
    expect(draftCheckHolds({ verifiedPhone: '+919845012345', verifiedAt: new Date('2026-11-20T12:00:00Z') }, '9845012346', now)).toBe(false);
  });
});
