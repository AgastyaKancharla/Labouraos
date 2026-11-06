import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { CANDIDATE_PHOTO_LINK_TTL_SECONDS } from '../job-seeker/photo-storage';

describe('Phase 14 Task 2 — candidate cards and photos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const timestamp = Date.now();
  const password = 'Password123!Secure';
  const roles = ['field_agent', 'call_agent', 'team_lead', 'manager', 'ceo', 'finance'] as const;
  const tokens: Record<(typeof roles)[number], string> = {} as Record<(typeof roles)[number], string>;
  const staffIds: Partial<Record<(typeof roles)[number], string>> = {};
  let seekerId: string;
  let noSharingSeekerId: string;
  let vacancyId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    const passwordHash = await bcrypt.hash(password, 10);
    for (const role of roles) {
      const staff = await prisma.staff.create({
        data: {
          code: `CARD-${role.toUpperCase()}-${timestamp}`,
          name: `${role} card test`,
          email: `${role}_card_${timestamp}@laboura.local`,
          passwordHash,
          role,
          city: 'Bengaluru',
          ...(role === 'field_agent' ? { area: 'Indiranagar' } : {}),
        },
      });
      staffIds[role] = staff.id;
      tokens[role] = (await enrolledLogin(app.getHttpServer(), { email: staff.email, password }).expect(200)).body.accessToken;
    }
    await prisma.staff.update({
      where: { id: staffIds.field_agent },
      data: { teamLeadId: staffIds.team_lead },
    });

    const business = await prisma.business.create({
      data: {
        code: `BZ-CARD-${timestamp}`,
        name: 'Card test business',
        city: 'Bengaluru',
        contactName: 'Business owner',
        phone: `918${String(timestamp).slice(-9)}`,
        phoneVerified: true,
        accountAgentId: staffIds.field_agent,
        verificationStatus: 'verified',
      },
    });
    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-CARD-${timestamp}`,
        city: 'Bengaluru',
        businessId: business.id,
        tradeSkill: 'Electrician',
        salaryMinPaise: 1500000,
        salaryMaxPaise: 2000000,
        latitude: 12.9716,
        longitude: 77.5946,
        headcount: 1,
        status: 'open',
        shift: 'day',
      },
    });
    vacancyId = vacancy.id;

    const createSeeker = (suffix: string) => prisma.jobSeeker.create({
      data: {
        code: `JS-CARD-${suffix}-${timestamp}`,
        name: 'Asha Rao',
        phone: `919${suffix}${String(timestamp).slice(-7)}`,
        phoneVerified: true,
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '21:00',
        dateOfBirth: new Date('1995-02-03T00:00:00.000Z'),
        latitude: 12.9717,
        longitude: 77.5947,
        travelDistanceKm: 20,
        shiftPreference: 'any',
        status: 'active',
        whatsappPhone: `919${suffix}${String(timestamp).slice(-7)}`,
        locality: 'Private locality name',
      },
    });
    const seeker = await createSeeker('1');
    seekerId = seeker.id;
    const noSharingSeeker = await createSeeker('2');
    noSharingSeekerId = noSharingSeeker.id;

    await prisma.jobSeekerTrade.create({
      data: { jobSeekerId: seekerId, trade: 'Electrician', yearsExperience: 4, isPrimary: true },
    });
    await prisma.jobSeekerTrade.create({
      data: { jobSeekerId: noSharingSeekerId, trade: 'Electrician', yearsExperience: 4, isPrimary: true },
    });
    await prisma.jobSeekerLanguage.create({
      data: { jobSeekerId: seekerId, language: 'Kannada', speaks: true, reads: true, writes: true },
    });
    await prisma.consent.createMany({
      data: [seekerId, noSharingSeekerId].flatMap((subjectId) => [
        {
          subjectType: 'job_seeker', subjectId, purpose: 'job_matching',
          noticeVersion: `cards-matching-${timestamp}`, granted: true, language: 'en', method: 'sms_link', grantedAt: new Date(),
        },
        ...(subjectId === seekerId ? [{
          subjectType: 'job_seeker', subjectId, purpose: 'profile_sharing',
          noticeVersion: `cards-sharing-${timestamp}`, granted: true, language: 'en', method: 'sms_link', grantedAt: new Date(),
        }] : []),
      ]),
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it.each(roles)('returns a privacy-safe allow-listed card to %s', async (role) => {
    const response = await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${tokens[role]}`)
      .expect(200);
    const match = response.body.matches.find((row: { jobSeekerId: string }) => row.jobSeekerId === seekerId);
    expect(match).toBeDefined();
    expect(match.card).toMatchObject({
      firstName: 'Asha',
      age: expect.any(Number),
      trade: 'Electrician',
      yearsExperience: 4,
      languages: ['Kannada'],
      distanceKm: 0,
      expectedSalary: { minPaise: 1500000, maxPaise: 2000000 },
      matchReasons: expect.any(Array),
    });
    const cardJson = JSON.stringify(match.card);
    for (const forbidden of ['phone', 'whatsappPhone', 'lastName', 'address', 'dateOfBirth', 'aadhaar', 'Private locality name', 'Asha Rao']) {
      expect(cardJson.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(match.card).not.toHaveProperty('phone');
    expect(match.card).not.toHaveProperty('lastName');
    expect(match.card).not.toHaveProperty('address');
    expect(match.card).not.toHaveProperty('dateOfBirth');
    expect(match.card).not.toHaveProperty('aadhaar');
  });

  it('refuses a photo upload without active profile_sharing consent', async () => {
    await request(app.getHttpServer())
      .post(`/job-seekers/${noSharingSeekerId}/photo`)
      .set('Authorization', `Bearer ${tokens.field_agent}`)
      .attach('photo', Buffer.from('image'), { filename: 'candidate.png', contentType: 'image/png' })
      .expect(403);
  });

  it('uploads a photo only through the photo route and returns a five-minute signed card link', async () => {
    await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/photo`)
      .set('Authorization', `Bearer ${tokens.field_agent}`)
      .attach('photo', Buffer.from('private image data'), { filename: 'candidate.png', contentType: 'image/png' })
      .expect(201);

    const stored = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seekerId } });
    expect(stored.photoStoragePath).toBe(`job-seekers/${seekerId}/profile-photo`);
    expect(stored.photoTakenAt).toBeInstanceOf(Date);

    await request(app.getHttpServer())
      .patch(`/job-seekers/${seekerId}/profile`)
      .set('Authorization', `Bearer ${tokens.call_agent}`)
      .send({ photoStoragePath: 'attacker/permanent-url', photoTakenAt: '2000-01-01T00:00:00.000Z' })
      .expect(200);
    const afterProfileUpdate = await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seekerId } });
    expect(afterProfileUpdate.photoStoragePath).toBe(`job-seekers/${seekerId}/profile-photo`);
    expect(afterProfileUpdate.photoTakenAt?.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');

    const shortlist = await request(app.getHttpServer())
      .get(`/vacancies/${vacancyId}/shortlist`)
      .set('Authorization', `Bearer ${tokens.call_agent}`)
      .expect(200);
    const card = shortlist.body.matches.find((row: { jobSeekerId: string }) => row.jobSeekerId === seekerId).card;
    expect(card.photoUrl).toContain('memory://candidate-photos/');
    expect(card.photoUrlExpiresInSeconds).toBe(CANDIDATE_PHOTO_LINK_TTL_SECONDS);
    expect(card.photoUrl).toMatch(/[?&]exp=\d+/);
  });
});
