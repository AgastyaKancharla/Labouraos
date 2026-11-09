import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { IdService } from '../../common/id/id.service';

describe('Phase 19 Task 1: Who can edit what, and why', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let idService: IdService;

  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const bizIds: string[] = [];
  const vacancyIds: string[] = [];
  const placementIds: string[] = [];
  const referralIds: string[] = [];
  const callIds: string[] = [];
  const paymentIds: string[] = [];
  const auditLogIds: string[] = [];

  let teamLead1: { id: string; token: string; code: string };
  let agent1: { id: string; token: string; code: string };
  let fieldAgent1: { id: string; token: string; code: string };
  let otherTeamLead: { id: string; token: string; code: string };
  let otherAgent: { id: string; token: string; code: string };
  let manager: { id: string; token: string; code: string };

  const suffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    idService = app.get(IdService);

    // Create staff hierarchy:
    // teamLead1 -> agent1
    // otherTeamLead -> otherAgent
    // manager
    const tl1 = await prisma.staff.create({
      data: {
        code: `TL1-${suffix}`,
        name: 'Team Lead 1',
        email: `tl1_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    staffIds.push(tl1.id);
    teamLead1 = {
      id: tl1.id,
      code: tl1.code,
      token: await jwt.signAsync({ sub: tl1.id, role: 'team_lead', email: tl1.email, code: tl1.code }),
    };

    const ag1 = await prisma.staff.create({
      data: {
        code: `CA1-${suffix}`,
        name: 'Call Agent 1',
        email: `ca1_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'call_agent',
        teamLeadId: tl1.id,
        city: 'Bengaluru',
      },
    });
    staffIds.push(ag1.id);
    agent1 = {
      id: ag1.id,
      code: ag1.code,
      token: await jwt.signAsync({
        sub: ag1.id,
        role: 'call_agent',
        email: ag1.email,
        code: ag1.code,
        teamLeadId: tl1.id,
      }),
    };

    const fa1 = await prisma.staff.create({
      data: {
        code: `FA1-${suffix}`,
        name: 'Field Agent 1',
        email: `fa1_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'field_agent',
        teamLeadId: tl1.id,
        city: 'Bengaluru',
      },
    });
    staffIds.push(fa1.id);
    fieldAgent1 = {
      id: fa1.id,
      code: fa1.code,
      token: await jwt.signAsync({
        sub: fa1.id,
        role: 'field_agent',
        email: fa1.email,
        code: fa1.code,
        teamLeadId: tl1.id,
      }),
    };

    const tl2 = await prisma.staff.create({
      data: {
        code: `TL2-${suffix}`,
        name: 'Team Lead 2',
        email: `tl2_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    staffIds.push(tl2.id);
    otherTeamLead = {
      id: tl2.id,
      code: tl2.code,
      token: await jwt.signAsync({ sub: tl2.id, role: 'team_lead', email: tl2.email, code: tl2.code }),
    };

    const ag2 = await prisma.staff.create({
      data: {
        code: `CA2-${suffix}`,
        name: 'Call Agent 2',
        email: `ca2_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'call_agent',
        teamLeadId: tl2.id,
        city: 'Bengaluru',
      },
    });
    staffIds.push(ag2.id);
    otherAgent = {
      id: ag2.id,
      code: ag2.code,
      token: await jwt.signAsync({
        sub: ag2.id,
        role: 'call_agent',
        email: ag2.email,
        code: ag2.code,
        teamLeadId: tl2.id,
      }),
    };

    const mgr = await prisma.staff.create({
      data: {
        code: `MGR-${suffix}`,
        name: 'Manager',
        email: `mgr_${suffix}@laboura.local`,
        passwordHash: 'hash',
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    staffIds.push(mgr.id);
    manager = {
      id: mgr.id,
      code: mgr.code,
      token: await jwt.signAsync({ sub: mgr.id, role: 'manager', email: mgr.email, code: mgr.code }),
    };
  });

  afterAll(async () => {
    try {
      if (auditLogIds.length) {
        await prisma.auditLog.deleteMany({ where: { id: { in: auditLogIds } } }).catch(() => {});
      }
      if (paymentIds.length) {
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }).catch(() => {});
      }
      if (callIds.length) {
        await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } }).catch(() => {});
      }
      if (placementIds.length) {
        await prisma.placement.deleteMany({ where: { id: { in: placementIds } } }).catch(() => {});
      }
      if (vacancyIds.length) {
        await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } }).catch(() => {});
      }
      if (bizIds.length) {
        await prisma.business.deleteMany({ where: { id: { in: bizIds } } }).catch(() => {});
      }
      if (seekerIds.length) {
        await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } }).catch(() => {});
      }
      if (referralIds.length) {
        await prisma.referral.deleteMany({ where: { id: { in: referralIds } } }).catch(() => {});
      }
      if (staffIds.length) {
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => {});
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('1. Job Seeker Edit Rules & Audit Log Redaction', () => {
    let seekerId: string;
    let seekerCode: string;

    beforeAll(async () => {
      seekerCode = await idService.generateCode('job_seeker');
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: seekerCode,
          name: 'Praveen Kumar',
          phone: `98${suffix}01`,
          phoneVerified: true,
          minSalary: 1800000,
          maxSalary: 2500000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
          status: 'lead',
          registeredByStaffId: agent1.id,
          city: 'Bengaluru',
        },
      });
      seekerId = seeker.id;
      seekerIds.push(seekerId);
    });

    it('agent edits their own job seeker: filling empty field without a reason is allowed', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seekerId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          whatsappPhone: `98${suffix}01`, // was null
          locality: 'Indiranagar', // was null
        });

      expect(res.status).toBe(200);
      expect(res.body.locality).toBe('Indiranagar');

      // Database has the actual unmasked phone, response has masked phone for agents
      const updated = await prisma.jobSeeker.findUnique({ where: { id: seekerId } });
      expect(updated?.whatsappPhone).toBe(`98${suffix}01`);
    });

    it('agent changing a previously saved field without a reason is refused with 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seekerId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          locality: 'Koramangala', // was Indiranagar
          // reason missing!
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('A reason is required');
    });

    it('agent changing a saved field with a reason succeeds', async () => {
      const newPhone = `98${suffix}02`;
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seekerId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          phone: newPhone,
          reason: 'Candidate updated primary SIM number',
        });

      expect(res.status).toBe(200);

      // Verify the AuditLog entry
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'job_seeker', entityCode: seekerCode, action: 'job_seeker.update' },
        orderBy: { createdAt: 'desc' },
      });

      expect(audit).toBeDefined();
      if (audit) auditLogIds.push(audit.id);

      expect(audit?.reason).toBe('Candidate updated primary SIM number');
      expect(audit?.changedFields).toContain('phone');

      // Crucial requirement: personal fields written as "[changed]", never their values
      const beforeObj = audit?.before as Record<string, unknown>;
      const afterObj = audit?.after as Record<string, unknown>;
      expect(beforeObj.phone).toBe('[changed]');
      expect(afterObj.phone).toBe('[changed]');

      // Ensure the raw phone number NEVER appears in the audit log JSON
      const auditJson = JSON.stringify(audit);
      expect(auditJson).not.toContain(newPhone);
      expect(auditJson).not.toContain(`98${suffix}01`);
    });

    it('another agent who did not create the job seeker is refused with 403', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seekerId}`)
        .set('Authorization', `Bearer ${otherAgent.token}`)
        .send({
          minSalary: 2000000,
          reason: 'Attempted edit by outsider agent',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Only the staff member who created this record can edit it');
    });

    it('after ₹499 succeeds, the agent edit is refused (Locked — money involved)', async () => {
      // Simulate successful ₹499 payment
      const payCode = await idService.generateCode('payment');
      const pay = await prisma.payment.create({
        data: {
          code: payCode,
          type: 'registration_fee',
          status: 'succeeded',
          amount: 49900,
          expectedAmountPaise: 49900,
          subjectType: 'job_seeker',
          subjectId: seekerId,
          jobSeekerId: seekerId,
          city: 'Bengaluru',
        },
      });
      paymentIds.push(pay.id);

      await prisma.jobSeeker.update({
        where: { id: seekerId },
        data: { paymentReceivedAt: new Date(), status: 'active' },
      });

      // The creator agent attempts to edit
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seekerId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          locality: 'Whitefield',
          reason: 'Candidate moved to Whitefield',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Locked — money involved, ask your Team Lead');
    });

    it('team lead of another team is refused with 403', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seekerId}`)
        .set('Authorization', `Bearer ${otherTeamLead.token}`)
        .send({
          locality: 'Whitefield',
          reason: 'Attempt by outsider team lead',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Only the team lead of the team that created this record can edit it');
    });

    it('the agent team lead can edit after money is involved, with a reason', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/job-seekers/${seekerId}`)
        .set('Authorization', `Bearer ${teamLead1.token}`)
        .send({
          locality: 'Whitefield',
          reason: 'Team lead approved candidate location change',
        });

      expect(res.status).toBe(200);
      expect(res.body.locality).toBe('Whitefield');
    });
  });

  describe('2. Business & Vacancy Edit Rules', () => {
    let bizId: string;
    let vacancyId: string;
    let placementId: string;

    beforeAll(async () => {
      const bizCode = await idService.generateCode('business');
      const biz = await prisma.business.create({
        data: {
          code: bizCode,
          name: 'Apex Manufacturing',
          phone: `99${suffix}01`,
          accountAgentId: fieldAgent1.id,
          city: 'Bengaluru',
        },
      });
      bizId = biz.id;
      bizIds.push(bizId);

      const vcCode = await idService.generateCode('vacancy');
      const vc = await prisma.vacancy.create({
        data: {
          code: vcCode,
          businessId: biz.id,
          tradeSkill: 'CNC Operator',
          salaryMinPaise: 2500000,
          capturedByStaffId: fieldAgent1.id,
          city: 'Bengaluru',
        },
      });
      vacancyId = vc.id;
      vacancyIds.push(vacancyId);
    });

    it('account agent edits business before money is involved (with reason for saved field)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/businesses/${bizId}`)
        .set('Authorization', `Bearer ${fieldAgent1.token}`)
        .send({
          name: 'Apex Manufacturing Pvt Ltd',
          reason: 'Incorporation name update',
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Apex Manufacturing Pvt Ltd');
    });

    it('vacancy creator edits vacancy before money is involved', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/vacancies/${vacancyId}`)
        .set('Authorization', `Bearer ${fieldAgent1.token}`)
        .send({
          salaryMinPaise: 2800000,
          reason: 'Client increased starting salary',
        });

      expect(res.status).toBe(200);
      expect(res.body.salaryMinPaise).toBe(2800000);
    });

    it('once placement is confirmed, agent edit is locked for both business and vacancy', async () => {
      const plCode = await idService.generateCode('placement');
      const seekerCode = await idService.generateCode('job_seeker');
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: seekerCode,
          name: 'Test Candidate',
          phone: `97${suffix}01`,
          city: 'Bengaluru',
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
        },
      });
      seekerIds.push(seeker.id);

      const pl = await prisma.placement.create({
        data: {
          code: plCode,
          businessId: bizId,
          vacancyId,
          jobSeekerId: seeker.id,
          agreedSalary: 2800000,
          placementFee: 1400000,
          gstAmount: 252000,
          status: 'confirmed', // Money is involved!
          createdByStaffId: fieldAgent1.id,
          city: 'Bengaluru',
        },
      });
      placementId = pl.id;
      placementIds.push(placementId);

      // Business edit by agent is now locked
      const resBiz = await request(app.getHttpServer())
        .patch(`/businesses/${bizId}`)
        .set('Authorization', `Bearer ${fieldAgent1.token}`)
        .send({
          name: 'Apex New Name',
          reason: 'Attempted edit after placement confirmed',
        });
      expect(resBiz.status).toBe(403);
      expect(resBiz.body.message).toContain('Locked — money involved, ask your Team Lead');

      // Vacancy edit by agent is now locked
      const resVc = await request(app.getHttpServer())
        .patch(`/vacancies/${vacancyId}`)
        .set('Authorization', `Bearer ${fieldAgent1.token}`)
        .send({
          salaryMinPaise: 3000000,
          reason: 'Attempted edit after placement confirmed',
        });
      expect(resVc.status).toBe(403);
      expect(resVc.body.message).toContain('Locked — money involved, ask your Team Lead');

      // Team lead can edit with reason
      const resTl = await request(app.getHttpServer())
        .patch(`/vacancies/${vacancyId}`)
        .set('Authorization', `Bearer ${teamLead1.token}`)
        .send({
          salaryMinPaise: 3000000,
          reason: 'Team Lead updated salary for new requirement',
        });
      expect(resTl.status).toBe(200);
      expect(resTl.body.salaryMinPaise).toBe(3000000);
    });
  });

  describe('3. Placement & Referral Edit Rules', () => {
    it('placement creator can edit before confirmed, locked once confirmed', async () => {
      const plCode = await idService.generateCode('placement');
      const seekerCode = await idService.generateCode('job_seeker');
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: seekerCode,
          name: 'Placement Worker',
          phone: `96${suffix}01`,
          city: 'Bengaluru',
          minSalary: 1500000,
          maxSalary: 2000000,
          preferredCallWindowStart: '09:00',
          preferredCallWindowEnd: '21:00',
        },
      });
      seekerIds.push(seeker.id);

      const pl = await prisma.placement.create({
        data: {
          code: plCode,
          businessId: bizIds[0],
          vacancyId: vacancyIds[0],
          jobSeekerId: seeker.id,
          agreedSalary: 2000000,
          placementFee: 1000000,
          gstAmount: 180000,
          status: 'awaiting_payment', // NOT confirmed yet
          createdByStaffId: agent1.id,
          city: 'Bengaluru',
        },
      });
      placementIds.push(pl.id);

      // Agent can edit before payment/confirmation
      const resPre = await request(app.getHttpServer())
        .patch(`/placements/${pl.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          agreedSalary: 2200000,
          reason: 'Negotiated revised salary with business',
        });
      expect(resPre.status).toBe(200);
      expect(resPre.body.agreedSalary).toBe(2200000);

      // Now set to confirmed
      await prisma.placement.update({
        where: { id: pl.id },
        data: { status: 'confirmed' },
      });

      // Agent is now locked out
      const resPost = await request(app.getHttpServer())
        .patch(`/placements/${pl.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          agreedSalary: 2500000,
          reason: 'Agent attempt after confirmed',
        });
      expect(resPost.status).toBe(403);
      expect(resPost.body.message).toContain('Locked — money involved, ask your Team Lead');

      // Manager can edit with reason
      const resMgr = await request(app.getHttpServer())
        .patch(`/placements/${pl.id}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({
          agreedSalary: 2500000,
          reason: 'Manager corrected placement salary',
        });
      expect(resMgr.status).toBe(200);
      expect(resMgr.body.agreedSalary).toBe(2500000);
    });

    it('referral partner editable until payout approved, locked once approved', async () => {
      const refCode = await idService.generateCode('referral');
      const ref = await prisma.referral.create({
        data: {
          code: refCode,
          name: 'Partner Ramesh',
          phone: `95${suffix}01`,
          phoneVerified: true,
          city: 'Bengaluru',
        },
      });
      referralIds.push(ref.id);

      // Create referral.create audit log pointing to agent1 as creator
      const audit = await prisma.auditLog.create({
        data: {
          code: await idService.generateCode('audit_log'),
          actorId: agent1.id,
          action: 'referral.create',
          entityType: 'referral',
          entityCode: refCode,
          city: 'Bengaluru',
        },
      });
      auditLogIds.push(audit.id);

      // Agent can edit partner before payout is approved
      const resPre = await request(app.getHttpServer())
        .patch(`/referrals/${ref.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          name: 'Partner Ramesh Babu',
          reason: 'Spelling correction',
        });
      expect(resPre.status).toBe(200);
      expect(resPre.body.name).toBe('Partner Ramesh Babu');

      // Create an approved payout for this referral partner
      const payoutCode = await idService.generateCode('payment');
      const payout = await prisma.payment.create({
        data: {
          code: payoutCode,
          type: 'referral_payout',
          status: 'approved',
          amount: 20000,
          expectedAmountPaise: 20000,
          subjectType: 'referral',
          subjectId: ref.id,
          referralId: ref.id,
          city: 'Bengaluru',
        },
      });
      paymentIds.push(payout.id);

      // Agent is now locked out
      const resPost = await request(app.getHttpServer())
        .patch(`/referrals/${ref.id}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          name: 'Partner Ramesh Kumar',
          reason: 'Agent attempt after payout approved',
        });
      expect(resPost.status).toBe(403);
      expect(resPost.body.message).toContain('Locked — money involved, ask your Team Lead');
    });
  });

  describe('4. Call Notes Edit Rules & Never-Editable Provider Fields', () => {
    let callId: string;

    beforeAll(async () => {
      const callCode = await idService.generateCode('call_record');
      const call = await prisma.callRecord.create({
        data: {
          code: callCode,
          provider: 'mock_telephony',
          providerCallId: `call_${suffix}`,
          providerStatus: 'completed',
          answered: true,
          durationSec: 120,
          staffId: agent1.id,
          agentOutcome: 'general',
          agentOutcomeReason: 'Initial candidate discussion notes',
        },
      });
      callId = call.id;
      callIds.push(callId);
    });

    it('staff who made the call can update notes with a reason', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/calls/${callId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          notes: 'Updated discussion details from candidate',
          reason: 'Clarified candidate preferred timings',
        });

      expect(res.status).toBe(200);
      expect(res.body.agentOutcomeReason).toBe('Updated discussion details from candidate');
    });

    it('refuses any attempt to edit provider fields or recordings on a call record', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/calls/${callId}`)
        .set('Authorization', `Bearer ${agent1.token}`)
        .send({
          providerCallId: 'tampered-call-id',
          reason: 'Attempt to tamper provider call id',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Call provider fields and recordings are never editable');
    });
  });

  describe('5. Never-Editable Entities Across All Routes', () => {
    it('asserts no update/patch/delete routes exist for Payment, BankCredit, Consent, CandidateIntroduction, AuditLog, StatusHistory, IdentityVerification, and BusinessAgreement', async () => {
      const server = app.getHttpServer();

      // Protected entities list from AGENTS.md / Phase 19 spec
      const protectedEndpoints = [
        '/payments/test-id',
        '/bank-credits/test-id',
        '/consents/test-id',
        '/candidate-introductions/test-id',
        '/audit-logs/test-id',
        '/status-history/test-id',
        '/identity-verifications/test-id',
        '/business-agreements/test-id',
      ];

      for (const endpoint of protectedEndpoints) {
        // PATCH
        const patchRes = await request(server)
          .patch(endpoint)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ status: 'tampered' });
        expect(patchRes.status).toBe(404);

        // PUT
        const putRes = await request(server)
          .put(endpoint)
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ status: 'tampered' });
        expect(putRes.status).toBe(404);

        // DELETE
        const deleteRes = await request(server)
          .delete(endpoint)
          .set('Authorization', `Bearer ${manager.token}`);
        expect(deleteRes.status).toBe(404);
      }
    });
  });
});
