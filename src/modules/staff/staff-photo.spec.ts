import { BadRequestException, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { assertLiveCameraPhoto, staffPhotoNeeded } from './staff-photo.service';

jest.setTimeout(120000);

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 2, 3, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('Staff photo rules', () => {
  it('asks for a photo when there is none, or when the CEO asked for a new one', () => {
    expect(staffPhotoNeeded({ photoStoragePath: null, photoRetakeRequestedAt: null })).toBe('missing');
    expect(staffPhotoNeeded({ photoStoragePath: 'staff/a/profile-photo', photoRetakeRequestedAt: new Date() })).toBe('retake');
    expect(staffPhotoNeeded({ photoStoragePath: 'staff/a/profile-photo', photoRetakeRequestedAt: null })).toBeNull();
  });

  it('takes only a live camera JPEG, PNG or WebP, by its first bytes, and stores the type read from them', () => {
    expect(assertLiveCameraPhoto({ buffer: JPEG, mimetype: 'image/png' }, 'live_camera').contentType).toBe('image/jpeg');
    expect(assertLiveCameraPhoto({ buffer: PNG, mimetype: 'image/jpeg' }, 'live_camera').contentType).toBe('image/png');
    expect(assertLiveCameraPhoto({ buffer: WEBP, mimetype: 'application/octet-stream' }, 'live_camera').contentType).toBe('image/webp');
    expect(() => assertLiveCameraPhoto({ buffer: SVG, mimetype: 'image/jpeg' }, 'live_camera')).toThrow(BadRequestException);
    expect(() => assertLiveCameraPhoto({ buffer: JPEG, mimetype: 'image/jpeg' }, 'gallery')).toThrow(BadRequestException);
    expect(() => assertLiveCameraPhoto({ buffer: JPEG, mimetype: 'image/jpeg' }, undefined)).toThrow(BadRequestException);
    expect(() => assertLiveCameraPhoto({ buffer: Buffer.alloc(0), mimetype: 'image/jpeg' }, 'live_camera')).toThrow(BadRequestException);
    expect(() => assertLiveCameraPhoto({ buffer: Buffer.from('%PDF-1.7 not an image at all'), mimetype: 'image/jpeg' }, 'live_camera')).toThrow(BadRequestException);
    expect(() => assertLiveCameraPhoto(undefined, 'live_camera')).toThrow(BadRequestException);
    expect(() => assertLiveCameraPhoto({ buffer: JPEG, mimetype: 'image/jpeg' }, 'live_camera')).not.toThrow();
  });
});

/**
 * Staff photo (guide, "The login code screen", 14 Nov): a live camera selfie
 * at account setup from the invite link, asked again at login when missing or
 * when the CEO asks for a new one; shown on login code requests, staff lists
 * and profiles; private storage, signed links only.
 */
describe('Staff photo API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const ts = Date.now();
  const ids: string[] = [];
  const tokens: Record<string, string> = {};
  let ip = 0;
  const freshIp = () => `10.23.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
  let ceoId = '';
  let teamLeadId = '';

  async function mkStaff(role: string, extra: Record<string, unknown> = {}) {
    const staff = await prisma.staff.create({
      data: {
        code: `PHO-${role.toUpperCase()}-${ts}-${ids.length}`,
        name: `Photo ${role} ${ids.length}`,
        email: `pho_${role}_${ts}_${ids.length}@laboura.local`,
        role,
        passwordHash: await bcrypt.hash('Correct-Horse-Battery-9', 4),
        ...extra,
      },
    });
    ids.push(staff.id);
    const session = await prisma.staffSession.create({
      data: { staffId: staff.id, expiresAt: new Date(Date.now() + 15 * 60_000), absoluteExpiresAt: new Date(Date.now() + 2 * 3600_000), lastActivityAt: new Date() },
    });
    const payload: JwtPayload = { sub: staff.id, role, email: staff.email, code: staff.code, teamLeadId: (extra.teamLeadId as string | undefined) ?? null, sid: session.id };
    tokens[staff.id] = jwt.sign(payload, { expiresIn: '15m' });
    return staff;
  }
  const as = (id: string) => ({ Authorization: `Bearer ${tokens[id]}` });
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    ceoId = (await mkStaff('ceo')).id;
    teamLeadId = (await mkStaff('team_lead')).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    const codes = (await prisma.staff.findMany({ where: { id: { in: ids } }, select: { code: true } })).map((s) => s.code);
    await prisma.loginCodeRequest.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffDevice.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: ids } } });
    await prisma.staffPasswordReset.deleteMany({ where: { OR: [{ staffId: { in: ids } }, { issuedByStaffId: { in: ids } }] } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityType: 'staff', entityCode: { in: codes } }] } });
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('the invite page takes a live camera selfie with the invite token (checked before the file is read); the preview says when one is needed', async () => {
    const hired = await request(server())
      .post('/staff')
      .set(as(ceoId))
      .send({ name: 'Photo Hire', email: `pho_hire_${ts}@laboura.local`, role: 'call_agent', teamLeadId })
      .expect(201);
    ids.push(hired.body.staff.id);
    const token = hired.body.inviteToken as string;
    const preview = await request(server()).post('/staff/accept-invite/preview').set('X-Forwarded-For', freshIp()).send({ token }).expect(200);
    expect(preview.body.photoRequired).toBe(true);

    await request(server())
      .post('/staff/accept-invite/not-a-real-token/photo')
      .set('X-Forwarded-For', freshIp())
      .field('captureSource', 'live_camera')
      .attach('photo', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect((res) => expect([400, 404]).toContain(res.status));
    await request(server())
      .post(`/staff/accept-invite/${token}/photo`)
      .set('X-Forwarded-For', freshIp())
      .field('captureSource', 'gallery')
      .attach('photo', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await request(server())
      .post(`/staff/accept-invite/${token}/photo`)
      .set('X-Forwarded-For', freshIp())
      .field('captureSource', 'live_camera')
      .attach('photo', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(200);

    const row = await prisma.staff.findUniqueOrThrow({ where: { id: hired.body.staff.id } });
    expect(row.photoStoragePath).toMatch(new RegExp(`^staff/${row.id}/profile-photo-\\d+$`));
    expect(row.photoTakenAt).toBeTruthy();
    const after = await request(server()).post('/staff/accept-invite/preview').set('X-Forwarded-For', freshIp()).send({ token }).expect(200);
    expect(after.body.photoRequired).toBe(false);
    // The same invite link cannot put another face on the account once one is on file.
    await request(server())
      .post(`/staff/accept-invite/${token}/photo`)
      .set('X-Forwarded-For', freshIp())
      .field('captureSource', 'live_camera')
      .attach('photo', PNG, { filename: 'other.png', contentType: 'image/png' })
      .expect(403);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: row.id } })).photoStoragePath).toBe(row.photoStoragePath);
    expect(after.body).not.toHaveProperty('photoStoragePath');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'staff.photo_taken', entityCode: row.code } });
    expect(audit).toBeTruthy();
    // The storage path never leaves the API in the staff answers.
    const staffView = await request(server()).get(`/staff/${row.id}`).set(as(ceoId)).expect(200);
    expect(JSON.stringify(staffView.body)).not.toContain('profile-photo');
  });

  it('someone with no photo is asked at login and takes it with the live camera; a gallery upload is refused', async () => {
    const agent = await mkStaff('call_agent', { teamLeadId });
    const before = await request(server()).get('/staff/me/photo').set(as(agent.id)).expect(200);
    expect(before.body).toMatchObject({ required: true, reason: 'missing', photoUrl: null });
    await request(server()).post('/staff/me/photo').set(as(agent.id)).field('captureSource', 'gallery').attach('photo', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(400);
    await request(server()).get('/staff/me/photo').expect(401);
    await request(server()).post('/staff/me/photo').set(as(agent.id)).field('captureSource', 'live_camera').attach('photo', SVG, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(400);
    const taken = await request(server()).post('/staff/me/photo').set(as(agent.id)).field('captureSource', 'live_camera').attach('photo', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(200);
    expect(taken.body.required).toBe(false);
    expect(typeof taken.body.photoUrl).toBe('string');
    const now = await request(server()).get('/staff/me/photo').set(as(agent.id)).expect(200);
    expect(now.body).toMatchObject({ required: false, reason: null });
    // Signed in, nobody can swap their photo again unless the CEO asks.
    const before2 = (await prisma.staff.findUniqueOrThrow({ where: { id: agent.id } })).photoStoragePath;
    await request(server()).post('/staff/me/photo').set(as(agent.id)).field('captureSource', 'live_camera').attach('photo', WEBP, { filename: 'x.webp', contentType: 'image/webp' }).expect(403);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: agent.id } })).photoStoragePath).toBe(before2);
  });

  it('a password reset link cannot replace a photo on file; it can add one only while none is on file', async () => {
    const withPhoto = await mkStaff('call_agent', { teamLeadId, photoStoragePath: 'staff/r/profile-photo-1', photoTakenAt: new Date() });
    const reset = await request(server()).post(`/staff/${withPhoto.id}/reset-password`).set(as(ceoId)).set('X-Forwarded-For', freshIp()).expect(200);
    const preview = await request(server()).post('/staff/accept-invite/preview').set('X-Forwarded-For', freshIp()).send({ token: reset.body.resetToken }).expect(200);
    expect(preview.body.photoRequired).toBe(false);
    await request(server())
      .post(`/staff/accept-invite/${reset.body.resetToken}/photo`)
      .set('X-Forwarded-For', freshIp())
      .field('captureSource', 'live_camera')
      .attach('photo', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(403);
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: withPhoto.id } })).photoStoragePath).toBe('staff/r/profile-photo-1');

    const noPhoto = await mkStaff('call_agent', { teamLeadId });
    const reset2 = await request(server()).post(`/staff/${noPhoto.id}/reset-password`).set(as(ceoId)).set('X-Forwarded-For', freshIp()).expect(200);
    await request(server())
      .post(`/staff/accept-invite/${reset2.body.resetToken}/photo`)
      .set('X-Forwarded-For', freshIp())
      .field('captureSource', 'live_camera')
      .attach('photo', JPEG, { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .expect(200);
  });

  it('only the CEO asks for a new photo; it is audited and the person retakes it at their next login', async () => {
    const agent = await mkStaff('field_agent', { teamLeadId, photoStoragePath: 'staff/x/profile-photo', photoTakenAt: new Date() });
    const manager = await mkStaff('manager');
    await request(server()).post('/staff/me/photo').set(as(agent.id)).field('captureSource', 'live_camera').attach('photo', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(403);
    await request(server()).post(`/staff/${agent.id}/photo/retake`).set(as(manager.id)).send({ reason: 'Blurry' }).expect(403);
    await request(server()).post(`/staff/${agent.id}/photo/retake`).set(as(teamLeadId)).send({}).expect(403);
    await request(server()).post(`/staff/${agent.id}/photo/retake`).set(as(ceoId)).send({ reason: 'Face not clear' }).expect(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'staff.photo_retake_requested', entityCode: agent.code, actorId: ceoId } });
    expect(audit?.reason).toBe('Face not clear');
    const asked = await request(server()).get('/staff/me/photo').set(as(agent.id)).expect(200);
    expect(asked.body).toMatchObject({ required: true, reason: 'retake' });
    await request(server()).post('/staff/me/photo').set(as(agent.id)).field('captureSource', 'live_camera').attach('photo', JPEG, { filename: 'x.jpg', contentType: 'image/jpeg' }).expect(200);
    const row = await prisma.staff.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row.photoRetakeRequestedAt).toBeNull();
    expect(row.photoStoragePath).toMatch(new RegExp(`^staff/${agent.id}/profile-photo-\\d+$`));
    // The retake is used up: a second new photo needs the CEO again.
    await request(server()).post('/staff/me/photo').set(as(agent.id)).field('captureSource', 'live_camera').attach('photo', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(403);
  });

  it('shows the photo on login code requests, the CEO staff list and the Team Lead agent list and profile (null when none)', async () => {
    const withPhoto = await mkStaff('call_agent', { teamLeadId, photoStoragePath: 'staff/p/profile-photo', photoTakenAt: new Date() });
    const without = await mkStaff('call_agent', { teamLeadId });
    for (const s of [withPhoto, without]) {
      const device = await prisma.staffDevice.create({ data: { staffId: s.id, deviceId: `dev-${s.id}`, label: 'Office PC 3', platform: 'web', status: 'approved' } });
      await prisma.loginCodeRequest.create({ data: { staffId: s.id, staffDeviceId: device.id, ipAddress: '10.0.0.1', expiresAt: new Date(Date.now() + 5 * 60_000) } });
    }
    const pending = await request(server()).get('/login-codes/pending').set(as(ceoId)).expect(200);
    const byId = new Map((pending.body as { staff: { id: string; photoUrl: string | null } }[]).map((r) => [r.staff.id, r.staff]));
    expect(typeof byId.get(withPhoto.id)?.photoUrl).toBe('string');
    expect(byId.get(without.id)?.photoUrl).toBeNull();

    const team = await request(server()).get('/ceo/team').set(as(ceoId)).expect(200);
    const row = (team.body.rows as { id: string; photoUrl: string | null; photoRetakeRequested: boolean }[]).find((r) => r.id === withPhoto.id);
    expect(typeof row?.photoUrl).toBe('string');
    expect(row?.photoRetakeRequested).toBe(false);

    const agents = await request(server()).get('/team-lead/agents').set(as(teamLeadId)).expect(200);
    const agentRow = (agents.body.rows as { staff: { id: string; photoUrl: string | null } }[]).find((r) => r.staff.id === withPhoto.id);
    expect(typeof agentRow?.staff.photoUrl).toBe('string');
    const profile = await request(server()).get(`/team-lead/agents/${without.id}`).set(as(teamLeadId)).expect(200);
    expect(profile.body.staff.photoUrl).toBeNull();
  });
});
