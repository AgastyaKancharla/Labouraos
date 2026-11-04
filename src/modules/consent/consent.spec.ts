import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentService } from './consent.service';
import { ConsentClock } from './consent-clock';
import {
  JOB_SEEKER_REQUIRED_CONSENT_PURPOSES,
  DEFAULT_NOTICE_VERSION,
} from './consent.constants';

class ControllableConsentClock extends ConsentClock {
  current = new Date('2026-11-05T09:00:00.000Z');

  override now(): Date {
    return this.current;
  }
}

describe('Phase 12 Task 1 — Consent table and service', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let consentService: ConsentService;
  const clock = new ControllableConsentClock();

  const createdSeekerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConsentClock)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    consentService = app.get(ConsentService);
  });

  afterAll(async () => {
    if (createdSeekerIds.length > 0) {
      await prisma.consent.deleteMany({
        where: { subjectId: { in: createdSeekerIds } },
      });
      await prisma.statusHistory.deleteMany({
        where: { subjectId: { in: createdSeekerIds } },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: createdSeekerIds } },
      });
    }
    await app.close();
  });

  async function createTestSeeker(status: string = 'active'): Promise<string> {
    const stamp = Date.now() + Math.floor(Math.random() * 100000);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-CS-${stamp}`.slice(0, 16),
        name: `Consent Seeker ${stamp}`,
        phone: `+9191${String(stamp).slice(-8)}`,
        tradeSkill: 'Plumber',
        minSalary: 1500000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '20:00',
        status,
      },
    });
    createdSeekerIds.push(seeker.id);
    return seeker.id;
  }

  it('granting all five required purposes returns hasAllRequired = true', async () => {
    const seekerId = await createTestSeeker();

    expect(await consentService.hasAllRequired('job_seeker', seekerId)).toBe(false);

    for (const purpose of JOB_SEEKER_REQUIRED_CONSENT_PURPOSES) {
      await consentService.grant({
        subjectType: 'job_seeker',
        subjectId: seekerId,
        purpose,
        noticeVersion: DEFAULT_NOTICE_VERSION,
        language: 'kn',
        method: 'sms_link',
        otpRequestId: 'otp-req-123',
      });
    }

    const hasAll = await consentService.hasAllRequired('job_seeker', seekerId);
    expect(hasAll).toBe(true);
  });

  it('missing one required purpose returns false', async () => {
    const seekerId = await createTestSeeker();

    // Grant 4 out of 5 required purposes
    const fourPurposes = JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.slice(0, 4);
    for (const purpose of fourPurposes) {
      await consentService.grant({
        subjectType: 'job_seeker',
        subjectId: seekerId,
        purpose,
        noticeVersion: DEFAULT_NOTICE_VERSION,
        language: 'en',
        method: 'sms_link',
      });
    }

    expect(await consentService.hasAllRequired('job_seeker', seekerId)).toBe(false);
  });

  it('promotions alone never returns true', async () => {
    const seekerId = await createTestSeeker();

    await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'promotions',
      noticeVersion: DEFAULT_NOTICE_VERSION,
      language: 'hi',
      method: 'sms_link',
    });

    expect(await consentService.hasAllRequired('job_seeker', seekerId)).toBe(false);
  });

  it('withdrawing call_recording on an active job seeker pauses them and records status history', async () => {
    const seekerId = await createTestSeeker('active');

    // Grant call_recording
    await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'call_recording',
      noticeVersion: DEFAULT_NOTICE_VERSION,
      language: 'kn',
      method: 'sms_link',
    });

    clock.current = new Date('2026-11-05T10:00:00.000Z');

    // Withdraw call_recording
    const res = await consentService.withdraw({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'call_recording',
    });
    expect(res.withdrawn).toBe(true);

    const updatedSeeker = await prisma.jobSeeker.findUniqueOrThrow({
      where: { id: seekerId },
    });
    expect(updatedSeeker.status).toBe('paused');

    // Verify row history was kept with withdrawnAt set
    const consentRows = await consentService.getConsents('job_seeker', seekerId);
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0].granted).toBe(false);
    expect(consentRows[0].withdrawnAt).toEqual(clock.current);

    // Verify status history was recorded
    const history = await prisma.statusHistory.findFirst({
      where: { subjectId: seekerId, toStatus: 'paused' },
    });
    expect(history).toBeDefined();
    expect(history?.fromStatus).toBe('active');
  });

  it('withdrawing job_matching on an active job seeker pauses them', async () => {
    const seekerId = await createTestSeeker('active');

    await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'job_matching',
      noticeVersion: DEFAULT_NOTICE_VERSION,
      language: 'en',
      method: 'sms_link',
    });

    await consentService.withdraw({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'job_matching',
    });

    const updatedSeeker = await prisma.jobSeeker.findUniqueOrThrow({
      where: { id: seekerId },
    });
    expect(updatedSeeker.status).toBe('paused');
  });

  it('withdrawing promotions or job_updates changes nothing else on an active job seeker', async () => {
    const seekerId = await createTestSeeker('active');

    await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'promotions',
      noticeVersion: DEFAULT_NOTICE_VERSION,
      language: 'en',
      method: 'sms_link',
    });

    await consentService.withdraw({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'promotions',
    });

    const seeker = await prisma.jobSeeker.findUniqueOrThrow({
      where: { id: seekerId },
    });
    expect(seeker.status).toBe('active');
  });

  it('a repeat grant of the same purpose and notice version does not create a second row', async () => {
    const seekerId = await createTestSeeker();

    const first = await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'job_matching',
      noticeVersion: '1.0',
      language: 'en',
      method: 'sms_link',
    });

    const second = await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'job_matching',
      noticeVersion: '1.0',
      language: 'hi', // updated language
      method: 'sms_link',
    });

    expect(second.id).toBe(first.id);

    const rows = await prisma.consent.findMany({
      where: { subjectType: 'job_seeker', subjectId: seekerId, purpose: 'job_matching' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].language).toBe('hi');
  });

  it('granting a new noticeVersion after a notice change creates a new row rather than overwriting the old one', async () => {
    const seekerId = await createTestSeeker();

    const row1 = await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'job_matching',
      noticeVersion: '1.0',
      language: 'en',
      method: 'sms_link',
    });

    const row2 = await consentService.grant({
      subjectType: 'job_seeker',
      subjectId: seekerId,
      purpose: 'job_matching',
      noticeVersion: '2.0',
      language: 'en',
      method: 'sms_link',
    });

    expect(row2.id).not.toBe(row1.id);

    const rows = await prisma.consent.findMany({
      where: { subjectType: 'job_seeker', subjectId: seekerId, purpose: 'job_matching' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.noticeVersion).sort()).toEqual(['1.0', '2.0']);
  });
});
