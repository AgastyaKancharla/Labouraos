import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyTrustProxy } from '../../common/http/trust-proxy';
import { stableTotpCode } from '../../test-support/enrolled-login-spec';
import { authenticator } from 'otplib';
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

  /**
   * First-login set-up (rev 174–175): staff code + temporary password → set-up
   * ticket → (authenticator roles) QR + first code → the new password.
   * Returns the authenticator secret when one was set up.
   */
  async function setUp(code: string, tempPassword: string, deviceId: string, newPassword: string): Promise<string | null> {
    const start = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: code, password: tempPassword, deviceId });
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('setup_required');
    const ticket = { setupTicket: start.body.setupTicket, deviceId };
    let secret: string | null = null;
    let totpCode: string | undefined;
    if (start.body.authenticatorSetupRequired) {
      const qr = await request(app.getHttpServer()).post('/auth/setup/authenticator').set('X-Forwarded-For', freshIp()).send(ticket).expect(200);
      secret = qr.body.secret as string;
      totpCode = await stableTotpCode(secret);
    }
    await request(app.getHttpServer())
      .post('/auth/setup/complete')
      .set('X-Forwarded-For', freshIp())
      .send({ ...ticket, newPassword, ...(totpCode ? { totpCode } : {}) })
      .expect(200);
    return secret;
  }

  async function clearAllStaff() {
    await prisma.staffSession.deleteMany({});
    await prisma.passwordResetRequest.deleteMany({});
    await prisma.staffPasswordReset.deleteMany({});
    await prisma.statusHistory.deleteMany({ where: { subjectType: 'staff' } });
    await prisma.businessVisit.deleteMany({});
    await prisma.contactAttempt.deleteMany({});
    await prisma.callbackTask.deleteMany({});
    await prisma.target.deleteMany({});
    await prisma.jobSeeker.updateMany({ data: { registeredByStaffId: null } });
    await prisma.placement.updateMany({ data: { createdByStaffId: null } });
    await prisma.vacancy.updateMany({ data: { capturedByStaffId: null } });
    await prisma.staff.updateMany({ data: { teamLeadId: null, reportsToId: null, tempPasswordIssuedByStaffId: null } });
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
    // STEP 1: Bootstrap a CEO using the secret, on an empty database (temporary password, shown once)
    // =========================================================================
    console.log('\n--- STEP 1: Bootstrap CEO on empty database ---');
    const bootstrapRes = await request(app.getHttpServer())
      .post('/staff/bootstrap')
      .set('X-Forwarded-For', freshIp())
      .set('x-bootstrap-secret', BOOTSTRAP_SECRET)
      .send({ name: 'Agastya CEO' });

    expect(bootstrapRes.status).toBe(201);
    expect(bootstrapRes.headers['cache-control']).toContain('no-store');
    expect(bootstrapRes.body.staff.role).toBe('ceo');
    expect(bootstrapRes.body.staff.status).toBe('pending_invite');
    expect(bootstrapRes.body.tempPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(bootstrapRes.body.totpSecret).toBeUndefined(); // no secret returned
    const staffRow = await prisma.staff.findUniqueOrThrow({ where: { id: bootstrapRes.body.staff.id } });
    expect(staffRow.totpEnabled).toBe(false);
    expect(staffRow.totpSecret).toBeNull();
    console.log('Step 1 Output: HTTP 201 Created');
    console.log(JSON.stringify({ ...bootstrapRes.body, tempPassword: '(shown once)' }, null, 2));

    // =========================================================================
    // STEP 2: The temporary password gives a set-up ticket — no session, nothing operational
    // =========================================================================
    console.log('\n--- STEP 2: First login gives only a set-up ticket ---');
    const firstLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: bootstrapRes.body.staff.code, password: bootstrapRes.body.tempPassword, deviceId: 'e2e-ceo-device' });
    expect(firstLoginRes.status).toBe(200);
    expect(firstLoginRes.body.status).toBe('setup_required');
    expect(firstLoginRes.body.accessToken).toBeUndefined();
    const probeRes = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${firstLoginRes.body.setupTicket}`)
      .set('X-Forwarded-For', freshIp());
    expect(probeRes.status).toBe(401);
    console.log('Step 2 Output: set-up ticket refused as a bearer token:', probeRes.status);

    // =========================================================================
    // STEP 3: Set the password and the authenticator in the set-up, then log in fully
    // =========================================================================
    console.log('\n--- STEP 3: Set-up (password + authenticator) and full login ---');
    const ceoPassword = 'SuperSecureCeoPassword2026!';
    const ceoTotpSecret = (await setUp(bootstrapRes.body.staff.code, bootstrapRes.body.tempPassword, 'e2e-ceo-device', ceoPassword))!;
    expect(ceoTotpSecret).toBeTruthy();
    const fullLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: bootstrapRes.body.staff.code, password: ceoPassword, deviceId: 'e2e-ceo-device', totpCode: await stableTotpCode(ceoTotpSecret) });
    expect(fullLoginRes.status).toBe(200);
    const ceoFullToken = fullLoginRes.body.accessToken;
    expect(ceoFullToken).toBeDefined();
    const ceoStaffList = await request(app.getHttpServer()).get('/staff').set('Authorization', `Bearer ${ceoFullToken}`).set('X-Forwarded-For', freshIp());
    expect(ceoStaffList.status).toBe(200);
    console.log('Step 3 Output: Full Login Successful:', JSON.stringify({ statusCode: fullLoginRes.status, staffEndpointAccessible: ceoStaffList.status === 200 }));

    // =========================================================================
    // STEP 4: Create a Team Lead and two agents under them
    // =========================================================================
    console.log('\n--- STEP 4: Create Team Lead 1, set up with the temporary password (authenticator), and add 2 agents under them ---');
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
    await setUp(createManagerRes.body.staff.code, createManagerRes.body.tempPassword, 'e2e-mgr-device', 'Manager1Password2026!');
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

    // 4b. TL1 sets up: new password and their own authenticator (Team Leads use one since rev 174–175)
    const tl1Password = 'Lead1Password2026!';
    const tl1Code = createTl1Res.body.staff.code as string;
    const tl1DeviceId = 'e2e-tl1-device';
    const tl1Secret = (await setUp(tl1Code, createTl1Res.body.tempPassword, tl1DeviceId, tl1Password))!;
    expect(tl1Secret).toBeTruthy();

    // 4c. TL1's device waits for approval by a Manager or the CEO.
    const tl1WaitingDevice = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: tl1Code, password: tl1Password, deviceId: tl1DeviceId, totpCode: await stableTotpCode(tl1Secret) });
    expect(tl1WaitingDevice.status).toBe(401);
    expect(tl1WaitingDevice.body.message).toBe('This device is waiting for approval by a Manager or the CEO');
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
    // TL2 has not signed in yet: an agent can already be put under them (rev 174–175).
    expect(createTl2Res.body.staff.status).toBe('pending_invite');

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
    const tl1FullLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: tl1Code, password: tl1Password, deviceId: tl1DeviceId, totpCode: await stableTotpCode(tl1Secret) });
    expect(tl1FullLogin.status).toBe(200);
    expect(tl1FullLogin.body.status).toBeUndefined(); // no login code step for a Team Lead
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
    // STEP 8: Reset Team Lead 1's sign-in completely. Old password, authenticator and sessions all end
    // =========================================================================
    console.log('\n--- STEP 8: Reset sign-in completely: old password, authenticator and sessions all end ---');
    const reissueRes = await request(app.getHttpServer())
      .post(`/staff/${tl1Id}/reset-sign-in`)
      .set('Authorization', `Bearer ${ceoFullToken}`)
      .set('X-Forwarded-For', freshIp())
      .send();
    expect(reissueRes.status).toBe(200);
    expect(reissueRes.body.tempPassword).toBeDefined();
    const oldLoginAttempt = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: tl1Code, password: tl1Password, deviceId: tl1DeviceId, totpCode: authenticator.generate(tl1Secret) });
    expect(oldLoginAttempt.status).toBe(401);
    const oldSessionProbe = await request(app.getHttpServer()).get('/staff/sessions').set('Authorization', `Bearer ${tl1Token}`).set('X-Forwarded-For', freshIp());
    expect(oldSessionProbe.status).toBe(401);
    const resetRow = await prisma.staff.findUniqueOrThrow({ where: { id: tl1Id } });
    expect(resetRow).toMatchObject({ status: 'pending_invite', totpEnabled: false, totpSecret: null });
    console.log('Step 8 Output:', JSON.stringify({ resetStatus: reissueRes.status, oldLogin: oldLoginAttempt.status, oldSession: oldSessionProbe.status }));

    // =========================================================================
    // STEP 9: Set up again with the temporary password (new authenticator) and verify restored access
    // =========================================================================
    console.log('\n--- STEP 9: Set up again and verify restored access ---');
    const newTlPassword = 'BrandNewLead1Password2026!';
    const newTlSecret = (await setUp(tl1Code, reissueRes.body.tempPassword, tl1DeviceId, newTlPassword))!;
    expect(newTlSecret).not.toBe(tl1Secret);
    const restoredLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', freshIp())
      .send({ staffCode: tl1Code, password: newTlPassword, deviceId: tl1DeviceId, totpCode: await stableTotpCode(newTlSecret) });
    expect(restoredLoginRes.status).toBe(200);
    // Approved devices stay after a reset; the notice says who reset it.
    expect(restoredLoginRes.body.passwordResetNotice).toMatchObject({ how: 'full_reset' });
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

    console.log('Step 9 Output: Authenticator set up again and Full Access Restored:');
    console.log(JSON.stringify({
      restoredLoginStatus: restoredLoginRes.status,
      teamListRestoredStatus: restoredStaffList.status,
      restoredTeamStaffCount: restoredStaffList.body.length,
    }, null, 2));
    console.log('--- END OF E2E PROOF ---\n');
  }, 180_000);
});
