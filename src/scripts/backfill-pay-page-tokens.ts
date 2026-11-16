/**
 * Security L3: a one-off backfill for the pay page token (INF-1). Payment
 * requests made before page tokens have no Payment.pageTokenHash; the old
 * /p/fee/<upiReference> fallback that kept their links working is removed, so
 * this gives every such request that is still waiting for money its page token
 * hash and (with --resend) sends the payer the new link.
 *
 * Run once from the Render shell of the web service, right after the release
 * with this change is live (DEPLOY.md, "Pay page tokens: one-off backfill"):
 *
 *     npm run backfill:pay-page-tokens -- --resend
 *
 * Without --resend it only saves the hashes and lists the payment codes, so the
 * links can be re-sent from the office screens instead. Safe to run again: a
 * request that already has its hash is left alone.
 *
 * Resuming (L3-R1): the run prints the codes it gave a token. If it stopped
 * before every link was sent (or some were "Not sent"), send just those again:
 *
 *     npm run backfill:pay-page-tokens -- --resend-codes PAY-00012,PAY-00013
 *
 * Only requests still waiting for money by UPI are sent; any other code is
 * listed as skipped.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { ensurePayPageToken } from '../modules/payment/pay-page-token';

export interface PayPageBackfillResult {
  /** Payments that got their page token hash in this run. */
  backfilled: { id: string; code: string }[];
}

/** The requests still waiting for money with no page token hash, given one. */
export async function backfillPayPageTokens(prisma: PrismaService): Promise<PayPageBackfillResult> {
  const rows = await prisma.payment.findMany({
    where: { pageTokenHash: null, status: 'pending', method: 'upi_direct' },
    select: { id: true, code: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const row of rows) await ensurePayPageToken(prisma, row.id);
  return { backfilled: rows };
}

/** `--resend-codes A,B` (or `--resend-codes=A,B`): the payment codes to send again, or null. */
export function resendCodesFromArgs(argv: string[]): string[] | null {
  const at = argv.findIndex((arg) => arg === '--resend-codes' || arg.startsWith('--resend-codes='));
  if (at < 0) return null;
  const raw = argv[at].includes('=') ? argv[at].slice(argv[at].indexOf('=') + 1) : (argv[at + 1] ?? '');
  return [...new Set(raw.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean))];
}

/**
 * L3-R1: of the named codes, the requests that can be sent again (still waiting
 * for money by UPI; each gets its page token hash if it had none), and the rest.
 */
export async function paymentsToResend(prisma: PrismaService, codes: string[]) {
  const rows = await prisma.payment.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, status: true, method: true },
  });
  const ready = rows.filter((row) => row.status === 'pending' && row.method === 'upi_direct');
  for (const row of ready) await ensurePayPageToken(prisma, row.id);
  const readyCodes = new Set(ready.map((row) => row.code));
  return {
    ready: ready.map(({ id, code }) => ({ id, code })),
    skipped: codes.filter((code) => !readyCodes.has(code)),
  };
}

@Module({ imports: [PrismaModule] })
class BackfillModule {}

async function sendLinks(rows: { id: string; code: string }[]): Promise<void> {
  // Sending goes through the full app (the message queue and the ID / ban checks before a ₹499 link).
  const { AppModule } = await import('../app.module');
  const { UpiCollectionService } = await import('../modules/payment/upi-collection.service');
  const full = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const notSent: string[] = [];
  try {
    const upi = full.get(UpiCollectionService);
    for (const row of rows) {
      try {
        await upi.resendRequest(row.id);
        process.stdout.write(`Sent a new link: ${row.code}\n`);
      } catch (error) {
        notSent.push(row.code);
        process.stdout.write(`Not sent (${row.code}): ${(error as Error).message}\n`);
        process.exitCode = 1;
      }
    }
  } finally {
    await full.close();
  }
  if (notSent.length) {
    process.stdout.write(`To try these again later: npm run backfill:pay-page-tokens -- --resend-codes ${notSent.join(',')}\n`);
  }
}

async function main(): Promise<void> {
  const resendCodes = resendCodesFromArgs(process.argv);
  const resend = resendCodes !== null || process.argv.includes('--resend');
  const app = await NestFactory.createApplicationContext(BackfillModule, { logger: ['error'] });
  let toSend: { id: string; code: string }[];
  try {
    if (resendCodes) {
      if (!resendCodes.length) throw new Error('--resend-codes needs the payment codes, separated by commas');
      const { ready, skipped } = await paymentsToResend(app.get(PrismaService), resendCodes);
      if (skipped.length) process.stdout.write(`Skipped (not waiting for money by UPI, or not found): ${skipped.join(', ')}\n`);
      toSend = ready;
    } else {
      const result = await backfillPayPageTokens(app.get(PrismaService));
      process.stdout.write(`Gave ${result.backfilled.length} waiting payment request(s) a pay page token.\n`);
      if (result.backfilled.length) process.stdout.write(`Codes: ${result.backfilled.map((r) => r.code).join(',')}\n`);
      toSend = result.backfilled;
    }
  } finally {
    await app.close();
  }
  if (!toSend.length) return;
  if (!resend) {
    process.stdout.write('Their old links no longer open. Send each a new link, or run again with --resend-codes and the codes above.\n');
    return;
  }
  await sendLinks(toSend);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
