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

@Module({ imports: [PrismaModule] })
class BackfillModule {}

async function main(): Promise<void> {
  const resend = process.argv.includes('--resend');
  const app = await NestFactory.createApplicationContext(BackfillModule, { logger: ['error'] });
  let result: PayPageBackfillResult;
  try {
    result = await backfillPayPageTokens(app.get(PrismaService));
  } finally {
    await app.close();
  }
  process.stdout.write(`Gave ${result.backfilled.length} waiting payment request(s) a pay page token.\n`);
  if (!result.backfilled.length) return;
  if (!resend) {
    process.stdout.write(`Their old links no longer open. Send each a new link: ${result.backfilled.map((r) => r.code).join(', ')}\n`);
    return;
  }
  // Sending goes through the full app (the message queue and the ID / ban checks before a ₹499 link).
  const { AppModule } = await import('../app.module');
  const { UpiCollectionService } = await import('../modules/payment/upi-collection.service');
  const full = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const upi = full.get(UpiCollectionService);
    for (const row of result.backfilled) {
      try {
        await upi.resendRequest(row.id);
        process.stdout.write(`Sent a new link: ${row.code}\n`);
      } catch (error) {
        process.stdout.write(`Not sent (${row.code}): ${(error as Error).message}\n`);
        process.exitCode = 1;
      }
    }
  } finally {
    await full.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
