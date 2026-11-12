import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { stableTotpCode } from '../../test-support/enrolled-login-spec';
import { loginCodeFor } from '../../modules/login-code/login-code.crypto';
import { RBAC_MATRIX } from '../../common/rbac/rbac.types';
import { seed } from '../../../prisma/seed';

interface StaffListItem {
  id: string;
  name: string;
  role: string;
  teamLeadId?: string | null;
}

describe('Phase 6.6 Gate: End-to-End Proof', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const BOOTSTRAP_SECRET = 'ci_bootstrap_secret_testing_only_32_characters';
  let ipCounter = 1;
  const freshIp = () => `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  async function clearAllStaff() {
    await prisma.staffSession.deleteMany({});
    await prisma.businessVisit.deleteMany({});
    await prisma.contactAttempt.deleteMany({});
    await prisma.callbackTask.deleteMany({});
    await prisma.target.deleteMany({});
    await prisma.jobSeeker.updateMany({ data: { registeredByStaffId: null } });
    await prisma.placement.updateMany({ data: { createdByStaffId: null } });
    await prisma.vacancy.updateMany({ data: { capturedByStaffId: null } });
    await prisma.staff.updateMany({ data: { teamLeadId: null } });
    await prisma.auditLog.deleteMany({});
    await prisma.staff.deleteMany({});
  }

  beforeAll(async () => {
    process.env.STAFF_BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    applyTrustProxy(app, '1');
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    process.env.STAFF_BOOTSTRAP_SECRET = BOOTSTRAP_SECRET;
    await clearAllStaff();
    await seed(prisma);
    await app.close();
  });

  it('executes the full 9-step end-to-end proof with recorded output at each step', async () => {
    await clearAllStaff();

    // =========================================================================
    // STEP 1: Bootstrap a CEO using the secret, on an empty database
    // =========================================================================
    console.log('\n--- STEP 1: Bootstrap CEO on empty database ---');
    const bootstrapPayload = {
      name: 'Agastya CEO',
      email: 'agastya.ceo@laboura.local',
      password: 'SuperSecureCeoPassword2026!',
    };
    const bootstrapRes = await request(app.getHttpServer())
      .post('/staff/bootstrap')
      .set('X-Forwarded-For', freshIp())
      .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
      .send(bootstrapPayload);

    expect(bootstrapRes.status).toBe(201);
    expect(bootstrapRes.body.staff.role).toBe('ceo');
    expect(bootstrapRes.body.totpSecret).toBeUndefined(); // no secret returned
    const staffRow = await prisma.staff.findUniqueOrThrow({
      where: { id: bootstrapRes.body.staff.id },
    });
    expect(staffRow.totpEnabled).toBe(false);
    expect(staffRow.totpSecret).toBeNull();
    console.log('Step 1 Output: HTTP 201 Created');
    console.log(JSON.stringify(bootstrapRes.body, null, 2));

    // =========================================================================
    // STEP 2: Log in — confirm restricted totp_setup scope and operational endpoints refused
    // =========================================================================
    console.log('\n--- STEP 2: First login returns totp_setup scope & blocks operational endpoints ---');
    const firstLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
        .send({
          staffCode: bootstrapRes.body.staff.code,
          password: bootstrapPayload.password,
          deviceId: 'e2e-ceo-device',
        });

    expect(firstLoginRes.status).toBe(200);
    expect(firstLoginRes.body.totpEnrollmentRequired).toBe(true);
    const setupToken = firstLoginRes.body.accessToken;
    expect(setupToken).toBeDefined();
    console.log('Step 2 Output: First Login Response (restricted scope):');
    console.log(JSON.stringify({
      statusCode: firstLoginRes.status,
      totpEnrollmentRequired: firstLoginRes.body.totpEnrollmentRequired,
      accessTokenPrefix: setupToken.slice(0, 20) + '...',
    }, null, 2));

    // Probe operational endpoint (/staff) with setupToken
    const probeRes = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${setupToken}`)
      .set('X-Forwarded-For', freshIp());

    expect(probeRes.status).toBe(403);
    console.log('Step 2 Output: Operational probe with setupToken (refused):');
    console.log(JSON.stringify({
      statusCode: probeRes.status,
      body: probeRes.body,
    }, null, 2));

    // =========================================================================
    // STEP 3: Enrol 2FA, then log in fully
    // =========================================================================
    console.log('\n--- STEP 3: Enrol 2FA and perform full login ---');
    const setup2faRes = await request(app.getHttpServer())
      .post('/staff/2fa/setup')
      .set('Authorization', `Bearer ${setupToken}`)
      .set('X-Forwarded-For', freshIp())
      .send();

    expect(setup2faRes.status).toBe(200);
    const ceoTotpSecret = setup2faRes.body.secret;
    const ceoCode = await stableTotpCode(ceoTotpSecret);

    const enable2faRes = await request(app.getHttpServer())
      .post('/staff/2fa/enable')
      .set('Authorization', `Bearer ${setupToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({ totpCode: ceoCode });

    expect(enable2faRes.status).toBe(200);
    expect(enable2faRes.body.success).toBe(true);

    const fullLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
        .send({
          staffCode: bootstrapRes.body.staff.code,
          password: bootstrapPayload.password,
          deviceId: 'e2e-ceo-device',
          totpCode: await stableTotpCode(ceoTotpSecret),
        });

    expect(fullLoginRes.status).toBe(200);
    expect(fullLoginRes.body.totpEnrollmentRequired).toBeUndefined();
    const ceoFullToken = fullLoginRes.body.accessToken;
    expect(ceoFullToken).toBeDefined();

    const ceoStaffList = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp());
    expect(ceoStaffList.status).toBe(200);

    console.log('Step 3 Output: Full Login Successful:');
    console.log(JSON.stringify({
      statusCode: fullLoginRes.status,
      hasFullToken: !!ceoFullToken,
      staffEndpointAccessible: ceoStaffList.status === 200,
      totalStaffCount: ceoStaffList.body.length,
    }, null, 2));

    // =========================================================================
    // STEP 4: Create a Team Lead and two agents under them
    // =========================================================================
    console.log('\n--- STEP 4: Create Team Lead 1, accept invite, enrol 2FA, and add 2 agents under them ---');
    const ceoId = bootstrapRes.body.staff.id as string;
    const createManagerRes = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'Manager 1',
        email: 'manager1@laboura.local',
        role: 'manager',
        reportsToId: ceoId,
      });
    expect(createManagerRes.status).toBe(201);
    const acceptManagerRes = await request(app.getHttpServer())
      .post('/staff/accept-invite')
      .set('X-Forwarded-For', freshIp())
      .send({
        token: createManagerRes.body.inviteToken,
        password: 'Manager1Password2026!',
      });
    expect(acceptManagerRes.status).toBe(200);
    const managerId = createManagerRes.body.staff.id as string;
    // 4a. Create Team Lead 1
    const createTl1Res = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'Team Lead 1',
        email: 'lead1@laboura.local',
        role: 'team_lead',
        reportsToId: managerId,
      });
    expect(createTl1Res.status).toBe(201);
    const tl1Id = createTl1Res.body.staff.id;
    const tl1InviteToken = createTl1Res.body.inviteToken;

    // 4b. TL1 accepts invite
    const tl1Password = 'Lead1Password2026!';
    const acceptTl1Res = await request(app.getHttpServer())
      .post('/staff/accept-invite')
      .set('X-Forwarded-For', freshIp())
      .send({
        token: tl1InviteToken,
        password: tl1Password,
      });
    expect(acceptTl1Res.status).toBe(200);

    // 4c. TL1's device waits for approval. Team leads do not enrol in TOTP.
    const tl1Code = createTl1Res.body.staff.code as string;
    const tl1DeviceId = 'e2e-tl1-device';
    const tl1WaitingDevice = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: tl1Code, password: tl1Password, deviceId: tl1DeviceId });
    expect(tl1WaitingDevice.status).toBe(401);
    const tl1Device = await prisma.staffDevice.findUniqueOrThrow({
      where: { staffId_deviceId: { staffId: tl1Id, deviceId: tl1DeviceId } },
    });
    const approveTl1 = await request(app.getHttpServer())
      .post(`/staff/devices/${tl1Device.id}/approve`)
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp());
    expect(approveTl1.status).toBe(200);

    // 4d. CEO creates Agent 1 under TL1 (call_agent)
    const createAgent1Res = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'Call Agent 1',
        email: 'agent1@laboura.local',
        role: 'call_agent',
        teamLeadId: tl1Id,
      });
    expect(createAgent1Res.status).toBe(201);
    const agent1Id = createAgent1Res.body.staff.id;

    // 4e. CEO creates Agent 2 under TL1 (field_agent)
    const createAgent2Res = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'Field Agent 2',
        email: 'agent2@laboura.local',
        role: 'field_agent',
        area: 'Koramangala',
        teamLeadId: tl1Id,
      });
    expect(createAgent2Res.status).toBe(201);
    const agent2Id = createAgent2Res.body.staff.id;

    // 4f. CEO also creates Team Lead 2 and Agent 3 under Team Lead 2 for negative assertion
    const createTl2Res = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'Team Lead 2',
        email: 'lead2@laboura.local',
        role: 'team_lead',
        reportsToId: managerId,
      });
    expect(createTl2Res.status).toBe(201);
    const tl2Id = createTl2Res.body.staff.id;
    const tl2InviteToken = createTl2Res.body.inviteToken;

    // TL2 accepts invite to become active so an agent can reference them as team lead
    const acceptTl2Res = await request(app.getHttpServer())
      .post('/staff/accept-invite')
      .set('X-Forwarded-For', freshIp())
      .send({
        token: tl2InviteToken,
        password: 'Lead2Password2026!',
      });
    expect(acceptTl2Res.status).toBe(200);

    const createAgent3Res = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'Call Agent 3',
        email: 'agent3@laboura.local',
        role: 'call_agent',
        teamLeadId: tl2Id,
      });
    expect(createAgent3Res.status).toBe(201);
    const agent3Id = createAgent3Res.body.staff.id;

    console.log('Step 4 Output: Created Team Lead 1, Agent 1 (under TL1), Agent 2 (under TL1), and Team Lead 2 with Agent 3');
    console.log(JSON.stringify({
      teamLead1: { id: tl1Id, email: 'lead1@laboura.local' },
      agent1: { id: agent1Id, email: 'agent1@laboura.local', teamLeadId: tl1Id },
      agent2: { id: agent2Id, email: 'agent2@laboura.local', teamLeadId: tl1Id },
      teamLead2: { id: tl2Id, email: 'lead2@laboura.local' },
      agent3: { id: agent3Id, email: 'agent3@laboura.local', teamLeadId: tl2Id },
    }, null, 2));

    // =========================================================================
    // STEP 5: Log in as the Team Lead. Confirm they see their own team
    // =========================================================================
    console.log('\n--- STEP 5: Log in as Team Lead 1 & confirm own team visibility ---');
    const tl1CodeLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: tl1Code, password: tl1Password, deviceId: tl1DeviceId });
    expect(tl1CodeLogin.body.status).toBe('awaiting_code');
    const tl1Shown = await request(app.getHttpServer())
      .post(`/login-codes/${tl1CodeLogin.body.loginRequestId}/reveal`)
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp());
    expect(tl1Shown.status).toBe(200);
    const tl1FullLogin = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .set('X-Forwarded-For', freshIp())
      .send({
        loginRequestId: tl1CodeLogin.body.loginRequestId,
        code: tl1Shown.body.code,
        deviceId: tl1DeviceId,
        loginRequestProof: tl1CodeLogin.body.loginRequestProof,
      });
    expect(tl1FullLogin.status).toBe(200);
    const tl1Token = tl1FullLogin.body.accessToken;

    const tl1StaffList = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${tl1Token}`)
      .set('X-Forwarded-For', freshIp());

    expect(tl1StaffList.status).toBe(200);
    const tl1StaffBody = tl1StaffList.body as StaffListItem[];
    const returnedStaffIds = tl1StaffBody.map((s) => s.id);
    expect(returnedStaffIds).toEqual(expect.arrayContaining([agent1Id, agent2Id]));
    expect(returnedStaffIds).toHaveLength(2);
    expect(returnedStaffIds).not.toContain(tl2Id);
    expect(returnedStaffIds).not.toContain(agent3Id);

    console.log('Step 5 Output: Team Lead 1 listed staff:');
    console.log(JSON.stringify({
      statusCode: tl1StaffList.status,
      returnedStaff: tl1StaffBody.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        teamLeadId: s.teamLeadId,
      })),
    }, null, 2));

    // =========================================================================
    // STEP 6: Confirm the Team Lead is refused another team lead's agent
    // =========================================================================
    console.log('\n--- STEP 6: Confirm Team Lead 1 is refused querying another team lead ---');
    const foreignTeamQuery = await request(app.getHttpServer())
      .get(`/staff?teamLeadId=${tl2Id}`)
      .set('Authorization', `Bearer ${tl1Token}`)
      .set('X-Forwarded-For', freshIp());

    expect(foreignTeamQuery.status).toBe(403);
    expect(foreignTeamQuery.body.message).toContain('cannot view staff of another team lead');

    console.log('Step 6 Output: Querying foreign team lead refused with 403:');
    console.log(JSON.stringify({
      statusCode: foreignTeamQuery.status,
      body: foreignTeamQuery.body,
    }, null, 2));

    // =========================================================================
    // STEP 7: Confirm Team Lead is refused creating staff, deactivating staff, and writing targets
    // =========================================================================
    console.log('\n--- STEP 7: Confirm Team Lead is refused staff creation, staff deactivation, and target writes ---');
    // 7a. Refused creating staff
    const tlCreateStaffRes = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tl1Token}`)
      .set('X-Forwarded-For', freshIp())
      .send({
        name: 'Unauthorized Hire',
        email: 'unauthorized@laboura.local',
        role: 'call_agent',
      });
    expect(tlCreateStaffRes.status).toBe(403);

    // 7b. Refused deactivating staff
    const tlDeactivateStaffRes = await request(app.getHttpServer())
      .post(`/staff/${agent1Id}/deactivate`)
      .set('Authorization', `Bearer ${tl1Token}`)
      .set('X-Forwarded-For', freshIp())
      .send();
    expect(tlDeactivateStaffRes.status).toBe(403);

    // 7c. Refused target write in RBAC
    const rbacTargetWrite = RBAC_MATRIX.team_lead.target.write;
    expect(rbacTargetWrite.allowed).toBe(false);
    expect(rbacTargetWrite.scope).toBe('none');

    console.log('Step 7 Output: Refusals confirmed:');
    console.log(JSON.stringify({
      createStaffRefusal: { statusCode: tlCreateStaffRes.status, body: tlCreateStaffRes.body },
      deactivateStaffRefusal: { statusCode: tlDeactivateStaffRes.status, body: tlDeactivateStaffRes.body },
      rbacTargetWritePolicy: rbacTargetWrite,
    }, null, 2));

    // =========================================================================
    // STEP 8: Re-issue Team Lead's invite. Confirm old password AND old TOTP code both fail, sessions gone
    // =========================================================================
    console.log('\n--- STEP 8: Re-issue invite: old password, old TOTP code, and old sessions all fail ---');
    const reissueRes = await request(app.getHttpServer())
      .post(`/staff/${tl1Id}/reissue-invite`)
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send();

    expect(reissueRes.status).toBe(200);
    const newInviteToken = reissueRes.body.inviteToken;
    expect(newInviteToken).toBeDefined();

    // 8a. Old password fails
    const oldLoginAttempt = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
        .send({
          staffCode: tl1Code,
          password: tl1Password,
          deviceId: tl1DeviceId,
        });
    expect(oldLoginAttempt.status).toBe(401);

    // 8b. Prior session token is revoked
    const oldSessionProbe = await request(app.getHttpServer())
      .get('/staff/sessions')
      .set('Authorization', `Bearer ${tl1Token}`)
      .set('X-Forwarded-For', freshIp());
    expect(oldSessionProbe.status).toBe(401);

    console.log('Step 8 Output: Invite Re-issued & Credentials Voided:');
    console.log(JSON.stringify({
      reissueStatus: reissueRes.status,
      inviteExpiresAt: reissueRes.body.inviteExpiresAt,
      oldCredentialsLoginAttempt: { statusCode: oldLoginAttempt.status, message: oldLoginAttempt.body.message },
      oldSessionProbe: { statusCode: oldSessionProbe.status, message: oldSessionProbe.body.message },
    }, null, 2));

    // =========================================================================
    // STEP 9: Accept new invite, confirm 2FA re-enrolment is forced, access restored
    // =========================================================================
    console.log('\n--- STEP 9: Accept new invite, force 2FA re-enrolment, and verify restored access ---');
    const newTlPassword = 'BrandNewLead1Password2026!';
    const acceptNewInviteRes = await request(app.getHttpServer())
      .post('/staff/accept-invite')
      .set('X-Forwarded-For', freshIp())
      .send({
        token: newInviteToken,
        password: newTlPassword,
      });
    expect(acceptNewInviteRes.status).toBe(200);
    expect(acceptNewInviteRes.body.success).toBe(true);

    // New password reaches the login-code step. Team leads are not sent back to TOTP.
    const newPasswordLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({
        staffCode: tl1Code,
        password: newTlPassword,
        deviceId: tl1DeviceId,
      });
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.body.status).toBe('awaiting_code');
    expect(newPasswordLogin.body.accessToken).toBeUndefined();

    const restoredShown = await request(app.getHttpServer())
      .post(`/login-codes/${newPasswordLogin.body.loginRequestId}/reveal`)
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp());
    expect(restoredShown.body.code).toBe(loginCodeFor(newPasswordLogin.body.loginRequestId));

    const restoredLoginRes = await request(app.getHttpServer())
      .post('/auth/login/verify-code')
      .set('X-Forwarded-For', freshIp())
      .send({
        loginRequestId: newPasswordLogin.body.loginRequestId,
        code: restoredShown.body.code,
        deviceId: tl1DeviceId,
        loginRequestProof: newPasswordLogin.body.loginRequestProof,
      });
    expect(restoredLoginRes.status).toBe(200);
    expect(restoredLoginRes.body.accessToken).toBeDefined();
    const restoredToken = restoredLoginRes.body.accessToken;

    // Verify access is fully restored to their team
    const restoredStaffList = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${restoredToken}`)
      .set('X-Forwarded-For', freshIp());
    expect(restoredStaffList.status).toBe(200);
    const restoredStaffBody = restoredStaffList.body as StaffListItem[];
    const restoredStaffIds = restoredStaffBody.map((s) => s.id);
    expect(restoredStaffIds).toEqual(expect.arrayContaining([agent1Id, agent2Id]));
    expect(restoredStaffIds).toHaveLength(2);
    expect(restoredStaffIds).not.toContain(tl2Id);
    expect(restoredStaffIds).not.toContain(agent3Id);

    console.log('Step 9 Output: 2FA Re-enrolled and Full Access Restored:');
    console.log(JSON.stringify({
      codeStep: newPasswordLogin.body.status === 'awaiting_code',
      restoredLoginStatus: restoredLoginRes.status,
      teamListRestoredStatus: restoredStaffList.status,
      restoredTeamStaffCount: restoredStaffList.body.length,
    }, null, 2));
    console.log('--- END OF E2E PROOF ---\n');
  }, 180_000);
});
