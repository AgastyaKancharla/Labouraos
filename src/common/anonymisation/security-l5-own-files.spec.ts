import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AnonymisationService, ownStoragePath } from './anonymisation.service';
import { CANDIDATE_PHOTO_STORAGE, MemoryCandidatePhotoStorage } from '../../modules/job-seeker/photo-storage';

/**
 * Security follow-up L5: staff could type a job seeker's cvStoragePath (and
 * policeVerified) in an edit, and anonymisation deleted whatever path was
 * saved — another person's photo included. Both fields are refused in an edit,
 * and anonymisation deletes only objects under that job seeker's own prefix.
 */
describe('Security L5: a job seeker\'s file paths are never typed in, and anonymisation deletes only his own files', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: MemoryCandidatePhotoStorage;
  let token = '';
  const suffix = Date.now().toString().slice(-7);
  const d = suffix.slice(-5);
  const ids = { staff: '', seekers: [] as string[] };

  async function seeker(n: number, data: Record<string, unknown> = {}) {
    const id = randomUUID();
    await prisma.jobSeeker.create({
      data: { id, code: `JS-L5-${suffix}-${n}`, name: `L5 Seeker ${n}`, phone: `+9190${d}00${n}`, city: 'Bengaluru', minSalary: 1, maxSalary: 2, preferredCallWindowStart: '09:00', preferredCallWindowEnd: '21:00', ...data },
    });
    ids.seekers.push(id);
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(CANDIDATE_PHOTO_STORAGE);
    const ceo = await prisma.staff.create({ data: { code: `L5CEO-${suffix}`, name: 'L5 CEO', email: `l5_${suffix}@laboura.local`, passwordHash: 'h', role: 'ceo', city: 'Bengaluru' } });
    ids.staff = ceo.id;
    token = await app.get(JwtService).signAsync({ sub: ceo.id, role: 'ceo', email: ceo.email, code: ceo.code });
  });

  afterAll(async () => {
    try {
      await prisma.jobSeeker.deleteMany({ where: { id: { in: ids.seekers } } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { actorId: ids.staff } }).catch(() => undefined);
      await prisma.staff.deleteMany({ where: { id: ids.staff } }).catch(() => undefined);
    } finally {
      await app?.close();
    }
  });

  it.each([
    ['cvStoragePath', 'job-seekers/someone-else/profile-photo'],
    ['policeVerified', true],
  ])('an edit setting %s is refused', async (field, value) => {
    const id = await seeker(field === 'cvStoragePath' ? 1 : 2);
    for (const path of [`/job-seekers/${id}`, `/job-seekers/${id}/profile`]) {
      const res = await request(app.getHttpServer()).patch(path).set('Authorization', `Bearer ${token}`).send({ [field]: value, reason: 'trying' });
      expect(res.status).toBe(400);
    }
    const saved = await prisma.jobSeeker.findUniqueOrThrow({ where: { id } });
    expect([saved.cvStoragePath, saved.policeVerified]).toEqual([null, null]);
  });

  it('anonymising a job seeker whose saved path points at another person\'s photo leaves that photo alone', async () => {
    const victimId = await seeker(3);
    const victimPhoto = `job-seekers/${victimId}/profile-photo`;
    await storage.put(victimPhoto, Buffer.from('victim'), 'image/jpeg');
    const id = randomUUID();
    const ownPhoto = `job-seekers/${id}/profile-photo`;
    await storage.put(ownPhoto, Buffer.from('own'), 'image/jpeg');
    await seeker(4, { id, photoStoragePath: ownPhoto, cvStoragePath: victimPhoto });

    await app.get(AnonymisationService).anonymise('job_seeker', id, 'DPDP erasure request', ids.staff);
    expect(storage.has(ownPhoto)).toBe(false);
    expect(storage.has(victimPhoto)).toBe(true);
    expect((await prisma.jobSeeker.findUniqueOrThrow({ where: { id } })).cvStoragePath).toBeNull();
  });

  it('ownStoragePath accepts only objects under <root>/<id>/', () => {
    expect(ownStoragePath('job-seekers/abc/profile-photo', 'job-seekers', 'abc')).toBe(true);
    expect(ownStoragePath('job-seekers/abc/', 'job-seekers', 'abc')).toBe(false);
    expect(ownStoragePath('job-seekers/abcd/profile-photo', 'job-seekers', 'abc')).toBe(false);
    expect(ownStoragePath('job-seekers/abc/../xyz/profile-photo', 'job-seekers', 'abc')).toBe(false);
    expect(ownStoragePath('job-seekers/abc//x', 'job-seekers', 'abc')).toBe(false);
    expect(ownStoragePath('businesses/abc/x', 'job-seekers', 'abc')).toBe(false);
    expect(ownStoragePath(null, 'job-seekers', 'abc')).toBe(false);
  });
});
