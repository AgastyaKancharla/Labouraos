import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { recordRefundCheck } from '../../test-support/refund-check';

describe('Phase 12 Task 6 — JobSeekerHit Changes and Reversals', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  let ceoToken: string;
  let managerToken: string;
  let teamLeadToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;
  let otherTeamLeadToken: string;
  let teamLeadId: string;
  let managerId: string;
  let callAgentId: string;

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

    const passwordHash = await bcrypt.hash('StaffPassword123!', 4);

    async function createStaffUser(role: string, prefix: string) {
      const suffix = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
      const staff = await prisma.staff.create({
        data: {
          code: `${prefix}-${suffix}`,
          name: `Test ${role} ${suffix}`,
          email: `${prefix.toLowerCase()}_${suffix}@laboura.local`,
          passwordHash,
          role,
          status: 'active',
        },
      });
      createdStaffIds.push(staff.id);
      lastStaffId = staff.id;
      return jwt.sign({ sub: staff.id, role: staff.role, code: staff.code, email: staff.email });
    }
    let lastStaffId = '';

    ceoToken = await createStaffUser('ceo', 'CEO-REV');
    managerToken = await createStaffUser('manager', 'MGR-REV');
    managerId = lastStaffId;
    teamLeadToken = await createStaffUser('team_lead', 'TL-REV');
    teamLeadId = lastStaffId;
    callAgentToken = await createStaffUser('call_agent', 'CA-REV');
    callAgentId = lastStaffId;
    fieldAgentToken = await createStaffUser('field_agent', 'FA-REV');
    financeToken = await createStaffUser('finance', 'FIN-REV');
    otherTeamLeadToken = await createStaffUser('team_lead', 'TL2-REV');
    // The call agent registers the test job seekers and sits in the Team Lead's team.
    await prisma.staff.update({ where: { id: teamLeadId }, data: { reportsToId: managerId } });
    await prisma.staff.update({ where: { id: callAgentId }, data: { teamLeadId, reportsToId: teamLeadId } });
  });

  afterAll(async () => {
    if (createdSeekerIds.length > 0) {
      await prisma.reviewFlag.deleteMany({
        where: {
          subjectType: 'job_seeker_hit',
        },
      });
      await prisma.payment.deleteMany({
        where: { jobSeekerId: { in: createdSeekerIds } },
      });
      await prisma.followUpTask.deleteMany({
        where: { subjectId: { in: createdSeekerIds } },
      });
      await prisma.jobSeekerHit.deleteMany({
        where: { jobSeekerId: { in: createdSeekerIds } },
      });
      await prisma.statusHistory.deleteMany({
        where: { subjectId: { in: createdSeekerIds } },
      });
      await prisma.jobSeeker.deleteMany({
        where: { id: { in: createdSeekerIds } },
      });
    }
    if (createdStaffIds.length > 0) {
      await prisma.staff.deleteMany({
        where: { id: { in: createdStaffIds } },
      });
    }
    await app.close();
  });

  async function createCandidate(options?: {
    status?: string;
    hitCount?: number;
    paymentReceivedAt?: Date | null;
    registeredByStaffId?: string | null;
  }): Promise<string> {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const phoneSuffix = Math.floor(10000000 + Math.random() * 90000000);
    const seeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-HIT-${suffix}`,
        name: `Hit Test Candidate ${suffix}`,
        phone: `+9195${phoneSuffix}`,
        trades: { create: { trade: 'Driver', isPrimary: true } },
        minSalary: 1600000,
        maxSalary: 2600000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: options?.status ?? 'active',
        hitCount: options?.hitCount ?? 0,
        paymentReceivedAt: options?.paymentReceivedAt ?? null,
        registeredByStaffId: options?.registeredByStaffId === undefined ? callAgentId : options.registeredByStaffId,
      },
    });
    createdSeekerIds.push(seeker.id);
    return seeker.id;
  }

  it('1. Records new hit reasons: offer_declined, offer_no_reply, interview_no_show with optional metadata', async () => {
    const seekerId = await createCandidate();

    const reasons = ['offer_declined', 'offer_no_reply', 'interview_no_show'];
    for (const reason of reasons) {
      const interviewId = randomUUID();
      const callRecordId = randomUUID();
      const res = await request(app.getHttpServer())
        .post(`/job-seekers/${seekerId}/hits`)
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          reason,
          note: `Test note for ${reason}`,
          interviewId,
          callRecordId,
        });

      expect(res.status).toBe(201);
      expect(res.body.reason).toBe(reason);

      const dbHit = await prisma.jobSeekerHit.findFirst({
        where: { jobSeekerId: seekerId, reason },
      });
      expect(dbHit).not.toBeNull();
      expect(dbHit?.interviewId).toBe(interviewId);
      expect(dbHit?.callRecordId).toBe(callRecordId);
    }
  });

  it('2. Read-maps legacy offer_rejected rows to offer_declined without rewriting the row', async () => {
    const seekerId = await createCandidate();

    // Insert legacy row directly in database
    const legacyHit = await prisma.jobSeekerHit.create({
      data: {
        jobSeekerId: seekerId,
        reason: 'offer_rejected',
        note: 'Legacy rejected offer',
        recordedBy: 'system',
      },
    });

    // Check GET /job-seeker-hits/:id
    const hitRes = await request(app.getHttpServer())
      .get(`/job-seeker-hits/${legacyHit.id}`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(hitRes.status).toBe(200);
    expect(hitRes.body.reason).toBe('offer_declined');

    // Check DB row still stores 'offer_rejected' (not rewritten)
    const rawDbHit = await prisma.jobSeekerHit.findUnique({
      where: { id: legacyHit.id },
    });
    expect(rawDbHit?.reason).toBe('offer_rejected');

    // Check GET /job-seekers/:id/hits
    const listRes = await request(app.getHttpServer())
      .get(`/job-seekers/${seekerId}/hits`)
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(listRes.status).toBe(200);
    const mapped = listRes.body.find((h: Record<string, unknown>) => h.id === legacyHit.id);
    expect(mapped.reason).toBe('offer_declined');
  });

  it('3. Reversing a hit updates reversal fields and raises exactly one ReviewFlag', async () => {
    const seekerId = await createCandidate();

    const hit = await prisma.jobSeekerHit.create({
      data: {
        jobSeekerId: seekerId,
        reason: 'offer_declined',
        note: 'Misunderstood offer details',
        recordedBy: 'system',
      },
    });
    await prisma.jobSeeker.update({
      where: { id: seekerId },
      data: { hitCount: 1 },
    });

    const res = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit.id}/reverse`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({
        reversalReason: 'Candidate contacted us to clarify wage misunderstanding; wrong hit',
      });

    expect(res.status).toBe(201);
    expect(res.body.reversedAt).toBeDefined();
    expect(res.body.reversedByStaffId).toBeDefined();
    expect(res.body.reversalReason).toBe(
      'Candidate contacted us to clarify wage misunderstanding; wrong hit',
    );

    // Verify in database
    const dbHit = await prisma.jobSeekerHit.findUnique({
      where: { id: hit.id },
    });
    expect(dbHit?.reversedAt).not.toBeNull();
    expect(dbHit?.reversalReason).toContain('wrong hit');

    // Verify candidate hitCount decremented
    const seeker = await prisma.jobSeeker.findUnique({
      where: { id: seekerId },
    });
    expect(seeker?.hitCount).toBe(0);

    // Verify exactly one ReviewFlag was raised
    const flags = await prisma.reviewFlag.findMany({
      where: {
        subjectType: 'job_seeker_hit',
        subjectId: hit.id,
        kind: 'hit_reversed',
      },
    });
    expect(flags.length).toBe(1);
    expect(flags[0].kind).toBe('hit_reversed');
    expect(flags[0].status).toBe('open');
  });

  it('4. Reversing a hit reactivates a deactivated candidate (active hits < maxHits)', async () => {
    const seekerId = await createCandidate({
      status: 'active',
      hitCount: 2,
    });

    // 3rd hit deactivates candidate
    const hit3Res = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/hits`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        reason: 'offer_no_reply',
        note: 'No reply within 48h',
      });

    expect(hit3Res.status).toBe(201);
    const seekerAfter3 = await prisma.jobSeeker.findUnique({
      where: { id: seekerId },
    });
    expect(seekerAfter3?.status).toBe('deactivated');
    expect(seekerAfter3?.hitCount).toBe(3);

    const hit3Id = hit3Res.body.id;

    // Team Lead reverses hit 3
    const revRes = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit3Id}/reverse`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({
        reversalReason: 'Candidate had medical emergency, validated via prescription',
      });

    expect(revRes.status).toBe(201);

    // Candidate should be reactivated because active hits is now 2 < 3
    const seekerAfterRev = await prisma.jobSeeker.findUnique({
      where: { id: seekerId },
    });
    expect(seekerAfterRev?.hitCount).toBe(2);
    expect(seekerAfterRev?.status).toBe('active');

    // Attempting to reverse the same hit again fails with 400
    const secondRev = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit3Id}/reverse`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({
        reversalReason: 'Duplicate attempt',
      });
    expect(secondRev.status).toBe(400);
    expect(secondRev.body.message).toContain('already been reversed');
  });

  it('5. Non-reversed interview_no_show ends refund eligibility immediately; reversing it restores eligibility', async () => {
    // Candidate paid 35 days ago (eligible for 30-day guarantee refund)
    const paidAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const seekerId = await createCandidate({
      status: 'active',
      hitCount: 0,
      paymentReceivedAt: paidAt,
    });

    // Add activation payment record
    await prisma.payment.create({
      data: {
        code: `PM-TEST-${randomUUID().slice(0, 8)}`,
        type: 'activation',
        amount: 49900,
        status: 'completed',
        gatewayReference: `gtw_${randomUUID()}`,
        subjectType: 'job_seeker',
        subjectId: seekerId,
        jobSeekerId: seekerId,
      },
    });

    // Candidate records an interview_no_show hit
    const hitRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/hits`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        reason: 'interview_no_show',
        note: 'Did not attend interview at bakery',
      });
    expect(hitRes.status).toBe(201);
    const hitId = hitRes.body.id;

    // Refund request MUST now be rejected immediately
    const refundDeniedRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/refund`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        asOf: new Date().toISOString(),
      });
    expect(refundDeniedRes.status).toBe(400);
    expect(refundDeniedRes.body.message).toContain('rejected a suitable offer');

    // Reverse the hit
    await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hitId}/reverse`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({
        reversalReason: 'Interviewer was not present; candidate was turned away at gate',
      })
      .expect(201);
    // The refund-check call is recorded before any ₹499 refund is approved.
    await recordRefundCheck(prisma, seekerId);

    // Refund request should now SUCCEED
    const refundApprovedRes = await request(app.getHttpServer())
      .post(`/job-seekers/${seekerId}/refund`)
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        asOf: new Date().toISOString(),
      });
    expect(refundApprovedRes.status).toBe(201);
    expect(refundApprovedRes.body.type).toBe('refund');
    expect(refundApprovedRes.body.amount).toBe(49900);
  });

  it('6. RBAC: Team Lead, Manager and CEO can reverse hits; Call Agent, Field Agent, Finance are denied', async () => {
    const seekerId = await createCandidate();
    const hit = await prisma.jobSeekerHit.create({
      data: {
        jobSeekerId: seekerId,
        reason: 'offer_declined',
        recordedBy: 'system',
      },
    });

    // Call agent denied (403)
    const caRes = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit.id}/reverse`)
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ reversalReason: 'Test' });
    expect(caRes.status).toBe(403);

    // Field agent denied (403)
    const faRes = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit.id}/reverse`)
      .set('Authorization', `Bearer ${fieldAgentToken}`)
      .send({ reversalReason: 'Test' });
    expect(faRes.status).toBe(403);

    // Finance denied (403)
    const finRes = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit.id}/reverse`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ reversalReason: 'Test' });
    expect(finRes.status).toBe(403);

    // Manager allowed (201)
    const mgrRes = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit.id}/reverse`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ reversalReason: 'Approved by manager' });
    expect(mgrRes.status).toBe(201);
  });

  it("7. A Team Lead can reverse hits only for job seekers handled by their own team", async () => {
    const outsiderSeekerId = await createCandidate({ registeredByStaffId: null });
    const hit = await prisma.jobSeekerHit.create({
      data: { jobSeekerId: outsiderSeekerId, reason: 'offer_declined', recordedBy: 'system' },
    });
    await prisma.jobSeeker.update({ where: { id: outsiderSeekerId }, data: { hitCount: 1 } });

    const noTeam = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit.id}/reverse`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ reversalReason: 'Not my team' });
    expect(noTeam.status).toBe(403);
    expect(noTeam.body.message).toContain('own team');

    const ownSeekerId = await createCandidate();
    const ownHit = await prisma.jobSeekerHit.create({
      data: { jobSeekerId: ownSeekerId, reason: 'offer_declined', recordedBy: 'system' },
    });
    await prisma.jobSeeker.update({ where: { id: ownSeekerId }, data: { hitCount: 1 } });
    const otherTeamLead = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${ownHit.id}/reverse`)
      .set('Authorization', `Bearer ${otherTeamLeadToken}`)
      .send({ reversalReason: 'Another team lead' });
    expect(otherTeamLead.status).toBe(403);

    const unchanged = await prisma.jobSeekerHit.findUniqueOrThrow({ where: { id: ownHit.id } });
    expect(unchanged.reversedAt).toBeNull();
  });

  it('8. A third hit removal on one job seeker goes to the Manager', async () => {
    const seekerId = await createCandidate({ hitCount: 3, status: 'deactivated' });
    const hits = [];
    for (const reason of ['offer_declined', 'offer_no_reply', 'interview_no_show']) {
      hits.push(await prisma.jobSeekerHit.create({ data: { jobSeekerId: seekerId, reason, recordedBy: 'system' } }));
    }

    for (const hit of hits.slice(0, 2)) {
      await request(app.getHttpServer())
        .post(`/job-seeker-hits/${hit.id}/reverse`)
        .set('Authorization', `Bearer ${teamLeadToken}`)
        .send({ reversalReason: 'Wrongly recorded' })
        .expect(201);
    }

    const third = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hits[2].id}/reverse`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ reversalReason: 'Third one too' });
    expect(third.status).toBe(403);
    expect(third.body.message).toContain('goes to the Manager');
    expect((await prisma.jobSeekerHit.findUniqueOrThrow({ where: { id: hits[2].id } })).reversedAt).toBeNull();

    const requestFlags = await prisma.reviewFlag.findMany({
      where: { kind: 'hit_reversal_needs_manager', subjectType: 'job_seeker_hit', subjectId: hits[2].id },
    });
    expect(requestFlags).toHaveLength(1);
    expect((requestFlags[0].details as Record<string, unknown>).managerStaffId).toBe(managerId);

    // Asking again does not raise a second request.
    await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hits[2].id}/reverse`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ reversalReason: 'Third one too' })
      .expect(403);
    expect(await prisma.reviewFlag.count({
      where: { kind: 'hit_reversal_needs_manager', subjectId: hits[2].id },
    })).toBe(1);

    const byManager = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hits[2].id}/reverse`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ reversalReason: 'Manager reviewed the recording' });
    expect(byManager.status).toBe(201);
  });

  it('9. A hit from an earlier guarantee (superseded by paying again) cannot be reversed', async () => {
    const seekerId = await createCandidate();
    const hit = await prisma.jobSeekerHit.create({
      data: { jobSeekerId: seekerId, reason: 'offer_declined', recordedBy: 'system', supersededAt: new Date() },
    });
    const res = await request(app.getHttpServer())
      .post(`/job-seeker-hits/${hit.id}/reverse`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ reversalReason: 'Old cycle' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('earlier guarantee');
  });
});
