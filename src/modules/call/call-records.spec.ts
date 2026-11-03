import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { signCallStatusBody } from './call-signature';
import { MemoryRecordingStorage, RECORDING_DOWNLOADER, RECORDING_STORAGE } from './recording-storage';
import { RecordingCopyJob } from './recording-copy.job';

const SECRET = 'call_status_webhook_secret_for_tests_32';
const PHONE = '+919800011122';

describe('Phase 11 Task 1: call records', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let storage: MemoryRecordingStorage;
  let copyJob: RecordingCopyJob;
  const downloads = new Map<string, Buffer | Error>();
  const createdStaff: string[] = [];
  const createdCalls: string[] = [];

  function tokenFor(staff: { id: string; role: string; code: string; email: string | null }) {
    return jwt.sign({ sub: staff.id, email: staff.email, role: staff.role, code: staff.code });
  }

  async function makeStaff(role: string, teamLeadId?: string) {
    const stamp = `${Date.now()}-${createdStaff.length}`;
    const staff = await prisma.staff.create({
      data: {
        code: `CR-${role.slice(0, 3).toUpperCase()}-${stamp}`,
        name: `Call ${role}`,
        email: `cr-${role}-${stamp}@laboura.local`,
        passwordHash: await bcrypt.hash('Call-Password-1', 4),
        role,
        status: 'active',
        teamLeadId: teamLeadId ?? null,
      },
    });
    createdStaff.push(staff.id);
    return staff;
  }

  function postStatus(payload: Record<string, unknown>, signature?: string) {
    const raw = JSON.stringify(payload);
    const signed = signature === undefined ? signCallStatusBody(raw, SECRET) : signature;
    return request(app.getHttpServer())
      .post('/telephony/webhook/call-status')
      .set('Content-Type', 'application/json')
      .set('x-telephony-signature', signed)
      .send(raw);
  }

  beforeAll(async () => {
    process.env.TELEPHONY_WEBHOOK_SECRET = SECRET;
    storage = new MemoryRecordingStorage();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RECORDING_STORAGE)
      .useValue(storage)
      .overrideProvider(RECORDING_DOWNLOADER)
      .useValue({
        download: async (url: string) => {
          const found = downloads.get(url);
          if (!found) {
            throw new Error('missing recording');
          }
          if (found instanceof Error) {
            throw found;
          }
          return found;
        },
      })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    copyJob = app.get(RecordingCopyJob);
  }, 120000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdStaff } } });
    await prisma.callRecord.deleteMany({ where: { id: { in: createdCalls } } });
    await prisma.staff.deleteMany({ where: { id: { in: createdStaff } } });
    await app.close();
  });

  it('creates a call from the webhook, ignores a repeat and a late ringing, copies the recording, and hides the phone number', async () => {
    const recordingUrl = 'https://recordings.example/call-1.mp3';
    downloads.set(recordingUrl, Buffer.from('audio-bytes'));
    const payload = {
      CallSid: `exo-${Date.now()}`,
      Status: 'completed',
      DialCallStatus: 'completed',
      DialCallDuration: '42',
      StartTime: '2026-06-15T05:30:00.000Z',
      EndTime: '2026-06-15T05:30:42.000Z',
      RecordingUrl: recordingUrl,
      From: PHONE,
      Direction: 'outbound',
    };

    const created = await postStatus(payload);
    expect(created.status).toBe(201);
    expect(created.body.unchanged).toBe(false);
    createdCalls.push(created.body.id);

    const row = await prisma.callRecord.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.provider).toBe('exotel');
    expect(row.providerStatus).toBe('completed');
    expect(row.answered).toBe(true);
    expect(row.durationSec).toBe(42);
    expect(row.recordingStoragePath).toBe(`calls/${row.id}.audio`);
    expect(storage.has(row.recordingStoragePath!)).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain(PHONE);

    const before = row.updatedAt.toISOString();
    const repeat = await postStatus(payload);
    expect(repeat.status).toBe(201);
    expect(repeat.body.unchanged).toBe(true);
    const afterRepeat = await prisma.callRecord.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterRepeat.updatedAt.toISOString()).toBe(before);
    expect(await prisma.callRecord.count({ where: { providerCallId: payload.CallSid } })).toBe(1);

    const late = await postStatus({
      CallSid: payload.CallSid,
      Status: 'ringing',
      From: PHONE,
    });
    expect(late.body.unchanged).toBe(true);
    const afterLate = await prisma.callRecord.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterLate.providerStatus).toBe('completed');
    expect(afterLate.updatedAt.toISOString()).toBe(before);

    const bad = await postStatus(payload, 'not-the-signature');
    expect(bad.status).toBe(401);

    const ceo = await makeStaff('ceo');
    const viewed = await request(app.getHttpServer())
      .get(`/calls/${row.id}`)
      .set('Authorization', `Bearer ${tokenFor(ceo)}`);
    expect(viewed.status).toBe(200);
    expect(JSON.stringify(viewed.body)).not.toContain(PHONE);
    expect(viewed.body.providerStatus).toBe('completed');

    const lead = await makeStaff('team_lead');
    const agent = await makeStaff('call_agent', lead.id);
    await prisma.callRecord.update({
      where: { id: row.id },
      data: { staffId: agent.id, subjectType: 'job_seeker', subjectId: 'subject-1' },
    });

    const refused = await request(app.getHttpServer())
      .get(`/calls/${row.id}/recording`)
      .set('Authorization', `Bearer ${tokenFor(agent)}`);
    expect(refused.status).toBe(403);

    const link = await request(app.getHttpServer())
      .get(`/calls/${row.id}/recording`)
      .set('Authorization', `Bearer ${tokenFor(lead)}`);
    expect(link.status).toBe(200);
    expect(link.body.url).toContain(`calls/${row.id}.audio`);
    expect(link.body.expiresInSeconds).toBe(300);
    expect(JSON.stringify(link.body)).not.toContain(PHONE);

    const listed = await request(app.getHttpServer())
      .get('/calls')
      .query({ subjectType: 'job_seeker', subjectId: 'subject-1' })
      .set('Authorization', `Bearer ${tokenFor(agent)}`);
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(PHONE);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'call.recording.listened', entityCode: row.code, actorId: lead.id },
    });
    expect(audit).not.toBeNull();
  }, 120000);

  it('queues a retry when the recording copy fails, and the job stores it later', async () => {
    const recordingUrl = 'https://recordings.example/call-retry.mp3';
    downloads.set(recordingUrl, new Error('storage down'));
    const schedule = jest.spyOn(copyJob, 'schedule').mockResolvedValue(undefined);
    const payload = {
      provider: 'exotel',
      providerCallId: `retry-${Date.now()}`,
      status: 'completed',
      answered: true,
      durationSec: 10,
      recordingUrl,
    };

    const created = await postStatus(payload);
    expect(created.status).toBe(201);
    createdCalls.push(created.body.id);
    const missing = await prisma.callRecord.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(missing.recordingStoragePath).toBeNull();
    expect(schedule).toHaveBeenCalledWith(created.body.id, recordingUrl);

    downloads.set(recordingUrl, Buffer.from('later'));
    await copyJob.run(created.body.id, recordingUrl);
    const stored = await prisma.callRecord.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.recordingStoragePath).toBe(`calls/${created.body.id}.audio`);
    schedule.mockRestore();
  }, 60000);
});
