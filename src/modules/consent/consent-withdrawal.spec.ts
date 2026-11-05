import { randomUUID } from "crypto";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as request from "supertest";
import { AppModule } from "../../app.module";
import { PrismaService } from "../../common/prisma/prisma.service";
import { OtpService } from "../../common/otp/otp.service";
import { MockOtpProvider } from "../../common/otp/mock-otp.provider";
import { ConsentClock } from "./consent-clock";
import { ConsentService } from "./consent.service";
import { JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from "./consent.constants";
import { CALL_PURPOSES } from "../call/call-outcomes";

class TestConsentClock extends ConsentClock {
  current = new Date("2026-11-05T10:00:00.000Z");
  override now() {
    return new Date(this.current);
  }
}

describe("Phase 13 Task 1 — agent consent withdrawal", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  let consent: ConsentService;
  let clock: TestConsentClock;
  const staffIds: string[] = [];
  const seekerIds: string[] = [];
  const callIds: string[] = [];
  const createdAuditIds: string[] = [];

  beforeAll(async () => {
    clock = new TestConsentClock();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConsentClock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    consent = app.get(ConsentService);
  }, 120000);

  it("adds 'consent_withdraw' to the closed call-purpose list", () => {
    expect(CALL_PURPOSES).toContain("consent_withdraw");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditLog.deleteMany({ where: { actorId: { in: staffIds } } });
    await prisma.callRecord.deleteMany({ where: { id: { in: callIds } } });
    await prisma.consent.deleteMany({
      where: { subjectId: { in: seekerIds } },
    });
    await prisma.messageLog.deleteMany({
      where: { subjectId: { in: seekerIds } },
    });
    await prisma.statusHistory.deleteMany({
      where: { subjectId: { in: seekerIds } },
    });
    await prisma.jobSeeker.deleteMany({ where: { id: { in: seekerIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await app.close();
  });

  async function createStaff(role: string) {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const row = await prisma.staff.create({
      data: {
        code: `CW-${suffix}`,
        name: "Consent withdrawal agent",
        email: `cw-${suffix}@laboura.local`,
        passwordHash: await bcrypt.hash("Consent-Password-1", 4),
        role,
        status: "active",
      },
    });
    staffIds.push(row.id);
    return {
      row,
      token: jwt.sign({
        sub: row.id,
        role: row.role,
        code: row.code,
        email: row.email,
      }),
    };
  }

  async function createSeeker(status = "active") {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const row = await prisma.jobSeeker.create({
      data: {
        code: `JS-CW-${suffix}`,
        name: `Consent Seeker ${suffix}`,
        phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
        tradeSkill: "Electrician",
        minSalary: 1200000,
        maxSalary: 2200000,
        preferredCallWindowStart: "09:00",
        preferredCallWindowEnd: "20:00",
        status,
      },
    });
    seekerIds.push(row.id);
    return row;
  }

  async function createCall(
    staffId: string,
    subjectId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const suffix = randomUUID();
    const row = await prisma.callRecord.create({
      data: {
        code: `CR-CW-${suffix.slice(0, 10)}`,
        provider: "test",
        providerCallId: suffix,
        direction: "inbound",
        staffId,
        subjectType: "job_seeker",
        subjectId,
        purpose: "consent_withdraw",
        providerStatus: "completed",
        answered: true,
        startedAt: new Date(clock.current.getTime() - 60000),
        endedAt: new Date(clock.current.getTime() - 30000),
        ...overrides,
      },
    });
    callIds.push(row.id);
    return row;
  }

  it("refuses missing, unanswered, mismatched-agent, mismatched-seeker, and stale calls", async () => {
    const { row: agent, token } = await createStaff("call_agent");
    const other = await createStaff("field_agent");
    const seeker = await createSeeker();
    const otherSeeker = await createSeeker();
    await consent.grant({
      subjectType: "job_seeker",
      subjectId: seeker.id,
      purpose: "call_recording",
      noticeVersion: "1.0",
      language: "en",
      method: "sms_link",
    });

    const unanswered = await createCall(agent.id, seeker.id, {
      answered: false,
      providerStatus: "no_answer",
    });
    const otherAgentCall = await createCall(other.row.id, seeker.id);
    const otherSeekerCall = await createCall(agent.id, otherSeeker.id);
    const stale = await createCall(agent.id, seeker.id, {
      endedAt: new Date(clock.current.getTime() - 61 * 60_000),
    });

    const cases = [
      { jobSeekerId: seeker.id, purposes: ["call_recording"] },
      {
        jobSeekerId: seeker.id,
        purposes: ["call_recording"],
        callRecordId: unanswered.id,
      },
      {
        jobSeekerId: seeker.id,
        purposes: ["call_recording"],
        callRecordId: otherAgentCall.id,
      },
      {
        jobSeekerId: seeker.id,
        purposes: ["call_recording"],
        callRecordId: otherSeekerCall.id,
      },
      {
        jobSeekerId: seeker.id,
        purposes: ["call_recording"],
        callRecordId: stale.id,
      },
    ];
    for (const body of cases) {
      const response = await request(app.getHttpServer())
        .post("/consent/withdraw")
        .set("Authorization", `Bearer ${token}`)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/answered|recent call/i);
    }
    const stillGranted = await prisma.consent.findFirstOrThrow({
      where: { subjectId: seeker.id, purpose: "call_recording" },
    });
    expect(stillGranted.granted).toBe(true);
  });

  it("withdraws in an answered recent inbound call, pauses, texts, audits, and re-grant restores active", async () => {
    const { row: agent, token } = await createStaff("call_agent");
    const seeker = await createSeeker();
    for (const purpose of JOB_SEEKER_REQUIRED_CONSENT_PURPOSES) {
      await consent.grant({
        subjectType: "job_seeker",
        subjectId: seeker.id,
        purpose,
        noticeVersion: "1.0",
        language: "en",
        method: "sms_link",
        otpRequestId: "initial-otp",
      });
    }
    const call = await createCall(agent.id, seeker.id);
    const response = await request(app.getHttpServer())
      .post("/consent/withdraw")
      .set("Authorization", `Bearer ${token}`)
      .send({
        jobSeekerId: seeker.id,
        purposes: ["call_recording"],
        callRecordId: call.id,
      });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      withdrawn: true,
      purposes: ["call_recording"],
    });
    expect(
      await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } }),
    ).toMatchObject({ status: "paused" });
    const withdrawn = await prisma.consent.findFirstOrThrow({
      where: { subjectId: seeker.id, purpose: "call_recording" },
    });
    expect(withdrawn).toMatchObject({
      granted: false,
      withdrawnMethod: "agent_call",
      withdrawnByStaffId: agent.id,
      withdrawnCallRecordId: call.id,
    });
    expect(
      await prisma.messageLog.count({
        where: { subjectId: seeker.id, template: "consent_withdrawn" },
      }),
    ).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        actorId: agent.id,
        action: "consent_withdrawn_by_agent_call",
        entityCode: seeker.code,
      },
    });
    createdAuditIds.push(audit.id);
    expect(audit.after).toMatchObject({
      callRecordId: call.id,
      withdrawnPurposes: ["call_recording"],
    });

    const link = await request(app.getHttpServer())
      .post("/consent/links")
      .set("Authorization", `Bearer ${token}`)
      .send({ jobSeekerId: seeker.id });
    const otpRequest = await request(app.getHttpServer())
      .post("/consent/send-otp")
      .send({ token: link.body.token });
    const otpCode = (otp.getProvider() as MockOtpProvider).getCode(
      otpRequest.body.requestId,
    );
    const submit = await request(app.getHttpServer())
      .post("/consent/submit")
      .send({
        token: link.body.token,
        otpRequestId: otpRequest.body.requestId,
        otpCode,
        purposes: [...JOB_SEEKER_REQUIRED_CONSENT_PURPOSES],
        language: "en",
      });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe("active");
    expect(
      await prisma.jobSeeker.findUniqueOrThrow({ where: { id: seeker.id } }),
    ).toMatchObject({ status: "active", pausedAt: null });
    const regranted = await prisma.consent.findFirstOrThrow({
      where: { subjectId: seeker.id, purpose: "call_recording" },
    });
    expect(regranted).toMatchObject({
      granted: true,
      withdrawnAt: null,
      withdrawnMethod: null,
      withdrawnByStaffId: null,
      withdrawnCallRecordId: null,
    });
    const preserved = await prisma.auditLog.findFirstOrThrow({
      where: {
        actorId: agent.id,
        action: "consent_withdrawal_history_preserved",
        entityCode: withdrawn.id,
      },
    });
    expect(preserved.before).toMatchObject({
      withdrawnMethod: "agent_call",
      withdrawnByStaffId: agent.id,
      withdrawnCallRecordId: call.id,
    });
  }, 120000);
});
