import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import * as request from 'supertest';
import { loginCodeFor } from '../modules/login-code/login-code.crypto';

/**
 * Test-only. Staff log in with a staff code and an approved device.
 * Management also presents a TOTP code. Everyone else receives a login code
 * and this helper submits it, so existing specs still get an access token.
 */

const TOTP_STEP_MS = 30_000;
const TOTP_SAFE_MARGIN_MS = 5_000;
const MANAGEMENT_ROLES = ['ceo', 'manager', 'finance'];

let prisma: PrismaClient | undefined;
const db = () => (prisma ??= new PrismaClient());

/** Management accounts this file enrolled (email -> undo on teardown). */
const enrolledByHelper = new Set<string>();

afterAll(async () => {
  if (!prisma) {
    return;
  }
  if (enrolledByHelper.size > 0) {
    await prisma.staff.updateMany({
      where: { email: { in: [...enrolledByHelper] } },
      data: { totpEnabled: false, totpSecret: null },
    });
  }
  await prisma.$disconnect();
  prisma = undefined;
});

/** A TOTP code that will still be valid by the time the server checks it. */
export async function stableTotpCode(secret: string): Promise<string> {
  const remaining = TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS);
  if (remaining < TOTP_SAFE_MARGIN_MS) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 50));
  }
  return authenticator.generate(secret);
}

/** Enrols a management account in TOTP if it is not already, and returns its secret. */
export async function ensureStaffEnrolled(
  email: string,
): Promise<{ secret: string | null; role?: string; code?: string; id?: string }> {
  const staff = await db().staff.findUnique({
    where: { email },
    select: { id: true, code: true, totpEnabled: true, totpSecret: true, role: true },
  });
  if (!staff) {
    return { secret: null };
  }
  if (!MANAGEMENT_ROLES.includes(staff.role)) {
    return { secret: staff.totpSecret, role: staff.role, code: staff.code, id: staff.id };
  }
  let secret = staff.totpSecret;
  if (!staff.totpEnabled || !staff.totpSecret) {
    secret = authenticator.generateSecret();
    enrolledByHelper.add(email);
    await db().staff.update({
      where: { email },
      data: { totpSecret: secret, totpEnabled: true },
    });
  }
  return { secret, role: staff.role, code: staff.code, id: staff.id };
}

export async function ensureTotpEnrolled(email: string): Promise<string | null> {
  const { secret } = await ensureStaffEnrolled(email);
  return secret;
}

type LoginCall = Promise<request.Response> & {
  /** Mirrors supertest's `.expect(status)` so existing call sites read the same. */
  expect(status: number): Promise<request.Response>;
};

export function enrolledLogin(
  server: Parameters<typeof request>[0],
  body: { email: string | null; password: string; deviceId?: string; [key: string]: unknown },
): LoginCall {
  const run = async (): Promise<request.Response> => {
    const email = body.email;
    const staff = email
      ? await db().staff.findUnique({
          where: { email },
          select: { id: true, code: true, role: true, totpEnabled: true, totpSecret: true },
        })
      : null;
    const deviceId =
      typeof body.deviceId === 'string' && body.deviceId.trim()
        ? body.deviceId.trim()
        : staff
          ? `test-device-${staff.id}`
          : 'test-device-missing';

    if (!staff) {
      return request(server).post('/auth/login').send({
        staffCode: 'missing-staff-code',
        password: body.password,
        deviceId,
      });
    }

    const management = MANAGEMENT_ROLES.includes(staff.role);
    let totpCode: string | undefined;
    if (management) {
      const { secret } = await ensureStaffEnrolled(email ?? '');
      if (secret) {
        totpCode = await stableTotpCode(secret);
      }
    }
    // Only the CEO approves his own device with his authenticator code; every
    // other role (Managers and Finance included) logs in on an approved device.
    if (staff.role !== 'ceo') {
      await db().staffDevice.upsert({
        where: { staffId_deviceId: { staffId: staff.id, deviceId } },
        create: {
          staffId: staff.id,
          deviceId,
          label: 'Test device',
          platform: 'web',
          status: 'approved',
          approvedAt: new Date(),
        },
        update: {
          status: 'approved',
          approvedAt: new Date(),
          revokedAt: null,
          revokedByStaffId: null,
        },
      });
    }

    const login = await request(server).post('/auth/login').send({
      staffCode: staff.code,
      password: body.password,
      deviceId,
      ...(totpCode ? { totpCode } : {}),
    });
    if (login.body?.status !== 'awaiting_code') {
      return login;
    }
    const code = loginCodeFor(login.body.loginRequestId as string);
    return request(server).post('/auth/login/verify-code').send({
      loginRequestId: login.body.loginRequestId,
      code,
      // The code works only for the device and sign-in that asked for it.
      deviceId,
      loginRequestProof: login.body.loginRequestProof,
    });
  };
  const call = run();
  return Object.assign(call, {
    expect: (status: number) =>
      call.then((res) => {
        if (res.status !== status) {
          throw new Error(
            `Expected login status ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
          );
        }
        return res;
      }),
  });
}
