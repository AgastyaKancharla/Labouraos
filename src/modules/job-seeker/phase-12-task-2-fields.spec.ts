import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';
import {
  JOB_SEEKER_STATUSES,
  normalizeJobSeekerStatus,
} from './job-seeker.status';
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from '../consent/consent.constants';

describe('Phase 12 Task 2 — JobSeeker new fields and status list', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let consentService: ConsentService;
  let agentToken: string;

  const createdStaffIds: string[] = [];
  const createdSeekerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    consentService = app.get(ConsentService);

    const passwordHash = await bcrypt.hash('StaffPassword123!', 4);
    const stamp = Date.now();

    const staff = await prisma.staff.create({
      data: {
        code: `CA-P12-${stamp}`.slice(0, 16),
        name: 'Task 2 Call Agent',
        email: `ca_p12_${stamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        status: 'active',
      },
    });
    createdStaffIds.push(staff.id);
    agentToken = jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email });
  });

  afterAll(async () => {
    if (createdSeekerIds.length > 0) {
      await prisma.consent.deleteMany({ where: { subjectId: { in: createdSeekerIds } } });
      await prisma.statusHistory.deleteMany({ where: { subjectId: { in: createdSeekerIds } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: createdSeekerIds } } });
    }
    if (createdStaffIds.length > 0) {
      await prisma.staff.deleteMany({ where: { id: { in: createdStaffIds } } });
    }
    await app.close();
  });

  async function createLead(dob?: Date | null): Promise<string> {
    const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const phoneSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-P12-${randomSuffix}`,
        name: `Lead Candidate ${randomSuffix}`,
        phone: `+9192${phoneSuffix}`,
        tradeSkill: 'Electrician',
        minSalary: 1400000,
        maxSalary: 2400000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'lead',
        dateOfBirth: dob ?? null,
      },
    });
    createdSeekerIds.push(seeker.id);
    return seeker.id;
  }

  it('validates the status closed list in job-seeker.status.ts', () => {
    expect(JOB_SEEKER_STATUSES).toEqual([
      'lead',
      'consented',
      'pending_activation',
      'active',
      'paused',
      'deactivated',
      'placed',
    ]);
  });

  it('normalizes legacy and historical status values correctly', () => {
    expect(normalizeJobSeekerStatus('pending_payment')).toBe('pending_activation');
    expect(normalizeJobSeekerStatus('pending')).toBe('pending_activation');
    expect(normalizeJobSeekerStatus('activated')).toBe('active');
    expect(normalizeJobSeekerStatus('active')).toBe('active');
    expect(normalizeJobSeekerStatus('deactivated')).toBe('deactivated');
    expect(normalizeJobSeekerStatus('placed')).toBe('placed');
    expect(normalizeJobSeekerStatus('paused')).toBe('paused');
    expect(normalizeJobSeekerStatus('consented')).toBe('consented');
    expect(normalizeJobSeekerStatus('lead')).toBe('lead');
  });

  it('a job seeker without dateOfBirth cannot reach pending_activation', async () => {
    const seekerId = await createLead(null);

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'pending_activation' })
      .expect(400);

    expect(res.body.message).toContain('dateOfBirth is required');
  });

  it('a job seeker under 18 cannot reach pending_activation', async () => {
    // 16 years old
    const under18 = new Date();
    under18.setFullYear(under18.getFullYear() - 16);
    const seekerId = await createLead(under18);

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'pending_activation' })
      .expect(400);

    expect(res.body.message).toContain('at least 18 years old');
  });

  it('a job seeker 18+ can reach pending_activation', async () => {
    // 22 years old
    const adultDob = new Date();
    adultDob.setFullYear(adultDob.getFullYear() - 22);
    const seekerId = await createLead(adultDob);

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'pending_activation' })
      .expect(201);

    expect(res.body.status).toBe('pending_activation');
  });

  it('attempting lead -> consented without all required consents throws 400', async () => {
    const seekerId = await createLead();

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'consented' })
      .expect(400);

    expect(res.body.message).toContain('without all required consents granted');
  });

  it('lead -> consented succeeds when all five required consents are granted', async () => {
    const seekerId = await createLead();

    for (const purpose of JOB_SEEKER_REQUIRED_CONSENT_PURPOSES) {
      await consentService.grant({
        subjectType: 'job_seeker',
        subjectId: seekerId,
        purpose,
        noticeVersion: '1.0',
        language: 'kn',
        method: 'sms_link',
      });
    }

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'consented' })
      .expect(201);

    expect(res.body.status).toBe('consented');
  });

  it('updates new profile fields cleanly without modifying deprecated columns', async () => {
    const adultDob = new Date('2000-01-15T00:00:00.000Z');
    const seekerId = await createLead(adultDob);

    const profilePayload = {
      gender: 'male',
      whatsappPhone: '+919876543210',
      locality: 'Indiranagar',
      pincode: '560038',
      latitude: 12.9716,
      longitude: 77.5946,
      travelDistanceKm: 15,
      preferredLocalities: ['Indiranagar', 'Koramangala'],
      willingToRelocate: false,
      needsAccommodation: true,
      salaryPeriod: 'monthly',
      shiftPreference: 'day',
      jobType: 'full_time',
      currentlyWorking: true,
      lastEmployer: 'Acme Services',
      lastRole: 'Assistant Plumber',
      lastSalaryPaise: 1800000,
      educationLevel: '10th_pass',
      certificates: ['ITI_Plumber'],
      drivingLicenceType: '2_wheeler',
      ownVehicle: true,
      policeVerified: false,
      hasSmartphone: true,
      keySkills: ['Pipefitting', 'Welding'],
    };

    const res = await request(app.getHttpServer())
      .patch(`/job-seekers/${seekerId}/profile`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send(profilePayload)
      .expect(200);

    expect(res.body.locality).toBe('Indiranagar');
    expect(res.body.travelDistanceKm).toBe(15);
    expect(res.body.preferredLocalities).toEqual(['Indiranagar', 'Koramangala']);
    expect(res.body.keySkills).toEqual(['Pipefitting', 'Welding']);
    expect(res.body.tradeSkill).toBe('Electrician'); // Deprecated column remains untouched
    expect(res.body.kycStatus).toBe('pending'); // Deprecated column remains untouched
  });
});
