/**
 * Break-glass for a locked-out CEO when there is only one CEO (Master Guide
 * rev 174–175, rule 11). A server-side command, never reachable over HTTP:
 * run from the Render shell of the web service (DEPLOY.md, "Break-glass: a
 * locked-out CEO").
 *
 *   BREAK_GLASS_SECRET must be set on the service (at least 32 characters) and
 *   typed again as BREAK_GLASS_CONFIRM, and the CEO's staff code is named:
 *
 *     BREAK_GLASS_CONFIRM='<the same secret>' npm run break-glass:ceo -- CEO-00001
 *
 * It gives that CEO a temporary password (shown once, here only), exactly as
 * "Reset sign-in completely" does: the authenticator is removed, every session
 * ends, the account is "Not signed in yet" until the CEO sets up again
 * (selfie if needed, new password, new authenticator). Approved devices stay.
 * Refused when another active CEO exists: that CEO resets it on C-Team.
 * Writes an audit row (actor "break_glass") and a password reset history row.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { IdModule } from '../common/id/id.module';
import { AuditService } from '../common/audit/audit.service';
import { recordStatusChange } from '../common/status-history/status-history.helper';
import {
  generateTemporaryPassword,
  normaliseTemporaryPassword,
  TEMP_PASSWORD_TTL_MS,
} from '../common/auth/temporary-password';

export const BREAK_GLASS_ACTOR = 'break_glass';

export interface BreakGlassInput {
  staffCode: string;
  env: NodeJS.ProcessEnv;
  now?: Date;
}

export interface BreakGlassResult {
  code: string;
  name: string;
  tempPassword: string;
  tempPasswordExpiresAt: Date;
}

function same(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/** The work, separate from the command line so it can be tested. Throws an Error with a plain message when refused. */
export async function issueBreakGlassTempPassword(
  prisma: PrismaService,
  audit: AuditService,
  input: BreakGlassInput,
): Promise<BreakGlassResult> {
  const secret = input.env.BREAK_GLASS_SECRET?.trim() ?? '';
  const confirm = input.env.BREAK_GLASS_CONFIRM?.trim() ?? '';
  if (secret.length < 32) {
    throw new Error('BREAK_GLASS_SECRET is not set on this service (at least 32 characters). Add it in Render first.');
  }
  if (!confirm || !same(secret, confirm)) {
    throw new Error('BREAK_GLASS_CONFIRM does not match BREAK_GLASS_SECRET.');
  }
  const staffCode = input.staffCode.trim();
  if (!staffCode) throw new Error('Name the CEO by staff code, for example: npm run break-glass:ceo -- CEO-00001');
  const now = input.now ?? new Date();
  const ceo = await prisma.staff.findFirst({ where: { code: { equals: staffCode, mode: 'insensitive' } } });
  if (!ceo || ceo.role !== 'ceo') throw new Error(`${staffCode} is not a CEO account.`);
  if (ceo.status === 'deactivated') throw new Error(`${ceo.code} is deactivated.`);
  const otherCeos = await prisma.staff.count({ where: { role: 'ceo', status: 'active', id: { not: ceo.id } } });
  if (otherCeos > 0) {
    throw new Error('Another active CEO exists: they reset this CEO from C-Team ("Reset sign-in completely"). Break-glass is only for a single CEO.');
  }

  const tempPassword = generateTemporaryPassword();
  const tempHash = await bcrypt.hash(normaliseTemporaryPassword(tempPassword)!, 10);
  const placeholderHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  const expiresAt = new Date(now.getTime() + TEMP_PASSWORD_TTL_MS);

  const resetId = await prisma.$transaction(async (tx) => {
    await tx.staffPasswordReset.updateMany({ where: { staffId: ceo.id, usedAt: null, cancelledAt: null }, data: { cancelledAt: now } });
    await tx.passwordResetRequest.updateMany({ where: { staffId: ceo.id, status: { in: ['pending', 'revealed'] } }, data: { status: 'cancelled' } });
    await tx.staff.update({
      where: { id: ceo.id },
      data: {
        passwordHash: placeholderHash,
        status: 'pending_invite',
        totpSecret: null,
        totpEnabled: false,
        totpLastStep: null,
        tempPasswordHash: tempHash,
        tempPasswordExpiresAt: expiresAt,
        tempPasswordIssuedByStaffId: null,
        setupTicketHash: null,
        setupTicketDeviceId: null,
        setupTicketExpiresAt: null,
        // A wrong-try lock ends; a lock placed by a senior stays.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    const row = await tx.staffPasswordReset.create({
      data: { staffId: ceo.id, issuedByStaffId: null, kind: 'break_glass', expiresAt, createdAt: now },
      select: { id: true },
    });
    if (ceo.status !== 'pending_invite') {
      await recordStatusChange(tx, {
        subjectType: 'staff',
        subjectId: ceo.id,
        fromStatus: ceo.status,
        toStatus: 'pending_invite',
        changedByStaffId: null,
        reason: 'break_glass',
      });
    }
    await tx.staffSession.updateMany({ where: { staffId: ceo.id, revokedAt: null }, data: { revokedAt: now, endedReason: 'revoked' } });
    return row.id;
  });

  await audit.log({
    actorId: BREAK_GLASS_ACTOR,
    action: 'staff.break_glass_temp_password',
    entityType: 'staff',
    entityCode: ceo.code,
    before: { status: ceo.status, totpEnabled: ceo.totpEnabled },
    after: { status: 'pending_invite', totpEnabled: false, passwordResetId: resetId, tempPasswordExpiresAt: expiresAt.toISOString() },
    reason: 'Server break-glass command for a locked-out single CEO',
  });
  return { code: ceo.code, name: ceo.name, tempPassword, tempPasswordExpiresAt: expiresAt };
}

@Module({ imports: [PrismaModule, IdModule], providers: [AuditService] })
class BreakGlassModule {}

async function main(): Promise<void> {
  const staffCode = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
  const app = await NestFactory.createApplicationContext(BreakGlassModule, { logger: ['error'] });
  try {
    const result = await issueBreakGlassTempPassword(app.get(PrismaService), app.get(AuditService), { staffCode, env: process.env });
    process.stdout.write(
      [
        '',
        `Temporary password for ${result.name} (${result.code}): ${result.tempPassword}`,
        `Valid until ${result.tempPasswordExpiresAt.toISOString()} (24 hours). Shown only once.`,
        'Sign in at app.laboura.com/login with the staff code and this temporary password, then set a new password and a new authenticator.',
        'Now remove BREAK_GLASS_SECRET from the service environment in Render.',
        '',
      ].join('\n'),
    );
  } catch (error) {
    process.stderr.write(`Refused: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main();
}
