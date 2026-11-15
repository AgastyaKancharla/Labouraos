import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { payPageTokenFor } from '../modules/payment/pay-page-token';

/**
 * Test-only. The pay page (/p/pay/<token>, /payments/request/<token>/...) opens
 * by its own page token (security INF-1), not the UPI reference a staff answer
 * shows. This finds the request by its UPI reference and returns its page token,
 * as the payer's SMS link carries it.
 */
export async function payPageTokenByReference(app: INestApplication, upiReference: string): Promise<string> {
  const payment = await app.get(PrismaService).payment.findUniqueOrThrow({ where: { upiReference }, select: { id: true } });
  return payPageTokenFor(payment.id);
}
