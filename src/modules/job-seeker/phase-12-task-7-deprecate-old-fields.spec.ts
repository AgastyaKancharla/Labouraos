import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { completeJobSeekerRegistration } from '../../test-support/job-seeker-registration';

describe('Phase 12 Task 7 — deprecated JobSeeker fields', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;
  let managerToken: string;
  const createdSeekerIds: string[] = [];
  let managerId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    otpService = app.get(OtpService);

    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const manager = await prisma.staff.create({
      data: {
        code: `MGR-T7-${suffix}`,
        name: 'Task 7 Manager',
        email: `manager_t7_${suffix}@laboura.local`,
        passwordHash: 'unused-in-test',
        role: 'manager',
        status: 'active',
      },
    });
    managerId = manager.id;
    managerToken = app.get(JwtService).sign({
      sub: manager.id,
      role: manager.role,
      code: manager.code,
      email: manager.email,
    });
  });

  afterAll(async () => {
    if (createdSeekerIds.length) {
      await prisma.identityVerification.deleteMany({
        where: { jobSeekerId: { in: createdSeekerIds } },
      });
      await prisma.jobSeekerTrade.deleteMany({
        where: { jobSeekerId: { in: createdSeekerIds } },
      });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: createdSeekerIds } } });
    }
    if (managerId) await prisma.staff.delete({ where: { id: managerId } });
    await app.close();
  });

  async function createLegacySeeker() {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-T7-${suffix}`,
        name: 'Legacy Field Candidate',
        phone: `+919${suffix.padEnd(10, '0').slice(0, 10)}`,
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
      },
    });
    createdSeekerIds.push(seeker.id);
    return seeker;
  }

  it('returns pending identity status when no IdentityVerification exists', async () => {
    const seeker = await createLegacySeeker();

    const res = await request(app.getHttpServer())
      .get(`/job-seekers/${seeker.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(res.body.tradeSkill).toBeNull();
    expect(res.body.kycStatus).toBe('pending');
    expect(res.body.kycReference).toBeNull();
  });

  it('prefers JobSeekerTrade and the latest IdentityVerification over deprecated values', async () => {
    const seeker = await createLegacySeeker();
    await prisma.jobSeekerTrade.create({
      data: { jobSeekerId: seeker.id, trade: 'Current Plumber', isPrimary: true },
    });
    await prisma.identityVerification.create({
      data: {
        jobSeekerId: seeker.id,
        method: 'aadhaar_qr',
        vendor: 'test-vendor',
        vendorReference: 'current-vendor-reference',
        status: 'failed',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/job-seekers/${seeker.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(res.body.tradeSkill).toBe('Current Plumber');
    expect(res.body.kycStatus).toBe('failed');
    expect(res.body.kycReference).toBe('current-vendor-reference');
    expect(res.body.identityVerifications[0].status).toBe('failed');
  });

  it('creates a lead with the required primary trade only in JobSeekerTrade', async () => {
    const phone = `+919${randomUUID().replace(/\D/g, '').slice(0, 9)}`;
    const { requestId } = await otpService.sendOtp(phone);
    const provider = otpService.getProvider() as MockOtpProvider;
    await otpService.verifyOtp(requestId, provider.getCode(requestId)!);

    const noTrade = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(completeJobSeekerRegistration({
        name: 'Lead without trade',
        phone,
        otpRequestId: requestId,
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      }))
      .expect(201);
    createdSeekerIds.push(noTrade.body.id);
    expect(noTrade.body.status).toBe('lead');
    expect(noTrade.body.tradeSkill).toBe('Housekeeping');
    expect(await prisma.jobSeekerTrade.count({ where: { jobSeekerId: noTrade.body.id } })).toBe(1);

    const tradePhone = `+919${randomUUID().replace(/\D/g, '').slice(0, 9)}`;
    const otp = await otpService.sendOtp(tradePhone);
    await otpService.verifyOtp(otp.requestId, provider.getCode(otp.requestId)!);
    const withTrade = await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${managerToken}`)
      .send(completeJobSeekerRegistration({
        name: 'Lead with trade',
        phone: tradePhone,
        otpRequestId: otp.requestId,
        tradeSkill: 'Painter',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      }))
      .expect(201);
    createdSeekerIds.push(withTrade.body.id);
    expect(withTrade.body.tradeSkill).toBe('Painter');
    expect(await prisma.jobSeekerTrade.findFirst({
      where: { jobSeekerId: withTrade.body.id, trade: 'Painter', isPrimary: true },
    })).not.toBeNull();
  });

  it('refuses pending_activation without a primary JobSeekerTrade row', async () => {
    const phone = `+919${randomUUID().replace(/\D/g, '').slice(0, 9)}`;
    const { requestId } = await otpService.sendOtp(phone);
    const provider = otpService.getProvider() as MockOtpProvider;
    await otpService.verifyOtp(requestId, provider.getCode(requestId)!);

    await request(app.getHttpServer())
      .post('/job-seekers')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name: 'No trade activation',
        phone,
        otpRequestId: requestId,
        status: 'pending_activation',
        dateOfBirth: '1990-01-01',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
      })
      .expect(400);
  });

  it('refuses a status transition to pending_activation without a primary JobSeekerTrade row', async () => {
    const seeker = await createLegacySeeker();
    await prisma.jobSeeker.update({
      where: { id: seeker.id },
      data: { dateOfBirth: new Date('1990-01-01T00:00:00.000Z') },
    });

    const res = await request(app.getHttpServer())
      .post(`/job-seekers/${seeker.id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'pending_activation' })
      .expect(400);

    expect(res.body.message).toContain('primary trade');
  });
});
