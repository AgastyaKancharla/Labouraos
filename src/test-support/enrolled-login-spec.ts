import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import * as request from 'supertest';

/**
 * Test-only. Every staff login now requires a TOTP code unless the account is
 * unenrolled, and an unenrolled account only receives a scope-limited token.
 * Specs that exercise ordinary endpoints therefore log in the way a real
 * employee does: enrol the account in TOTP, then present a current code.
 */

const TOTP_STEP_MS = 30_000;
const TOTP_SAFE_MARGIN_MS = 5_000;

let prisma: PrismaClient | undefined;
const db = () => (prisma ??= new PrismaClient());

/**
 * Accounts this file enrolled that were not enrolled before (email -> original
 * state). Some specs log in as seeded accounts, which developers also use by
 * hand, so enrolment is undone when the spec file finishes.
 */
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

/** Enrols the account in TOTP if it is not already, and returns its secret. */
export async function ensureTotpEnrolled(
  email: string,
): Promise<string | null> {
  const staff = await db().staff.findUnique({
    where: { email },
    select: { totpEnabled: true, totpSecret: true },
  });
  if (!staff) {
    return null;
  }
  if (staff.totpEnabled && staff.totpSecret) {
    return staff.totpSecret;
  }
  const secret = authenticator.generateSecret();
  enrolledByHelper.add(email);
  await db().staff.update({
    where: { email },
    data: { totpSecret: secret, totpEnabled: true },
  });
  return secret;
}

type LoginCall = Promise<request.Response> & {
  /** Mirrors supertest's `.expect(status)` so existing call sites read the same. */
  expect(status: number): Promise<request.Response>;
};

export function enrolledLogin(
  server: Parameters<typeof request>[0],
  body: { email: string; password: string; [key: string]: unknown },
): LoginCall {
  const run = async (): Promise<request.Response> => {
    const secret = await ensureTotpEnrolled(body.email);
    const payload = secret
      ? { ...body, totpCode: await stableTotpCode(secret) }
      : body;
    return request(server).post('/auth/login').send(payload);
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
